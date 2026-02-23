/**
 * FFmpeg downloader - fetches pre-built FFmpeg binaries from CDN
 */

import { createWriteStream, mkdirSync, existsSync, chmodSync, readdirSync, copyFileSync, rmSync } from "fs";
import { join, dirname, sep } from "path";
import type { ApiSettings } from "../types.js";

export type FfmpegPlatformKey =
  | "windows-64"
  | "linux-64"
  | "linux-arm64"
  | "osx-64"
  | "osx-arm64";

export function getPlatformKey(): FfmpegPlatformKey | null {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "win32" && arch === "x64") return "windows-64";
  if (platform === "linux" && arch === "x64") return "linux-64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64";
  if (platform === "darwin" && arch === "x64") return "osx-64";
  if (platform === "darwin" && arch === "arm64") return "osx-arm64";

  return null;
}

type FfbinariesResponse = {
  version: string;
  bin: Record<string, { ffmpeg: string; ffprobe?: string; ffplay?: string }>;
};

export type DownloadItem = { url: string; downloadId: string; label: string };

const EVERMEET_BASE = "https://evermeet.cx/pub/ffmpeg";
const EVERMEET_VERSIONS: Record<string, string> = {
  "6.1": "6.1.1",
  "6.1.1": "6.1.1",
  "7.0": "7.0.2",
  "7.0.2": "7.0.2",
  "7.1": "7.1.1",
  "7.1.1": "7.1.1",
  "8.0": "8.0.1",
  "8.0.1": "8.0.1",
  latest: "8.0.1",
};

async function fetchFfbinariesUrls(
  version: string,
  platformKey: FfmpegPlatformKey
): Promise<DownloadItem[]> {
  const v = version === "latest" ? "latest" : version;
  const url = `https://ffbinaries.com/api/v1/version/${v}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FFbinaries API error: ${res.status}`);
  const data = (await res.json()) as FfbinariesResponse;
  const bin = data.bin?.[platformKey];
  if (!bin?.ffmpeg) {
    throw new Error(
      `FFbinaries: no ffmpeg for platform ${platformKey}, version ${version}`
    );
  }
  const items: DownloadItem[] = [{ url: bin.ffmpeg, downloadId: "ffmpeg", label: "FFmpeg" }];
  if (bin.ffprobe) items.push({ url: bin.ffprobe, downloadId: "ffprobe", label: "FFprobe" });
  if (bin.ffplay) items.push({ url: bin.ffplay, downloadId: "ffplay", label: "FFplay" });
  return items;
}

function getEvermeetUrl(version: string): string {
  const v = EVERMEET_VERSIONS[version] || EVERMEET_VERSIONS.latest || "8.0.1";
  return `${EVERMEET_BASE}/ffmpeg-${v}.zip`;
}

export async function resolveDownloadItems(
  settings: ApiSettings | null,
  userDataDir: string
): Promise<DownloadItem[]> {
  const preset = settings?.ffmpegCdnPreset || "ffbinaries";
  const version = settings?.ffmpegVersion || "latest";
  const customUrl = settings?.ffmpegCustomUrl?.trim();
  const platformKey = getPlatformKey();

  if (!platformKey) {
    throw new Error(
      `Unsupported platform: ${process.platform}-${process.arch}`
    );
  }

  if (preset === "custom" && customUrl) {
    return [{ url: customUrl, downloadId: "ffmpeg", label: "FFmpeg" }];
  }

  if (preset === "evermeet") {
    if (platformKey !== "osx-64" && platformKey !== "osx-arm64") {
      throw new Error("Evermeet preset is macOS only");
    }
    return [{ url: getEvermeetUrl(version), downloadId: "ffmpeg", label: "FFmpeg" }];
  }

  if (preset === "ffbinaries" && platformKey === "osx-arm64") {
    return [{ url: getEvermeetUrl(version), downloadId: "ffmpeg", label: "FFmpeg" }];
  }

  return fetchFfbinariesUrls(version, platformKey);
}

const BINARY_NAMES = ["ffmpeg", "ffprobe", "ffplay"];
const EXE_SUFFIX = process.platform === "win32" ? ".exe" : "";

