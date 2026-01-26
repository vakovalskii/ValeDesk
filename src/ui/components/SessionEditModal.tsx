import { useState, useEffect } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { LLMModel } from "../types";
import { useAppStore } from "../store/useAppStore";

interface SessionEditModalProps {
  currentModel?: string;
  currentTemperature?: number;
  currentTitle?: string;
  llmModels: LLMModel[];
  onSave: (updates: { model?: string; temperature?: number; sendTemperature?: boolean; title?: string }) => void;
  onClose: () => void;
}

export function SessionEditModal({
  currentModel,
  currentTemperature,
  currentTitle,
  llmModels,
  onSave,
  onClose
}: SessionEditModalProps) {
  const llmProviders = useAppStore((s) => s.llmProviders);
  const [model, setModel] = useState(currentModel || '');
  const [temperature, setTemperature] = useState(currentTemperature ?? 0.3);
  const [sendTemperature, setSendTemperature] = useState(currentTemperature !== undefined);
  const [title, setTitle] = useState(currentTitle || '');
  const [modelSearch, setModelSearch] = useState('');

  // Filter models that are enabled and add provider label
  const enabledModels = llmModels.filter(m => m.enabled !== false).map(m => {
    const provider = llmProviders.find(p => p.id === m.providerId);
    const providerLabel = provider?.name || m.providerType;
    return {
      ...m,
      providerLabel
    };
  });
  
  // Filter by search
  const filteredModels = enabledModels.filter(m => 
    m.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
    m.id.toLowerCase().includes(modelSearch.toLowerCase()) ||
    m.providerLabel.toLowerCase().includes(modelSearch.toLowerCase())
  );

  // Get display name for current model
  const displayModel = (() => {
    if (model) {
      const found = enabledModels.find(m => m.id === model);
      return found ? found.name : model.split('::').pop() || model;
    }
    return "Select model...";
  })();

  const handleSave = () => {
    onSave({
      model: model || undefined,
      temperature: sendTemperature ? temperature : undefined,
      sendTemperature,
      title: title.trim() || undefined
    });
    onClose();
  };

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/20 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-ink-900/5 bg-surface p-6 shadow-elevated">
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold text-ink-800">Edit Session</div>
          <button 
            className="rounded-full p-1.5 text-muted hover:bg-surface-tertiary hover:text-ink-700 transition-colors" 
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <p className="mt-2 text-sm text-muted">
          Change model and settings for this session.
        </p>

        <div className="mt-5 grid gap-4">
          {/* Title */}
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted">Session Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-xl border border-ink-900/10 bg-surface-secondary px-4 py-2.5 text-sm text-ink-800 placeholder:text-muted-light focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20"
              placeholder="Session title..."
            />
          </label>

          {/* Model selector */}
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted">Model</span>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button className="flex items-center justify-between rounded-xl border border-ink-900/10 bg-surface-secondary px-4 py-2.5 text-sm text-ink-800 hover:bg-ink-50 focus:outline-none focus:ring-2 focus:ring-accent/20 transition-colors">
                  <span className="truncate">{displayModel}</span>
                  <svg className="w-4 h-4 text-muted ml-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content 
                  className="z-[100] min-w-[300px] max-w-[400px] rounded-xl border border-ink-900/10 bg-surface p-2 shadow-lg"
                  sideOffset={5}
                >
                  {/* Search input */}
                  <div className="px-2 pb-2">
                    <input
                      type="text"
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      placeholder="Search models..."
                      className="w-full px-3 py-2 text-sm border border-ink-900/10 rounded-lg bg-surface-secondary focus:outline-none focus:ring-1 focus:ring-accent/20"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    {filteredModels.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted">No models found</div>
                    ) : (
                      filteredModels.map((m) => (
                        <DropdownMenu.Item
                          key={m.id}
                          className="flex flex-col cursor-pointer rounded-lg px-3 py-2 text-sm text-ink-700 outline-none hover:bg-ink-900/5"
                          onSelect={() => {
                            setModel(m.id);
                            setModelSearch('');
                          }}
                        >
                          <span className="font-medium truncate">{m.name}</span>
                          <span className="text-xs text-muted truncate">
                            {m.providerLabel}{m.description ? ` | ${m.description}` : ''}
                          </span>
                        </DropdownMenu.Item>
                      ))
                    )}
                  </div>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </label>

          {/* Temperature */}
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted">Temperature</span>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendTemperature}
                    onChange={(e) => setSendTemperature(e.target.checked)}
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
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                disabled={!sendTemperature}
                className="w-full h-2 bg-ink-100 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
                style={{
                  background: sendTemperature 
                    ? `linear-gradient(to right, #f59e0b ${(temperature / 2) * 100}%, #e5e5e5 ${(temperature / 2) * 100}%)`
                    : '#e5e5e5'
                }}
              />
            </div>
            <p className="text-[10px] text-muted-light">
              Disable for models like GPT-5 that don't support temperature.
            </p>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-ink-600 bg-ink-50 rounded-xl hover:bg-ink-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-ink-800 rounded-xl hover:bg-ink-900 transition-colors"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
