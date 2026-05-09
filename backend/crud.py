"""
Supabase CRUD 操作封装

提供 workflows / prompts / prompt_versions / executions 四张表的
增删改查操作，供 FastAPI 路由调用。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from supabase import Client


# ============================================================
# Workflow CRUD
# ============================================================


class WorkflowCRUD:
    """workflows 表操作"""

    def __init__(self, client: Client):
        self.client = client
        self.table = "workflows"

    def list(self, limit: int = 50, offset: int = 0) -> list[dict]:
        """列出所有 workflows，按更新时间倒序"""
        response = (
            self.client.table(self.table)
            .select("*")
            .order("updated_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        return response.data

    def get(self, workflow_id: str) -> dict | None:
        """获取单个 workflow"""
        response = (
            self.client.table(self.table)
            .select("*")
            .eq("id", workflow_id)
            .single()
            .execute()
        )
        return response.data

    def create(self, data: dict) -> dict:
        """创建 workflow"""
        response = self.client.table(self.table).insert(data).execute()
        return response.data[0] if response.data else {}

    def update(self, workflow_id: str, data: dict) -> dict:
        """更新 workflow"""
        response = (
            self.client.table(self.table)
            .update(data)
            .eq("id", workflow_id)
            .execute()
        )
        return response.data[0] if response.data else {}

    def delete(self, workflow_id: str) -> bool:
        """删除 workflow"""
        response = (
            self.client.table(self.table)
            .delete()
            .eq("id", workflow_id)
            .execute()
        )
        return len(response.data) > 0


# ============================================================
# Prompt CRUD
# ============================================================


class PromptCRUD:
    """prompts 表操作（含版本历史）"""

    def __init__(self, client: Client):
        self.client = client
        self.table = "prompts"
        self.versions_table = "prompt_versions"

    def list(self, workflow_id: str | None = None, limit: int = 50, offset: int = 0) -> list[dict]:
        """列出 prompts，可按 workflow_id 过滤"""
        query = (
            self.client.table(self.table)
            .select("*")
            .order("updated_at", desc=True)
            .range(offset, offset + limit - 1)
        )
        if workflow_id:
            query = query.eq("workflow_id", workflow_id)
        response = query.execute()
        return response.data

    def get(self, prompt_id: str) -> dict | None:
        """获取单个 prompt"""
        response = (
            self.client.table(self.table)
            .select("*")
            .eq("id", prompt_id)
            .single()
            .execute()
        )
        return response.data

    def create(self, data: dict) -> dict:
        """创建 prompt（初始版本为 1）"""
        data.setdefault("current_version", 1)
        response = self.client.table(self.table).insert(data).execute()
        prompt = response.data[0] if response.data else {}

        # 同时在 prompt_versions 中创建初始版本
        if prompt:
            self.client.table(self.versions_table).insert({
                "prompt_id": prompt["id"],
                "version": 1,
                "content_html": data.get("content_html", ""),
                "content_text": data.get("content_text", ""),
                "variables": data.get("variables", []),
                "change_summary": "Initial version",
            }).execute()

        return prompt

    def update(self, prompt_id: str, data: dict, change_summary: str = "") -> dict:
        """更新 prompt

        触发器会自动：
        1. 将旧版本快照到 prompt_versions
        2. 递增 current_version
        """
        # 如果传了 change_summary，先获取旧数据，更新后再补充 summary
        response = (
            self.client.table(self.table)
            .update(data)
            .eq("id", prompt_id)
            .execute()
        )
        updated = response.data[0] if response.data else {}

        # 更新最新版本记录的 change_summary
        if updated and change_summary:
            # 触发器创建的版本记录是旧版本，summary 应该标注在旧版本上
            old_version = updated.get("current_version", 1) - 1
            if old_version > 0:
                self.client.table(self.versions_table).update({
                    "change_summary": change_summary,
                }).eq("prompt_id", prompt_id).eq("version", old_version).execute()

        return updated

    def delete(self, prompt_id: str) -> bool:
        """删除 prompt（级联删除版本历史）"""
        response = (
            self.client.table(self.table)
            .delete()
            .eq("id", prompt_id)
            .execute()
        )
        return len(response.data) > 0

    def list_versions(self, prompt_id: str) -> list[dict]:
        """获取 prompt 的所有版本历史"""
        response = (
            self.client.table(self.versions_table)
            .select("*")
            .eq("prompt_id", prompt_id)
            .order("version", desc=True)
            .execute()
        )
        return response.data

    def get_version(self, prompt_id: str, version: int) -> dict | None:
        """获取 prompt 的特定版本"""
        response = (
            self.client.table(self.versions_table)
            .select("*")
            .eq("prompt_id", prompt_id)
            .eq("version", version)
            .single()
            .execute()
        )
        return response.data

    def restore_version(self, prompt_id: str, version: int) -> dict:
        """恢复到指定版本（将该版本内容写回 prompts 表）"""
        version_data = self.get_version(prompt_id, version)
        if not version_data:
            raise ValueError(f"Version {version} not found for prompt {prompt_id}")

        return self.update(
            prompt_id,
            {
                "content_html": version_data["content_html"],
                "content_text": version_data["content_text"],
                "variables": version_data["variables"],
            },
            change_summary=f"Restored from version {version}",
        )


# ============================================================
# Execution CRUD
# ============================================================


class ExecutionCRUD:
    """executions 表操作"""

    def __init__(self, client: Client):
        self.client = client
        self.table = "executions"

    def list(
        self,
        workflow_id: str | None = None,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        """列出执行记录，支持按 workflow_id 和 status 过滤"""
        query = (
            self.client.table(self.table)
            .select("*")
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
        )
        if workflow_id:
            query = query.eq("workflow_id", workflow_id)
        if status:
            query = query.eq("status", status)
        response = query.execute()
        return response.data

    def get(self, execution_id: str) -> dict | None:
        """获取单条执行详情"""
        response = (
            self.client.table(self.table)
            .select("*")
            .eq("id", execution_id)
            .single()
            .execute()
        )
        return response.data

    def get_by_task_id(self, task_id: str) -> dict | None:
        """根据 Celery task_id 获取执行记录"""
        response = (
            self.client.table(self.table)
            .select("*")
            .eq("task_id", task_id)
            .single()
            .execute()
        )
        return response.data

    def create(self, data: dict) -> dict:
        """创建执行记录"""
        data.setdefault("status", "pending")
        data.setdefault("started_at", datetime.now(timezone.utc).isoformat())
        response = self.client.table(self.table).insert(data).execute()
        return response.data[0] if response.data else {}

    def update_status(self, execution_id: str, status: str, **extra: Any) -> dict:
        """更新执行状态"""
        update_data: dict[str, Any] = {"status": status, **extra}
        response = (
            self.client.table(self.table)
            .update(update_data)
            .eq("id", execution_id)
            .execute()
        )
        return response.data[0] if response.data else {}

    def complete(
        self,
        task_id: str,
        result: dict,
        steps: list,
        tool_results: list,
        duration_ms: int,
    ) -> dict:
        """标记执行完成"""
        update_data = {
            "status": "success",
            "result": result,
            "steps": steps,
            "tool_results": tool_results,
            "duration_ms": duration_ms,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }
        response = (
            self.client.table(self.table)
            .update(update_data)
            .eq("task_id", task_id)
            .execute()
        )
        return response.data[0] if response.data else {}

    def fail(self, task_id: str, error_message: str, duration_ms: int = 0) -> dict:
        """标记执行失败"""
        update_data = {
            "status": "error",
            "error_message": error_message,
            "duration_ms": duration_ms,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }
        response = (
            self.client.table(self.table)
            .update(update_data)
            .eq("task_id", task_id)
            .execute()
        )
        return response.data[0] if response.data else {}

    def cleanup(self, retention_days: int = 30) -> int:
        """清理超过指定天数的执行记录

        调用 Supabase 中的 cleanup_old_executions SQL 函数。
        """
        response = self.client.rpc(
            "cleanup_old_executions",
            {"retention_days": retention_days},
        ).execute()
        return response.data if isinstance(response.data, int) else 0
