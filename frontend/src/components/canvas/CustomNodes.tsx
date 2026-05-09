"use client";

import React, { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  MessageSquare,
  Bot,
  Wrench,
  GitBranch,
  UserCheck,
  ArrowDownToLine,
  Cpu,
  Loader2,
  Check,
  AlertTriangle,
} from "lucide-react";
import { useAgentStore, type NodeExecutionStatus } from "@/store/useAgentStore";

// ============================================================
// 节点类型配置
// ============================================================

export interface CustomNodeData extends Record<string, unknown> {
  label: string;
  prompt?: string;
  tool_name?: string;
  tool_config?: Record<string, unknown>;
  condition_key?: string;
  condition_map?: Record<string, string>;
}

type NodeType =
  | "input"
  | "llm_call"
  | "tool_call"
  | "condition"
  | "human_input"
  | "output"
  | "default";

interface NodeStyleConfig {
  icon: React.ReactNode;
  gradient: string;
  border: string;
  glow: string;
  badge: string;
  badgeText: string;
}

const NODE_STYLES: Record<NodeType, NodeStyleConfig> = {
  input: {
    icon: <MessageSquare className="w-3.5 h-3.5" />,
    gradient: "from-slate-700/80 to-slate-800/80",
    border: "border-slate-500/40",
    glow: "shadow-slate-500/10",
    badge: "bg-slate-500/20 text-slate-300",
    badgeText: "INPUT",
  },
  llm_call: {
    icon: <Bot className="w-3.5 h-3.5" />,
    gradient: "from-violet-600/30 to-purple-700/30",
    border: "border-violet-400/40",
    glow: "shadow-violet-500/15",
    badge: "bg-violet-500/20 text-violet-300",
    badgeText: "LLM",
  },
  tool_call: {
    icon: <Wrench className="w-3.5 h-3.5" />,
    gradient: "from-amber-600/30 to-orange-700/30",
    border: "border-amber-400/40",
    glow: "shadow-amber-500/15",
    badge: "bg-amber-500/20 text-amber-300",
    badgeText: "TOOL",
  },
  condition: {
    icon: <GitBranch className="w-3.5 h-3.5" />,
    gradient: "from-cyan-600/30 to-teal-700/30",
    border: "border-cyan-400/40",
    glow: "shadow-cyan-500/15",
    badge: "bg-cyan-500/20 text-cyan-300",
    badgeText: "CONDITION",
  },
  human_input: {
    icon: <UserCheck className="w-3.5 h-3.5" />,
    gradient: "from-rose-600/30 to-pink-700/30",
    border: "border-rose-400/40",
    glow: "shadow-rose-500/15",
    badge: "bg-rose-500/20 text-rose-300",
    badgeText: "HUMAN",
  },
  output: {
    icon: <ArrowDownToLine className="w-3.5 h-3.5" />,
    gradient: "from-emerald-600/30 to-green-700/30",
    border: "border-emerald-400/40",
    glow: "shadow-emerald-500/15",
    badge: "bg-emerald-500/20 text-emerald-300",
    badgeText: "OUTPUT",
  },
  default: {
    icon: <Cpu className="w-3.5 h-3.5" />,
    gradient: "from-sky-600/30 to-blue-700/30",
    border: "border-sky-400/40",
    glow: "shadow-sky-500/15",
    badge: "bg-sky-500/20 text-sky-300",
    badgeText: "NODE",
  },
};

// ============================================================
// Execution State Badge
// ============================================================

function ExecutionBadge({ status, duration }: { status: NodeExecutionStatus; duration?: number }) {
  if (status === "idle") return null;

  return (
    <div
      className={`execution-indicator ${status}`}
    >
      {status === "running" && (
        <>
          <Loader2 className="w-2.5 h-2.5 spin-icon" />
          <span>RUNNING</span>
        </>
      )}
      {status === "completed" && (
        <>
          <Check className="w-2.5 h-2.5" />
          <span>{duration ? `${Math.round(duration)}ms` : "DONE"}</span>
        </>
      )}
      {status === "error" && (
        <>
          <AlertTriangle className="w-2.5 h-2.5" />
          <span>ERROR</span>
        </>
      )}
    </div>
  );
}

// ============================================================
// Base Custom Node Component
// ============================================================

