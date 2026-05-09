"""
SSE 事件管理器

基于 Redis Pub/Sub 实现 Celery Worker → FastAPI 的跨进程事件传递。

使用方式：
  - Worker 端 (同步): SSEEventPublisher.publish(task_id, event_type, data)
  - API 端   (异步): async for event in SSEEventSubscriber.subscribe(task_id): ...
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any, AsyncGenerator

import redis
import redis.asyncio as aioredis
from dotenv import load_dotenv
from urllib.parse import quote

load_dotenv()

# ============================================================
# Redis 连接配置
# ============================================================

REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_USERNAME = os.getenv("REDIS_USERNAME", "")
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "")

_encoded_password = quote(REDIS_PASSWORD, safe="")

if REDIS_USERNAME:
    REDIS_URL = f"redis://{REDIS_USERNAME}:{_encoded_password}@{REDIS_HOST}:{REDIS_PORT}/0"
else:
    REDIS_URL = f"redis://:{_encoded_password}@{REDIS_HOST}:{REDIS_PORT}/0"


def _channel_name(task_id: str) -> str:
    """生成 Redis Pub/Sub 频道名称。"""
    return f"workflow:{task_id}:events"


# ============================================================
# Publisher (同步 — Celery Worker 使用)
# ============================================================


class SSEEventPublisher:
    """同步事件发布器，在 Celery Worker 进程中使用。"""

    _client: redis.Redis | None = None

    @classmethod
    def _get_client(cls) -> redis.Redis:
        if cls._client is None:
            cls._client = redis.from_url(REDIS_URL, decode_responses=True)
        return cls._client

    @classmethod
    def publish(cls, task_id: str, event_type: str, data: dict[str, Any]) -> None:
        """发布一个 SSE 事件到 Redis 频道。

        Parameters
        ----------
        task_id : str
            Celery 任务 ID，用于构建频道名
        event_type : str
            事件类型，如 node_enter, llm_token, step_complete 等
        data : dict
            事件数据载荷
        """
        client = cls._get_client()
        message = json.dumps({
            "event": event_type,
            "data": data,
            "timestamp": time.time(),
        })
        client.publish(_channel_name(task_id), message)

    @classmethod
    def publish_node_enter(
        cls, task_id: str, node_id: str, node_label: str, node_type: str
    ) -> None:
        cls.publish(task_id, "node_enter", {
            "node_id": node_id,
            "node_label": node_label,
            "node_type": node_type,
        })

    @classmethod
    def publish_llm_token(
        cls, task_id: str, node_id: str, token: str, accumulated: str
    ) -> None:
        cls.publish(task_id, "llm_token", {
            "node_id": node_id,
            "token": token,
            "accumulated": accumulated,
        })

    @classmethod
    def publish_step_complete(
        cls, task_id: str, node_id: str, result: str, duration_ms: float
    ) -> None:
        cls.publish(task_id, "step_complete", {
            "node_id": node_id,
            "result": result,
            "duration_ms": round(duration_ms, 2),
        })

    @classmethod
    def publish_tool_result(
        cls, task_id: str, node_id: str, tool_name: str, result: str, duration_ms: float
    ) -> None:
        cls.publish(task_id, "tool_result", {
            "node_id": node_id,
            "tool_name": tool_name,
            "result": result,
            "duration_ms": round(duration_ms, 2),
        })

    @classmethod
    def publish_workflow_complete(
        cls, task_id: str, final_output: str, steps: list[str],
        tool_results: list[dict], human_responses: dict
    ) -> None:
        cls.publish(task_id, "workflow_complete", {
            "status": "completed",
            "final_output": final_output,
            "steps": steps,
            "tool_results": tool_results,
            "human_responses": human_responses,
        })

    @classmethod
    def publish_workflow_error(
        cls, task_id: str, error: str, node_id: str = ""
    ) -> None:
        cls.publish(task_id, "workflow_error", {
            "error": error,
            "node_id": node_id,
        })


# ============================================================
# Subscriber (异步 — FastAPI 端点使用)
# ============================================================

# 心跳间隔 (秒)
HEARTBEAT_INTERVAL = 15
# 超时时间 (秒) — 5 分钟无 complete 事件则自动关闭
STREAM_TIMEOUT = 300


class SSEEventSubscriber:
    """异步事件订阅器，在 FastAPI SSE 端点中使用。"""

    @staticmethod
    async def subscribe(task_id: str) -> AsyncGenerator[str, None]:
        """订阅指定任务的事件流，yield SSE 格式的文本。

        Yields
        ------
        str
            SSE 格式: "event: xxx\\ndata: {...}\\n\\n"
        """
        client = aioredis.from_url(REDIS_URL, decode_responses=True)
        pubsub = client.pubsub()
        channel = _channel_name(task_id)

        try:
            await pubsub.subscribe(channel)

            # 先发一个初始事件告知连接建立
            yield _format_sse("connected", {"task_id": task_id})

            start_time = time.time()
            last_heartbeat = time.time()

            while True:
                # 检查超时
                elapsed = time.time() - start_time
                if elapsed > STREAM_TIMEOUT:
                    yield _format_sse("timeout", {"message": "Stream timed out after 5 minutes"})
                    break

                # 尝试获取消息 (非阻塞，100ms 超时)
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=0.1
                )

                if message and message["type"] == "message":
                    raw = message["data"]
                    try:
                        parsed = json.loads(raw)
                        event_type = parsed.get("event", "unknown")
                        event_data = parsed.get("data", {})

                        yield _format_sse(event_type, event_data)

                        # 终止事件 — 收到后结束流
                        if event_type in ("workflow_complete", "workflow_error"):
                            break
                    except json.JSONDecodeError:
                        continue

                # 心跳
                now = time.time()
                if now - last_heartbeat >= HEARTBEAT_INTERVAL:
                    yield _format_sse("heartbeat", {"ts": now})
                    last_heartbeat = now

                # 无消息时短暂让出事件循环
                if not message or message["type"] != "message":
                    await asyncio.sleep(0.05)

        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.close()
            await client.close()


def _format_sse(event: str, data: dict[str, Any]) -> str:
    """将事件格式化为 SSE 文本。"""
    json_data = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {json_data}\n\n"
