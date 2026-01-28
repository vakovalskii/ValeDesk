import type { PlatformAdapter } from "./types";

export function createElectronPlatform(): PlatformAdapter {
  if (!("electron" in window) || !window.electron) {
    throw new Error("[platform/electron] window.electron is missing");
  }

  return {
    sendClientEvent: (event) => window.electron.sendClientEvent(event),
    onServerEvent: (callback, onReady) => {
      const unsubscribe = window.electron.onServerEvent(callback);
      // Electron listener is synchronous, call onReady immediately
      onReady?.();
      return unsubscribe;
    },

    generateSessionTitle: (userInput) => window.electron.generateSessionTitle(userInput),
    getRecentCwds: (limit) => window.electron.getRecentCwds(limit),
    selectDirectory: () => window.electron.selectDirectory(),

    invoke: (channel, ...args) => window.electron.invoke(channel, ...args),
    send: (channel, ...args) => window.electron.send(channel, ...args),
  };
}

