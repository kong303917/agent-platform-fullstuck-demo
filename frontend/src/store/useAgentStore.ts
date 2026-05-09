import { create } from "zustand";
import type { Node, Edge, NodeChange, EdgeChange, Connection } from "@xyflow/react";
import { applyNodeChanges, applyEdgeChanges, addEdge } from "@xyflow/react";
import {
  connectSSE,
  type NodeEnterData,
  type LLMTokenData,
  type StepCompleteData,
  type ToolResultData,
  type WorkflowCompleteData,
  type WorkflowErrorData,
} from "@/lib/useSSE";
import {
  workflowApi,
  promptApi,
  executionApi,
  type Workflow,
  type Prompt,
  type Execution,
} from "@/lib/supabaseApi";

// ============================================================
// Types
// ============================================================

export interface AgentConfig {
  agentName: string;
  modelSelection: string;
}

export type DeployStatus =
  | "idle"
  | "connecting"
  | "streaming"
  | "success"
  | "error";

export interface DeployResult {
  taskId: string;
  status: string;
  output?: string;
  steps?: string[];
  toolResults?: { tool: string; result: string }[];
  humanResponses?: Record<string, string>;
  receivedConfig?: Record<string, unknown>;
  error?: string;
}

// 节点执行状态
export type NodeExecutionStatus = "idle" | "running" | "completed" | "error";

export interface NodeExecutionState {
  status: NodeExecutionStatus;
  startedAt?: number;
  completedAt?: number;
  duration?: number;
  result?: string;
  streamingText?: string; // LLM 节点的累积文本
}

// ============================================================
// Initial Data – 使用新的自定义节点类型
// ============================================================

const initialNodes: Node[] = [
  {
    id: "1",
    type: "input",
    data: { label: "User Input (Start)" },
    position: { x: 250, y: 50 },
    style: {
      background: "transparent",
      border: "none",
      padding: 0,
      boxShadow: "none",
    },
  },
  {
    id: "2",
    type: "llm_call",
    data: { label: "Agent Reasoning", prompt: "You are a helpful AI assistant. Analyze the user's request." },
    position: { x: 250, y: 180 },
    style: {
      background: "transparent",
      border: "none",
      padding: 0,
      boxShadow: "none",
    },
  },
  {
    id: "3",
    type: "output",
    data: { label: "Final Output", prompt: "" },
    position: { x: 250, y: 310 },
    style: {
      background: "transparent",
      border: "none",
      padding: 0,
      boxShadow: "none",
    },
  },
];

const initialEdges: Edge[] = [
  {
    id: "e1-2",
    source: "1",
    target: "2",
    animated: true,
    style: { stroke: "#8b5cf6" },
  },
  {
    id: "e2-3",
    source: "2",
    target: "3",
    animated: true,
    style: { stroke: "#34d399" },
  },
];

// ============================================================
// Node Style (transparent wrapper for custom nodes)
// ============================================================

const TRANSPARENT_STYLE = {
  background: "transparent",
  border: "none",
  padding: 0,
  boxShadow: "none",
};

// ============================================================
// Store
// ============================================================

interface AgentStore {
  // --- Canvas ---
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;

  // --- Selection ---
  selectedNodeId: string | null;
  selectNode: (nodeId: string | null) => void;

  // --- Node Operations ---
  addNode: (type: string, data: Record<string, unknown>, position?: { x: number; y: number }) => void;
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  removeNode: (nodeId: string) => void;

  // --- Config ---
  agentConfig: AgentConfig;
  setAgentConfig: (patch: Partial<AgentConfig>) => void;

  // --- Deploy (SSE) ---
  deployStatus: DeployStatus;
  deployResult: DeployResult | null;
  deploy: (backendUrl: string) => void;
  resetDeploy: () => void;

  // --- 实时执行状态 ---
  nodeExecutionStates: Record<string, NodeExecutionState>;
  liveSteps: string[];
  streamingTokens: Record<string, string>; // node_id → accumulated text
  resetExecution: () => void;

  // --- 持久化 (Supabase) ---
  currentWorkflowId: string | null;
  savedWorkflows: Workflow[];
  savedPrompts: Prompt[];
  executionHistory: Execution[];
  isSaving: boolean;
  isLoading: boolean;