async function downloadOne(
  item: DownloadItem,
  ffmpegDir: string,
  onProgress: (loaded: number, total: number, percent: number, downloadId: string, label: string) => void
): Promise<string> {
  const { pipeline } = await import("stream/promises");
  const res = await fetch(item.url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed (${item.label}): ${res.status} ${res.statusText}`);

  const contentLength = res.headers.get("content-length");
  const total = contentLength ? parseInt(contentLength, 10) : 0;
  const reader = res.body;
  if (!reader) throw new Error("No response body");

  const zipPath = join(ffmpegDir, `${item.downloadId}-download.zip`);
  const destStream = createWriteStream(zipPath);

  let loaded = 0;
  const reportInterval = 100;
  let lastReport = 0;
  let maxPercentSent = 0;

  const report = (l: number, t: number, p: number) => {
    const percent = Math.min(100, Math.floor(p));
    if (percent >= maxPercentSent) {
      maxPercentSent = percent;
      onProgress(l, t, percent, item.downloadId, item.label);
    }
  };

  const transformStream = new (await import("stream")).Transform({
    transform(chunk: Buffer, _enc, cb) {
      loaded += chunk.length;
      const now = Date.now();
      if (now - lastReport >= reportInterval || loaded >= (total || 0)) {
        lastReport = now;
        const percent = total > 0 ? (loaded / total) * 100 : 0;
        report(loaded, total, percent);
      }
      cb(null, chunk);
    },
  });

  await pipeline(reader as any, transformStream, destStream);
  report(loaded, total, 99);

  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(ffmpegDir, true);
  report(loaded, total, 100);

  try {
    const { unlinkSync } = await import("fs");
    unlinkSync(zipPath);
  } catch {
    // ignore
  }
  return zipPath;
}

function chmodBinaries(dir: string): void {
  const items = readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const full = join(dir, item.name);
    if (item.isDirectory()) {
      chmodBinaries(full);
    } else if (BINARY_NAMES.some((b) => item.name === b || item.name === `${b}${EXE_SUFFIX}`)) {
      try {
        chmodSync(full, 0o755);
      } catch {
        // Windows may not support chmod
      }
    }
  }
}

function findBinariesInTree(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  const items = readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const full = join(dir, item.name);
    if (item.isDirectory()) {
      for (const [k, v] of findBinariesInTree(full)) {
        if (!found.has(k)) found.set(k, v);
      }
    } else {
      for (const b of BINARY_NAMES) {
        const name = EXE_SUFFIX ? `${b}.exe` : b;
        if (item.name === name || item.name === b) {
          found.set(b, full);
          break;
        }
      }
    }
  }
  return found;
}

function consolidateBinaries(ffmpegDir: string): string {
  const found = findBinariesInTree(ffmpegDir);
  const ffmpegPath = found.get("ffmpeg");
  if (!ffmpegPath) throw new Error("Failed to find ffmpeg binary in archive");

  const targetDir = dirname(ffmpegPath);

  for (const [bin, src] of found) {
    const dest = join(targetDir, EXE_SUFFIX ? `${bin}.exe` : bin);
    if (src !== dest) copyFileSync(src, dest);
  }

  const items = readdirSync(ffmpegDir, { withFileTypes: true });
  for (const item of items) {
    if (item.isDirectory()) {
      const subPath = join(ffmpegDir, item.name);
      if (subPath !== targetDir && !targetDir.startsWith(subPath + sep)) {
        try {
          rmSync(subPath, { recursive: true });
        } catch {
          // ignore
        }
      }
    }
  }
  return targetDir;
}

export async function downloadFfmpeg(
  settings: ApiSettings | null,
  userDataDir: string,
  onProgress: (loaded: number, total: number, percent: number, downloadId?: string, label?: string) => void
): Promise<string> {
  const items = await resolveDownloadItems(settings, userDataDir);
  const ffmpegDir = join(userDataDir, "ffmpeg");
  if (!existsSync(ffmpegDir)) {
    mkdirSync(ffmpegDir, { recursive: true });
  }

  const report = (l: number, t: number, p: number, id?: string, label?: string) => {
    onProgress(l, t, p, id ?? "ffmpeg", label ?? "FFmpeg");
  };

  await Promise.all(
    items.map((item) =>
      downloadOne(item, ffmpegDir, (l, t, p) => report(l, t, p, item.downloadId, item.label))
    )
  );

  const binaryDir = consolidateBinaries(ffmpegDir);
  chmodBinaries(binaryDir);
  return binaryDir;
}
