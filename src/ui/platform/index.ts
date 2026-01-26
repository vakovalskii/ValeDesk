import type { PlatformAdapter } from "./types";
import { createElectronPlatform } from "./electron";
import { createTauriPlatform } from "./tauri";
import { createWebPlatform } from "./web";

export type { PlatformAdapter, Unsubscribe } from "./types";

let cachedPlatform: PlatformAdapter | null = null;

function hasTauriApi(): boolean {
  return typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== "undefined";
}

function hasElectronApi(): boolean {
  return typeof (window as unknown as { electron?: unknown }).electron !== "undefined";
}

export function getPlatform(): PlatformAdapter {
  if (cachedPlatform) return cachedPlatform;

  if (hasTauriApi()) {
    cachedPlatform = createTauriPlatform();
    return cachedPlatform;
  }

  if (hasElectronApi()) {
    cachedPlatform = createElectronPlatform();
    return cachedPlatform;
  }

  // Fallback to web platform for debugging in browser
  console.warn("[platform] Host API not detected. Falling back to WebPlatform mock.");
  cachedPlatform = createWebPlatform();
  return cachedPlatform;
}