  // Workflow 持久化
  saveWorkflow: (name?: string) => Promise<void>;
  loadWorkflow: (id: string) => Promise<void>;
  listWorkflows: () => Promise<void>;
  deleteWorkflow: (id: string) => Promise<void>;

  // Prompt 持久化
  savePrompt: (name?: string) => Promise<void>;
  loadPrompt: (id: string) => Promise<void>;
  listPrompts: () => Promise<void>;
  deletePrompt: (id: string) => Promise<void>;

  // Execution 历史
  listExecutions: () => Promise<void>;
  getExecution: (id: string) => Promise<Execution | null>;
}

let nodeIdCounter = 10; // 从较大数字开始避免与初始节点冲突
let activeAbortController: AbortController | null = null;

export const useAgentStore = create<AgentStore>((set, get) => ({
  // ---- Canvas State ----
  nodes: initialNodes,
  edges: initialEdges,

  // ---- Selection State ----
  selectedNodeId: null,

  selectNode: (nodeId) => {
    set((s) => ({
      selectedNodeId: nodeId,
      nodes: s.nodes.map((n) => ({
        ...n,
        selected: n.id === nodeId,
      })),
    }));
  },

  onNodesChange: (changes) => {
    const newNodes = applyNodeChanges(changes, get().nodes);

    // 从 React Flow 的 select 事件中同步 selectedNodeId
    const selectChanges = changes.filter(
      (c): c is NodeChange & { type: "select"; id: string; selected: boolean } =>
        c.type === "select"
    );
    let newSelectedId = get().selectedNodeId;
    for (const sc of selectChanges) {
      if (sc.selected) {
        newSelectedId = sc.id;
      } else if (sc.id === newSelectedId) {
        newSelectedId = null;
      }
    }

    set({ nodes: newNodes, selectedNodeId: newSelectedId });
  },
  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },
  onConnect: (connection) => {
    set({
      edges: addEdge(
        { ...connection, animated: true, style: { stroke: "#38bdf8" } },
        get().edges
      ),
    });
  },

  // ---- Node Operations ----
  addNode: (type, data, position) => {
    const id = String(++nodeIdCounter);
    const pos = position || { x: 250, y: 100 };

    const newNode: Node = {
      id,
      type,
      data: { ...data },
      position: pos,
      style: TRANSPARENT_STYLE,
    };

    set((s) => ({ nodes: [...s.nodes, newNode] }));
  },

  updateNodeData: (nodeId, dataUpdate) => {
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, ...dataUpdate } }
          : n
      ),
    }));
  },

  removeNode: (nodeId) => {
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== nodeId),
      edges: s.edges.filter(
        (e) => e.source !== nodeId && e.target !== nodeId
      ),
      // 删除选中节点时清空选中状态
      selectedNodeId: s.selectedNodeId === nodeId ? null : s.selectedNodeId,
    }));
  },

  // ---- Config State ----
  agentConfig: {
    agentName: "Reasoning Agent",
    modelSelection: "meta/llama-3.1-70b-instruct",
  },
  setAgentConfig: (patch) =>
    set((s) => ({ agentConfig: { ...s.agentConfig, ...patch } })),

  // ---- 实时执行状态 ----
  nodeExecutionStates: {},
  liveSteps: [],
  streamingTokens: {},

  resetExecution: () =>
    set({
      nodeExecutionStates: {},
      liveSteps: [],
      streamingTokens: {},
    }),

  // ---- 持久化状态 ----
  currentWorkflowId: null,
  savedWorkflows: [],
  savedPrompts: [],
  executionHistory: [],
  isSaving: false,
  isLoading: false,

  // ---- Workflow 持久化 ----
  saveWorkflow: async (name?: string) => {
    const { nodes, edges, agentConfig, currentWorkflowId } = get();
    set({ isSaving: true });
    try {
      const graphData = {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type ?? "default",
          data: n.data,
          position: n.position,
          style: n.style,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          animated: e.animated,
          style: e.style,
          label: e.label,
          sourceHandle: e.sourceHandle,
        })),
      };
      const workflow = await workflowApi.save(
        {
          name: name || agentConfig.agentName || "Untitled Workflow",
          graph_data: graphData,
          config: {
            agent_name: agentConfig.agentName,
            model: agentConfig.modelSelection,
          },
        },
        currentWorkflowId || undefined,
      );
      set({ currentWorkflowId: workflow.id });
    } finally {
      set({ isSaving: false });
    }
  },

  loadWorkflow: async (id: string) => {
    set({ isLoading: true });
    try {
      const workflow = await workflowApi.get(id);
      if (!workflow) return;

      const graphData = workflow.graph_data as {
        nodes: Node[];
        edges: Edge[];
      };

      set({
        currentWorkflowId: workflow.id,
        nodes: graphData.nodes || [],
        edges: graphData.edges || [],
        agentConfig: {
          agentName:
            (workflow.config as Record<string, string>)?.agent_name ||
            workflow.name,
          modelSelection:
            (workflow.config as Record<string, string>)?.model ||
            "meta/llama-3.1-70b-instruct",
        },
      });
    } finally {
      set({ isLoading: false });
    }
  },

  listWorkflows: async () => {
    set({ isLoading: true });
    try {
      const workflows = await workflowApi.list();
      set({ savedWorkflows: workflows });
    } finally {
      set({ isLoading: false });
    }
  },

  deleteWorkflow: async (id: string) => {
    await workflowApi.delete(id);
    set((s) => ({
      savedWorkflows: s.savedWorkflows.filter((w) => w.id !== id),
      currentWorkflowId:
        s.currentWorkflowId === id ? null : s.currentWorkflowId,
    }));
  },

  // ---- Prompt 持久化 ----
  savePrompt: async (name?: string) => {
    const { selectedNodeId, nodes } = get();
    const selectedNode = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null;
    const promptHtml = (selectedNode?.data?.prompt as string) || "";
    if (!promptHtml) return;

    set({ isSaving: true });
    try {
      // 将 HTML 中的标签去除获得纯文本
      const tempDiv =
        typeof document !== "undefined"
          ? document.createElement("div")
          : null;
      let contentText = promptHtml;
      if (tempDiv) {
        tempDiv.innerHTML = promptHtml;
        contentText = tempDiv.textContent || tempDiv.innerText || "";
      }

      await promptApi.save({
        name: name || (selectedNode?.data?.label as string) || "Untitled Prompt",
        content_html: promptHtml,
        content_text: contentText,
      });
    } finally {
      set({ isSaving: false });
    }
  },

  loadPrompt: async (id: string) => {
    set({ isLoading: true });
    try {
      const prompt = await promptApi.get(id);
      if (prompt) {
        const { selectedNodeId } = get();
        if (selectedNodeId) {
          // 将加载的 prompt 写入当前选中的节点
          set((s) => ({
            nodes: s.nodes.map((n) =>
              n.id === selectedNodeId
                ? { ...n, data: { ...n.data, prompt: prompt.content_html } }
                : n
            ),
          }));
        }
      }
    } finally {
      set({ isLoading: false });
    }
  },

  listPrompts: async () => {
    set({ isLoading: true });
    try {
      const prompts = await promptApi.list();
      set({ savedPrompts: prompts });
    } finally {
      set({ isLoading: false });
    }
  },

  deletePrompt: async (id: string) => {
    await promptApi.delete(id);
    set((s) => ({
      savedPrompts: s.savedPrompts.filter((p) => p.id !== id),
    }));
  },

  // ---- Execution 历史 ----
  listExecutions: async () => {
    set({ isLoading: true });
    try {
      const executions = await executionApi.list();
      set({ executionHistory: executions });
    } finally {
      set({ isLoading: false });
    }
  },

  getExecution: async (id: string) => {
    return executionApi.get(id);
  },

  // ---- Deploy State (SSE) ----
  deployStatus: "idle",
  deployResult: null,

  resetDeploy: () => {
    // 终止可能正在进行的 SSE 连接
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    set({
      deployStatus: "idle",
      deployResult: null,
      nodeExecutionStates: {},
      liveSteps: [],
      streamingTokens: {},
    });
  },

  deploy: (backendUrl: string) => {
    const { nodes, edges, agentConfig, deployStatus } = get();

    // 防止重复提交
    if (deployStatus === "connecting" || deployStatus === "streaming") return;

    // 终止旧连接
    if (activeAbortController) {
      activeAbortController.abort();
    }

    // 收集所有节点中的 prompt 作为总体 prompt
    const allPrompts = nodes
      .filter((n) => n.data?.prompt)
      .map((n) => n.data.prompt as string)
      .join("\n");

    // 构建 payload
    const payload = {
      user_input: allPrompts,
      agent_type: agentConfig.agentName,
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
        label: typeof e.label === "string" ? e.label : "",
        source_handle: e.sourceHandle ?? "",
      })),
      prompt: allPrompts,
      config: {
        agent_name: agentConfig.agentName,
        model: agentConfig.modelSelection,
      },
    };

    // 重置执行状态
    set({
      deployStatus: "connecting",
      deployResult: null,
      nodeExecutionStates: {},
      liveSteps: [],
      streamingTokens: {},
    });

    // 连接 SSE
    activeAbortController = connectSSE(
      `${backendUrl}/api/v1/workflow/start`,
      payload,
      {
        onConnected: (data: { task_id: string }) => {
          set({
            deployStatus: "streaming",
            deployResult: { taskId: data.task_id, status: "STREAMING" },
          });
        },

        onNodeEnter: (data: NodeEnterData) => {
          set((s) => ({
            nodeExecutionStates: {
              ...s.nodeExecutionStates,
              [data.node_id]: {
                status: "running",
                startedAt: Date.now(),
              },
            },
            liveSteps: [
              ...s.liveSteps,
              `⚡ [${data.node_label}] Starting...`,
            ],
          }));
        },

        onLLMToken: (data: LLMTokenData) => {
          set((s) => ({
            streamingTokens: {
              ...s.streamingTokens,
              [data.node_id]: data.accumulated,
            },
            nodeExecutionStates: {
              ...s.nodeExecutionStates,
              [data.node_id]: {
                ...s.nodeExecutionStates[data.node_id],
                status: "running",
                streamingText: data.accumulated,
              },
            },
          }));
        },

        onStepComplete: (data: StepCompleteData) => {
          set((s) => {
            const prev = s.nodeExecutionStates[data.node_id];
            return {
              nodeExecutionStates: {
                ...s.nodeExecutionStates,
                [data.node_id]: {
                  ...prev,
                  status: "completed",
                  completedAt: Date.now(),
                  duration: data.duration_ms,
                  result: data.result,
                },
              },
              liveSteps: [
                ...s.liveSteps,
                `✅ ${data.result} (${Math.round(data.duration_ms)}ms)`,
              ],
            };
          });
        },

        onToolResult: (data: ToolResultData) => {
          set((s) => ({
            liveSteps: [
              ...s.liveSteps,
              `🔧 [${data.tool_name}] ${data.result.slice(0, 100)} (${Math.round(data.duration_ms)}ms)`,
            ],
          }));
        },

        onWorkflowComplete: (data: WorkflowCompleteData) => {
          activeAbortController = null;
          set((s) => ({
            deployStatus: "success",
            deployResult: {
              taskId: s.deployResult?.taskId ?? "",
              status: "SUCCESS",
              output: data.final_output,
              steps: data.steps,
              toolResults: data.tool_results,
              humanResponses: data.human_responses,
            },
          }));
        },

        onWorkflowError: (data: WorkflowErrorData) => {
          activeAbortController = null;
          // 标记出错的节点
          set((s) => ({
            deployStatus: "error",
            deployResult: {
              taskId: s.deployResult?.taskId ?? "",
              status: "ERROR",
              error: data.error,
            },
            nodeExecutionStates: data.node_id
              ? {
                  ...s.nodeExecutionStates,
                  [data.node_id]: {
                    ...s.nodeExecutionStates[data.node_id],
                    status: "error",
                  },
                }
              : s.nodeExecutionStates,
          }));
        },

        onError: (error: Error) => {
          activeAbortController = null;
          set({
            deployStatus: "error",
            deployResult: {
              taskId: "",
              status: "ERROR",
              error: error.message,
            },
          });
        },
      }
    );
  },
}));

// ============================================================
// Selector Hooks — 方便各面板组件消费
// ============================================================

/** 获取当前选中的节点完整数据，未选中时返回 null */
export function useSelectedNode() {
  return useAgentStore((s) => {
    if (!s.selectedNodeId) return null;
    return s.nodes.find((n) => n.id === s.selectedNodeId) ?? null;
  });
}
