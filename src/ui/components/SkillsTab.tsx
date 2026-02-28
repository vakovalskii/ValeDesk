import { useState } from "react";
import type { Skill } from "../types";
import { useI18n } from "../i18n";

interface SkillsTabProps {
  skills: Skill[];
  marketplaceUrl: string;
  lastFetched?: number;
  loading: boolean;
  error: string | null;
  onToggleSkill: (skillId: string, enabled: boolean) => void;
  onRefresh: () => void;
  onSetMarketplaceUrl: (url: string) => void;
}

export function SkillsTab({
  skills,
  marketplaceUrl,
  lastFetched,
  loading,
  error,
  onToggleSkill,
  onRefresh,
  onSetMarketplaceUrl
}: SkillsTabProps) {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  const [showOnlyEnabled, setShowOnlyEnabled] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [editingUrl, setEditingUrl] = useState(false);
  const [newUrl, setNewUrl] = useState(marketplaceUrl);

  // Get unique categories
  const categories = Array.from(new Set(skills.map(s => s.category).filter(Boolean))) as string[];

  // Filter skills
  const filteredSkills = skills.filter(skill => {
    const matchesSearch = !searchQuery || 
      skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.description.toLowerCase().includes(searchQuery.toLowerCase());
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

      {/* Marketplace URL */}
      <div className="p-3 bg-ink-50 rounded-lg">
        <div className="flex items-center justify-between">
          <div className="text-sm">
            <span className="text-ink-500">{t("skillsTab.marketplace")}</span>{" "}
            {editingUrl ? (
              <input
                type="text"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                className="ml-2 px-2 py-1 text-sm border border-ink-200 rounded"
                placeholder={t("skillsTab.githubApiUrl")}
              />
            ) : (
              <span className="text-ink-700 font-mono text-xs">{marketplaceUrl}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {editingUrl ? (
              <>
                <button
                  onClick={() => {
                    onSetMarketplaceUrl(newUrl);
                    setEditingUrl(false);
                  }}
                  className="px-2 py-1 text-xs font-medium text-white bg-accent rounded hover:bg-accent/90"
                >
                  {t("settings.save")}
                </button>
                <button
                  onClick={() => {
                    setNewUrl(marketplaceUrl);
                    setEditingUrl(false);
                  }}
                  className="px-2 py-1 text-xs font-medium text-ink-600 bg-ink-100 rounded hover:bg-ink-200"
                >
                  {t("settings.cancel")}
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditingUrl(true)}
                className="px-2 py-1 text-xs font-medium text-ink-600 bg-ink-100 rounded hover:bg-ink-200"
              >
                {t("eventCard.edit")}
              </button>
            )}
          </div>
        </div>
        <div className="mt-1 text-xs text-ink-400">
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
              key={skill.id}
              skill={skill}
              onToggle={() => onToggleSkill(skill.id, !skill.enabled)}
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
    </div>
  );
}

function SkillCard({ skill, onToggle }: { skill: Skill; onToggle: () => void }) {
  return (
    <div className={`p-4 border rounded-lg transition-colors ${
      skill.enabled 
        ? 'border-accent/30 bg-accent/5' 
        : 'border-ink-200 bg-white hover:border-ink-300'
    }`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-ink-900 truncate">{skill.name}</h4>
            {skill.category && (
              <span className="px-2 py-0.5 text-xs font-medium bg-ink-100 text-ink-600 rounded">
                {skill.category}
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
