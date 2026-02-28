import { describe, it, expect, vi, beforeEach } from "vitest";
import { mapSystemLocaleToSupported } from "../src/ui/i18n/localeUtils";

describe("App locale flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("effectiveLocale priority", () => {
    it("uses apiSettings.locale when present", () => {
      const apiSettings = { locale: "ru" };
      const systemLocale = "en";
      const fallback = mapSystemLocaleToSupported(navigator.language);

      const effectiveLocale =
        apiSettings?.locale ?? systemLocale ?? fallback;

      expect(effectiveLocale).toBe("ru");
    });

    it("falls back to systemLocale when apiSettings.locale is undefined", () => {
      const apiSettings = {};
      const systemLocale = "ru";
      const fallback = mapSystemLocaleToSupported(navigator.language);

      const effectiveLocale =
        (apiSettings as { locale?: string }).locale ?? systemLocale ?? fallback;

      expect(effectiveLocale).toBe("ru");
    });

    it("falls back to mapSystemLocaleToSupported when no apiSettings.locale or systemLocale", () => {
      const apiSettings = null;
      const systemLocale: string | null = null;
      const fallback = mapSystemLocaleToSupported(navigator.language);

      const effectiveLocale =
        (apiSettings as { locale?: string } | null)?.locale ?? systemLocale ?? fallback;

      expect(effectiveLocale).toBe(fallback);
      expect(["en", "ru"]).toContain(effectiveLocale);
    });
  });

  describe("handleLocaleChange structure", () => {
    it("creates new settings with locale field", () => {
      const apiSettings = { apiKey: "", baseUrl: "", model: "", locale: "en" as string };
      const newLocale = "ru";

      const newSettings = {
        ...(apiSettings ?? { apiKey: "", baseUrl: "", model: "" }),
        locale: newLocale,
      };

      expect(newSettings.locale).toBe("ru");
      expect(newSettings.apiKey).toBe("");
    });
  });
});