function BaseCustomNode({
  id,
  data,
  selected,
  nodeType,
}: NodeProps & { nodeType: NodeType }) {
  const nodeData = data as CustomNodeData;
  const style = NODE_STYLES[nodeType] || NODE_STYLES.default;
  const hasInput = nodeType !== "input";
  const hasOutput = nodeType !== "output";

  // 从 store 读取节点执行状态
  const executionState = useAgentStore(
    (s) => s.nodeExecutionStates[id]
  );
  const execStatus: NodeExecutionStatus = executionState?.status ?? "idle";
  const streamingText = executionState?.streamingText;

  // 根据执行状态确定动画类名
  const execClassName =
    execStatus === "running"
      ? "node-running"
      : execStatus === "completed"
      ? "node-completed"
      : execStatus === "error"
      ? "node-error"
      : "";

  return (
    <div
      className={`
        relative min-w-[180px] max-w-[240px]
        bg-gradient-to-br ${style.gradient}
        backdrop-blur-xl rounded-xl
        border ${execStatus === "running" ? "border-indigo-400/60" : execStatus === "completed" ? "border-emerald-400/50" : execStatus === "error" ? "border-red-400/50" : style.border}
        ${selected ? "ring-2 ring-white/30 ring-offset-1 ring-offset-transparent" : ""}
        shadow-lg ${style.glow}
        transition-all duration-200
        hover:scale-[1.02] hover:shadow-xl
        group
        ${execClassName}
      `}
    >
      {/* Top Handle */}
      {hasInput && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !bg-slate-400 !border-2 !border-slate-600 hover:!bg-white transition-colors !-top-1.5"
        />
      )}

      {/* Node Body */}
      <div className="px-3 py-2.5">
        {/* Badge + Icon Row + Execution Status */}
        <div className="flex items-center justify-between mb-1.5 gap-1">
          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wider ${style.badge}`}
          >
            {style.icon}
            {style.badgeText}
          </span>
          <ExecutionBadge status={execStatus} duration={executionState?.duration} />
        </div>

        {/* Label */}
        <div className="text-xs font-medium text-slate-100 leading-snug truncate">
          {nodeData.label || "Untitled"}
        </div>

        {/* Sub-info */}
        {nodeType === "tool_call" && nodeData.tool_name && (
          <div className="mt-1 text-[10px] text-amber-300/70 font-mono truncate">
            🔧 {nodeData.tool_name}
          </div>
        )}

        {nodeType === "llm_call" && nodeData.prompt && execStatus === "idle" && (
          <div className="mt-1 text-[10px] text-violet-300/70 truncate">
            📝 {nodeData.prompt.slice(0, 30)}...
          </div>
        )}

        {nodeType === "condition" && nodeData.condition_key && (
          <div className="mt-1 text-[10px] text-cyan-300/70 font-mono truncate">
            ⚡ key: {nodeData.condition_key}
          </div>
        )}

        {nodeType === "human_input" && (
          <div className="mt-1 text-[10px] text-rose-300/70">
            ⏸ Requires human input
          </div>
        )}

        {/* 流式文本预览 — LLM / Output 节点执行中显示 */}
        {streamingText && execStatus === "running" && (
          <div className="mt-1.5 text-[10px] text-slate-300/90 streaming-text-preview streaming-cursor font-mono leading-relaxed bg-slate-900/40 rounded px-1.5 py-1">
            {streamingText.slice(-80)}
          </div>
        )}
      </div>

      {/* Bottom Handle */}
      {hasOutput && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3 !h-3 !bg-slate-400 !border-2 !border-slate-600 hover:!bg-white transition-colors !-bottom-1.5"
        />
      )}

      {/* Condition node: extra handles for branches */}
      {nodeType === "condition" && (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="condition-true"
            className="!w-2.5 !h-2.5 !bg-emerald-400 !border-2 !border-emerald-600 hover:!bg-emerald-300 transition-colors !-right-1"
            style={{ top: "40%" }}
          />
          <Handle
            type="source"
            position={Position.Left}
            id="condition-false"
            className="!w-2.5 !h-2.5 !bg-red-400 !border-2 !border-red-600 hover:!bg-red-300 transition-colors !-left-1"
            style={{ top: "40%" }}
          />
        </>
      )}
    </div>
  );
}

// ============================================================
// Typed Node Components
// ============================================================

export const InputNode = memo((props: NodeProps) => (
  <BaseCustomNode {...props} nodeType="input" />
));
InputNode.displayName = "InputNode";

export const LLMCallNode = memo((props: NodeProps) => (
  <BaseCustomNode {...props} nodeType="llm_call" />
));
LLMCallNode.displayName = "LLMCallNode";

export const ToolCallNode = memo((props: NodeProps) => (
  <BaseCustomNode {...props} nodeType="tool_call" />
));
ToolCallNode.displayName = "ToolCallNode";

export const ConditionNode = memo((props: NodeProps) => (
  <BaseCustomNode {...props} nodeType="condition" />
));
ConditionNode.displayName = "ConditionNode";

export const HumanInputNode = memo((props: NodeProps) => (
  <BaseCustomNode {...props} nodeType="human_input" />
));
HumanInputNode.displayName = "HumanInputNode";

export const OutputNode = memo((props: NodeProps) => (
  <BaseCustomNode {...props} nodeType="output" />
));
OutputNode.displayName = "OutputNode";

export const DefaultNode = memo((props: NodeProps) => (
  <BaseCustomNode {...props} nodeType="default" />
));
DefaultNode.displayName = "DefaultNode";

// ============================================================
// Node Type Registry (for React Flow)
// ============================================================

export const customNodeTypes = {
  input: InputNode,
  llm_call: LLMCallNode,
  tool_call: ToolCallNode,
  condition: ConditionNode,
  human_input: HumanInputNode,
  output: OutputNode,
  default: DefaultNode,
};
