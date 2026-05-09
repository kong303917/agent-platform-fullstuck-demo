from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from supabase import Client

from schemas import (
    ConfigSchema,
    EdgeSchema,
    ExecutionCleanupRequest,
    ExecutionCleanupResponse,
    ExecutionCreateRequest,
    ExecutionResponseSchema,
    GraphValidateRequest,
    GraphValidateResponse,
    HumanInputRequest,
    NodeSchema,
    PromptCreateRequest,
    PromptRestoreRequest,
    PromptResponseSchema,
    PromptUpdateRequest,
    PromptVersionResponseSchema,
    ToolInfo,
    WorkflowCreateRequest,
    WorkflowResponseSchema,
    WorkflowUpdateRequest,
    WorkflowRequest,
    WorkflowResponse,
)
from tasks import run_agent_workflow
from database import get_supabase_client
from crud import WorkflowCRUD, PromptCRUD, ExecutionCRUD
from graph import validate_graph, resume_graph
from tools import list_tools
from sse_manager import SSEEventSubscriber
import uvicorn


app = FastAPI(title="Agent Platform API", version="2.0.0")

# ------------------------------------------------------------------
# CORS – 允许本地前端 Next.js 开发服务器跨域访问
# ------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_origin_regex="https://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------
# API Routes – Workflow Execution (SSE 实时流)
# ------------------------------------------------------------------


@app.post("/api/v1/workflow/start")
async def start_workflow(request: WorkflowRequest):
    """启动工作流并返回 SSE 实时事件流。

    1. 发起 Celery 异步任务
    2. 返回 StreamingResponse (text/event-stream)
    3. 内部订阅 Redis Pub/Sub 频道，实时推送执行事件

    SSE 事件类型:
      - connected       : 连接建立，包含 task_id
      - node_enter      : 节点开始执行
      - llm_token       : LLM 流式 token (已做 100ms 节流)
      - step_complete   : 节点执行完成
      - tool_result     : 工具调用结果
      - workflow_complete: 工作流执行完成
      - workflow_error   : 工作流执行错误
      - heartbeat       : 心跳 (15s 间隔)
    """
    payload = {
        "user_input": request.user_input,
        "agent_type": request.agent_type,
        "nodes": [n.model_dump() for n in request.nodes],
        "edges": [e.model_dump() for e in request.edges],
        "prompt": request.prompt,
        "config": request.config.model_dump(),
    }
    task = run_agent_workflow.delay(payload)
    task_id = task.id

    async def event_generator():
        async for event in SSEEventSubscriber.subscribe(task_id):
            yield event

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Nginx 反代时禁用缓冲
        },
    )


# ------------------------------------------------------------------
# API Routes – Graph Validation
# ------------------------------------------------------------------


@app.post("/api/v1/graph/validate", response_model=GraphValidateResponse)
async def validate_graph_endpoint(request: GraphValidateRequest):
    """实时校验前端画布的图结构"""
    errors, warnings = validate_graph(
        [n.model_dump() for n in request.nodes],
        [e.model_dump() for e in request.edges],
    )
    return GraphValidateResponse(
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
    )


# ------------------------------------------------------------------
# API Routes – Human-in-the-loop
# ------------------------------------------------------------------


@app.post("/api/v1/workflow/human-input")
async def submit_human_input(request: HumanInputRequest):
    """接收人工输入，恢复被暂停的图执行。

    注意：当前版本使用 MemorySaver 内存 checkpointer，
    仅适用于单进程模式。生产环境应替换为持久化 checkpointer。
    """
    # TODO: 从存储中获取原始的 nodes/edges/config
    # 当前简化版本返回提示信息
    return {
        "status": "received",
        "message": f"Human input received for task {request.task_id}, node {request.node_id}",
        "note": "Full resume support requires persistent checkpointer (e.g., Supabase/Redis)",
    }


# ------------------------------------------------------------------
# API Routes – Tools
# ------------------------------------------------------------------


