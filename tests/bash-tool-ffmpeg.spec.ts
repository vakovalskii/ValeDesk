import { describe, expect, it } from "vitest";
import { executeBashTool, BashToolDefinition } from "../src/agent/libs/tools/bash-tool.ts";

describe("bash-tool FFmpeg integration", () => {
  it("returns fallback when ffmpeg requested but not installed and download not asked", async () => {
    const result = await executeBashTool(
      { command: "ffmpeg -version", explanation: "check ffmpeg" },
      {
        cwd: "/tmp",
        isPathSafe: () => true,
        enableFfmpegTools: true,
        ffmpegDir: undefined,
        ffmpegDownloadAsked: false,
      } as any
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("FFmpeg is not installed");
    expect(result.output).toContain("Download it when prompted");
  });

  it("returns fallback when ffmpeg requested but not installed and download was asked", async () => {
    const result = await executeBashTool(
      { command: "ffmpeg -i video.mp4", explanation: "convert" },
      {
        cwd: "/tmp",
        isPathSafe: () => true,
        enableFfmpegTools: true,
        ffmpegDir: undefined,
        ffmpegDownloadAsked: true,
      } as any
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("Enable and download FFmpeg in Settings");
  });

  it("returns fallback when ffprobe requested but not installed", async () => {
    const result = await executeBashTool(
      { command: "ffprobe video.mp4", explanation: "probe" },
      {
        cwd: "/tmp",
        isPathSafe: () => true,
        enableFfmpegTools: true,
        ffmpegDir: undefined,
      } as any
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("FFmpeg is not installed");
  });

  it("returns fallback when ffplay requested but not installed", async () => {
    const result = await executeBashTool(
      { command: "ffplay video.mp4", explanation: "play" },
      {
        cwd: "/tmp",
        isPathSafe: () => true,
        enableFfmpegTools: true,
        ffmpegDir: undefined,
      } as any
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("FFmpeg is not installed");
  });

  it("does not block non-ffmpeg commands when ffmpeg tools disabled", async () => {
    const result = await executeBashTool(
      { command: process.platform === "win32" ? "Write-Output ok" : "echo ok", explanation: "echo" },
      {
        cwd: process.cwd(),
        isPathSafe: () => true,
        enableFfmpegTools: false,
        ffmpegDir: undefined,
      } as any
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("ok");
  });

  it("does not block when ffmpegDir is set", async () => {
    const result = await executeBashTool(
      { command: process.platform === "win32" ? "Write-Output test" : "echo test", explanation: "echo" },
      {
        cwd: process.cwd(),
        isPathSafe: () => true,
        enableFfmpegTools: true,
        ffmpegDir: "/fake/path",
      } as any
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("test");
  });

  it("BashToolDefinition includes ffmpeg, ffprobe, ffplay in description", () => {
    const desc = BashToolDefinition.function.description;
    expect(desc).toContain("ffmpeg");
    expect(desc).toContain("ffprobe");
    expect(desc).toContain("ffplay");
  });
});
