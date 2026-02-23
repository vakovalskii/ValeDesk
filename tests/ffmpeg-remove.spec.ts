import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("ffmpeg remove", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("removes ffmpeg directory and clears ffmpegPath from settings", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ffmpeg-remove-test-"));
    const ffmpegDir = join(tmpDir, "ffmpeg");
    const { mkdirSync } = await import("fs");
    mkdirSync(ffmpegDir, { recursive: true });
    writeFileSync(join(ffmpegDir, "ffmpeg.exe"), "fake");

    const settingsPath = join(tmpDir, "settings.json");
    const settings = { ffmpegPath: ffmpegDir, apiKey: "test" };
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    const { rmSync: rm } = await import("fs");
    expect(existsSync(ffmpegDir)).toBe(true);
    rm(ffmpegDir, { recursive: true });
    expect(existsSync(ffmpegDir)).toBe(false);

    const updated = { ...settings };
    delete updated.ffmpegPath;
    writeFileSync(settingsPath, JSON.stringify(updated, null, 2));
    const loaded = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(loaded.ffmpegPath).toBeUndefined();

    try {
      rmSync(tmpDir, { recursive: true });
    } catch {
      // ignore
    }
  });
});
