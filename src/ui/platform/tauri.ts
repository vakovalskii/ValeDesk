import type { PlatformAdapter } from "./types";

type TauriUnlisten = () => void;
type TauriListenEvent = { payload: unknown };

type TauriInvoke = <TResult = unknown>(
  command: string,
  args?: Record<string, unknown>
) => Promise<TResult>;

type TauriListen = (event: string, handler: (event: TauriListenEvent) => void) => Promise<TauriUnlisten>;

function getTauriGlobal(): any {
  const tauri = (window as any).__TAURI__;
  if (!tauri) {
    throw new Error("[platform/tauri] window.__TAURI__ is missing");
  }
  return tauri;
}

function getTauriInvoke(): TauriInvoke {
  const tauri = getTauriGlobal();

  if (typeof tauri.invoke === "function") {
    return tauri.invoke.bind(tauri);
  }

  if (tauri.core && typeof tauri.core.invoke === "function") {
    return tauri.core.invoke.bind(tauri.core);
  }

  throw new Error("[platform/tauri] invoke API not found (expected __TAURI__.invoke or __TAURI__.core.invoke)");
}

function getTauriListen(): TauriListen {
  const tauri = getTauriGlobal();

  if (tauri.event && typeof tauri.event.listen === "function") {
    return tauri.event.listen.bind(tauri.event);
  }

  throw new Error("[platform/tauri] event.listen API not found (expected __TAURI__.event.listen)");
}

export function createTauriPlatform(): PlatformAdapter {
  const tauriInvoke = getTauriInvoke();
  const tauriListen = getTauriListen();

  return {
    sendClientEvent: (event) => {
      const eventType = (event as any)?.type;
      // Log user actions (skip noisy events)
      if (!["session.list", "session.history", "settings.get", "models.get", "llm.providers.get", "skills.get"].includes(eventType)) {
        console.log(`[ui] → ${eventType}`, (event as any)?.payload || "");
      }
      void tauriInvoke("client_event", { event }).catch((error) => {
        console.error("[ui] ✗ ${eventType}", { error });
      });
    },

    onServerEvent: (callback, onReady) => {
      let unlisten: TauriUnlisten | null = null;
      let cancelled = false;

      void tauriListen("server-event", (event) => {
        try {
          const payload = (event as any)?.payload;
          let parsed: any;
          if (typeof payload === "string") {
            parsed = JSON.parse(payload);
          } else {
            parsed = payload;
          }
          // Log non-streaming events
          const eventType = parsed?.type;
          if (eventType && !["stream.message"].includes(eventType)) {
            console.log(`[ui] ← ${eventType}`);
          }
          callback(parsed);
        } catch (error) {
          console.error("[ui] ✗ parse server-event", error);
        }
      })
        .then((fn) => {
          unlisten = fn;
          if (cancelled) {
            try {
              unlisten();
            } catch (error) {
              console.error("[platform/tauri] Failed to unlisten (post-cancel)", { error });
            }
          } else {
            // Signal that listener is ready
            onReady?.();
          }
        })
        .catch((error) => {
          console.error("[platform/tauri] Failed to listen to server-event", { error });
        });

      return () => {
        cancelled = true;
        if (!unlisten) return;
        try {
          unlisten();
        } catch (error) {
          console.error("[platform/tauri] Failed to unlisten", { error });
        }
      };
    },

    generateSessionTitle: (userInput) => tauriInvoke("generate_session_title", { user_input: userInput ?? "" }),
    getRecentCwds: (limit) => tauriInvoke("get_recent_cwds", { limit }),
    selectDirectory: () => tauriInvoke("select_directory"),

    invoke: (channel, ...args) => {
      switch (channel) {
        case "list-directory": {
          const path = String(args[0] ?? "");
          return tauriInvoke("list_directory", { path });
        }
        case "read-memory": {
          return tauriInvoke("read_memory");
        }
        case "write-memory": {
          const content = String(args[0] ?? "");
          return tauriInvoke("write_memory", { content });
        }
        case "get-build-info": {
          return tauriInvoke("get_build_info");
        }
        case "open-external-url": {
          const url = String(args[0] ?? "");
          return tauriInvoke("open_external_url", { url });
        }
        case "open-path-in-finder": {
          const path = String(args[0] ?? "");
          return tauriInvoke("open_path_in_finder", { path });
        }
        case "get-file-old-content": {
          const filePath = String(args[0] ?? "");
          const cwd = String(args[1] ?? "");
          const useGit = args[2] !== undefined ? Boolean(args[2]) : true;
          // Tauri expects parameters wrapped in a 'params' object
          return tauriInvoke("get_file_old_content", { 
            params: {
              filePath: filePath, 
              cwd: cwd, 
              useGit: useGit 
            }
          });
        }
        case "get-file-new-content": {
          const filePath = String(args[0] ?? "");
          const cwd = String(args[1] ?? "");
          const useGit = args[2] !== undefined ? Boolean(args[2]) : true;
          // Tauri expects parameters wrapped in a 'params' object
          return tauriInvoke("get_file_new_content", { 
            params: {
              filePath: filePath, 
              cwd: cwd, 
              useGit: useGit 
            }
          });
        }
        case "get-file-snapshot": {
          const filePath = String(args[0] ?? "");
          const cwd = String(args[1] ?? "");
          // Tauri expects parameters wrapped in a 'params' object
          return tauriInvoke("get_file_snapshot", { 
            params: {
              filePath, 
              cwd 
            }
          });
        }
        case "save-file-snapshot": {
          const filePath = String(args[0] ?? "");
          const cwd = String(args[1] ?? "");
          const content = String(args[2] ?? "");
          // Tauri expects parameters wrapped in a 'params' object
          return tauriInvoke("save_file_snapshot", { 
            params: {
              filePath, 
              cwd, 
              content 
            }
          });
        }
        default: {
          // fail fast: do not silently pass unknown channels
          throw new Error(`[platform/tauri] Unsupported invoke channel: ${channel}`);
        }
      }
    },

    send: (channel, ...args) => {
      switch (channel) {
        case "open-file": {
          const path = String(args[0] ?? "");
          void tauriInvoke("open_file", { path }).catch((error) => {
            console.error("[platform/tauri] open_file failed", { error, path });
          });
          return;
        }
        default: {
          throw new Error(`[platform/tauri] Unsupported send channel: ${channel}`);
        }
      }
    },
  };
}

