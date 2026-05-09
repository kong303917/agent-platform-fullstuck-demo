"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useState, useRef } from "react";
import { Bot, Sparkles, Variable, MousePointerClick } from "lucide-react";
import { useAgentStore, useSelectedNode } from "@/store/useAgentStore";

// 支持 prompt 编辑的节点类型
const PROMPTABLE_TYPES = new Set(["llm_call", "output", "human_input"]);

export default function PromptEditor() {
  const [mounted, setMounted] = useState(false);
  const selectedNode = useSelectedNode();
  const updateNodeData = useAgentStore((s) => s.updateNodeData);

  // 判断当前节点是否可编辑 prompt
  const isPromptable = selectedNode && PROMPTABLE_TYPES.has(selectedNode.type || "");
  const nodePrompt = isPromptable ? ((selectedNode.data?.prompt as string) || "") : "";
  const nodeLabel = (selectedNode?.data?.label as string) || "Untitled";
  const nodeId = selectedNode?.id ?? null;

  // 跟踪上一次同步到编辑器的节点 ID，避免重复 setContent
  const lastSyncedNodeIdRef = useRef<string | null>(null);

  const editor = useEditor({
    extensions: [StarterKit],
    immediatelyRender: false,
    content: "",
    editorProps: {
      attributes: {
        class:
          "prose prose-invert prose-sm sm:prose-base focus:outline-none max-w-none min-h-[200px] px-6 py-4",
      },
    },
    onUpdate: ({ editor: e }) => {
      // 将编辑内容回写到节点 data.prompt
      if (nodeId) {
        updateNodeData(nodeId, { prompt: e.getHTML() });
      }
    },
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  // 当选中节点切换时，同步编辑器内容
  useEffect(() => {
    if (!editor) return;

    if (isPromptable && nodeId && nodeId !== lastSyncedNodeIdRef.current) {
      editor.commands.setContent(nodePrompt);
      lastSyncedNodeIdRef.current = nodeId;
    } else if (!isPromptable) {
      editor.commands.setContent("");
      lastSyncedNodeIdRef.current = null;
    }
  }, [editor, nodeId, isPromptable, nodePrompt]);

  if (!mounted || !editor) {
    return (
      <div className="w-full min-h-[300px] flex items-center justify-center bg-slate-900 rounded-2xl animate-pulse border border-slate-800">
        <div className="text-slate-500">Loading Editor...</div>
      </div>
    );
  }

  // 未选中可编辑的节点时，显示占位提示
  if (!isPromptable) {
    return (
      <div className="w-full flex flex-col bg-slate-950/80 backdrop-blur-xl rounded-2xl border border-slate-800 shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-slate-900/50 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-slate-500" />
            <h3 className="text-sm font-medium text-slate-400">Prompt Designer</h3>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center py-12 px-6 text-center gap-3">
          <MousePointerClick className="w-8 h-8 text-slate-600" />
          <p className="text-sm text-slate-500">
            Select an <span className="text-violet-400 font-medium">LLM</span>,{" "}
            <span className="text-emerald-400 font-medium">Output</span>, or{" "}
            <span className="text-rose-400 font-medium">Human Input</span> node to edit its prompt
          </p>
        </div>
        {/* Status Bar */}
        <div className="px-4 py-2 bg-slate-900/80 border-t border-slate-800 flex justify-between items-center text-xs text-slate-500">
          <div>No node selected</div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-slate-600"></span>
            Idle
          </div>
        </div>
      </div>
    );
  }

  const insertVariable = () => {
    editor.chain().focus().insertContent(" <code>{{variable}}</code> ").run();
  };

  return (
    <div className="w-full flex flex-col bg-slate-950/80 backdrop-blur-xl rounded-2xl border border-slate-800 shadow-xl overflow-hidden">
      {/* Editor Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900/50 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-indigo-400" />
          <h3 className="text-sm font-medium text-slate-200">Prompt Designer</h3>
          <span className="text-[10px] text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full font-mono">
            {nodeLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={insertVariable}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-400/10 hover:bg-emerald-400/20 rounded-md transition-colors border border-emerald-400/20"
          >
            <Variable className="w-3.5 h-3.5" />
            Insert Variable
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-400 bg-indigo-400/10 hover:bg-indigo-400/20 rounded-md transition-colors border border-indigo-400/20">
            <Sparkles className="w-3.5 h-3.5" />
            Optimize
          </button>
        </div>
      </div>

      {/* Editor Content */}
      <div className="flex-1 bg-slate-900/30">
        <EditorContent editor={editor} />
      </div>

      {/* Status Bar */}
      <div className="px-4 py-2 bg-slate-900/80 border-t border-slate-800 flex justify-between items-center text-xs text-slate-500">
        <div>Characters: {editor.getText().length}</div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          Editing · Node #{nodeId}
        </div>
      </div>
    </div>
  );
}
