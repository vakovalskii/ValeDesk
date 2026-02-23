import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import AdmZip from "adm-zip";

describe("ffmpeg-downloader", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("getPlatformKey", () => {
    it("returns platform key for supported platform", async () => {
      const { getPlatformKey } = await import("../src/agent/libs/ffmpeg-downloader.ts");
      const key = getPlatformKey();
      if (process.platform === "win32" && process.arch === "x64") {
        expect(key).toBe("windows-64");
      } else if (process.platform === "linux" && process.arch === "x64") {
        expect(key).toBe("linux-64");
      } else if (process.platform === "darwin" && process.arch === "arm64") {
        expect(key).toBe("osx-arm64");
      } else if (process.platform === "darwin" && process.arch === "x64") {
        expect(key).toBe("osx-64");
      } else if (process.platform === "linux" && process.arch === "arm64") {
        expect(key).toBe("linux-arm64");
      } else {
        expect(key).toBeNull();
      }
    });

    it("returns valid key format when supported", async () => {
      const { getPlatformKey } = await import("../src/agent/libs/ffmpeg-downloader.ts");
      const key = getPlatformKey();
      const validKeys = ["windows-64", "linux-64", "linux-arm64", "osx-64", "osx-arm64"];
      if (key !== null) {
        expect(validKeys).toContain(key);
      }
    });
  });

  describe("resolveDownloadItems", () => {
    it("returns custom URL when preset is custom", async () => {
      const { resolveDownloadItems } = await import("../src/agent/libs/ffmpeg-downloader.ts");
      const result = await resolveDownloadItems(
        { ffmpegCdnPreset: "custom", ffmpegCustomUrl: "https://example.com/ffmpeg.zip" },
        "/tmp"
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        url: "https://example.com/ffmpeg.zip",
        downloadId: "ffmpeg",
        label: "FFmpeg",
      });
    });

    it("throws on evermeet for non-macOS", async () => {
      const platform = process.platform;
      if (platform === "darwin") return;
      const { resolveDownloadItems } = await import("../src/agent/libs/ffmpeg-downloader.ts");
      await expect(
        resolveDownloadItems({ ffmpegCdnPreset: "evermeet" }, "/tmp")
      ).rejects.toThrow("Evermeet preset is macOS only");
    });

    it("returns ffbinaries URLs when API provides ffmpeg and ffprobe", async () => {
      const { getPlatformKey, resolveDownloadItems } = await import("../src/agent/libs/ffmpeg-downloader.ts");
      const platformKey = getPlatformKey();
      if (!platformKey) return;

      const ffbinariesResponse = {
        version: "6.1",
        bin: {
          [platformKey]: {
            ffmpeg: "https://example.com/ffmpeg.zip",
            ffprobe: "https://example.com/ffprobe.zip",
          },
        },
      };

      global.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ffbinariesResponse,
      })) as any;

      const result = await resolveDownloadItems(
        { ffmpegCdnPreset: "ffbinaries", ffmpegVersion: "6.1" },
        "/tmp"
      );

      expect(result).toHaveLength(2);
      expect(result[0].url).toBe("https://example.com/ffmpeg.zip");
      expect(result[1].url).toBe("https://example.com/ffprobe.zip");
      expect(result[1].downloadId).toBe("ffprobe");
    });

    it("includes ffplay when API provides it", async () => {
      const { getPlatformKey, resolveDownloadItems } = await import("../src/agent/libs/ffmpeg-downloader.ts");
      const platformKey = getPlatformKey();
      if (!platformKey) return;

      const ffbinariesResponse = {
        version: "6.1",
        bin: {
          [platformKey]: {
            ffmpeg: "https://example.com/ffmpeg.zip",
            ffprobe: "https://example.com/ffprobe.zip",
            ffplay: "https://example.com/ffplay.zip",
          },
        },
      };

      global.fetch = vi.fn(async () => ({
        ok: true,
        json: async () => ffbinariesResponse,
      })) as any;

      const result = await resolveDownloadItems(
        { ffmpegCdnPreset: "ffbinaries" },
        "/tmp"
      );

      expect(result).toHaveLength(3);
      expect(result[2].downloadId).toBe("ffplay");
      expect(result[2].label).toBe("FFplay");
    });
  });

  describe("downloadFfmpeg", () => {
    it("downloads and extracts zip, returns binary dir with monotonic progress", async () => {
      const zip = new AdmZip();
      zip.addFile("ffmpeg-6.1/ffmpeg.exe", Buffer.from("fake-ffmpeg"));
      zip.addFile("ffmpeg-6.1/ffprobe.exe", Buffer.from("fake-ffprobe"));
      const zipBuffer = zip.toBuffer();

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(zipBuffer);
          controller.close();
        },
      });

      global.fetch = vi.fn(async () => ({
        ok: true,
        body: stream,
        headers: { get: (k: string) => (k === "content-length" ? String(zipBuffer.length) : null) },
        redirect: "follow",
      })) as any;

      const tmpDir = mkdtempSync(join(tmpdir(), "ffmpeg-test-"));
      const progressCalls: { percent: number; downloadId: string }[] = [];
      let maxPercent = 0;

      try {
        const { downloadFfmpeg } = await import("../src/agent/libs/ffmpeg-downloader.ts");
        const result = await downloadFfmpeg(
          { ffmpegCdnPreset: "custom", ffmpegCustomUrl: "https://example.com/ffmpeg.zip" },
          tmpDir,
          (loaded, total, percent, downloadId) => {
            progressCalls.push({ percent, downloadId: downloadId ?? "ffmpeg" });
            expect(percent).toBeGreaterThanOrEqual(maxPercent);
            maxPercent = percent;
          }
        );

        expect(result).toBeTruthy();
        expect(existsSync(join(result, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"))).toBe(true);
        expect(progressCalls.length).toBeGreaterThan(0);
        expect(progressCalls[progressCalls.length - 1].percent).toBe(100);
      } finally {
        try {
          rmSync(tmpDir, { recursive: true });
        } catch {
          // ignore
        }
      }
    });

    it("consolidates multiple extracted dirs into one with all binaries", async () => {
      const zip = new AdmZip();
      const exeName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
      const probeName = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
      zip.addFile(`ffmpeg-6.1/${exeName}`, Buffer.from("ffmpeg"));
      zip.addFile(`ffmpeg-6.1/${probeName}`, Buffer.from("ffprobe"));
      const zipBuffer = zip.toBuffer();

      global.fetch = vi.fn(async () => ({
        ok: true,
        body: new ReadableStream({
          start(c) {
            c.enqueue(zipBuffer);
            c.close();
          },
        }),
        headers: { get: (k: string) => (k === "content-length" ? String(zipBuffer.length) : null) },
        redirect: "follow",
      })) as any;

      const tmpDir = mkdtempSync(join(tmpdir(), "ffmpeg-consolidate-"));

      try {
        const { downloadFfmpeg } = await import("../src/agent/libs/ffmpeg-downloader.ts");
        const result = await downloadFfmpeg(
          { ffmpegCdnPreset: "custom", ffmpegCustomUrl: "https://example.com/x.zip" },
          tmpDir,
          () => {}
        );

        const files = readdirSync(result);
        const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
        const probe = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
        expect(files).toContain(exe);
        expect(files).toContain(probe);
      } finally {
        try {
          rmSync(tmpDir, { recursive: true });
        } catch {
          // ignore
        }
      }
    });

    it("throws when fetch fails", async () => {
      global.fetch = vi.fn(async () => ({ ok: false, status: 404, statusText: "Not Found" })) as any;

      const tmpDir = mkdtempSync(join(tmpdir(), "ffmpeg-fail-"));

      try {
        const { downloadFfmpeg } = await import("../src/agent/libs/ffmpeg-downloader.ts");
        await expect(
          downloadFfmpeg(
            { ffmpegCdnPreset: "custom", ffmpegCustomUrl: "https://example.com/missing.zip" },
            tmpDir,
            () => {}
          )
        ).rejects.toThrow(/Download failed/);
      } finally {
        try {
          rmSync(tmpDir, { recursive: true });
        } catch {
          // ignore
        }
      }
    });
  });
});
