import { useState, Component } from "react";
import type { ReactNode } from "react";
import type { Skill, SkillRepository, SkillRepositoryType } from "../types";
import { useI18n } from "../i18n";
import { getPlatform } from "../platform";

interface SkillsTabProps {
  skills: Skill[];
  repositories: SkillRepository[];
  lastFetched?: number;
  loading: boolean;
  error: string | null;
  onToggleSkill: (skillId: string, enabled: boolean) => void;
  onRefresh: () => void;
  onAddRepository: (repo: Omit<SkillRepository, "id">) => void;
  onUpdateRepository: (id: string, updates: Partial<Omit<SkillRepository, "id">>) => void;
  onRemoveRepository: (id: string) => void;
  onToggleRepository: (id: string, enabled: boolean) => void;
}

interface RepoFormState {
  name: string;
  type: SkillRepositoryType;
  url: string;
}

const DEFAULT_FORM: RepoFormState = { name: "", type: "github", url: "" };

function urlPlaceholder(type: SkillRepositoryType, t: (key: string) => string): string {
  if (type === "github") return t("skillsTab.urlPlaceholderGithub");
  if (type === "local") return t("skillsTab.urlPlaceholderLocal");
  return t("skillsTab.urlPlaceholderHttp");
}

function typeBadgeClass(type: SkillRepositoryType): string {
  if (type === "github") return "bg-purple-100 text-purple-700";
  if (type === "local") return "bg-green-100 text-green-700";
  return "bg-blue-100 text-blue-700";
}

function typeLabel(type: SkillRepositoryType, t: (key: string) => string): string {
  if (type === "github") return t("skillsTab.typeGithub");
  if (type === "local") return t("skillsTab.typeLocal");
  return t("skillsTab.typeHttp");
}

class SkillsTabErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[SkillsTabErrorBoundary] caught render error:", error);
    console.error("[SkillsTabErrorBoundary] component stack:", info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-6 text-center text-red-500">
          <p className="font-medium">Failed to render skills tab</p>
          <p className="text-sm mt-1 text-ink-500">{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export function SkillsTab(props: SkillsTabProps) {
  return (
    <SkillsTabErrorBoundary>
      <SkillsTabInner {...props} />
    </SkillsTabErrorBoundary>
  );
}

function SkillsTabInner({
  skills,
  repositories,
  lastFetched,
  loading,
  error,
  onToggleSkill,
  onRefresh,
  onAddRepository,
  onUpdateRepository,
  onRemoveRepository,
  onToggleRepository
}: SkillsTabProps) {
  console.log("[SkillsTabInner] render - skills:", skills?.length, "repos:", repositories?.length, "loading:", loading);
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  const [showOnlyEnabled, setShowOnlyEnabled] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Dialog state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addForm, setAddForm] = useState<RepoFormState>(DEFAULT_FORM);
  const [editingRepo, setEditingRepo] = useState<SkillRepository | null>(null);
  const [editForm, setEditForm] = useState<RepoFormState>(DEFAULT_FORM);

  // Get unique categories
  const categories = Array.from(new Set(skills.map(s => s.category).filter(Boolean))) as string[];

  // Filter skills
  const filteredSkills = skills.filter(skill => {
    const matchesSearch = !searchQuery ||
      (skill.name?.toLowerCase() ?? '').includes(searchQuery.toLowerCase()) ||
      (skill.description?.toLowerCase() ?? '').includes(searchQuery.toLowerCase());
    const matchesEnabled = !showOnlyEnabled || skill.enabled;
    const matchesCategory = !selectedCategory || skill.category === selectedCategory;
    return matchesSearch && matchesEnabled && matchesCategory;
  });

  const enabledCount = skills.filter(s => s.enabled).length;

  const formatLastFetched = () => {
    if (!lastFetched) return t("skillsTab.never");
    const date = new Date(lastFetched);
    return date.toLocaleString();
  };

  const handleAddSubmit = () => {
    if (!addForm.name.trim() || !addForm.url.trim()) return;
    onAddRepository({ name: addForm.name.trim(), type: addForm.type, url: addForm.url.trim(), enabled: true });
    setAddForm(DEFAULT_FORM);
    setShowAddDialog(false);
  };

  const handleEditStart = (repo: SkillRepository) => {
    setEditingRepo(repo);
    setEditForm({ name: repo.name, type: repo.type, url: repo.url });
  };

  const handleEditSubmit = () => {
    if (!editingRepo || !editForm.name.trim() || !editForm.url.trim()) return;
    onUpdateRepository(editingRepo.id, { name: editForm.name.trim(), type: editForm.type, url: editForm.url.trim() });
    setEditingRepo(null);
  };

  const repoById = (id: string) => repositories.find(r => r.id === id);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-ink-900">{t("skillsTab.skillsMarketplace")}</h3>
          <p className="text-sm text-ink-500">
            {t("skillsTab.skillsAvailable", { count: skills.length })} • {enabledCount} {t("skillsTab.enabled")}
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-ink-600 bg-ink-50 rounded-lg hover:bg-ink-100 transition-colors disabled:opacity-50"
        >
          {loading ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          {t("skillsTab.refresh")}
        </button>
      </div>

      {/* Repositories Section */}
      <div className="border border-ink-200 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 bg-ink-50">
          <span className="text-sm font-medium text-ink-700">{t("skillsTab.repositories")}</span>
          <button
            onClick={() => { setAddForm(DEFAULT_FORM); setShowAddDialog(true); }}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-accent bg-accent/10 rounded hover:bg-accent/20 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {t("skillsTab.addRepository")}
          </button>
        </div>

        {/* Repository List */}
        {repositories.length === 0 ? (
          <div className="p-4 text-center text-sm text-ink-400">{t("skillsTab.noRepositories")}</div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {repositories.map(repo => (
              <li key={repo.id} className="p-3 bg-white">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <label className="flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={repo.enabled}
                        onChange={() => onToggleRepository(repo.id, !repo.enabled)}
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4 bg-ink-200 rounded-full peer peer-checked:bg-accent relative after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-4"></div>
                    </label>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-ink-900 truncate">{repo.name}</span>
                        <span className={`px-1.5 py-0.5 text-xs font-medium rounded shrink-0 ${typeBadgeClass(repo.type)}`}>
                          {typeLabel(repo.type, t)}
                        </span>
                      </div>
                      <p className="text-xs text-ink-400 truncate font-mono">{repo.url}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleEditStart(repo)}
                      className="px-2 py-1 text-xs font-medium text-ink-600 bg-ink-100 rounded hover:bg-ink-200"
                    >
                      {t("skillsTab.editRepository")}
                    </button>
                    <button
                      onClick={() => onRemoveRepository(repo.id)}
                      className="px-2 py-1 text-xs font-medium text-red-600 bg-red-50 rounded hover:bg-red-100"
                    >
                      {t("skillsTab.removeRepository")}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Last fetched */}
        <div className="px-3 py-1.5 bg-ink-50 border-t border-ink-100 text-xs text-ink-400">
          {t("skillsTab.lastUpdated")} {formatLastFetched()}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Search and Filters */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("skillsTab.searchSkills")}
            className="w-full pl-9 pr-4 py-2 text-sm border border-ink-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        <select
          value={selectedCategory || ""}
          onChange={(e) => setSelectedCategory(e.target.value || null)}
          className="px-3 py-2 text-sm border border-ink-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20"
        >
          <option value="">{t("skillsTab.allCategories")}</option>
          {categories.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>

        <button
          onClick={() => setShowOnlyEnabled(!showOnlyEnabled)}
          className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
            showOnlyEnabled
              ? 'bg-accent text-white'
              : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
          }`}
        >
          {t("skillsTab.enabledOnly")}
        </button>
      </div>

      {/* Skills List */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {filteredSkills.length === 0 ? (
          <div className="py-8 text-center text-ink-500">
            {skills.length === 0 ? (
              <>
                <p className="text-lg font-medium">{t("skillsTab.noSkillsLoaded")}</p>
                <p className="text-sm mt-1">{t("skillsTab.noSkillsLoadedDesc")}</p>
              </>
            ) : (
              <p>{t("skillsTab.noMatch")}</p>
            )}
          </div>
        ) : (
          filteredSkills.map(skill => (
            <SkillCard
              key={`${skill.repositoryId}:${skill.id}`}
              skill={skill}
              repoName={repoById(skill.repositoryId)?.name}
              onToggle={() => onToggleSkill(skill.id, !skill.enabled)}
              t={t}
            />
          ))
        )}
      </div>

      {/* Info */}
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-800">
          <strong>{t("skillsTab.howSkillsWork")}</strong> {t("skillsTab.howSkillsWorkDesc")}{" "}
          <code className="px-1 py-0.5 bg-blue-100 rounded text-xs">{t("skillsTab.loadSkillTool")}</code>{" "}
          {t("skillsTab.loadSkillToolDesc")}
        </p>
      </div>

      {/* Add Repository Dialog */}
      <RepoDialog
        open={showAddDialog}
        title={t("skillsTab.addRepositoryTitle")}
        form={addForm}
        onChange={setAddForm}
        onSubmit={handleAddSubmit}
        onCancel={() => { setShowAddDialog(false); setAddForm(DEFAULT_FORM); }}
        t={t}
      />

      {/* Edit Repository Dialog */}
      <RepoDialog
        open={editingRepo !== null}
        title={t("skillsTab.editRepositoryTitle")}
        form={editForm}
        onChange={setEditForm}
        onSubmit={handleEditSubmit}
        onCancel={() => setEditingRepo(null)}
        t={t}
      />
    </div>
  );
}

function RepoDialog({
  open,
  title,
  form,
  onChange,
  onSubmit,
  onCancel,
  t
}: {
  open: boolean;
  title: string;
  form: RepoFormState;
  onChange: (f: RepoFormState) => void;
  onSubmit: () => void;
  onCancel: () => void;
  t: (key: string) => string;
}) {
  if (!open) return null;

  const handleBrowse = async () => {
    const dir = await getPlatform().selectDirectory();
    if (dir) onChange({ ...form, url: dir });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-md mx-4 bg-white rounded-xl shadow-xl border border-ink-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-100">
          <h3 className="text-base font-semibold text-ink-900">{title}</h3>
          <button
            onClick={onCancel}
            className="p-1 text-ink-400 hover:text-ink-700 rounded transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-ink-600 mb-1">
              {t("skillsTab.repositoryName")}
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => onChange({ ...form, name: e.target.value })}
              placeholder={t("skillsTab.repositoryName")}
              autoFocus
              className="w-full px-3 py-2 text-sm border border-ink-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-medium text-ink-600 mb-1">
              {t("skillsTab.repositoryType")}
            </label>
            <select
              value={form.type}
              onChange={e => onChange({ ...form, type: e.target.value as SkillRepositoryType })}
              className="w-full px-3 py-2 text-sm border border-ink-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              <option value="github">{t("skillsTab.typeGithub")}</option>
              <option value="local">{t("skillsTab.typeLocal")}</option>
              <option value="http">{t("skillsTab.typeHttp")}</option>
            </select>
          </div>

          {/* URL / Path */}
          <div>
            <label className="block text-xs font-medium text-ink-600 mb-1">
              {t("skillsTab.repositoryUrl")}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.url}
                onChange={e => onChange({ ...form, url: e.target.value })}
                placeholder={urlPlaceholder(form.type, t)}
                className="flex-1 px-3 py-2 text-sm border border-ink-200 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
              {form.type === "local" && (
                <button
                  type="button"
                  onClick={handleBrowse}
                  className="px-3 py-2 text-sm font-medium text-ink-600 bg-ink-100 rounded-lg hover:bg-ink-200 transition-colors shrink-0"
                >
                  {t("skillsTab.browse")}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-ink-100">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-ink-600 bg-ink-100 rounded-lg hover:bg-ink-200 transition-colors"
          >
            {t("skillsTab.cancelEdit")}
          </button>
          <button
            onClick={onSubmit}
            disabled={!form.name.trim() || !form.url.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-accent rounded-lg hover:bg-accent/90 disabled:opacity-40 transition-colors"
          >
            {t("skillsTab.saveRepository")}
          </button>
        </div>
      </div>
    </div>
  );
}

function SkillCard({
  skill,
  repoName,
  onToggle,
  t
}: {
  skill: Skill;
  repoName?: string;
  onToggle: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className={`p-4 border rounded-lg ${
      skill.enabled
        ? 'border-accent/30 bg-accent/5'
        : 'border-ink-200 bg-white hover:border-ink-300'
    }`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-medium text-ink-900 truncate">{skill.name}</h4>
            {skill.category && (
              <span className="px-2 py-0.5 text-xs font-medium bg-ink-100 text-ink-600 rounded">
                {skill.category}
              </span>
            )}
            {repoName && (
              <span className="text-xs text-ink-400">
                {t("skillsTab.repositoryFrom")} {repoName}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-600 line-clamp-2">{skill.description}</p>
          <div className="mt-2 flex items-center gap-3 text-xs text-ink-400">
            {skill.author && <span>by {skill.author}</span>}
            {skill.version && <span>v{skill.version}</span>}
            {skill.license && <span>{skill.license}</span>}
          </div>
        </div>
        <label className="flex items-center ml-4 cursor-pointer">
          <input
            type="checkbox"
            checked={skill.enabled}
            onChange={onToggle}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-ink-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-accent/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-ink-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent relative"></div>
        </label>
      </div>
    </div>
  );
}
