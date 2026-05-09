"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  MessageSquare,
  Bot,
  Wrench,
  GitBranch,
  UserCheck,
  ArrowDownToLine,
  Plus,
  X,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { useAgentStore } from "@/store/useAgentStore";

// ============================================================
// 节点模板定义
// ============================================================

interface NodeTemplate {
  type: string;
  label: string;
  icon: React.ReactNode;
  description: string;
  color: string;
  defaultData: Record<string, unknown>;
}

const NODE_TEMPLATES: NodeTemplate[] = [
  {
    type: "input",
    label: "Input",
    icon: <MessageSquare className="w-4 h-4" />,
    description: "工作流入口节点",
    color: "text-slate-300 bg-slate-500/10 border-slate-500/30 hover:bg-slate-500/20",
    defaultData: { label: "User Input" },
  },
  {
    type: "llm_call",
    label: "LLM Call",
    icon: <Bot className="w-4 h-4" />,
    description: "调用大模型推理",
    color: "text-violet-300 bg-violet-500/10 border-violet-500/30 hover:bg-violet-500/20",
    defaultData: { label: "LLM Reasoning", prompt: "" },
  },
  {
    type: "tool_call",
    label: "Tool Call",
    icon: <Wrench className="w-4 h-4" />,
    description: "调用预设工具",
    color: "text-amber-300 bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20",
    defaultData: { label: "Tool Execution", tool_name: "calculator", tool_config: {} },
  },
  {
    type: "condition",
    label: "Condition",
    icon: <GitBranch className="w-4 h-4" />,
    description: "条件分支路由",
    color: "text-cyan-300 bg-cyan-500/10 border-cyan-500/30 hover:bg-cyan-500/20",
    defaultData: {
      label: "Condition Check",
      condition_key: "status",
      condition_map: {},
    },
  },
  {
    type: "human_input",
    label: "Human Input",
    icon: <UserCheck className="w-4 h-4" />,
    description: "等待人工审核/输入",
    color: "text-rose-300 bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/20",
    defaultData: { label: "Human Review", prompt: "请审核并提供反馈" },
  },
  {
    type: "output",
    label: "Output",
    icon: <ArrowDownToLine className="w-4 h-4" />,
    description: "最终输出节点",
    color: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20",
    defaultData: { label: "Final Output", prompt: "" },
  },
];

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

// ============================================================
// NodeToolbar Component
// ============================================================

export default function NodeToolbar() {
  const addNode = useAgentStore((s) => s.addNode);
  const nodes = useAgentStore((s) => s.nodes);
  const edges = useAgentStore((s) => s.edges);

  const [isOpen, setIsOpen] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  } | null>(null);

  // 关闭面板时清除验证结果
  useEffect(() => {
    if (!isOpen) {
      setValidationResult(null);
    }
  }, [isOpen]);

  const handleAddNode = (template: NodeTemplate) => {
    // 计算新节点位置（偏移量避免重叠）
    const offset = nodes.length * 30;
    addNode(template.type, template.defaultData, {
      x: 250 + offset,
      y: 100 + offset,
    });
  };

  const handleValidate = useCallback(async () => {
    setValidating(true);
    try {
      const payload = {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type ?? "default",
          data: {
            label: typeof n.data?.label === "string" ? n.data.label : n.id,
            prompt: (n.data?.prompt as string) ?? "",
            tool_name: (n.data?.tool_name as string) ?? "",
            tool_config: (n.data?.tool_config as Record<string, unknown>) ?? {},
            condition_key: (n.data?.condition_key as string) ?? "",
            condition_map: (n.data?.condition_map as Record<string, string>) ?? {},
          },
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          label: (e.label as string) ?? "",
          source_handle: e.sourceHandle ?? "",
        })),
      };

      const res = await fetch(`${BACKEND_URL}/api/v1/graph/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const result = await res.json();
        setValidationResult(result);
      } else {
        setValidationResult({
          valid: false,
          errors: [`Server error: ${res.status}`],
          warnings: [],
        });
      }
    } catch (err) {
      setValidationResult({
        valid: false,
        errors: [`Network error: ${err instanceof Error ? err.message : String(err)}`],
        warnings: [],
      });
    } finally {
      setValidating(false);
    }
  }, [nodes, edges]);

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          absolute top-4 right-4 z-20
          flex items-center gap-1.5 px-3 py-2
          rounded-lg text-xs font-medium
          transition-all duration-200
          ${
            isOpen
              ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
              : "bg-slate-800/90 text-slate-300 border border-slate-700 hover:bg-slate-700/90 hover:text-white"
          }
          backdrop-blur-md
        `}
      >
        {isOpen ? (
          <>
            <X className="w-3.5 h-3.5" />
            Close
          </>
        ) : (
          <>
            <Plus className="w-3.5 h-3.5" />
            Add Node
          </>
        )}
      </button>

      {/* Panel */}
      <div
        className={`
          absolute top-14 right-4 z-20
          w-64 max-h-[calc(100%-80px)]
          bg-slate-900/95 backdrop-blur-xl
          rounded-xl border border-slate-700/80
          shadow-2xl shadow-black/30
          transition-all duration-300 ease-out
          ${isOpen ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 -translate-y-2 pointer-events-none"}
          overflow-hidden flex flex-col
        `}
      >
        {/* Header */}
        <div className="px-3 py-2.5 border-b border-slate-700/50">
          <h3 className="text-xs font-semibold text-slate-200 tracking-wide">
            节点类型
          </h3>
          <p className="text-[10px] text-slate-500 mt-0.5">
            点击添加到画布
          </p>
        </div>

        {/* Node List */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
          {NODE_TEMPLATES.map((template) => (
            <button
              key={template.type}
              onClick={() => handleAddNode(template)}
              className={`
                w-full flex items-center gap-2.5 px-2.5 py-2
                rounded-lg border text-left
                transition-all duration-150
                ${template.color}
              `}
            >
              <div className="shrink-0">{template.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium">{template.label}</div>
                <div className="text-[10px] opacity-60 truncate">
                  {template.description}
                </div>
              </div>
              <ChevronRight className="w-3 h-3 opacity-40" />
            </button>
          ))}
        </div>

        {/* Validate Button */}
        <div className="px-2 py-2 border-t border-slate-700/50">
          <button
            onClick={handleValidate}
            disabled={validating}
            className={`
              w-full flex items-center justify-center gap-1.5 px-3 py-2
              rounded-lg text-xs font-medium transition-all
              ${
                validating
                  ? "bg-slate-700 text-slate-400 cursor-wait"
                  : "bg-indigo-600/80 hover:bg-indigo-500 text-white"
              }
            `}
          >
            {validating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Validating...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                Validate Graph
              </>
            )}
          </button>

          {/* Validation Result */}
          {validationResult && (
            <div className="mt-2 space-y-1">
              {validationResult.valid ? (
                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/20">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-[10px] text-emerald-300 font-medium">
                    Graph is valid
                  </span>
                </div>
              ) : null}

              {validationResult.errors.map((err, i) => (
                <div
                  key={`err-${i}`}
                  className="flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-red-500/10 border border-red-500/20"
                >
                  <X className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />
                  <span className="text-[10px] text-red-300">{err}</span>
                </div>
              ))}

              {validationResult.warnings.map((warn, i) => (
                <div
                  key={`warn-${i}`}
                  className="flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/20"
                >
                  <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
                  <span className="text-[10px] text-amber-300">{warn}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
