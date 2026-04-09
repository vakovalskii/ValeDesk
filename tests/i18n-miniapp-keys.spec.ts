import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { globSync } from "glob";

// All mini-app i18n keys that must exist in both locales
const MINIAPP_KEYS = [
  // Vale Apps sidebar
  "valeApps.title",
  "valeApps.filterPlaceholder",
  "valeApps.noWorkflows",
  "valeApps.edit",
  "valeApps.archive",
  "valeApps.delete",
  "valeApps.run",
  "valeApps.createValeApp",
  "valeApps.analyzing",

  // Distill config dialog
  "distillConfig.title",
  "distillConfig.model",
  "distillConfig.modelHint",
  "distillConfig.sessionModel",
  "distillConfig.maxCycles",
  "distillConfig.maxCyclesHint",
  "distillConfig.cancel",
  "distillConfig.start",

  // Distill panel — main
  "distill.title",
  "distill.close",
  "distill.analyzing",
  "distill.analyzeDescription",
  "distill.tokens",
  "distill.cancelBtn",
  "distill.validationErrors",
  "distill.retryDistill",
  "distill.publish",
  "distill.saveDraft",
  "distill.inputsNotFound",
  "distill.needsClarification",
  "distill.notSuitable",

  // Distill panel — form labels
  "distill.nameLabel",
  "distill.descriptionLabel",
  "distill.goalLabel",
  "distill.inputsLabel",
  "distill.acceptanceCriteria",
  "distill.permNetwork",
  "distill.permFileSystem",
  "distill.permGit",

  // Distill panel — step editor labels
  "distill.stepScript",
  "distill.stepTitle",
  "distill.stepPromptTemplate",
  "distill.stepTools",
  "distill.stepOutput",
  "distill.stepNone",
  "distill.debugLog",

  // Distill panel — steps (left panel)
  "distill.steps",
  "distill.systemContext",
  "distill.systemContextHint",
  "distill.goal",
  "distill.constraints",
  "distill.sessionResult",
  "distill.requirements",
  "distill.sourceContext",

  // Distill panel — chat (right panel)
  "distill.chatTitle",
  "distill.chatPlaceholder",
  "distill.chatEmpty",
  "distill.chatProcessing",
  "distill.chatSendError",
  "distill.chatWorkflowUpdated",
  "distill.chatProcessingError",

  // Distill panel — verification
  "distill.verificationResult",
  "distill.iterations",
  "distill.match",
  "distill.discrepancies",
  "distill.discrepanciesTitle",
  "distill.suggestions",
  "distill.rerunReview",
  "distill.fixDiscrepancies",
  "distill.verificationArtifacts",
  "distill.stepResults",

  // Run workflow dialog
  "runWorkflow.title",
  "runWorkflow.close",
  "runWorkflow.model",
  "runWorkflow.noModels",
  "runWorkflow.selectValue",
  "runWorkflow.cancel",
  "runWorkflow.start",
];

function loadLocale(locale: string): Record<string, string> {
  const path = join(__dirname, "..", "locales", `${locale}.json`);
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("Mini-app i18n keys", () => {
  const en = loadLocale("en");
  const ru = loadLocale("ru");

  it("all mini-app keys exist in en.json", () => {
    const missing = MINIAPP_KEYS.filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });

  it("all mini-app keys exist in ru.json", () => {
    const missing = MINIAPP_KEYS.filter((k) => !(k in ru));
    expect(missing).toEqual([]);
  });

  it("no mini-app key has empty value in en.json", () => {
    const empty = MINIAPP_KEYS.filter((k) => k in en && !en[k]?.trim());
    expect(empty).toEqual([]);
  });

  it("no mini-app key has empty value in ru.json", () => {
    const empty = MINIAPP_KEYS.filter((k) => k in ru && !ru[k]?.trim());
    expect(empty).toEqual([]);
  });

  it("en and ru locale files have the same set of keys", () => {
    const enKeys = Object.keys(en).filter((k) => !k.startsWith("_")).sort();
    const ruKeys = Object.keys(ru).filter((k) => !k.startsWith("_")).sort();
    const onlyEn = enKeys.filter((k) => !ruKeys.includes(k));
    const onlyRu = ruKeys.filter((k) => !enKeys.includes(k));
    expect(onlyEn).toEqual([]);
    expect(onlyRu).toEqual([]);
  });

  it("all t() calls in DistillPanel reference existing keys", () => {
    const src = readFileSync(join(__dirname, "..", "src", "ui", "components", "DistillPanel.tsx"), "utf8");
    const tCalls = Array.from(src.matchAll(/\bt\(["']([^"']+)["']/g)).map((m) => m[1]);
    const missing = tCalls.filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });

  it("all t() calls in App.tsx (mini-app sections) reference existing keys", () => {
    const src = readFileSync(join(__dirname, "..", "src", "ui", "App.tsx"), "utf8");
    const tCalls = Array.from(src.matchAll(/\bt\(["']([^"']+)["']/g)).map((m) => m[1]);
    // Filter only mini-app related keys
    const miniAppKeys = tCalls.filter(
      (k) => k.startsWith("valeApps.") || k.startsWith("distill") || k.startsWith("runWorkflow.")
    );
    const missing = miniAppKeys.filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });
});