@app.get("/api/v1/tools/list", response_model=list[ToolInfo])
async def get_available_tools():
    """返回所有可用的预设工具列表"""
    tools = list_tools()
    return [
        ToolInfo(
            name=t["name"],
            description=t["description"],
            parameters=t["parameters"],
        )
        for t in tools
    ]


# ------------------------------------------------------------------
# API Routes – Workflows CRUD
# ------------------------------------------------------------------


@app.get("/api/v1/workflows", response_model=list[WorkflowResponseSchema])
async def list_workflows(
    limit: int = 50,
    offset: int = 0,
    supabase: Client = Depends(get_supabase_client),
):
    """列出所有 workflows"""
    crud = WorkflowCRUD(supabase)
    return crud.list(limit=limit, offset=offset)


@app.get("/api/v1/workflows/{workflow_id}", response_model=WorkflowResponseSchema)
async def get_workflow(
    workflow_id: str,
    supabase: Client = Depends(get_supabase_client),
):
    """获取单个 workflow"""
    crud = WorkflowCRUD(supabase)
    result = crud.get(workflow_id)
    if not result:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return result


@app.post("/api/v1/workflows", response_model=WorkflowResponseSchema, status_code=201)
async def create_workflow(
    request: WorkflowCreateRequest,
    supabase: Client = Depends(get_supabase_client),
):
    """创建 workflow"""
    crud = WorkflowCRUD(supabase)
    data = request.model_dump(exclude_none=True)
    return crud.create(data)


@app.put("/api/v1/workflows/{workflow_id}", response_model=WorkflowResponseSchema)
async def update_workflow(
    workflow_id: str,
    request: WorkflowUpdateRequest,
    supabase: Client = Depends(get_supabase_client),
):
    """更新 workflow"""
    crud = WorkflowCRUD(supabase)
    data = request.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = crud.update(workflow_id, data)
    if not result:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return result


@app.delete("/api/v1/workflows/{workflow_id}")
async def delete_workflow(
    workflow_id: str,
    supabase: Client = Depends(get_supabase_client),
):
    """删除 workflow"""
    crud = WorkflowCRUD(supabase)
    success = crud.delete(workflow_id)
    if not success:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return {"status": "deleted", "id": workflow_id}


# ------------------------------------------------------------------
# API Routes – Prompts CRUD
# ------------------------------------------------------------------


@app.get("/api/v1/prompts", response_model=list[PromptResponseSchema])
async def list_prompts(
    workflow_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
    supabase: Client = Depends(get_supabase_client),
):
    """列出 prompts，可按 workflow_id 过滤"""
    crud = PromptCRUD(supabase)
    return crud.list(workflow_id=workflow_id, limit=limit, offset=offset)


@app.get("/api/v1/prompts/{prompt_id}", response_model=PromptResponseSchema)
async def get_prompt(
    prompt_id: str,
    supabase: Client = Depends(get_supabase_client),
):
    """获取单个 prompt"""
    crud = PromptCRUD(supabase)
    result = crud.get(prompt_id)
    if not result:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return result


@app.post("/api/v1/prompts", response_model=PromptResponseSchema, status_code=201)
async def create_prompt(
    request: PromptCreateRequest,
    supabase: Client = Depends(get_supabase_client),
):
    """创建 prompt"""
    crud = PromptCRUD(supabase)
    data = request.model_dump(exclude_none=True)
    return crud.create(data)


@app.put("/api/v1/prompts/{prompt_id}", response_model=PromptResponseSchema)
async def update_prompt(
    prompt_id: str,
    request: PromptUpdateRequest,
    supabase: Client = Depends(get_supabase_client),
):
    """更新 prompt（自动创建版本快照）"""
    crud = PromptCRUD(supabase)
    change_summary = request.change_summary
    data = request.model_dump(exclude_none=True, exclude={"change_summary"})
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = crud.update(prompt_id, data, change_summary=change_summary)
    if not result:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return result


