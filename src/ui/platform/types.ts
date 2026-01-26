import type { ClientEvent, ServerEvent } from "../types";

export type Unsubscribe = () => void;

export type PlatformAdapter = {
  // Claude Agent IPC APIs
  sendClientEvent: (event: ClientEvent) => void;
  onServerEvent: (callback: (event: ServerEvent) => void) => Unsubscribe;

  // Misc host APIs
  generateSessionTitle: (userInput: string | null) => Promise<string>;
  getRecentCwds: (limit?: number) => Promise<string[]>;
  selectDirectory: () => Promise<string | null>;

  // Generic IPC helpers (kept for incremental migration)
  invoke: <TResult = unknown>(channel: string, ...args: unknown[]) => Promise<TResult>;
  send: (channel: string, ...args: unknown[]) => void;
};

