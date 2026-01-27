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
        console.error(`[ui] ✗ ${eventType}`, { error });
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
            } catch {
            }
          } else {
            // Signal that listener is ready
            onReady?.();
          }
        })
        .catch(() => {});

      return () => {
        cancelled = true;
        if (!unlisten) return;
        try {
          unlisten();
        } catch {
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
        case "transcribe-voice-stream": {
          const audioChunkB64 = String(args[0] ?? "");
          const audioMime = String(args[1] ?? "");
          const sessionId = String(args[2] ?? "");
          const baseUrl = String(args[3] ?? "");
          const apiKey = args[4] as string | undefined;
          const model = String(args[5] ?? "whisper-1");
          const language = args[6] as string | undefined;
          const isFinal = Boolean(args[7] ?? false);
          return tauriInvoke("transcribe_voice_stream", {
            audioChunkB64,
            audioMime,
            sessionId,
            baseUrl,
            apiKey,
            model,
            language,
            isFinal
          });
        }
        case "voice-models": {
          const baseUrl = String(args[0] ?? "");
          const apiKey = args[1] as string | undefined;
          return tauriInvoke("list_voice_models", { baseUrl, apiKey });
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
          void tauriInvoke("open_file", { path }).catch(() => {});
          return;
        }
        default: {
          throw new Error(`[platform/tauri] Unsupported send channel: ${channel}`);
        }
      }
    },
  };
}

