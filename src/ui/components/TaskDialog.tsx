import { useState, useEffect } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ApiSettings, CreateTaskPayload, TaskMode, ThreadTask, ModelInfo, LLMModel } from "../types";
import { getPlatform } from "../platform";
import { useAppStore } from "../store/useAppStore";

// Helper function to generate task title automatically (max 3 words)
function generateTaskTitle(
  mode: TaskMode,
  tasks: ThreadTask[],
  consensusPrompt: string,
  _consensusModel: string,
  consensusQuantity: number
): string {
  if (mode === "consensus") {
    if (consensusPrompt.trim()) {
      // Extract first meaningful word from consensus prompt
      const words = consensusPrompt.trim().split(/\s+/).filter(word => word.length > 0);
      if (words.length > 0) {
        const firstWord = words[0].replace(/[^a-zA-Zа-яА-Я0-9]/g, '');
        return `${firstWord} x${consensusQuantity}`;
      }
    }
    return `Consensus x${consensusQuantity}`;
  } else {
    // For different tasks, get unique models
    const uniqueModels = [...new Set(tasks.filter(t => t.model).map(t => t.model))];
    if (uniqueModels.length > 0) {
      if (uniqueModels.length === 1) {
        return `${uniqueModels[0]} x${tasks.length}`;
      } else {
        return `Multi-Model x${tasks.length}`;
      }
    }
    return "Multi-Task";
  }
}

interface TaskDialogProps {
  cwd: string;
  onClose: () => void;
  onCreateTask: (payload: CreateTaskPayload) => void;
  apiSettings: ApiSettings | null;
  availableModels: ModelInfo[];
  llmModels?: LLMModel[];
}

