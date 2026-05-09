"""
动态 LangGraph 构建器 v2

根据前端传入的 nodes / edges JSON，动态创建 StateGraph 并执行。

支持的节点类型:
  - input        → 入口节点，记录输入
  - llm_call     → 调用大模型推理，支持自定义 prompt
  - tool_call    → 调用预设工具（calculator, web_search 等）
  - condition    → 条件路由，根据 state 值分发到不同分支
  - human_input  → Human-in-the-loop，暂停执行等待人工输入
  - output       → 末端节点，生成最终输出
  - default      → 通用推理占位节点
"""

from __future__ import annotations

import os
from collections import deque
from typing import Annotated, Any, TypedDict

import operator
from langchain_core.messages import HumanMessage, SystemMessage
from langchain.chat_models import init_chat_model
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from tools import execute_tool


def _get_llm_provider_model(model_name: str) -> tuple[str, str]:
    """解析模型字符串 (例如 'openai/gpt-4o') 获取 provider 和实际模型名"""
    provider = "nvidia"
    if "/" in model_name:
        provider, model_name = model_name.split("/", 1)
    return provider, model_name


def _check_api_key(provider: str) -> bool:
    """检查提供商对应的 API Key 是否已配置"""
    keys = {
        "nvidia": "NVIDIA_API_KEY",
        "openai": "OPENAI_API_KEY",
        "anthropic": "ANTHROPIC_API_KEY",
        "google_genai": "GOOGLE_API_KEY",
    }
    key_name = keys.get(provider)
    if not key_name:
        return True
    api_key = os.getenv(key_name, "")
    return bool(api_key and "your_" not in api_key)


# ============================================================
# State Schema
# ============================================================


class AgentState(TypedDict):
    """图执行期间的全局状态。"""

    input: str
    intermediate_steps: Annotated[list[str], operator.add]
    final_output: str
    # v2 新增
    current_node: str
    tool_results: Annotated[list[dict], operator.add]
    condition_values: dict
    messages: Annotated[list, operator.add]
    human_responses: dict  # node_id → 用户输入


# ============================================================
# Node Factory – 根据前端传入的类型动态生成可执行节点
# ============================================================


def _make_input_node(label: str):
    """入口节点：记录 input 到 intermediate_steps"""

    def node_fn(state: AgentState) -> dict:
        return {
            "intermediate_steps": [f"[{label}] Received input: {state['input']}"],
            "current_node": label,
        }

    return node_fn


def _make_reasoning_node(label: str):
    """中间推理节点：对输入进行分析"""

    def node_fn(state: AgentState) -> dict:
        return {
            "intermediate_steps": [f"[{label}] Analyzed: {state['input']}"],
            "current_node": label,
        }

    return node_fn


def _make_llm_call_node(label: str, model_name: str, prompt_template: str = ""):
    """LLM 调用节点：使用自定义 prompt 调用大模型。

    prompt_template 中可以使用 {input} 占位符引用用户输入。
    """

    def node_fn(state: AgentState) -> dict:
        step_msg = f"[{label}] Calling LLM ({model_name})..."

        # 构建消息
        messages = []
        if prompt_template:
            # 将 prompt 模板中的 {input} 替换为实际输入
            system_content = prompt_template.replace("{input}", state["input"])
            messages.append(SystemMessage(content=system_content))

        messages.append(HumanMessage(content=state["input"]))

        # 根据 provider 检查 API Key
        provider, real_model_name = _get_llm_provider_model(model_name)
        if not _check_api_key(provider):
            return {
                "intermediate_steps": [step_msg + f" ({provider} API Key 未配置, 返回 mock)"],
                "current_node": label,
                "messages": [{"role": "assistant", "content": f"[Mock LLM] {state['input']}"}],
            }

        llm = init_chat_model(model=real_model_name, model_provider=provider)
        response = llm.invoke(messages)

        return {
            "intermediate_steps": [step_msg],
            "current_node": label,
            "messages": [{"role": "assistant", "content": response.content}],
        }

    return node_fn


