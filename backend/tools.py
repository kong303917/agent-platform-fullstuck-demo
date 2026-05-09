"""
工具注册表

为 tool_call 节点提供可调用的预设工具集合。
采用装饰器模式注册工具，方便扩展。
"""

from __future__ import annotations

import math
import json
from typing import Any, Callable


# ============================================================
# Registry
# ============================================================

# 全局工具注册表: name → {fn, description, parameters}
_TOOL_REGISTRY: dict[str, dict[str, Any]] = {}


def register_tool(
    name: str,
    description: str = "",
    parameters: dict | None = None,
):
    """装饰器：将函数注册为可用工具。

    用法::

        @register_tool("web_search", description="搜索互联网", parameters={"query": "str"})
        def web_search(query: str, **kwargs) -> str:
            ...
    """

    def wrapper(fn: Callable[..., str]):
        _TOOL_REGISTRY[name] = {
            "fn": fn,
            "description": description or fn.__doc__ or "",
            "parameters": parameters or {},
        }
        return fn

    return wrapper


def get_tool(name: str) -> Callable[..., str] | None:
    """按名称获取工具函数。"""
    entry = _TOOL_REGISTRY.get(name)
    return entry["fn"] if entry else None


def list_tools() -> list[dict[str, Any]]:
    """返回所有已注册工具的元信息（不含函数引用）。"""
    return [
        {
            "name": name,
            "description": entry["description"],
            "parameters": entry["parameters"],
        }
        for name, entry in _TOOL_REGISTRY.items()
    ]


def execute_tool(name: str, **kwargs: Any) -> str:
    """安全执行工具，找不到时返回错误信息而非抛异常。"""
    fn = get_tool(name)
    if fn is None:
        return f"[Error] Tool '{name}' not found. Available: {list(_TOOL_REGISTRY.keys())}"
    try:
        return fn(**kwargs)
    except Exception as e:
        return f"[Error] Tool '{name}' execution failed: {e}"


# ============================================================
# Built-in Tools
# ============================================================


@register_tool(
    "calculator",
    description="安全的数学计算器，支持基本运算和常用数学函数",
    parameters={"expression": "str – 数学表达式，如 '2 + 3 * 4' 或 'sqrt(144)'"},
)
def calculator(expression: str = "", **kwargs: Any) -> str:
    """计算数学表达式并返回结果。"""
    if not expression:
        return "[Error] No expression provided."

    # 安全的数学环境
    safe_env: dict[str, Any] = {
        "abs": abs,
        "round": round,
        "min": min,
        "max": max,
        "sum": sum,
        "pow": pow,
        "sqrt": math.sqrt,
        "log": math.log,
        "log10": math.log10,
        "sin": math.sin,
        "cos": math.cos,
        "tan": math.tan,
        "pi": math.pi,
        "e": math.e,
    }

    try:
        result = eval(expression, {"__builtins__": {}}, safe_env)  # noqa: S307
        return str(result)
    except Exception as e:
        return f"[Error] Cannot evaluate '{expression}': {e}"


@register_tool(
    "text_summarizer",
    description="对输入文本进行摘要概括",
    parameters={"text": "str – 需要摘要的文本"},
)
def text_summarizer(text: str = "", **kwargs: Any) -> str:
    """简单的文本摘要（截取前500字 + 统计信息）。"""
    if not text:
        return "[Error] No text provided."

    words = text.split()
    word_count = len(words)

    if word_count <= 50:
        return f"[Summary] ({word_count} words) {text}"

    summary = " ".join(words[:50]) + "..."
    return f"[Summary] ({word_count} words, truncated to 50) {summary}"


@register_tool(
    "json_formatter",
    description="格式化 JSON 字符串，美化输出",
    parameters={"raw_json": "str – 需要格式化的 JSON 字符串"},
)
def json_formatter(raw_json: str = "", **kwargs: Any) -> str:
    """格式化 JSON 字符串。"""
    if not raw_json:
        return "[Error] No JSON provided."
    try:
        parsed = json.loads(raw_json)
        return json.dumps(parsed, indent=2, ensure_ascii=False)
    except json.JSONDecodeError as e:
        return f"[Error] Invalid JSON: {e}"


@register_tool(
    "text_transformer",
    description="文本转换工具：大小写转换、反转、统计等",
    parameters={
        "text": "str – 要转换的文本",
        "operation": "str – 操作: uppercase / lowercase / reverse / word_count / char_count",
    },
)
def text_transformer(
    text: str = "", operation: str = "uppercase", **kwargs: Any
) -> str:
    """执行文本转换操作。"""
    if not text:
        return "[Error] No text provided."

    ops: dict[str, Callable[[], str]] = {
        "uppercase": lambda: text.upper(),
        "lowercase": lambda: text.lower(),
        "reverse": lambda: text[::-1],
        "word_count": lambda: str(len(text.split())),
        "char_count": lambda: str(len(text)),
    }

    fn = ops.get(operation)
    if fn is None:
        return f"[Error] Unknown operation '{operation}'. Available: {list(ops.keys())}"
    return fn()


@register_tool(
    "web_search",
    description="模拟网络搜索（当前为 Mock 实现）",
    parameters={"query": "str – 搜索关键词"},
)
def web_search_mock(query: str = "", **kwargs: Any) -> str:
    """模拟搜索结果。生产环境应对接真实搜索 API。"""
    if not query:
        return "[Error] No query provided."
    return (
        f"[Mock Search Results for '{query}']\n"
        f"1. Result about {query} - example.com\n"
        f"2. Understanding {query} in depth - docs.example.com\n"
        f"3. {query} best practices guide - blog.example.com"
    )


@register_tool(
    "code_executor",
    description="安全执行简单 Python 表达式（沙箱模式）",
    parameters={"code": "str – Python 表达式"},
)
def code_executor(code: str = "", **kwargs: Any) -> str:
    """在受限沙箱中执行 Python 表达式。"""
    if not code:
        return "[Error] No code provided."

    safe_builtins = {
        "len": len,
        "range": range,
        "list": list,
        "dict": dict,
        "set": set,
        "tuple": tuple,
        "str": str,
        "int": int,
        "float": float,
        "bool": bool,
        "sorted": sorted,
        "reversed": reversed,
        "enumerate": enumerate,
        "zip": zip,
        "map": map,
        "filter": filter,
        "sum": sum,
        "min": min,
        "max": max,
        "abs": abs,
        "round": round,
        "True": True,
        "False": False,
        "None": None,
    }

    try:
        result = eval(code, {"__builtins__": safe_builtins}, {})  # noqa: S307
        return str(result)
    except Exception as e:
        return f"[Error] Execution failed: {e}"
