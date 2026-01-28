import { useEffect, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ApiSettings, LLMModel, ClientEvent } from "../types";
import { getPlatform } from "../platform";
import { useAppStore } from "../store/useAppStore";

interface StartSessionModalProps {
  cwd: string;
  prompt: string;
  pendingStart: boolean;
  onCwdChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onStart: () => void;
  onClose: () => void;
  apiSettings: ApiSettings | null;
  availableModels: Array<{ id: string; name: string; description?: string }>;
  selectedModel: string | null;
  onModelChange: (model: string | null) => void;
  llmModels?: LLMModel[];
  temperature: number;
  onTemperatureChange: (temp: number) => void;
  sendTemperature?: boolean;
  onSendTemperatureChange?: (send: boolean) => void;
}

export function StartSessionModal({
  cwd,
  prompt,
  pendingStart,
  onCwdChange,
  onPromptChange,
  onStart,
  onClose,
  apiSettings,
  availableModels,
  selectedModel,
  onModelChange,
  llmModels = [],
  temperature,
  onTemperatureChange,
  sendTemperature = true,
  onSendTemperatureChange
}: StartSessionModalProps) {
  const llmProviders = useAppStore((s) => s.llmProviders);
  const schedulerDefaultModel = useAppStore((s) => s.schedulerDefaultModel);
  const schedulerDefaultTemperature = useAppStore((s) => s.schedulerDefaultTemperature);
  const schedulerDefaultSendTemperature = useAppStore((s) => s.schedulerDefaultSendTemperature);
  const [recentCwds, setRecentCwds] = useState<string[]>([]);
  const [modelSearch, setModelSearch] = useState('');

  useEffect(() => {
    getPlatform()
      .getRecentCwds()
      .then(setRecentCwds)
      .catch((error) => {
        console.error("[StartSessionModal] getRecentCwds failed", { error });
      });
  }, []);

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

  // Filter models based on search
  const filteredModels = modelSearch.trim() === '' 
    ? allAvailableModels 
    : allAvailableModels.filter(model => 
        model.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
        model.description?.toLowerCase().includes(modelSearch.toLowerCase())
      );

  // Set default model: schedulerDefaultModel > apiSettings.model
  useEffect(() => {
    if (!selectedModel) {
      // Prioritize scheduler default model if set
      if (schedulerDefaultModel) {
        onModelChange(schedulerDefaultModel);
      } else if (apiSettings?.model) {
        onModelChange(apiSettings.model);
      }
    }
  }, [apiSettings, selectedModel, onModelChange, schedulerDefaultModel]);

  // Set default temperature from scheduler defaults
  useEffect(() => {
    if (schedulerDefaultTemperature !== null) {
      onTemperatureChange(schedulerDefaultTemperature);
    }
    if (schedulerDefaultSendTemperature !== null && onSendTemperatureChange) {
      onSendTemperatureChange(schedulerDefaultSendTemperature);
    }
  }, [schedulerDefaultTemperature, schedulerDefaultSendTemperature, onTemperatureChange, onSendTemperatureChange]);

  const handleSelectDirectory = async () => {
    const result = await getPlatform().selectDirectory();
    if (result) onCwdChange(result);
  };

  // Find the selected model in the list to display its name instead of ID
  const displayModel = (() => {
    if (selectedModel) {
      const found = allAvailableModels.find(m => m.id === selectedModel);
      return found ? found.name : selectedModel;
    }
    if (apiSettings?.model) {
      const found = allAvailableModels.find(m => m.id === apiSettings.model);
      return found ? found.name : apiSettings.model;
    }
    return "Select model...";
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/20 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-ink-900/5 bg-surface p-6 shadow-elevated">
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold text-ink-800">Start Task</div>
          <button className="rounded-full p-1.5 text-muted hover:bg-surface-tertiary hover:text-ink-700 transition-colors" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">Start a new task session. You can chat without a workspace, but file operations will be disabled.</p>
        <div className="mt-5 grid gap-4">
          <label className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">Model</span>
            </div>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className="w-full rounded-xl border border-ink-900/10 bg-surface-secondary px-4 py-2.5 text-sm text-ink-800 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors text-left flex items-center justify-between">
                <span className="truncate">{displayModel}</span>
                <svg className="w-4 h-4 text-muted shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="z-50 min-w-[300px] max-w-[400px] rounded-xl border border-ink-900/10 bg-white shadow-lg" sideOffset={8}>
                  {/* Search input */}
                  <div className="p-2 border-b border-ink-900/10">
                    <input
                      type="text"
                      placeholder="Search models..."
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      className="w-full rounded-lg border border-ink-900/10 bg-surface-secondary px-3 py-2 text-sm text-ink-800 placeholder:text-muted-light focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                  
                  {/* Models list */}
                  <div className="max-h-60 overflow-y-auto p-1">
                    {allAvailableModels.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted">No models available. Check your API settings.</div>
                    ) : filteredModels.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted">No models found matching "{modelSearch}"</div>
                    ) : (
                      filteredModels.map((model) => (
                        <DropdownMenu.Item
                          key={model.id}
                          className="flex flex-col cursor-pointer rounded-lg px-3 py-2 text-sm text-ink-700 outline-none hover:bg-ink-900/5"
                          onSelect={() => {
                            onModelChange(model.id);
                            setModelSearch('');
                          }}
                        >
                          <span className="font-medium truncate">{model.name}</span>
                          {model.description && (
                            <span className="text-xs text-muted truncate">{model.description}</span>
                          )}
                        </DropdownMenu.Item>
                      ))
                    )}
                  </div>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            {/* Set as default for scheduled tasks */}
            {selectedModel && (
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-muted">
                  {schedulerDefaultModel === selectedModel 
                    ? "✓ Default for scheduled tasks" 
                    : ""}
                </span>
                {schedulerDefaultModel !== selectedModel && (
                  <button
                    type="button"
                    onClick={() => {
                      getPlatform().sendClientEvent({
                        type: "scheduler.default_model.set",
                        payload: { modelId: selectedModel }
                      } as ClientEvent);
                    }}
                    className="text-[10px] text-accent hover:text-accent-hover transition-colors"
                  >
                    Set as default for tasks
                  </button>
                )}
              </div>
            )}
          </label>

          {/* Temperature */}
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted">Temperature</span>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendTemperature !== false}
                    onChange={(e) => onSendTemperatureChange?.(e.target.checked)}
                    className="w-3 h-3 rounded border-ink-300 text-accent focus:ring-accent/20"
                  />
                  <span className="text-[10px] text-muted">send</span>
                </label>
              </div>
              <span className="text-xs text-ink-600 font-mono">{temperature.toFixed(1)}</span>
            </div>
            <div className="relative">
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={(e) => onTemperatureChange(parseFloat(e.target.value))}
                disabled={sendTemperature === false}
                className="w-full h-2 bg-ink-100 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
                style={{
                  background: sendTemperature !== false 
                    ? `linear-gradient(to right, #f59e0b ${(temperature / 2) * 100}%, #e5e5e5 ${(temperature / 2) * 100}%)`
                    : '#e5e5e5'
                }}
              />
            </div>
            <p className="text-[10px] text-muted-light">
              Lower = more focused, Higher = more creative. Disable for models like GPT-5.
            </p>
          </div>

          <label className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">Workspace Folder</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-ink-100 text-ink-600 font-medium">Optional</span>
            </div>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-xl border border-ink-900/10 bg-surface-secondary px-4 py-2.5 text-sm text-ink-800 placeholder:text-muted-light focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors"
                placeholder="Leave empty to chat without file access"
                value={cwd}
                onChange={(e) => onCwdChange(e.target.value)}
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
                <div className="flex flex-wrap gap-2 w-full min-w-0 max-h-32 overflow-y-auto">
                  {recentCwds.map((path) => (
                    <button
                      key={path}
                      type="button"
                      className={`truncate rounded-full border px-3 py-1.5 text-xs transition-colors whitespace-nowrap ${cwd === path ? "border-accent/60 bg-accent/10 text-ink-800" : "border-ink-900/10 bg-white text-muted hover:border-ink-900/20 hover:text-ink-700"}`}
                      onClick={() => onCwdChange(path)}
                      title={path}
                    >
                      {path}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </label>
          <label className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">Initial Message</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-ink-100 text-ink-600 font-medium">Optional</span>
            </div>
            <textarea
              rows={4}
              className="rounded-xl border border-ink-900/10 bg-surface-secondary p-3 text-sm text-ink-800 placeholder:text-muted-light focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors resize-none"
              placeholder="Leave empty to start chatting from the main input..."
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !pendingStart) {
                  e.preventDefault();
                  onStart();
                }
              }}
            />
            <div className="text-xs text-muted text-center">
              Press <span className="font-medium text-ink-700">{typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? '⌘ + Enter' : 'Ctrl + Enter'}</span> to start
            </div>
          </label>
          <button
            className="flex flex-col items-center rounded-full bg-accent px-5 py-3 text-sm font-medium text-white shadow-soft hover:bg-accent-hover transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onStart}
            disabled={pendingStart}
          >
            {pendingStart ? (
              <svg aria-hidden="true" className="w-5 h-5 animate-spin" viewBox="0 0 100 101" fill="none">
                <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor" opacity="0.3" />
                <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="white" />
              </svg>
            ) : "Start Chat"}
          </button>
        </div>
      </div>
    </div>
  );
}