def _make_tool_call_node(label: str, tool_name: str, tool_config: dict):
    """工具调用节点：调度工具注册表中的工具执行。"""

    def node_fn(state: AgentState) -> dict:
        step_msg = f"[{label}] Calling tool '{tool_name}'..."

        # 合并 tool_config 和 state 中的输入
        kwargs = {**tool_config, "text": state["input"], "query": state["input"]}
        # 如果 tool_config 中已有 expression/code 等字段，优先使用
        if "expression" not in kwargs:
            kwargs["expression"] = state["input"]
        if "code" not in kwargs:
            kwargs["code"] = state["input"]

        result = execute_tool(tool_name, **kwargs)

        return {
            "intermediate_steps": [step_msg, f"[{label}] Tool result: {result[:200]}"],
            "current_node": label,
            "tool_results": [{"tool": tool_name, "result": result}],
        }

    return node_fn


def _make_condition_node(label: str, condition_key: str):
    """条件判断节点：检查 state 中的值，写入 condition_values 供路由函数读取。

    条件判断逻辑：
    1. 优先检查 state["condition_values"] 中是否有 condition_key
    2. 其次检查最近的 tool_results
    3. 最后基于 input 长度做简单判断
    """

    def node_fn(state: AgentState) -> dict:
        # 尝试从已有的 condition_values 获取
        existing = state.get("condition_values", {})
        value = existing.get(condition_key)

        if value is None:
            # 从最近的 tool_results 推断
            tool_results = state.get("tool_results", [])
            if tool_results:
                last_result = tool_results[-1].get("result", "")
                if "[Error]" in last_result:
                    value = "error"
                else:
                    value = "success"
            else:
                # 基于 input 的简单判断
                user_input = state.get("input", "")
                value = "long" if len(user_input) > 100 else "short"

        step_msg = f"[{label}] Condition '{condition_key}' evaluated to: {value}"

        return {
            "intermediate_steps": [step_msg],
            "current_node": label,
            "condition_values": {**existing, condition_key: str(value)},
        }

    return node_fn


def _make_human_input_node(label: str, prompt_text: str = ""):
    """Human-in-the-loop 节点：使用 LangGraph interrupt 暂停执行。

    当图执行到此节点时会暂停，等待外部提供 human_response 后恢复。
    """

    def node_fn(state: AgentState) -> dict:
        display_prompt = prompt_text or f"请提供 '{label}' 所需的输入"
        step_msg = f"[{label}] Waiting for human input: {display_prompt}"

        # 使用 LangGraph 的 interrupt 机制暂停
        human_response = interrupt(
            {
                "node_id": label,
                "prompt": display_prompt,
                "current_input": state["input"],
            }
        )

        return {
            "intermediate_steps": [
                step_msg,
                f"[{label}] Human responded: {str(human_response)[:200]}",
            ],
            "current_node": label,
            "human_responses": {
                **state.get("human_responses", {}),
                label: str(human_response),
            },
        }

    return node_fn


def _make_output_node(label: str, model_name: str, prompt_template: str = ""):
    """输出节点：汇总上下文，调用 LLM 生成最终输出。"""

    def node_fn(state: AgentState) -> dict:
        step_msg = f"[{label}] Generating final output ({model_name})..."

        # 构建上下文：包含中间步骤和工具结果
        context_parts = []
        for step in state.get("intermediate_steps", []):
            context_parts.append(step)
        for tr in state.get("tool_results", []):
            context_parts.append(f"Tool [{tr['tool']}]: {tr['result']}")

        context = "\n".join(context_parts) if context_parts else "No context available."
        user_input = state["input"]

        # 构建消息
        system_content = prompt_template or "You are a helpful assistant. Synthesize the context and provide a clear answer."
        system_content = system_content.replace("{input}", user_input)
        system_content += f"\n\n--- Context ---\n{context}"

        # 根据 provider 检查 API Key
        provider, real_model_name = _get_llm_provider_model(model_name)
        if not _check_api_key(provider):
            return {
                "intermediate_steps": [step_msg + f" ({provider} API Key 未配置, 返回 mock)"],
                "current_node": label,
                "final_output": f"[Mock Output] Processed: {user_input}\nContext: {context[:300]}",
            }

        llm = init_chat_model(model=real_model_name, model_provider=provider)
        response = llm.invoke(
            [
                SystemMessage(content=system_content),
                HumanMessage(content=user_input),
            ]
        )

        return {
            "intermediate_steps": [step_msg],
            "current_node": label,
            "final_output": response.content,
        }

    return node_fn


