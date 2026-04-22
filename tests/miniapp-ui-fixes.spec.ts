import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const readSrc = (relPath: string) =>
  readFileSync(join(__dirname, "..", relPath), "utf8");

describe("Mini-app UI fixes", () => {
  // Fix #1 + #5: z-index — modals must be above Vale Apps sidebar (z-[70])
  describe("z-index layering", () => {
    it("DistillPanel overlay has z-index above sidebar (z-[80])", () => {
      const src = readSrc("src/ui/components/DistillPanel.tsx");
      expect(src).toContain("z-[80]");
      expect(src).not.toMatch(/class[^"]*z-50[^"]*bg-ink-900\/40/);
    });

    it("distill config dialog has z-[80]", () => {
      const src = readSrc("src/ui/App.tsx");
      // Find the JSX block {showDistillConfig && (
      const marker = "{showDistillConfig && (";
      const idx = src.indexOf(marker);
      expect(idx).toBeGreaterThan(-1);
      const distillConfigBlock = src.slice(idx, idx + 500);
      expect(distillConfigBlock).toContain("z-[80]");
    });

    it("run workflow dialog has z-[80]", () => {
      const src = readSrc("src/ui/App.tsx");
      const runBlock = src.slice(
        src.indexOf("runWorkflow && ("),
        src.indexOf("runWorkflow && (") + 500
      );
      expect(runBlock).toContain("z-[80]");
    });

    it("delete workflow dialog has z-[80]", () => {
      const src = readSrc("src/ui/App.tsx");
      const deleteBlock = src.slice(
        src.indexOf("deleteWorkflowCandidate && ("),
        src.indexOf("deleteWorkflowCandidate && (") + 500
      );
      expect(deleteBlock).toContain("z-[80]");
    });

    it("Vale Apps sidebar stays at z-[70]", () => {
      const src = readSrc("src/ui/App.tsx");
      expect(src).toMatch(/aside[\s\S]*?z-\[70\]/);
    });
  });

  // Fix #1: Edit closes sidebar
  describe("Edit workflow closes sidebar", () => {
    it("setShowWorkflowPanel(false) is called after setPendingWorkflowAction('edit')", () => {
      const src = readSrc("src/ui/App.tsx");
      const editBlock = src.slice(
        src.indexOf('setPendingWorkflowAction("edit")'),
        src.indexOf('setPendingWorkflowAction("edit")') + 300
      );
      expect(editBlock).toContain("setShowWorkflowPanel(false)");
    });
  });

  // Fix #4: Create Vale App button in sidebar
  describe("Create Vale App in sidebar", () => {
    it("sidebar aside contains Create Vale App button", () => {
      const src = readSrc("src/ui/App.tsx");
      // Find the aside block
      const asideStart = src.indexOf('<aside');
      const asideEnd = src.indexOf('</aside>', asideStart);
      const asideBlock = src.slice(asideStart, asideEnd);
      expect(asideBlock).toContain('valeApps.createValeApp');
      expect(asideBlock).toContain('canSaveMiniWorkflow');
    });

    it("sidebar is flex column for mt-auto to work", () => {
      const src = readSrc("src/ui/App.tsx");
      const asideStart = src.indexOf('<aside');
      const asideTag = src.slice(asideStart, src.indexOf('>', asideStart) + 1);
      expect(asideTag).toContain("flex flex-col");
    });
  });

  // Fix #2: Draft badge visible
  describe("Draft status badge", () => {
    it("workflow card shows draft badge when status is draft", () => {
      const src = readSrc("src/ui/App.tsx");
      expect(src).toContain('"draft"');
      expect(src).toContain('valeApps.draftBadge');
      expect(src).toMatch(/status.*===.*"draft"/);
    });
  });

  // i18n: hints are translated
  describe("Hints use t() translations", () => {
    it("saveMiniWorkflowHint uses t() not hardcoded Russian", () => {
      const src = readSrc("src/ui/App.tsx");
      const hintBlock = src.slice(
        src.indexOf("saveMiniWorkflowHint"),
        src.indexOf("saveMiniWorkflowHint") + 500
      );
      expect(hintBlock).not.toContain("Откройте сессию");
      expect(hintBlock).not.toContain("Дождитесь завершения");
      expect(hintBlock).toContain('t("valeApps.hintOpenSession")');
    });

    it("delete dialog uses t() translations", () => {
      const src = readSrc("src/ui/App.tsx");
      const deleteBlock = src.slice(
        src.indexOf("deleteWorkflowCandidate && ("),
        src.indexOf("deleteWorkflowCandidate && (") + 1000
      );
      expect(deleteBlock).toContain('t("valeApps.deleteTitle")');
      expect(deleteBlock).toContain('t("valeApps.deleteConfirm"');
      expect(deleteBlock).not.toContain("Удалить workflow");
    });
  });
});
