"use client";

import React, { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "@/styles/execution-animations.css";
import { useAgentStore } from "@/store/useAgentStore";
import { customNodeTypes } from "./CustomNodes";
import NodeToolbar from "./NodeToolbar";

export default function AgentCanvas() {
  const nodes = useAgentStore((s) => s.nodes);
  const edges = useAgentStore((s) => s.edges);
  const onNodesChange = useAgentStore((s) => s.onNodesChange);
  const onEdgesChange = useAgentStore((s) => s.onEdgesChange);
  const onConnect = useAgentStore((s) => s.onConnect);
  const selectNode = useAgentStore((s) => s.selectNode);
  const nodeExecutionStates = useAgentStore((s) => s.nodeExecutionStates);

  // memoize nodeTypes to avoid re-renders
  const nodeTypes = useMemo(() => customNodeTypes, []);

  // 节点点击 → 更新全局选中状态
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: { id: string }) => {
      selectNode(node.id);
    },
    [selectNode]
  );

  // 画布空白区域点击 → 取消选中
  const handlePaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  // 根据节点执行状态动态更新边样式
  const styledEdges = useMemo(() => {
    return edges.map((edge) => {
      const sourceState = nodeExecutionStates[edge.source];
      const targetState = nodeExecutionStates[edge.target];

      // 源节点完成且目标节点正在执行 → 边高亮
      if (
        sourceState?.status === "completed" &&
        targetState?.status === "running"
      ) {
        return {
          ...edge,
          animated: true,
          style: {
            ...edge.style,
            stroke: "#818cf8",
            strokeWidth: 2.5,
          },
        };
      }

      // 源节点正在执行 → 边半透明脉冲
      if (sourceState?.status === "running") {
        return {
          ...edge,
          animated: true,
          style: {
            ...edge.style,
            stroke: "#6366f1",
            strokeWidth: 2,
            opacity: 0.7,
          },
        };
      }

      // 两侧都完成 → 边变为成功色
      if (
        sourceState?.status === "completed" &&
        targetState?.status === "completed"
      ) {
        return {
          ...edge,
          animated: false,
          style: {
            ...edge.style,
            stroke: "#34d399",
            strokeWidth: 2,
          },
        };
      }

      // 有错误 → 边变红
      if (
        sourceState?.status === "error" ||
        targetState?.status === "error"
      ) {
        return {
          ...edge,
          animated: false,
          style: {
            ...edge.style,
            stroke: "#f87171",
            strokeWidth: 2,
          },
        };
      }

      return edge;
    });
  }, [edges, nodeExecutionStates]);

  return (
    <div className="w-full h-full min-h-[500px] bg-slate-950/50 rounded-2xl overflow-hidden border border-slate-800 shadow-2xl relative">
      <div className="absolute top-4 left-4 z-10 px-4 py-2 bg-slate-900/80 backdrop-blur-md rounded-lg border border-slate-700">
        <h2 className="text-slate-200 font-semibold text-sm flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Workflow Canvas
          <span className="text-[10px] text-slate-500 font-normal ml-1">
            {nodes.length} nodes · {edges.length} edges
          </span>
        </h2>
      </div>

      {/* Node Toolbar */}
      <NodeToolbar />

      <ReactFlow
        nodes={nodes}
        edges={styledEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes}
        fitView
        colorMode="dark"
        deleteKeyCode={["Backspace", "Delete"]}
        selectNodesOnDrag={false}
      >
        <Background color="#334155" gap={16} />
        <Controls className="bg-slate-800 border-slate-700 fill-slate-300" />
        <MiniMap
          nodeStrokeColor={() => "#0ea5e9"}
          nodeColor={(n) => {
            // 根据执行状态优先着色
            const execState = nodeExecutionStates[n.id];
            if (execState?.status === "running") return "#818cf8";
            if (execState?.status === "completed") return "#34d399";
            if (execState?.status === "error") return "#f87171";

            const colorMap: Record<string, string> = {
              input: "#64748b",
              llm_call: "#8b5cf6",
              tool_call: "#f59e0b",
              condition: "#06b6d4",
              human_input: "#f43f5e",
              output: "#10b981",
              default: "#0ea5e9",
            };
            return colorMap[n.type || "default"] || "#bae6fd";
          }}
          maskColor="rgba(15, 23, 42, 0.8)"
          className="bg-slate-900 border-slate-700 rounded-lg overflow-hidden"
        />
      </ReactFlow>
    </div>
  );
}