export function TaskDialog({
  cwd,
  onClose,
  onCreateTask,
  apiSettings,
  availableModels,
  llmModels = []
}: TaskDialogProps) {
  const llmProviders = useAppStore((s) => s.llmProviders);
  const [mode, setMode] = useState<TaskMode>("consensus");
  const [shareWebCache, setShareWebCache] = useState(true);
  const [localCwd, setLocalCwd] = useState(cwd);
  const [recentCwds, setRecentCwds] = useState<string[]>([]);

  useEffect(() => {
    getPlatform()
      .getRecentCwds()
      .then(setRecentCwds)
      .catch((error) => {
        console.error("[TaskDialog] getRecentCwds failed", { error });
      });
  }, []);

  const handleSelectDirectory = async () => {
    const result = await getPlatform().selectDirectory();
    if (result) setLocalCwd(result);
  };

  // Consensus mode state
  const [consensusModel, setConsensusModel] = useState("");
  const [consensusQuantity, setConsensusQuantity] = useState(5);
  const [consensusPrompt, setConsensusPrompt] = useState("");
  const [autoSummary, setAutoSummary] = useState(true);

  // Different tasks mode state
  const [tasks, setTasks] = useState<ThreadTask[]>([
    { id: "1", model: "", prompt: "" }
  ]);

  // Show only enabled models from settings.
  // If no LLM models are configured, fall back to legacy API models.
  const allAvailableModels = (() => {
    const enabledLlmModels = llmModels.filter(m => m.enabled);
    if (enabledLlmModels.length > 0) {
      return enabledLlmModels.map(model => {
        // Find provider name by providerId
        const provider = llmProviders.find(p => p.id === model.providerId);
        const providerLabel = provider?.name || model.providerType;
        return {
          id: model.id,
          name: model.name,
          description: `${providerLabel} | ${model.description || ''}`
        };
      });
    }

    return availableModels.map(model => ({
      id: model.id,
      name: model.name,
      description: model.description
    }));
  })();

  const handleAddTask = () => {
    setTasks([...tasks, { id: Date.now().toString(), model: "", prompt: "" }]);
  };

  const handleRemoveTask = (index: number) => {
    if (tasks.length > 1) {
      setTasks(tasks.filter((_, i) => i !== index));
    }
  };

  const handleTaskModelChange = (index: number, model: string) => {
    const newTasks = [...tasks];
    newTasks[index].model = model;
    setTasks(newTasks);
  };

  const handleTaskPromptChange = (index: number, prompt: string) => {
    const newTasks = [...tasks];
    newTasks[index].prompt = prompt;
    setTasks(newTasks);
  };

  const handleCreateTask = () => {
    const title = generateTaskTitle(mode, tasks, consensusPrompt, consensusModel, consensusQuantity);
    
    const payload: CreateTaskPayload = {
      mode,
      title,
      cwd: localCwd,
      allowedTools: undefined,
      shareWebCache,
    };

    if (mode === "consensus") {
      payload.consensusModel = consensusModel || apiSettings?.model || "gpt-4";
      payload.consensusQuantity = consensusQuantity;
      payload.consensusPrompt = consensusPrompt;
      payload.autoSummary = autoSummary;
    } else {
      payload.tasks = tasks.filter(t => t.model || t.prompt);
    }

    onCreateTask(payload);
  };

  const isValid = mode === "consensus"
    ? consensusPrompt.trim() !== ""
    : tasks.some(t => t.model && t.prompt.trim() !== "");

  const displayConsensusModel = consensusModel || apiSettings?.model || "Select model...";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/20 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-ink-900/5 bg-surface p-6 shadow-elevated max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold text-ink-800">Create Multi-Thread Task</div>
          <button className="rounded-full p-1.5 text-muted hover:bg-surface-tertiary hover:text-ink-700 transition-colors" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">Create a task with multiple threads running in parallel. Each thread works independently with its own model and prompt.</p>

        <div className="mt-5 grid gap-4">
          {/* Auto-generated Title */}
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted">Task Title</span>
            <div className="rounded-xl border border-ink-900/10 bg-surface-secondary px-4 py-2.5 text-sm text-ink-800">
              {generateTaskTitle(mode, tasks, consensusPrompt, consensusModel, consensusQuantity)}
            </div>
          </div>

          {/* Mode Selection */}
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted">Execution Mode</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("consensus")}
                className={`rounded-xl border px-4 py-3 text-sm transition-colors text-left ${
                  mode === "consensus"
                    ? "border-accent bg-accent/10 text-ink-800"
                    : "border-ink-900/10 bg-surface-secondary text-muted hover:border-ink-900/20"
                }`}
              >
                <div className="font-medium">Consensus Mode</div>
                <div className="text-xs mt-1">Same task, N models → find best answer</div>
              </button>
              <button
                type="button"
                onClick={() => setMode("different_tasks")}
                className={`rounded-xl border px-4 py-3 text-sm transition-colors text-left ${
                  mode === "different_tasks"
                    ? "border-accent bg-accent/10 text-ink-800"
                    : "border-ink-900/10 bg-surface-secondary text-muted hover:border-ink-900/20"
                }`}
              >
                <div className="font-medium">Different Tasks</div>
                <div className="text-xs mt-1">Different tasks, different models</div>
              </button>
            </div>
          </label>

          {/* Workspace Folder */}
          <label className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">Workspace Folder</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-ink-100 text-ink-600 font-medium">Optional</span>
            </div>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-xl border border-ink-900/10 bg-surface-secondary px-4 py-2.5 text-sm text-ink-800 placeholder:text-muted-light focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors"
                placeholder="Leave empty to work without file access"
                value={localCwd}
                onChange={(e) => setLocalCwd(e.target.value)}
              />
              <button
                type="button"
                onClick={handleSelectDirectory}
                className="rounded-xl border border-ink-900/10 bg-surface px-3 py-2 text-sm text-ink-700 hover:bg-surface-tertiary transition-colors"
              >
                Browse...
              </button>
            </div>
            <p className="text-[11px] text-muted-light">
              💡 Choose a folder to enable file operations (read, write, edit, bash commands)
            </p>
            {recentCwds.length > 0 && (
              <div className="mt-2 grid gap-2 w-full">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-light">Recent</div>
                <div className="flex flex-wrap gap-2 w-full min-w-0">
                  {recentCwds.map((path) => (
                    <button
                      key={path}
                      type="button"
                      className={`truncate rounded-full border px-3 py-1.5 text-xs transition-colors whitespace-nowrap ${localCwd === path ? "border-accent/60 bg-accent/10 text-ink-800" : "border-ink-900/10 bg-white text-muted hover:border-ink-900/20 hover:text-ink-700"}`}
                      onClick={() => setLocalCwd(path)}
                      title={path}
                    >
                      {path}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </label>

          {/* Consensus Mode Options */}
          {mode === "consensus" && (
            <>
              {/* Model */}
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-muted">Model for All Threads</span>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger className="w-full rounded-xl border border-ink-900/10 bg-surface-secondary px-4 py-2.5 text-sm text-ink-800 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors text-left flex items-center justify-between">
                    <span className="truncate">{displayConsensusModel}</span>
                    <svg className="w-4 h-4 text-muted shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content className="z-50 min-w-[300px] max-w-[400px] rounded-xl border border-ink-900/10 bg-white p-1 shadow-lg max-h-60 overflow-y-auto" sideOffset={8}>
                      {allAvailableModels.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted">No models available. Check your API settings.</div>
                      ) : (
                        allAvailableModels.map((model) => (
                          <DropdownMenu.Item
                            key={model.id}
                            className="flex flex-col cursor-pointer rounded-lg px-3 py-2 text-sm text-ink-700 outline-none hover:bg-ink-900/5"
                            onSelect={() => setConsensusModel(model.id)}
                          >
                            <span className="font-medium truncate">{model.name}</span>
                            {model.description && (
                              <span className="text-xs text-muted truncate">{model.description}</span>
                            )}
                          </DropdownMenu.Item>
                        ))
                      )}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </label>

              {/* Quantity */}
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-muted">Number of Threads</span>
                <input
                  type="number"
                  min="2"
                  max="10"
                  value={consensusQuantity}
                  onChange={(e) => setConsensusQuantity(Math.max(2, Math.min(10, parseInt(e.target.value) || 2)))}
                  className="rounded-xl border border-ink-900/10 bg-surface-secondary px-4 py-2.5 text-sm text-ink-800 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors"
                />
                <p className="text-[11px] text-muted-light">Multiple threads will work on the same task independently</p>
              </label>

              {/* Prompt */}
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-muted">Task Description</span>
                <textarea
                  rows={4}
                  className="rounded-xl border border-ink-900/10 bg-surface-secondary p-3 text-sm text-ink-800 placeholder:text-muted-light focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors resize-none"
                  placeholder="Describe the task for all threads..."
                  value={consensusPrompt}
                  onChange={(e) => setConsensusPrompt(e.target.value)}
                />
              </label>

              {/* Auto Summary */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSummary}
                  onChange={(e) => setAutoSummary(e.target.checked)}
                  className="rounded border-ink-900/20 bg-surface-secondary text-accent focus:ring-accent/20"
                />
                <span className="text-sm text-ink-700">Auto-generate summary after all threads complete</span>
              </label>
            </>
          )}

          {/* Different Tasks Mode */}
          {mode === "different_tasks" && (
            <div className="grid gap-4">
              {tasks.map((task, index) => (
                <div key={task.id} className="rounded-xl border border-ink-900/10 bg-surface-secondary p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-muted">Thread {index + 1}</span>
                    {tasks.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveTask(index)}
                        className="text-xs text-error hover:text-error-dark transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  {/* Model */}
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium text-muted">Model</span>
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger className="w-full rounded-xl border border-ink-900/10 bg-surface-tertiary px-3 py-2 text-sm text-ink-800 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors text-left flex items-center justify-between">
                        <span className="truncate">{task.model || "Select model..."}</span>
                        <svg className="w-4 h-4 text-muted shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content className="z-50 min-w-[300px] max-w-[400px] rounded-xl border border-ink-900/10 bg-white p-1 shadow-lg max-h-60 overflow-y-auto" sideOffset={8}>
                          {allAvailableModels.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-muted">No models available. Check your API settings.</div>
                          ) : (
                            allAvailableModels.map((model) => (
                              <DropdownMenu.Item
                                key={model.id}
                                className="flex flex-col cursor-pointer rounded-lg px-3 py-2 text-sm text-ink-700 outline-none hover:bg-ink-900/5"
                                onSelect={() => handleTaskModelChange(index, model.id)}
                              >
                                <span className="font-medium truncate">{model.name}</span>
                                {model.description && (
                                  <span className="text-xs text-muted truncate">{model.description}</span>
                                )}
                              </DropdownMenu.Item>
                            ))
                          )}
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </label>

                  {/* Prompt */}
                  <label className="grid gap-1.5 mt-3">
                    <span className="text-xs font-medium text-muted">Task</span>
                    <textarea
                      rows={3}
                      className="rounded-xl border border-ink-900/10 bg-surface-tertiary p-3 text-sm text-ink-800 placeholder:text-muted-light focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors resize-none"
                      placeholder="Describe the task for this thread..."
                      value={task.prompt}
                      onChange={(e) => handleTaskPromptChange(index, e.target.value)}
                    />
                  </label>
                </div>
              ))}

              {tasks.length < 10 && (
                <button
                  type="button"
                  onClick={handleAddTask}
                  className="rounded-xl border border-dashed border-ink-900/20 bg-surface-secondary px-4 py-3 text-sm text-muted hover:border-accent hover:text-accent transition-colors"
                >
                  + Add Another Thread
                </button>
              )}
            </div>
          )}

          {/* Share Web Cache */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={shareWebCache}
              onChange={(e) => setShareWebCache(e.target.checked)}
              className="rounded border-ink-900/20 bg-surface-secondary text-accent focus:ring-accent/20"
            />
            <span className="text-sm text-ink-700">Share web cache between threads</span>
          </label>

          {/* Create Button */}
          <button
            className="flex flex-col items-center rounded-full bg-accent px-5 py-3 text-sm font-medium text-white shadow-soft hover:bg-accent-hover transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            onClick={handleCreateTask}
            disabled={!isValid}
          >
            Create Task
          </button>
        </div>
      </div>
    </div>
  );
}
