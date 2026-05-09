"use client";

import AgentCanvas from "@/components/canvas/AgentCanvas";
import PromptEditor from "@/components/editor/PromptEditor";
import NodePropertiesPanel from "@/components/canvas/NodePropertiesPanel";
import { useAgentStore } from "@/store/useAgentStore";
import {
  Loader2,
  Rocket,
  CheckCircle2,
  XCircle,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Radio,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

export default function Home() {
  const agentConfig = useAgentStore((s) => s.agentConfig);
  const setAgentConfig = useAgentStore((s) => s.setAgentConfig);
  const deployStatus = useAgentStore((s) => s.deployStatus);
  const deployResult = useAgentStore((s) => s.deployResult);
  const deploy = useAgentStore((s) => s.deploy);
  const resetDeploy = useAgentStore((s) => s.resetDeploy);
  const selectedNodeId = useAgentStore((s) => s.selectedNodeId);

  const [showResult, setShowResult] = useState(false);

  const isRunning = deployStatus === "connecting" || deployStatus === "streaming";

  const handleDeploy = () => {
    if (isRunning) return;
    setShowResult(true);
    deploy(BACKEND_URL);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-6 flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-emerald-400 bg-clip-text text-transparent">
            Agent Studio
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Orchestrate complex workflows and design precise prompts
          </p>
        </div>
        <div className="flex gap-3 items-center">
          {/* Deploy Status Badge */}
          {deployStatus !== "idle" && (
            <DeployBadge
              status={deployStatus}
              taskId={deployResult?.taskId}
              onReset={resetDeploy}
            />
          )}

          <button className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors border border-slate-700">
            Docs
          </button>

          <button
            id="deploy-agent-btn"
            onClick={handleDeploy}
            disabled={isRunning}
            className={`
              flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all
              ${
                isRunning
                  ? "bg-indigo-600/50 cursor-wait shadow-none"
                  : "bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30 active:scale-95"
              }
            `}
          >
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Rocket className="w-4 h-4" />
                Deploy Agent
              </>
            )}
          </button>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Canvas (takes up 2 columns) */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <AgentCanvas />

          {/* Execution Result Panel */}
          {showResult && (deployResult || isRunning) && (
            <LiveResultPanel
              deployStatus={deployStatus}
              deployResult={deployResult}
              onClose={() => setShowResult(false)}
            />
          )}
        </div>

        {/* Right Column: Prompt Editor, Node Properties & Config */}
        <div className="flex flex-col gap-6">
          <PromptEditor />

          {/* Node Properties Panel */}
          <NodePropertiesPanel />

          {/* Current Selection Indicator */}
          <div className="bg-slate-900/50 backdrop-blur-md rounded-2xl border border-slate-800 p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
              <span className="text-sm font-medium text-slate-300">
                Selected Node
              </span>
            </div>
            <div className="text-xs font-mono text-slate-400 bg-slate-950 px-2.5 py-1 rounded-md border border-slate-800">
              {selectedNodeId ? `#${selectedNodeId}` : "None"}
            </div>
          </div>

          {/* Agent Config */}
          <div className="bg-slate-900/50 backdrop-blur-md rounded-2xl border border-slate-800 p-5">
            <h3 className="text-sm font-medium text-slate-300 mb-4 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
              Agent Configuration
            </h3>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Agent Name</label>
                <input
                  id="agent-name-input"
                  type="text"
                  value={agentConfig.agentName}
                  onChange={(e) =>
                    setAgentConfig({ agentName: e.target.value })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Model Selection</label>
                <select
                  id="model-select"
                  value={agentConfig.modelSelection}
                  onChange={(e) =>
                    setAgentConfig({ modelSelection: e.target.value })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 transition-colors appearance-none"
                >
                  <option value="meta/llama-3.1-70b-instruct">Llama 3.1 70B</option>
                  <option value="z-ai/glm-5.1">GLM 5.1</option>
                  <option value="meta/llama-3.1-8b-instruct">Llama 3.1 8B</option>
                  <option value="google/gemma-2-9b-it">Gemma 2 9B</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ============================================================
// Sub-Components
// ============================================================

function DeployBadge({
  status,
  taskId,
  onReset,
}: {
  status: string;
  taskId?: string;
  onReset: () => void;
}) {
  const colorMap: Record<string, string> = {
    connecting: "text-amber-400 border-amber-400/30 bg-amber-400/10",
    streaming: "text-sky-400 border-sky-400/30 bg-sky-400/10",
    success: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10",
    error: "text-red-400 border-red-400/30 bg-red-400/10",
  };

  const iconMap: Record<string, React.ReactNode> = {
    connecting: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
    streaming: <Radio className="w-3.5 h-3.5 animate-pulse" />,
    success: <CheckCircle2 className="w-3.5 h-3.5" />,
    error: <XCircle className="w-3.5 h-3.5" />,
  };

  const labelMap: Record<string, string> = {
    connecting: "Connecting",
    streaming: "Live",
    success: "Success",
    error: "Error",
  };

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium ${
        colorMap[status] ?? ""
      }`}
    >
      {iconMap[status]}
      <span>{labelMap[status] ?? status}</span>
      {taskId && (
        <span className="text-slate-500 font-mono truncate max-w-[80px]">
          {taskId.slice(0, 8)}
        </span>
      )}
      {(status === "success" || status === "error") && (
        <button
          onClick={onReset}
          className="ml-1 p-0.5 rounded hover:bg-white/10 transition-colors"
          title="Reset"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ============================================================
// Live Result Panel — 实时显示执行进度
// ============================================================

function LiveResultPanel({
  deployStatus,
  deployResult,
  onClose,
}: {
  deployStatus: string;
  deployResult: NonNullable<ReturnType<typeof useAgentStore.getState>["deployResult"]> | null;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const liveSteps = useAgentStore((s) => s.liveSteps);
  const streamingTokens = useAgentStore((s) => s.streamingTokens);

  // 自动滚动到底部
  const stepsEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [liveSteps]);

  const statusColor =
    deployStatus === "success"
      ? "border-emerald-500/40"
      : deployStatus === "error"
      ? "border-red-500/40"
      : "border-indigo-500/40";

  const isStreaming = deployStatus === "connecting" || deployStatus === "streaming";

  return (
    <div
      className={`bg-slate-900/60 backdrop-blur-md rounded-2xl border ${statusColor} overflow-hidden transition-all`}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-slate-200 hover:bg-slate-800/30 transition-colors"
      >
        <span className="flex items-center gap-2">
          {deployStatus === "success" && (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          )}
          {deployStatus === "error" && (
            <XCircle className="w-4 h-4 text-red-400" />
          )}
          {isStreaming && (
            <Radio className="w-4 h-4 text-indigo-400 animate-pulse" />
          )}
          {isStreaming ? "Live Execution" : "Execution Result"}
          {isStreaming && liveSteps.length > 0 && (
            <span className="text-[10px] text-slate-500 font-normal">
              {liveSteps.length} steps
            </span>
          )}
        </span>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-slate-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-500" />
        )}
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-5 pb-4 space-y-3">
          {/* Live Steps */}
          {liveSteps.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                {isStreaming && (
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                )}
                Live Steps
              </div>
              <div className="max-h-[200px] overflow-y-auto space-y-1">
                {liveSteps.map((step, i) => (
                  <div
                    key={i}
                    className="text-xs text-slate-300 bg-slate-800/50 rounded px-3 py-1.5 font-mono live-step-enter"
                  >
                    {step}
                  </div>
                ))}
                <div ref={stepsEndRef} />
              </div>
            </div>
          )}

          {/* Streaming Token Preview */}
          {isStreaming && Object.keys(streamingTokens).length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                Streaming Output
              </div>
              {Object.entries(streamingTokens).map(([nodeId, text]) => (
                <div
                  key={nodeId}
                  className="text-xs text-slate-200 bg-slate-800/50 rounded-lg p-3 whitespace-pre-wrap font-mono leading-relaxed max-h-[150px] overflow-y-auto streaming-cursor"
                >
                  {text}
                </div>
              ))}
            </div>
          )}

          {/* Final Output */}
          {deployResult?.output && deployStatus === "success" && (
            <div className="space-y-1">
              <div className="text-xs text-slate-400 font-medium">Output</div>
              <div className="text-sm text-slate-200 bg-slate-800/50 rounded-lg p-3 whitespace-pre-wrap font-mono leading-relaxed max-h-[300px] overflow-y-auto">
                {deployResult.output}
              </div>
            </div>
          )}

          {/* Error */}
          {deployResult?.error && (
            <div className="space-y-1">
              <div className="text-xs text-red-400 font-medium">Error</div>
              <div className="text-sm text-red-300 bg-red-950/30 border border-red-500/20 rounded-lg p-3 whitespace-pre-wrap font-mono">
                {deployResult.error}
              </div>
            </div>
          )}

          {/* Connecting placeholder */}
          {deployStatus === "connecting" && liveSteps.length === 0 && (
            <div className="flex items-center gap-2 py-4 justify-center text-slate-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Connecting to execution stream...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