# ============================================================
# Graph Validation
# ============================================================


def validate_graph(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> tuple[list[str], list[str]]:
    """验证图结构的合法性。

    Returns
    -------
    (errors, warnings)
        errors: 阻塞性错误列表
        warnings: 警告列表
    """
    errors: list[str] = []
    warnings: list[str] = []

    if not nodes:
        errors.append("图中没有任何节点")
        return errors, warnings

    node_ids = {n["id"] for n in nodes}
    node_map = {n["id"]: n for n in nodes}

    # 1. 检查边引用的节点是否存在
    for e in edges:
        if e["source"] not in node_ids:
            errors.append(f"边 ({e['source']} → {e['target']}): 源节点 '{e['source']}' 不存在")
        if e["target"] not in node_ids:
            errors.append(f"边 ({e['source']} → {e['target']}): 目标节点 '{e['target']}' 不存在")

    if errors:
        return errors, warnings

    # 2. 构建邻接关系
    outgoing: dict[str, list[str]] = {nid: [] for nid in node_ids}
    incoming: dict[str, list[str]] = {nid: [] for nid in node_ids}
    for e in edges:
        outgoing[e["source"]].append(e["target"])
        incoming[e["target"]].append(e["source"])

    # 3. 入口节点检查
    entry_ids = [nid for nid in node_ids if not incoming[nid]]
    input_typed = [nid for nid, n in node_map.items() if n.get("type") == "input"]

    if not entry_ids and not input_typed:
        errors.append("找不到入口节点（没有入边且类型非 'input' 的节点）")

    # 4. 出口节点检查
    exit_ids = [nid for nid in node_ids if not outgoing[nid]]
    if not exit_ids:
        warnings.append("所有节点都有出边，可能存在无限循环")

    # 5. 孤立节点检查
    for nid in node_ids:
        if not incoming[nid] and not outgoing[nid] and nid not in (entry_ids or input_typed):
            warnings.append(f"节点 '{nid}' 是孤立的（没有入边也没有出边）")

    # 6. 环路检测（Kahn's algorithm）
    in_degree = {nid: len(incoming[nid]) for nid in node_ids}
    queue = deque([nid for nid, deg in in_degree.items() if deg == 0])
    visited_count = 0

    while queue:
        curr = queue.popleft()
        visited_count += 1
        for neighbor in outgoing[curr]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    if visited_count < len(node_ids):
        # 有环，但条件节点可能合法地形成环路
        has_condition = any(n.get("type") == "condition" for n in nodes)
        if has_condition:
            warnings.append("检测到环路结构（含条件节点，可能是合法的重试/循环逻辑）")
        else:
            errors.append("检测到无条件环路，可能导致无限执行")

    # 7. 条件节点分支检查
    for n in nodes:
        if n.get("type") == "condition":
            nid = n["id"]
            data = n.get("data", {})
            condition_map = data.get("condition_map", {})
            actual_targets = set(outgoing.get(nid, []))

            if not condition_map:
                warnings.append(f"条件节点 '{nid}' 没有配置 condition_map")
            else:
                mapped_targets = set(condition_map.values())
                unmapped = actual_targets - mapped_targets
                if unmapped:
                    warnings.append(
                        f"条件节点 '{nid}' 有出边指向 {unmapped}，但未在 condition_map 中映射"
                    )

    return errors, warnings


# ============================================================
# Dynamic Graph Builder
# ============================================================


def build_graph_from_payload(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    config: dict[str, Any] | None = None,
) -> Any:
    """根据前端传入的节点和边动态构建 StateGraph。

    Parameters
    ----------
    nodes : list[dict]
        每个元素至少包含 {"id", "type", "data": {"label", ...}}
    edges : list[dict]
        每个元素至少包含 {"source", "target"}
    config : dict, optional
        {"model": "meta/llama-3.1-70b-instruct", ...}

    Returns
    -------
    compiled LangGraph app (支持 interrupt / checkpointer)
    """

    config = config or {}
    model_name = config.get("model", os.getenv("NVIDIA_MODEL", "meta/llama-3.1-70b-instruct"))

    # --- 构建快速查找表 ---
    node_map: dict[str, dict] = {n["id"]: n for n in nodes}

    # --- 构建 adjacency 信息 ---
    outgoing: dict[str, list[str]] = {}
    incoming: dict[str, list[str]] = {}
    for e in edges:
        src, tgt = e["source"], e["target"]
        outgoing.setdefault(src, []).append(tgt)
        incoming.setdefault(tgt, []).append(src)

    # --- 找到入口节点和出口节点 ---
    all_ids = set(node_map.keys())
    entry_ids = [nid for nid in all_ids if nid not in incoming]
    exit_ids = [nid for nid in all_ids if nid not in outgoing]

    if not entry_ids:
        entry_ids = [nid for nid, n in node_map.items() if n.get("type") == "input"]
    if not exit_ids:
        exit_ids = [nid for nid, n in node_map.items() if n.get("type") == "output"]
    if not entry_ids:
        entry_ids = [nodes[0]["id"]]
    if not exit_ids:
        exit_ids = [nodes[-1]["id"]]

    # --- 检测是否使用 human_input 节点（需要 checkpointer）---
    has_human_input = any(n.get("type") == "human_input" for n in nodes)

    # --- 创建 StateGraph ---
    workflow = StateGraph(AgentState)

    for n in nodes:
        nid = n["id"]
        ntype = n.get("type", "default")
        data = n.get("data", {})
        label = data.get("label") or n.get("label", nid)
        prompt = data.get("prompt", "")

        if ntype == "input":
            workflow.add_node(nid, _make_input_node(label))

        elif ntype == "llm_call":
            workflow.add_node(nid, _make_llm_call_node(label, model_name, prompt))

        elif ntype == "tool_call":
            tool_name = data.get("tool_name", "calculator")
            tool_config = data.get("tool_config", {})
            workflow.add_node(nid, _make_tool_call_node(label, tool_name, tool_config))

        elif ntype == "condition":
            condition_key = data.get("condition_key", "status")
            workflow.add_node(nid, _make_condition_node(label, condition_key))

        elif ntype == "human_input":
            workflow.add_node(nid, _make_human_input_node(label, prompt))

        elif ntype == "output" or nid in exit_ids:
            workflow.add_node(nid, _make_output_node(label, model_name, prompt))

        else:
            workflow.add_node(nid, _make_reasoning_node(label))

    # --- 添加边 ---
    for e in edges:
        src = e["source"]
        src_node = node_map.get(src, {})

        # 条件节点使用 add_conditional_edges
        if src_node.get("type") == "condition":
            data = src_node.get("data", {})
            condition_key = data.get("condition_key", "status")
            condition_map = data.get("condition_map", {})

            if condition_map:
                # 已经在下面统一处理条件边，这里跳过单条边
                continue
            else:
                # 没有 condition_map 则退化为普通边
                workflow.add_edge(src, e["target"])
        else:
            workflow.add_edge(src, e["target"])

    # --- 为条件节点统一添加条件边 ---
    for n in nodes:
        if n.get("type") == "condition":
            nid = n["id"]
            data = n.get("data", {})
            condition_key = data.get("condition_key", "status")
            condition_map = data.get("condition_map", {})

            if condition_map:
                # 构建路由目标映射，确保 END 也被支持
                path_map = {}
                for cond_val, target_id in condition_map.items():
                    if target_id == "__END__":
                        path_map[cond_val] = END
                    else:
                        path_map[cond_val] = target_id

                # 添加 __default__ 回退
                if "__default__" not in path_map:
                    # 默认走第一条出边
                    default_targets = outgoing.get(nid, [])
                    if default_targets:
                        path_map["__default__"] = default_targets[0]
                    else:
                        path_map["__default__"] = END

                def make_route_fn(key: str, p_map: dict):
                    def route_fn(state: AgentState) -> str:
                        val = str(state.get("condition_values", {}).get(key, ""))
                        return p_map.get(val, p_map.get("__default__", END))

                    return route_fn

                workflow.add_conditional_edges(
                    nid,
                    make_route_fn(condition_key, path_map),
                    path_map,
                )

    # --- START → 入口节点 ---
    for eid in entry_ids:
        workflow.add_edge(START, eid)

    # --- 出口节点 → END（仅限无条件边的出口）---
    for eid in exit_ids:
        node_type = node_map.get(eid, {}).get("type", "")
        # 条件节点已在上面处理过
        if node_type != "condition":
            workflow.add_edge(eid, END)

    # --- 编译 ---
    if has_human_input:
        # Human-in-the-loop 需要 checkpointer
        from langgraph.checkpoint.memory import MemorySaver

        checkpointer = MemorySaver()
        return workflow.compile(checkpointer=checkpointer)
    else:
        return workflow.compile()


# ============================================================
# Public API
# ============================================================


def execute_graph(
    user_input: str,
    nodes: list[dict[str, Any]] | None = None,
    edges: list[dict[str, Any]] | None = None,
    config: dict[str, Any] | None = None,
) -> dict:
    """执行动态图。

    如果未传入 nodes/edges，则回退到默认的 3 节点线性图。
    """

    if not nodes or not edges:
        # 回退到默认硬编码图
        nodes = [
            {"id": "1", "type": "input", "data": {"label": "User Input (Start)"}},
            {"id": "2", "type": "default", "data": {"label": "Agent Reasoning"}},
            {"id": "3", "type": "output", "data": {"label": "LLM Action"}},
        ]
        edges = [
            {"source": "1", "target": "2"},
            {"source": "2", "target": "3"},
        ]

    # 验证图结构
    errors, warnings = validate_graph(nodes, edges)
    if errors:
        return {
            "input": user_input,
            "intermediate_steps": [f"[Validation Error] {e}" for e in errors],
            "final_output": f"Graph validation failed: {'; '.join(errors)}",
            "current_node": "",
            "tool_results": [],
            "condition_values": {},
            "messages": [],
            "human_responses": {},
        }

    app = build_graph_from_payload(nodes, edges, config)

    # 检测是否有 human_input 节点
    has_human_input = any(n.get("type") == "human_input" for n in nodes)

    initial_state: AgentState = {
        "input": user_input,
        "intermediate_steps": [],
        "final_output": "",
        "current_node": "",
        "tool_results": [],
        "condition_values": {},
        "messages": [],
        "human_responses": {},
    }

    if has_human_input:
        # 使用 thread 配置运行
        thread_config = {"configurable": {"thread_id": "workflow-1"}}
        result = app.invoke(initial_state, config=thread_config)
    else:
        result = app.invoke(initial_state)

    return result


def execute_graph_with_events(
    user_input: str,
    task_id: str,
    nodes: list[dict[str, Any]] | None = None,
    edges: list[dict[str, Any]] | None = None,
    config: dict[str, Any] | None = None,
) -> dict:
    """带 SSE 事件发布的图执行。

    执行过程中通过 Redis Pub/Sub 发布实时事件，
    供 FastAPI SSE 端点推送给前端。

    Parameters
    ----------
    user_input : str
        用户输入
    task_id : str
        Celery 任务 ID，用于构建 Redis 频道
    nodes, edges, config :
        同 execute_graph
    """
    import time as _time
    from sse_manager import SSEEventPublisher

    if not nodes or not edges:
        nodes = [
            {"id": "1", "type": "input", "data": {"label": "User Input (Start)"}},
            {"id": "2", "type": "default", "data": {"label": "Agent Reasoning"}},
            {"id": "3", "type": "output", "data": {"label": "LLM Action"}},
        ]
        edges = [
            {"source": "1", "target": "2"},
            {"source": "2", "target": "3"},
        ]

    # 验证图结构
    errors, warnings = validate_graph(nodes, edges)
    if errors:
        error_msg = f"Graph validation failed: {'; '.join(errors)}"
        SSEEventPublisher.publish_workflow_error(task_id, error_msg)
        return {
            "input": user_input,
            "intermediate_steps": [f"[Validation Error] {e}" for e in errors],
            "final_output": error_msg,
            "current_node": "",
            "tool_results": [],
            "condition_values": {},
            "messages": [],
            "human_responses": {},
        }

    # --- 构建节点元数据映射 ---
    node_map = {n["id"]: n for n in nodes}

    # --- 构建带事件发布的 node wrapper ---
    config = config or {}
    model_name = config.get("model", os.getenv("NVIDIA_MODEL", "meta/llama-3.1-70b-instruct"))

    workflow = StateGraph(AgentState)

    # 拓扑信息
    outgoing: dict[str, list[str]] = {}
    incoming: dict[str, list[str]] = {}
    for e in edges:
        src, tgt = e["source"], e["target"]
        outgoing.setdefault(src, []).append(tgt)
        incoming.setdefault(tgt, []).append(src)

    all_ids = set(node_map.keys())
    entry_ids = [nid for nid in all_ids if nid not in incoming]
    exit_ids = [nid for nid in all_ids if nid not in outgoing]

    if not entry_ids:
        entry_ids = [nid for nid, n in node_map.items() if n.get("type") == "input"]
    if not exit_ids:
        exit_ids = [nid for nid, n in node_map.items() if n.get("type") == "output"]
    if not entry_ids:
        entry_ids = [nodes[0]["id"]]
    if not exit_ids:
        exit_ids = [nodes[-1]["id"]]

    has_human_input = any(n.get("type") == "human_input" for n in nodes)

    # --- 为每个节点创建带事件发布的执行函数 ---
    for n in nodes:
        nid = n["id"]
        ntype = n.get("type", "default")
        data = n.get("data", {})
        label = data.get("label") or n.get("label", nid)
        prompt = data.get("prompt", "")

        if ntype == "llm_call":
            # LLM 节点使用流式调用 + token 节流
            workflow.add_node(nid, _make_streaming_llm_node(
                label, model_name, prompt, task_id, nid
            ))
        elif ntype == "output":
            # 输出节点也使用流式
            workflow.add_node(nid, _make_streaming_output_node(
                label, model_name, prompt, task_id, nid
            ))
        else:
            # 其他节点类型包一层事件发布
            if ntype == "input":
                inner_fn = _make_input_node(label)
            elif ntype == "tool_call":
                tool_name = data.get("tool_name", "calculator")
                tool_config = data.get("tool_config", {})
                inner_fn = _make_tool_call_node(label, tool_name, tool_config)
            elif ntype == "condition":
                condition_key = data.get("condition_key", "status")
                inner_fn = _make_condition_node(label, condition_key)
            elif ntype == "human_input":
                inner_fn = _make_human_input_node(label, prompt)
            else:
                inner_fn = _make_reasoning_node(label)

            workflow.add_node(nid, _wrap_node_with_events(
                inner_fn, task_id, nid, label, ntype
            ))

    # --- 添加边 (复用 build_graph_from_payload 的逻辑) ---
    for e in edges:
        src = e["source"]
        src_node = node_map.get(src, {})
        if src_node.get("type") == "condition":
            data = src_node.get("data", {})
            condition_map = data.get("condition_map", {})
            if condition_map:
                continue
            else:
                workflow.add_edge(src, e["target"])
        else:
            workflow.add_edge(src, e["target"])

    # 条件边
    for n in nodes:
        if n.get("type") == "condition":
            nid = n["id"]
            data = n.get("data", {})
            condition_key = data.get("condition_key", "status")
            condition_map = data.get("condition_map", {})

            if condition_map:
                path_map = {}
                for cond_val, target_id in condition_map.items():
                    path_map[cond_val] = END if target_id == "__END__" else target_id

                if "__default__" not in path_map:
                    default_targets = outgoing.get(nid, [])
                    path_map["__default__"] = default_targets[0] if default_targets else END

                def make_route_fn(key: str, p_map: dict):
                    def route_fn(state: AgentState) -> str:
                        val = str(state.get("condition_values", {}).get(key, ""))
                        return p_map.get(val, p_map.get("__default__", END))
                    return route_fn

                workflow.add_conditional_edges(
                    nid, make_route_fn(condition_key, path_map), path_map,
                )

    for eid in entry_ids:
        workflow.add_edge(START, eid)

    for eid in exit_ids:
        node_type = node_map.get(eid, {}).get("type", "")
        if node_type != "condition":
            workflow.add_edge(eid, END)

    # 编译
    if has_human_input:
        from langgraph.checkpoint.memory import MemorySaver
        app = workflow.compile(checkpointer=MemorySaver())
    else:
        app = workflow.compile()

    # 执行
    initial_state: AgentState = {
        "input": user_input,
        "intermediate_steps": [],
        "final_output": "",
        "current_node": "",
        "tool_results": [],
        "condition_values": {},
        "messages": [],
        "human_responses": {},
    }

    try:
        if has_human_input:
            thread_config = {"configurable": {"thread_id": f"workflow-{task_id}"}}
            result = app.invoke(initial_state, config=thread_config)
        else:
            result = app.invoke(initial_state)

        # 发布完成事件
        SSEEventPublisher.publish_workflow_complete(
            task_id,
            result.get("final_output", ""),
            result.get("intermediate_steps", []),
            result.get("tool_results", []),
            result.get("human_responses", {}),
        )
        return result

    except Exception as exc:
        SSEEventPublisher.publish_workflow_error(task_id, str(exc))
        raise


# ============================================================
# Streaming Node Factories (带 SSE 事件发布)
# ============================================================

# Token 节流间隔 (秒)
_TOKEN_THROTTLE_INTERVAL = 0.1


def _wrap_node_with_events(
    inner_fn, task_id: str, node_id: str, label: str, node_type: str
):
    """为非流式节点包裹事件发布逻辑。"""
    import time as _time
    from sse_manager import SSEEventPublisher

    def wrapped(state: AgentState) -> dict:
        SSEEventPublisher.publish_node_enter(task_id, node_id, label, node_type)
        start = _time.time()

        result = inner_fn(state)

        duration_ms = (_time.time() - start) * 1000

        # 对工具节点额外发布 tool_result
        if node_type == "tool_call":
            tool_results = result.get("tool_results", [])
            for tr in tool_results:
                SSEEventPublisher.publish_tool_result(
                    task_id, node_id, tr.get("tool", ""), tr.get("result", ""), duration_ms
                )

        # 取最新一条 step 作为 result 文本
        steps = result.get("intermediate_steps", [])
        step_text = steps[-1] if steps else f"[{label}] completed"
        SSEEventPublisher.publish_step_complete(task_id, node_id, step_text, duration_ms)

        return result

    return wrapped


def _make_streaming_llm_node(
    label: str, model_name: str, prompt_template: str,
    task_id: str, node_id: str
):
    """流式 LLM 节点：逐 token 推送，100ms 节流。"""
    import time as _time
    from sse_manager import SSEEventPublisher

    def node_fn(state: AgentState) -> dict:
        SSEEventPublisher.publish_node_enter(task_id, node_id, label, "llm_call")
        start = _time.time()

        step_msg = f"[{label}] Calling LLM ({model_name})..."
        messages = []
        if prompt_template:
            system_content = prompt_template.replace("{input}", state["input"])
            messages.append(SystemMessage(content=system_content))
        messages.append(HumanMessage(content=state["input"]))

        provider, real_model_name = _get_llm_provider_model(model_name)
        if not _check_api_key(provider):
            mock_text = f"[Mock LLM] {state['input']}"
            # 模拟流式输出
            for i, ch in enumerate(mock_text):
                SSEEventPublisher.publish_llm_token(
                    task_id, node_id, ch, mock_text[:i + 1]
                )
                _time.sleep(0.02)

            duration_ms = (_time.time() - start) * 1000
            SSEEventPublisher.publish_step_complete(
                task_id, node_id, step_msg + " (mock)", duration_ms
            )
            return {
                "intermediate_steps": [step_msg + f" ({provider} API Key 未配置, 返回 mock)"],
                "current_node": label,
                "messages": [{"role": "assistant", "content": mock_text}],
            }

        # 真实流式调用
        llm = init_chat_model(model=real_model_name, model_provider=provider)
        accumulated = ""
        last_push_time = _time.time()

        for chunk in llm.stream(messages):
            token = chunk.content or ""
            accumulated += token

            # 节流：每 100ms 才推送一次
            now = _time.time()
            if now - last_push_time >= _TOKEN_THROTTLE_INTERVAL:
                SSEEventPublisher.publish_llm_token(
                    task_id, node_id, token, accumulated
                )
                last_push_time = now

        # 最后一次推送确保完整
        SSEEventPublisher.publish_llm_token(task_id, node_id, "", accumulated)

        duration_ms = (_time.time() - start) * 1000
        SSEEventPublisher.publish_step_complete(task_id, node_id, step_msg, duration_ms)

        return {
            "intermediate_steps": [step_msg],
            "current_node": label,
            "messages": [{"role": "assistant", "content": accumulated}],
        }

    return node_fn


def _make_streaming_output_node(
    label: str, model_name: str, prompt_template: str,
    task_id: str, node_id: str
):
    """流式输出节点：汇总上下文后流式生成最终输出。"""
    import time as _time
    from sse_manager import SSEEventPublisher

    def node_fn(state: AgentState) -> dict:
        SSEEventPublisher.publish_node_enter(task_id, node_id, label, "output")
        start = _time.time()

        step_msg = f"[{label}] Generating final output ({model_name})..."

        context_parts = []
        for step in state.get("intermediate_steps", []):
            context_parts.append(step)
        for tr in state.get("tool_results", []):
            context_parts.append(f"Tool [{tr['tool']}]: {tr['result']}")

        context = "\n".join(context_parts) if context_parts else "No context available."
        user_input = state["input"]

        system_content = prompt_template or "You are a helpful assistant. Synthesize the context and provide a clear answer."
        system_content = system_content.replace("{input}", user_input)
        system_content += f"\n\n--- Context ---\n{context}"

        provider, real_model_name = _get_llm_provider_model(model_name)
        if not _check_api_key(provider):
            mock_output = f"[Mock Output] Processed: {user_input}\nContext: {context[:300]}"
            for i, ch in enumerate(mock_output):
                SSEEventPublisher.publish_llm_token(
                    task_id, node_id, ch, mock_output[:i + 1]
                )
                _time.sleep(0.02)

            duration_ms = (_time.time() - start) * 1000
            SSEEventPublisher.publish_step_complete(
                task_id, node_id, step_msg + " (mock)", duration_ms
            )
            return {
                "intermediate_steps": [step_msg + f" ({provider} API Key 未配置, 返回 mock)"],
                "current_node": label,
                "final_output": mock_output,
            }

        llm = init_chat_model(model=real_model_name, model_provider=provider)
        accumulated = ""
        last_push_time = _time.time()

        for chunk in llm.stream([
            SystemMessage(content=system_content),
            HumanMessage(content=user_input),
        ]):
            token = chunk.content or ""
            accumulated += token

            now = _time.time()
            if now - last_push_time >= _TOKEN_THROTTLE_INTERVAL:
                SSEEventPublisher.publish_llm_token(
                    task_id, node_id, token, accumulated
                )
                last_push_time = now

        SSEEventPublisher.publish_llm_token(task_id, node_id, "", accumulated)

        duration_ms = (_time.time() - start) * 1000
        SSEEventPublisher.publish_step_complete(task_id, node_id, step_msg, duration_ms)

        return {
            "intermediate_steps": [step_msg],
            "current_node": label,
            "final_output": accumulated,
        }

    return node_fn


def resume_graph(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    config: dict[str, Any] | None = None,
    human_input: str = "",
    thread_id: str = "workflow-1",
) -> dict:
    """恢复被 human_input 节点暂停的图执行。

    Parameters
    ----------
    human_input : str
        用户提供的人工输入
    thread_id : str
        线程 ID，用于恢复执行上下文

    Returns
    -------
    执行结果 dict
    """
    app = build_graph_from_payload(nodes, edges, config)

    from langgraph.types import Command

    thread_config = {"configurable": {"thread_id": thread_id}}
    result = app.invoke(Command(resume=human_input), config=thread_config)

    return result
