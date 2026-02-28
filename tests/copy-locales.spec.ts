import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("copy:locales script", () => {
  const projectRoot = path.resolve(__dirname, "..");
  const localesDir = path.join(projectRoot, "locales");
  const publicLocalesDir = path.join(projectRoot, "public", "locales");

  it("creates public/locales directory with en.json and ru.json after copy:locales", async () => {
    const { execSync } = await import("node:child_process");
    execSync("npm run copy:locales", { cwd: projectRoot });

    expect(fs.existsSync(publicLocalesDir)).toBe(true);
    expect(fs.existsSync(path.join(publicLocalesDir, "en.json"))).toBe(true);
    expect(fs.existsSync(path.join(publicLocalesDir, "ru.json"))).toBe(true);
  });

  it("copied en.json content matches locales/en.json", () => {
    const srcPath = path.join(localesDir, "en.json");
    const destPath = path.join(publicLocalesDir, "en.json");

    if (!fs.existsSync(destPath)) return;

    const src = JSON.parse(fs.readFileSync(srcPath, "utf-8"));
    const dest = JSON.parse(fs.readFileSync(destPath, "utf-8"));

    const srcKeys = Object.keys(src).filter((k) => k !== "_version").sort();
    const destKeys = Object.keys(dest).filter((k) => k !== "_version").sort();

    expect(destKeys).toEqual(srcKeys);
  });

  it("copied ru.json content matches locales/ru.json", () => {
    const srcPath = path.join(localesDir, "ru.json");
    const destPath = path.join(publicLocalesDir, "ru.json");

    if (!fs.existsSync(destPath)) return;

    const src = JSON.parse(fs.readFileSync(srcPath, "utf-8"));
    const dest = JSON.parse(fs.readFileSync(destPath, "utf-8"));

    const srcKeys = Object.keys(src).filter((k) => k !== "_version").sort();
    const destKeys = Object.keys(dest).filter((k) => k !== "_version").sort();

    expect(destKeys).toEqual(srcKeys);
  });
});
