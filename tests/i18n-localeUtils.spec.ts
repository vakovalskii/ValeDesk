import { describe, it, expect } from "vitest";
import {
  mapSystemLocaleToSupported,
  getSupportedLocales,
  isSupportedLocale,
  getDefaultLocale,
} from "../src/ui/i18n/localeUtils";

describe("localeUtils", () => {
  describe("mapSystemLocaleToSupported", () => {
    it("maps en to en", () => {
      expect(mapSystemLocaleToSupported("en")).toBe("en");
    });

    it("maps en-US to en", () => {
      expect(mapSystemLocaleToSupported("en-US")).toBe("en");
    });

    it("maps en-GB to en", () => {
      expect(mapSystemLocaleToSupported("en-GB")).toBe("en");
    });

    it("maps ru to ru", () => {
      expect(mapSystemLocaleToSupported("ru")).toBe("ru");
    });

    it("maps ru-RU to ru", () => {
      expect(mapSystemLocaleToSupported("ru-RU")).toBe("ru");
    });

    it("falls back to en for zh-CN (unsupported locale)", () => {
      expect(mapSystemLocaleToSupported("zh-CN")).toBe("en");
    });

    it("returns en for empty string", () => {
      expect(mapSystemLocaleToSupported("")).toBe("en");
    });

    it("returns en for whitespace-only string", () => {
      expect(mapSystemLocaleToSupported("   ")).toBe("en");
    });

    it("falls back to en for unsupported locale (de-DE)", () => {
      expect(mapSystemLocaleToSupported("de-DE")).toBe("en");
    });
  });

  describe("getSupportedLocales", () => {
    it("returns [en, ru]", () => {
      expect(getSupportedLocales()).toEqual(["en", "ru"]);
    });

    it("returns a new array each time (not mutated)", () => {
      const a = getSupportedLocales();
      const b = getSupportedLocales();
      expect(a).toEqual(b);
      a.push("de");
      expect(getSupportedLocales()).toEqual(["en", "ru"]);
    });
  });

  describe("isSupportedLocale", () => {
    it("returns true for en", () => {
      expect(isSupportedLocale("en")).toBe(true);
    });

    it("returns true for ru", () => {
      expect(isSupportedLocale("ru")).toBe(true);
    });

    it("returns false for de", () => {
      expect(isSupportedLocale("de")).toBe(false);
    });

    it("returns false for zh", () => {
      expect(isSupportedLocale("zh")).toBe(false);
    });
  });

  describe("getDefaultLocale", () => {
    it("returns en", () => {
      expect(getDefaultLocale()).toBe("en");
    });
  });
});
