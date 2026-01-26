import { useEffect, useMemo, useState } from "react";
import type { ApiSettings, CreateTaskPayload, LLMModel, ModelInfo, RoleGroupRoleConfig } from "../types";
import { getPlatform } from "../platform";
import { useAppStore } from "../store/useAppStore";
import { getRoleGroupSettings } from "../role-group";

function generateRoleGroupTitle(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return "Role Group";
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "Role Group";
  const firstWord = words[0].replace(/[^a-zA-Zа-яА-Я0-9]/g, "");
  return firstWord ? `${firstWord} Roles` : "Role Group";
}

function buildRolePrompt(role: RoleGroupRoleConfig, taskPrompt: string): string {
  const roleInstructions = role.prompt?.trim();
  return [
    `Role: ${role.name}`,
    roleInstructions ? `Role Instructions:\n${roleInstructions}` : "",
    `User Task:\n${taskPrompt.trim()}`
  ].filter(Boolean).join("\n\n");
}

interface RoleGroupDialogProps {
  cwd: string;
  onClose: () => void;
  onCreateTask: (payload: CreateTaskPayload) => void;
  apiSettings: ApiSettings | null;
  availableModels: ModelInfo[];
  llmModels?: LLMModel[];
}

export function RoleGroupDialog({
  cwd,
  onClose,
  onCreateTask,
  apiSettings,
  availableModels,
  llmModels = []
}: RoleGroupDialogProps) {
  const llmProviders = useAppStore((s) => s.llmProviders);
  const [taskPrompt, setTaskPrompt] = useState("");
  const [shareWebCache, setShareWebCache] = useState(true);
  const [localCwd, setLocalCwd] = useState(cwd);
  const [recentCwds, setRecentCwds] = useState<string[]>([]);
  const [roles, setRoles] = useState<RoleGroupRoleConfig[]>(() => getRoleGroupSettings(apiSettings).roles);

  useEffect(() => {
    setLocalCwd(cwd);
  }, [cwd]);

  useEffect(() => {
    setRoles(getRoleGroupSettings(apiSettings).roles);
  }, [apiSettings]);

  useEffect(() => {
    getPlatform()
      .getRecentCwds()
      .then(setRecentCwds)
      .catch((error) => {
        console.error("[RoleGroupDialog] getRecentCwds failed", { error });
      });
  }, []);

  const handleSelectDirectory = async () => {
    const result = await getPlatform().selectDirectory();
    if (result) setLocalCwd(result);
  };

  const allAvailableModels = useMemo(() => {
    const enabledLlmModels = llmModels.filter(m => m.enabled);
    if (enabledLlmModels.length > 0) {
      return enabledLlmModels.map(model => {
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
  }, [availableModels, llmModels, llmProviders]);

  const updateRole = (roleId: RoleGroupRoleConfig["id"], updates: Partial<RoleGroupRoleConfig>) => {
    setRoles(prev =>
      prev.map(role => (role.id === roleId ? { ...role, ...updates } : role))
    );
  };

  const handleCreateTask = () => {
    const enabledRoles = roles.filter(role => role.enabled);
    const title = generateRoleGroupTitle(taskPrompt);
    const tasks = enabledRoles.map((role, index) => ({
      id: `${index + 1}`,
      model: role.model || apiSettings?.model || "gpt-4",
      prompt: buildRolePrompt(role, taskPrompt),
      roleId: role.id,
      roleName: role.name
    }));

    const payload: CreateTaskPayload = {
      mode: "role_group",
      title,
      cwd: localCwd,
      allowedTools: undefined,
      shareWebCache,
      tasks
    };

    onCreateTask(payload);
  };

  const hasEnabledRoles = roles.some(role => role.enabled);
  const isValid = taskPrompt.trim() !== "" && hasEnabledRoles;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/20 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-2xl border border-ink-900/5 bg-surface p-6 shadow-elevated max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold text-ink-800">Create Role Group Task</div>
          <button className="rounded-full p-1.5 text-muted hover:bg-surface-tertiary hover:text-ink-700 transition-colors" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">
          Launch a group of agents with specialized roles to cover all perspectives.
        </p>

        <div className="mt-5 grid gap-4">
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted">Task Title</span>
            <div className="rounded-xl border border-ink-900/10 bg-surface-secondary px-4 py-2.5 text-sm text-ink-800">
              {generateRoleGroupTitle(taskPrompt)}
            </div>
          </div>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-muted">Task Description</span>
            <textarea
              rows={4}
              className="w-full rounded-xl border border-ink-900/10 bg-surface-secondary px-4 py-3 text-sm text-ink-800 placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors"
              placeholder="Describe the task for all roles..."
              value={taskPrompt}
              onChange={(event) => setTaskPrompt(event.target.value)}
            />
          </label>

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
                onChange={(event) => setLocalCwd(event.target.value)}
              />
              <button
                type="button"
                onClick={handleSelectDirectory}
                className="rounded-xl border border-ink-900/10 bg-surface px-3 py-2 text-sm text-ink-700 hover:bg-surface-tertiary transition-colors"
              >
                Browse...
              </button>
            </div>
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

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">Roles</span>
              <button
                type="button"
                onClick={() => setRoles(getRoleGroupSettings(apiSettings).roles)}
                className="text-xs text-ink-600 hover:text-ink-800"
              >
                Reset to defaults
              </button>
            </div>
            <div className="space-y-3">
              {roles.map((role) => (
                <div key={role.id} className="rounded-xl border border-ink-900/10 bg-surface p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={role.enabled}
                        onChange={(event) => updateRole(role.id, { enabled: event.target.checked })}
                        className="h-4 w-4 rounded border-ink-900/20 text-accent focus:ring-accent/40"
                      />
                      <div>
                        <div className="text-sm font-medium text-ink-900">{role.name}</div>
                        <div className="text-[11px] text-muted">{role.id}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted">Model</span>
                      {allAvailableModels.length > 0 ? (
                        <select
                          value={role.model || ""}
                          onChange={(event) => updateRole(role.id, { model: event.target.value })}
                          className="min-w-[220px] rounded-lg border border-ink-900/10 bg-surface-secondary px-3 py-2 text-xs text-ink-800 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20"
                        >
                          <option value="">
                            {apiSettings?.model ? `Default (${apiSettings.model})` : "Default model"}
                          </option>
                          {allAvailableModels.map(option => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={role.model || ""}
                          onChange={(event) => updateRole(role.id, { model: event.target.value })}
                          placeholder={apiSettings?.model || "Model id"}
                          className="min-w-[220px] rounded-lg border border-ink-900/10 bg-surface-secondary px-3 py-2 text-xs text-ink-800 placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20"
                        />
                      )}
                    </div>
                  </div>

                  <div className="mt-3 grid gap-1.5">
                    <span className="text-xs font-medium text-muted">Role Prompt</span>
                    <textarea
                      rows={3}
                      value={role.prompt}
                      onChange={(event) => updateRole(role.id, { prompt: event.target.value })}
                      className="w-full rounded-lg border border-ink-900/10 bg-surface-secondary px-3 py-2 text-xs text-ink-800 placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={shareWebCache}
              onChange={(event) => setShareWebCache(event.target.checked)}
              className="h-4 w-4 rounded border-ink-900/20 text-accent focus:ring-accent/40"
            />
            Share web cache between roles
          </label>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            className="rounded-lg border border-ink-900/10 px-4 py-2 text-sm text-ink-600 hover:bg-surface-tertiary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            onClick={handleCreateTask}
            disabled={!isValid}
            className={`rounded-lg px-5 py-2 text-sm font-medium text-white transition-colors ${
              isValid ? "bg-accent hover:bg-accent/90" : "bg-ink-300 cursor-not-allowed"
            }`}
          >
            Create Role Group
          </button>
        </div>
      </div>
    </div>
  );
}
