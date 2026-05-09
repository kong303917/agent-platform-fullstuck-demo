"""
统一的 Pydantic 数据模型

定义前后端交互的完整数据结构，包括 React Flow 节点/边的解析模型。
"""

from __future__ import annotations

from pydantic import BaseModel, Field


# ============================================================
# Node / Edge Schemas – 对应前端 React Flow 结构
# ============================================================


class NodeData(BaseModel):
    """React Flow 节点的 data 字段。

    不同节点类型会使用不同的字段组合：
    - input:        label
    - llm_call:     label, prompt
    - tool_call:    label, tool_name, tool_config
    - condition:    label, condition_key, condition_map
    - human_input:  label, prompt (作为提示语)
    - output:       label, prompt
    - default:      label
    """

    label: str = ""
    prompt: str = ""
    tool_name: str = ""
    tool_config: dict = Field(default_factory=dict)
    condition_key: str = ""
    # condition_map: 条件值 → 目标节点 ID
    # 例如: {"approved": "node_3", "rejected": "node_4", "__default__": "node_5"}
    condition_map: dict[str, str] = Field(default_factory=dict)


class NodeSchema(BaseModel):
    """单个节点定义。

    type 枚举:
      input | llm_call | tool_call | condition | human_input | output | default
    """

    id: str
    type: str = "default"
    data: NodeData = Field(default_factory=NodeData)

    # 兼容旧接口：如果前端只传了 label 而不是 data.label
    label: str = ""

    def get_label(self) -> str:
        return self.data.label or self.label or self.id


class EdgeSchema(BaseModel):
    """单条边定义。"""

    id: str = ""
    source: str
    target: str
    label: str = ""  # 条件边的标签
    source_handle: str = ""  # React Flow handle ID


# ============================================================
# Config
# ============================================================


class ConfigSchema(BaseModel):
    agent_name: str = "default"
    model: str = "meta/llama-3.1-70b-instruct"


# ============================================================
# Request / Response
# ============================================================


class WorkflowRequest(BaseModel):
    user_input: str
    agent_type: str = "default"
    nodes: list[NodeSchema] = Field(default_factory=list)
    edges: list[EdgeSchema] = Field(default_factory=list)
    prompt: str = ""
    config: ConfigSchema = Field(default_factory=ConfigSchema)


class WorkflowResponse(BaseModel):
    task_id: str
    status: str


class GraphValidateRequest(BaseModel):
    nodes: list[NodeSchema]
    edges: list[EdgeSchema]


class GraphValidateResponse(BaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class HumanInputRequest(BaseModel):
    """Human-in-the-loop: 用户提交的人工输入"""

    task_id: str
    node_id: str
    user_input: str


class ToolInfo(BaseModel):
    """工具信息，供前端展示"""

    name: str
    description: str
    parameters: dict = Field(default_factory=dict)


# ============================================================
# SSE Event Models
# ============================================================


class SSENodeEnterEvent(BaseModel):
    """节点开始执行事件"""

    node_id: str
    node_label: str
    node_type: str


class SSELLMTokenEvent(BaseModel):
    """LLM Token 流式推送事件"""

    node_id: str
    token: str
    accumulated: str


class SSEStepCompleteEvent(BaseModel):
    """节点执行完成事件"""

    node_id: str
    result: str
    duration_ms: float


class SSEToolResultEvent(BaseModel):
    """工具调用结果事件"""

    node_id: str
    tool_name: str
    result: str
    duration_ms: float


class SSEWorkflowCompleteEvent(BaseModel):
    """工作流执行完成事件"""

    status: str = "completed"
    final_output: str = ""
    steps: list[str] = Field(default_factory=list)
    tool_results: list[dict] = Field(default_factory=list)
    human_responses: dict = Field(default_factory=dict)


class SSEWorkflowErrorEvent(BaseModel):
    """工作流执行错误事件"""

    error: str
    node_id: str = ""


# ============================================================
# Workflow CRUD Schemas
# ============================================================


class WorkflowCreateRequest(BaseModel):
    """创建 workflow 的请求"""

    name: str = "Untitled Workflow"
    description: str = ""
    graph_data: dict = Field(default_factory=lambda: {"nodes": [], "edges": []})
    config: dict = Field(default_factory=dict)


class WorkflowUpdateRequest(BaseModel):
    """更新 workflow 的请求"""

    name: str | None = None
    description: str | None = None
    graph_data: dict | None = None
    config: dict | None = None


class WorkflowResponseSchema(BaseModel):
    """workflow 响应"""

    id: str
    name: str
    description: str = ""
    graph_data: dict = Field(default_factory=dict)
    config: dict = Field(default_factory=dict)
    created_at: str
    updated_at: str


# ============================================================
# Prompt CRUD Schemas
# ============================================================


class PromptCreateRequest(BaseModel):
    """创建 prompt 的请求"""

    name: str = "Untitled Prompt"
    content_html: str = ""
    content_text: str = ""
    variables: list[str] = Field(default_factory=list)
    workflow_id: str | None = None


class PromptUpdateRequest(BaseModel):
    """更新 prompt 的请求"""

    name: str | None = None
    content_html: str | None = None
    content_text: str | None = None
    variables: list[str] | None = None
    workflow_id: str | None = None
    change_summary: str = ""


class PromptResponseSchema(BaseModel):
    """prompt 响应"""

    id: str
    name: str
    content_html: str = ""
    content_text: str = ""
    variables: list = Field(default_factory=list)
    current_version: int = 1
    workflow_id: str | None = None
    created_at: str
    updated_at: str


class PromptVersionResponseSchema(BaseModel):
    """prompt 版本历史响应"""

    id: str
    prompt_id: str
    version: int
    content_html: str = ""
    content_text: str = ""
    variables: list = Field(default_factory=list)
    change_summary: str = ""
    created_at: str


class PromptRestoreRequest(BaseModel):
    """恢复到指定版本的请求"""

    version: int


# ============================================================
# Execution CRUD Schemas
# ============================================================


class ExecutionCreateRequest(BaseModel):
    """创建执行记录的请求"""

    workflow_id: str | None = None
    task_id: str = ""
    user_input: str = ""
    graph_snapshot: dict = Field(default_factory=dict)
    config: dict = Field(default_factory=dict)


class ExecutionResponseSchema(BaseModel):
    """执行记录响应"""

    id: str
    workflow_id: str | None = None
    task_id: str = ""
    status: str = "pending"
    user_input: str = ""
    graph_snapshot: dict = Field(default_factory=dict)
    result: dict = Field(default_factory=dict)
    steps: list = Field(default_factory=list)
    tool_results: list = Field(default_factory=list)
    error_message: str = ""
    duration_ms: int = 0
    config: dict = Field(default_factory=dict)
    started_at: str | None = None
    completed_at: str | None = None
    created_at: str


class ExecutionCleanupRequest(BaseModel):
    """执行记录清理请求"""

    retention_days: int = Field(default=30, ge=1, le=365)


class ExecutionCleanupResponse(BaseModel):
    """执行记录清理响应"""

    deleted_count: int
    retention_days: int
