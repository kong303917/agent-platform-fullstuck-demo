/**
 * SSE 客户端 Hook
 *
 * 基于 fetch + ReadableStream 解析 SSE 协议。
 * 不使用 EventSource，因为 EventSource 只支持 GET 请求，
 * 而 /api/v1/workflow/start 是 POST 请求。
 */

export interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
}

// SSE 事件类型定义
export interface NodeEnterData {
  node_id: string;
  node_label: string;
  node_type: string;
}

export interface LLMTokenData {
  node_id: string;
  token: string;
  accumulated: string;
}

export interface StepCompleteData {
  node_id: string;
  result: string;
  duration_ms: number;
}

export interface ToolResultData {
  node_id: string;
  tool_name: string;
  result: string;
  duration_ms: number;
}

export interface WorkflowCompleteData {
  status: string;
  final_output: string;
  steps: string[];
  tool_results: { tool: string; result: string }[];
  human_responses: Record<string, string>;
}

export interface WorkflowErrorData {
  error: string;
  node_id: string;
}

/**
 * SSE 事件回调接口
 */
export interface SSECallbacks {
  onConnected?: (data: { task_id: string }) => void;
  onNodeEnter?: (data: NodeEnterData) => void;
  onLLMToken?: (data: LLMTokenData) => void;
  onStepComplete?: (data: StepCompleteData) => void;
  onToolResult?: (data: ToolResultData) => void;
  onWorkflowComplete?: (data: WorkflowCompleteData) => void;
  onWorkflowError?: (data: WorkflowErrorData) => void;
  onHeartbeat?: () => void;
  onError?: (error: Error) => void;
}

/**
 * 连接 SSE 端点并消费事件流。
 *
 * 返回一个 AbortController，调用 .abort() 可主动断开连接。
 */
export function connectSSE(
  url: string,
  body: Record<string, unknown>,
  callbacks: SSECallbacks
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(
          `SSE connection failed: ${response.status} ${errText}`
        );
      }

      if (!response.body) {
        throw new Error("Response body is null");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE 协议：每个事件以 \n\n 分隔
        const parts = buffer.split("\n\n");
        // 最后一个可能是不完整的，保留到 buffer
        buffer = parts.pop() || "";

        for (const part of parts) {
          const event = parseSSEEvent(part);
          if (event) {
            dispatchEvent(event, callbacks);
          }
        }
      }

      // 处理 buffer 中可能剩余的最后一个事件
      if (buffer.trim()) {
        const event = parseSSEEvent(buffer);
        if (event) {
          dispatchEvent(event, callbacks);
        }
      }
    } catch (err) {
      // AbortError 是主动断开，不视为错误
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      callbacks.onError?.(
        err instanceof Error ? err : new Error(String(err))
      );
    }
  })();

  return controller;
}

/**
 * 解析单个 SSE 事件文本块。
 *
 * 格式:
 *   event: xxx
 *   data: {...}
 */
function parseSSEEvent(text: string): SSEEvent | null {
  let eventType = "";
  let dataStr = "";

  for (const line of text.split("\n")) {
    if (line.startsWith("event: ")) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      dataStr = line.slice(6);
    }
  }

  if (!eventType || !dataStr) return null;

  try {
    const data = JSON.parse(dataStr) as Record<string, unknown>;
    return { event: eventType, data };
  } catch {
    return null;
  }
}

/**
 * 根据事件类型分发回调。
 */
function dispatchEvent(event: SSEEvent, callbacks: SSECallbacks): void {
  const d = event.data as unknown;
  switch (event.event) {
    case "connected":
      callbacks.onConnected?.(d as { task_id: string });
      break;
    case "node_enter":
      callbacks.onNodeEnter?.(d as NodeEnterData);
      break;
    case "llm_token":
      callbacks.onLLMToken?.(d as LLMTokenData);
      break;
    case "step_complete":
      callbacks.onStepComplete?.(d as StepCompleteData);
      break;
    case "tool_result":
      callbacks.onToolResult?.(d as ToolResultData);
      break;
    case "workflow_complete":
      callbacks.onWorkflowComplete?.(d as WorkflowCompleteData);
      break;
    case "workflow_error":
      callbacks.onWorkflowError?.(d as WorkflowErrorData);
      break;
    case "heartbeat":
      callbacks.onHeartbeat?.();
      break;
    default:
      // 未知事件类型，忽略
      break;
  }
}
