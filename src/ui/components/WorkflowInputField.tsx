import { useState } from "react";
import type { InputSpec } from "../../shared/mini-workflow-types";
import { getPlatform } from "../platform";
import { useI18n } from "../i18n";

type Props = {
  input: InputSpec;
  value: string;
  onChange: (value: string) => void;
};

export function WorkflowInputField({ input, value, onChange }: Props) {
  const { t } = useI18n();
  const [showSecret, setShowSecret] = useState(false);

  if (input.type === "period") {
    const [rawStart = "", rawEnd = ""] = String(value ?? "").split("/");
    const updatePeriod = (nextStart: string, nextEnd: string) => {
      onChange(nextStart || nextEnd ? `${nextStart}/${nextEnd}` : "");
    };

    return (
      <div className="mt-1 flex items-center gap-2">
        <input
          type="date"
          className="min-w-0 flex-1 rounded-lg border border-ink-900/10 px-2 py-1.5 text-sm"
          value={rawStart}
          onChange={(e) => updatePeriod(e.target.value, rawEnd)}
        />
        <span className="text-xs text-ink-400">-</span>
        <input
          type="date"
          className="min-w-0 flex-1 rounded-lg border border-ink-900/10 px-2 py-1.5 text-sm"
          value={rawEnd}
          onChange={(e) => updatePeriod(rawStart, e.target.value)}
        />
      </div>
    );
  }

  if (input.type === "boolean") {
    return (
      <div className="mt-1 flex items-center gap-2 rounded-lg border border-ink-900/10 px-2 py-1.5 bg-white">
        <input
          type="checkbox"
          checked={String(value ?? "").toLowerCase() === "true"}
          onChange={(e) => onChange(String(e.target.checked))}
        />
        <span className="text-xs text-ink-600">{input.description || input.id}</span>
      </div>
    );
  }

  if (input.type === "enum" && Array.isArray(input.enum_values)) {
    return (
      <select
        className="mt-1 w-full rounded-lg border border-ink-900/10 px-2 py-1.5 text-sm"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t("runWorkflow.selectValue")}</option>
        {input.enum_values.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    );
  }

  if (input.type === "text") {
    return (
      <textarea
        rows={3}
        className="mt-1 w-full rounded-lg border border-ink-900/10 px-2 py-1.5 text-sm font-mono"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (input.type === "file_path" || input.type === "directory") {
    const isDir = input.type === "directory";
    return (
      <div className="mt-1 flex gap-2">
        <input
          type="text"
          className="flex-1 rounded-lg border border-ink-900/10 px-2 py-1.5 text-sm"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={isDir ? t("workflowInput.directoryPlaceholder") : t("workflowInput.filePlaceholder")}
        />
        <button
          type="button"
          className="shrink-0 rounded-lg border border-ink-900/20 bg-ink-100 px-2 py-1.5 text-xs text-ink-700 hover:bg-ink-200"
          onClick={async () => {
            try {
              const picked = isDir
                ? await getPlatform().selectDirectory()
                : await getPlatform().selectFile();
              if (picked) onChange(picked);
            } catch (err) {
              console.error("[WorkflowInputField] picker failed:", err);
            }
          }}
        >
          {t("workflowInput.browse")}
        </button>
      </div>
    );
  }

  if (input.type === "secret") {
    return (
      <div className="mt-1 flex gap-2">
        <input
          type={showSecret ? "text" : "password"}
          className="flex-1 rounded-lg border border-ink-900/10 px-2 py-1.5 text-sm"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="shrink-0 rounded-lg border border-ink-900/20 bg-ink-100 px-2 py-1.5 text-xs text-ink-700 hover:bg-ink-200"
          onClick={() => setShowSecret((prev) => !prev)}
          title={showSecret ? t("workflowInput.hideSecret") : t("workflowInput.showSecret")}
        >
          {showSecret ? t("workflowInput.hide") : t("workflowInput.show")}
        </button>
      </div>
    );
  }

  const htmlType =
    input.type === "number" ? "number"
      : input.type === "date" ? "date"
        : input.type === "datetime" ? "datetime-local"
          : input.type === "url" ? "url"
            : "text";

  return (
    <input
      type={htmlType}
      className="mt-1 w-full rounded-lg border border-ink-900/10 px-2 py-1.5 text-sm"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