@app.delete("/api/v1/prompts/{prompt_id}")
async def delete_prompt(
    prompt_id: str,
    supabase: Client = Depends(get_supabase_client),
):
    """删除 prompt（级联删除版本历史）"""
    crud = PromptCRUD(supabase)
    success = crud.delete(prompt_id)
    if not success:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return {"status": "deleted", "id": prompt_id}


# ------------------------------------------------------------------
# API Routes – Prompt Versions
# ------------------------------------------------------------------


@app.get(
    "/api/v1/prompts/{prompt_id}/versions",
    response_model=list[PromptVersionResponseSchema],
)
async def list_prompt_versions(
    prompt_id: str,
    supabase: Client = Depends(get_supabase_client),
):
    """获取 prompt 的所有版本历史"""
    crud = PromptCRUD(supabase)
    return crud.list_versions(prompt_id)


@app.get(
    "/api/v1/prompts/{prompt_id}/versions/{version}",
    response_model=PromptVersionResponseSchema,
)
async def get_prompt_version(
    prompt_id: str,
    version: int,
    supabase: Client = Depends(get_supabase_client),
):
    """获取 prompt 的特定版本"""
    crud = PromptCRUD(supabase)
    result = crud.get_version(prompt_id, version)
    if not result:
        raise HTTPException(status_code=404, detail="Version not found")
    return result


@app.post(
    "/api/v1/prompts/{prompt_id}/restore",
    response_model=PromptResponseSchema,
)
async def restore_prompt_version(
    prompt_id: str,
    request: PromptRestoreRequest,
    supabase: Client = Depends(get_supabase_client),
):
    """恢复 prompt 到指定版本"""
    crud = PromptCRUD(supabase)
    try:
        result = crud.restore_version(prompt_id, request.version)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ------------------------------------------------------------------
# API Routes – Executions CRUD
# ------------------------------------------------------------------


@app.get("/api/v1/executions", response_model=list[ExecutionResponseSchema])
async def list_executions(
    workflow_id: str | None = None,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
    supabase: Client = Depends(get_supabase_client),
):
    """列出执行记录"""
    crud = ExecutionCRUD(supabase)
    return crud.list(
        workflow_id=workflow_id,
        status=status,
        limit=limit,
        offset=offset,
    )


@app.get("/api/v1/executions/{execution_id}", response_model=ExecutionResponseSchema)
async def get_execution(
    execution_id: str,
    supabase: Client = Depends(get_supabase_client),
):
    """获取单条执行详情"""
    crud = ExecutionCRUD(supabase)
    result = crud.get(execution_id)
    if not result:
        raise HTTPException(status_code=404, detail="Execution not found")
    return result


@app.post("/api/v1/executions", response_model=ExecutionResponseSchema, status_code=201)
async def create_execution(
    request: ExecutionCreateRequest,
    supabase: Client = Depends(get_supabase_client),
):
    """创建执行记录"""
    crud = ExecutionCRUD(supabase)
    data = request.model_dump(exclude_none=True)
    return crud.create(data)


@app.post("/api/v1/executions/cleanup", response_model=ExecutionCleanupResponse)
async def cleanup_executions(
    request: ExecutionCleanupRequest,
    supabase: Client = Depends(get_supabase_client),
):
    """清理超过指定天数的执行记录"""
    crud = ExecutionCRUD(supabase)
    deleted_count = crud.cleanup(retention_days=request.retention_days)
    return ExecutionCleanupResponse(
        deleted_count=deleted_count,
        retention_days=request.retention_days,
    )


# ------------------------------------------------------------------
# API Routes – Health Check
# ------------------------------------------------------------------


@app.get("/api/v1/health/db")
async def check_db_health(supabase: Client = Depends(get_supabase_client)):
    """验证 Supabase 连接和表结构是否正常"""
    try:
        # 查询 workflows 表验证连通性
        response = supabase.table("workflows").select("id").limit(1).execute()
        return {
            "status": "ok",
            "message": "Supabase connection is alive",
            "tables": {
                "workflows": "accessible",
                "prompts": "accessible",
                "prompt_versions": "accessible",
                "executions": "accessible",
            },
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
