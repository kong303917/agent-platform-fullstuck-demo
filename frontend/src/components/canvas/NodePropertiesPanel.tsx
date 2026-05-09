"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Bot,
  Wrench,
  GitBranch,
  UserCheck,
  ArrowDownToLine,
  MessageSquare,
  Cpu,
  Trash2,
  Plus,
  X,
} from "lucide-react";
import { useAgentStore, useSelectedNode } from "@/store/useAgentStore";
import type { Node } from "@xyflow/react";

// ============================================================
// 工具列表（从后端动态获取或使用预设）
// ============================================================

const PRESET_TOOLS = [
  { name: "calculator", label: "Calculator" },
  { name: "text_summarizer", label: "Text Summarizer" },
  { name: "json_formatter", label: "JSON Formatter" },
  { name: "text_transformer", label: "Text Transformer" },
  { name: "web_search", label: "Web Search" },
  { name: "code_executor", label: "Code Executor" },
];

const NODE_ICONS: Record<string, React.ReactNode> = {
  input: <MessageSquare className="w-4 h-4 text-slate-300" />,
  llm_call: <Bot className="w-4 h-4 text-violet-300" />,
  tool_call: <Wrench className="w-4 h-4 text-amber-300" />,
  condition: <GitBranch className="w-4 h-4 text-cyan-300" />,
  human_input: <UserCheck className="w-4 h-4 text-rose-300" />,
  output: <ArrowDownToLine className="w-4 h-4 text-emerald-300" />,
  default: <Cpu className="w-4 h-4 text-sky-300" />,
};

// ============================================================
// NodePropertiesPanel
// ============================================================

export default function NodePropertiesPanel() {
  const updateNodeData = useAgentStore((s) => s.updateNodeData);
  const removeNode = useAgentStore((s) => s.removeNode);

  // 使用全局 Store 的选中节点
  const selectedNode = useSelectedNode();

  if (!selectedNode) {
    return (
      <div className="flex-1 bg-slate-900/50 backdrop-blur-md rounded-2xl border border-slate-800 p-5">
        <h3 className="text-sm font-medium text-slate-300 mb-3 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
          Node Properties
        </h3>
        <p className="text-xs text-slate-500 italic">
          Select a node on the canvas to edit its properties
        </p>
      </div>
    );
  }

  return <NodeEditor node={selectedNode} updateNodeData={updateNodeData} removeNode={removeNode} />;
}

// ============================================================
// NodeEditor – 根据节点类型渲染不同的编辑表单
// ============================================================

function NodeEditor({
  node,
  updateNodeData,
  removeNode,
}: {
  node: Node;
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  removeNode: (nodeId: string) => void;
}) {
  const nodeType = node.type || "default";
  const data = node.data as Record<string, unknown>;
  const icon = NODE_ICONS[nodeType] || NODE_ICONS.default;

  const handleChange = useCallback(
    (key: string, value: unknown) => {
      updateNodeData(node.id, { [key]: value });
    },
    [node.id, updateNodeData]
  );

  return (
    <div className="flex-1 bg-slate-900/50 backdrop-blur-md rounded-2xl border border-slate-800 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
          {icon}
          <span className="capitalize">{nodeType.replace("_", " ")}</span>
          <span className="text-[10px] text-slate-500 font-mono">#{node.id}</span>
        </h3>
        <button
          onClick={() => removeNode(node.id)}
          className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Delete Node"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Label Field (all node types) */}
      <FieldGroup label="Label">
        <input
          type="text"
          value={(data.label as string) || ""}
          onChange={(e) => handleChange("label", e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors"
          placeholder="Node label"
        />
      </FieldGroup>

      {/* Type-specific fields */}
      {(nodeType === "llm_call" || nodeType === "output") && (
        <FieldGroup label="System Prompt">
          <textarea
            value={(data.prompt as string) || ""}
            onChange={(e) => handleChange("prompt", e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors resize-none font-mono"
            rows={4}
            placeholder="Enter system prompt... Use {input} for user input placeholder"
          />
        </FieldGroup>
      )}

      {nodeType === "tool_call" && (
        <>
          <FieldGroup label="Tool">
            <select
              value={(data.tool_name as string) || "calculator"}
              onChange={(e) => handleChange("tool_name", e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors appearance-none"
            >
              {PRESET_TOOLS.map((tool) => (
                <option key={tool.name} value={tool.name}>
                  {tool.label}
                </option>
              ))}
            </select>
          </FieldGroup>
        </>
      )}

      {nodeType === "condition" && (
        <>
          <FieldGroup label="Condition Key">
            <input
              type="text"
              value={(data.condition_key as string) || ""}
              onChange={(e) => handleChange("condition_key", e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors font-mono"
              placeholder="e.g., status"
            />
          </FieldGroup>
          <ConditionMapEditor
            conditionMap={(data.condition_map as Record<string, string>) || {}}
            onChange={(map) => handleChange("condition_map", map)}
          />
        </>
      )}

      {nodeType === "human_input" && (
        <FieldGroup label="Prompt to User">
          <textarea
            value={(data.prompt as string) || ""}
            onChange={(e) => handleChange("prompt", e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors resize-none"
            rows={3}
            placeholder="What should the user be asked?"
          />
        </FieldGroup>
      )}
    </div>
  );
}

// ============================================================
// ConditionMapEditor – 条件分支映射编辑器
// ============================================================

function ConditionMapEditor({
  conditionMap,
  onChange,
}: {
  conditionMap: Record<string, string>;
  onChange: (map: Record<string, string>) => void;
}) {
  const entries = Object.entries(conditionMap);
  const nodes = useAgentStore((s) => s.nodes);

  const handleAdd = () => {
    const newMap = { ...conditionMap, [`value_${entries.length + 1}`]: "" };
    onChange(newMap);
  };

  const handleRemove = (key: string) => {
    const newMap = { ...conditionMap };
    delete newMap[key];
    onChange(newMap);
  };

  const handleKeyChange = (oldKey: string, newKey: string) => {
    const newMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(conditionMap)) {
      if (k === oldKey) {
        newMap[newKey] = v;
      } else {
        newMap[k] = v;
      }
    }
    onChange(newMap);
  };

  const handleValueChange = (key: string, value: string) => {
    onChange({ ...conditionMap, [key]: value });
  };

  return (
    <FieldGroup label="Branch Mapping">
      <div className="space-y-2">
        {entries.map(([key, targetId]) => (
          <div key={key} className="flex items-center gap-1.5">
            <input
              type="text"
              value={key}
              onChange={(e) => handleKeyChange(key, e.target.value)}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-[11px] text-cyan-300 focus:outline-none focus:border-cyan-500 transition-colors font-mono"
              placeholder="condition value"
            />
            <span className="text-slate-600 text-[10px]">→</span>
            <select
              value={targetId}
              onChange={(e) => handleValueChange(key, e.target.value)}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors appearance-none"
            >
              <option value="">Select target...</option>
              <option value="__END__">🏁 END</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {(n.data?.label as string) || n.id}
                </option>
              ))}
            </select>
            <button
              onClick={() => handleRemove(key)}
              className="p-1 rounded text-slate-600 hover:text-red-400 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        <button
          onClick={handleAdd}
          className="w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded-md border border-dashed border-slate-700 text-slate-500 text-[10px] hover:border-cyan-500/50 hover:text-cyan-400 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Add Branch
        </button>
      </div>
    </FieldGroup>
  );
}

// ============================================================
// Helper Components
// ============================================================

function FieldGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs text-slate-400 font-medium">{label}</label>
      {children}
    </div>
  );
}
