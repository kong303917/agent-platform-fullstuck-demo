import time
from celery_app import celery_app
from graph import execute_graph_with_events


@celery_app.task(bind=True, name="run_agent_workflow")
def run_agent_workflow(self, payload: dict):
    """
    Celery 异步任务：接收完整的前端 payload 并执行动态 LangGraph 图。

    执行过程中通过 Redis Pub/Sub 发布 SSE 事件，
    供 FastAPI SSE 端点实时推送给前端。

    同时将执行过程和结果记录到 Supabase executions 表。

    payload 示例::

        {
            "user_input": "...",
            "agent_type": "...",
            "nodes": [
                {
                    "id": "1",
                    "type": "input",
                    "data": {"label": "User Input", "prompt": "", ...},
                },
                ...
            ],
            "edges": [{"source": "1", "target": "2"}, ...],
            "prompt": "<html>...",
            "config": {"agent_name": "...", "model": "meta/llama-3.1-70b-instruct"},
        }
    """
    start_time = time.time()

    user_input = payload.get("user_input", "")
    nodes = payload.get("nodes") or None
    edges = payload.get("edges") or None
    config = payload.get("config") or None
    task_id = self.request.id  # Celery 任务 ID

    # --- 创建 execution 记录 ---
    execution_id = None
    try:
        from database import get_supabase_client
        from crud import ExecutionCRUD

        supabase = get_supabase_client()
        execution_crud = ExecutionCRUD(supabase)
        execution = execution_crud.create({
            "task_id": task_id,
            "status": "running",
            "user_input": user_input,
            "graph_snapshot": {
                "nodes": nodes or [],
                "edges": edges or [],
            },
            "config": config or {},
        })
        execution_id = execution.get("id")
    except Exception as e:
        # execution 记录创建失败不阻塞主流程
        print(f"[Warning] Failed to create execution record: {e}")

    # 模拟预处理延时（如鉴权、限流等）
    time.sleep(1)

    try:
        # 调用带事件发布的动态 LangGraph 执行器
        result = execute_graph_with_events(
            user_input=user_input,
            task_id=task_id,
            nodes=nodes,
            edges=edges,
            config=config,
        )

        duration_ms = int((time.time() - start_time) * 1000)

        # --- 更新 execution 记录为成功 ---
        if execution_id:
            try:
                execution_crud.complete(
                    task_id=task_id,
                    result={"final_output": result.get("final_output", "")},
                    steps=result.get("intermediate_steps", []),
                    tool_results=result.get("tool_results", []),
                    duration_ms=duration_ms,
                )
            except Exception as e:
                print(f"[Warning] Failed to update execution record: {e}")

        return {
            "status": "completed",
            "agent_type": payload.get("agent_type", "default"),
            "input": user_input,
            "output": result.get("final_output", ""),
            "steps": result.get("intermediate_steps", []),
            "tool_results": result.get("tool_results", []),
            "human_responses": result.get("human_responses", {}),
            "received_config": config,
        }

    except Exception as exc:
        duration_ms = int((time.time() - start_time) * 1000)

        # --- 更新 execution 记录为失败 ---
        if execution_id:
            try:
                execution_crud.fail(
                    task_id=task_id,
                    error_message=str(exc),
                    duration_ms=duration_ms,
                )
            except Exception as e:
                print(f"[Warning] Failed to update execution error: {e}")

        raise
