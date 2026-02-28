import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("locales consistency", () => {
  const localesDir = path.resolve(__dirname, "../locales");

  it("en.json and ru.json have the same keys (excluding _version)", () => {
    const enPath = path.join(localesDir, "en.json");
    const ruPath = path.join(localesDir, "ru.json");

    const en = JSON.parse(fs.readFileSync(enPath, "utf-8"));
    const ru = JSON.parse(fs.readFileSync(ruPath, "utf-8"));

    const enKeys = Object.keys(en).filter((k) => k !== "_version").sort();
    const ruKeys = Object.keys(ru).filter((k) => k !== "_version").sort();

    expect(enKeys).toEqual(ruKeys);
  });

  it("all locale values in en.json are non-empty strings (except _version)", () => {
    const enPath = path.join(localesDir, "en.json");
    const en = JSON.parse(fs.readFileSync(enPath, "utf-8"));

    for (const [key, value] of Object.entries(en)) {
      if (key === "_version") continue;
      expect(typeof value).toBe("string");
      expect((value as string).trim().length).toBeGreaterThan(0);
    }
  });
});
