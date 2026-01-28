import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientEvent, ServerEvent } from "../types";
import { useAppStore } from "../store/useAppStore";
import { getPlatform } from "../platform";

const DEFAULT_ALLOWED_TOOLS = "Read,Edit,Bash";
const MAX_ROWS = 12;
const LINE_HEIGHT = 21;
const MAX_HEIGHT = MAX_ROWS * LINE_HEIGHT;

interface PromptInputProps {
  sendEvent: (event: ClientEvent) => void;
}

export function usePromptActions(sendEvent: (event: ClientEvent) => void) {
  const prompt = useAppStore((state) => state.prompt);
  const cwd = useAppStore((state) => state.cwd);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const sessions = useAppStore((state) => state.sessions);
  const setPrompt = useAppStore((state) => state.setPrompt);
  const setPendingStart = useAppStore((state) => state.setPendingStart);
  const setGlobalError = useAppStore((state) => state.setGlobalError);
  const selectedModel = useAppStore((state) => state.selectedModel);
  const selectedTemperature = useAppStore((state) => state.selectedTemperature);
  const sendTemperature = useAppStore((state) => state.sendTemperature);

  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
  const isRunning = activeSession?.status === "running";

  const handleSend = useCallback(async () => {
    const trimmedPrompt = prompt.trim();

    // For existing sessions, require a prompt
    if (activeSessionId && !trimmedPrompt) return;

    if (!activeSessionId) {
      // Starting new session - can be empty for chat-only mode
      setPendingStart(true);

      // Generate title from first 3 words of prompt
      let title = "New Chat";
      if (trimmedPrompt) {
        const words = trimmedPrompt.split(/\s+/).slice(0, 3);
        title = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
      }
      sendEvent({
        type: "session.start",
        payload: {
          title,
          prompt: trimmedPrompt, // Can be empty string
          cwd: cwd.trim() || undefined,
          allowedTools: DEFAULT_ALLOWED_TOOLS,
          model: selectedModel || undefined,
          temperature: sendTemperature ? selectedTemperature : undefined
        }
      });
      // Save selected model as default for future sessions
      if (selectedModel) {
        sendEvent({
          type: "scheduler.default_model.set",
          payload: { modelId: selectedModel }
        } as ClientEvent);
      }
      // Save temperature as default for future sessions
      sendEvent({
        type: "scheduler.default_temperature.set",
        payload: {
          temperature: selectedTemperature,
          sendTemperature: sendTemperature
        }
      } as ClientEvent);
    } else {
      if (activeSession?.status === "running") {
        setGlobalError("Session is still running. Please wait for it to finish.");
        return;
      }
      sendEvent({ type: "session.continue", payload: { sessionId: activeSessionId, prompt: trimmedPrompt } });
    }
    setPrompt("");
  }, [activeSession, activeSessionId, cwd, prompt, sendEvent, setGlobalError, setPendingStart, setPrompt, selectedModel, selectedTemperature, sendTemperature]);

  const handleStop = useCallback(() => {
    if (!activeSessionId) return;
    sendEvent({ type: "session.stop", payload: { sessionId: activeSessionId } });
  }, [activeSessionId, sendEvent]);

  const handleStartFromModal = useCallback(() => {
    // Allow starting chat without cwd or prompt
    // If no cwd, file operations will be blocked by tools-executor
    handleSend();
  }, [handleSend]);

  return { prompt, setPrompt, isRunning, handleSend, handleStop, handleStartFromModal };
}

export function PromptInput({ sendEvent }: PromptInputProps) {
  const { prompt, setPrompt, isRunning, handleSend, handleStop } = usePromptActions(sendEvent);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  const [isDictating, setIsDictating] = useState(false);
  const [isStopRequested, setIsStopRequested] = useState(false);
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [livePreview, setLivePreview] = useState<string>("");
  const dictationIdRef = useRef<string | null>(null);
  const committedTextRef = useRef<string>("");
  const unstableTextRef = useRef<string>("");
  const finalPartsRef = useRef<string[]>([]);
  const audioLevelRef = useRef<number>(0);
  const unsubscribeDictationRef = useRef<(() => void) | null>(null);
  const stopRequestedRef = useRef(false);
  const dictationStartSentRef = useRef(false);

  const stopDictationListener = useCallback(() => {
    if (unsubscribeDictationRef.current) {
      unsubscribeDictationRef.current();
      unsubscribeDictationRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopDictationListener();
    };
  }, [stopDictationListener]);

  const createDictationId = () => {
    const maybeCrypto =
      typeof crypto === "undefined" ? null : (crypto as Crypto & { randomUUID?: () => string });
    if (maybeCrypto?.randomUUID) {
      return maybeCrypto.randomUUID();
    }
    return `dictation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  const insertTranscriptIntoPrompt = useCallback(
    (transcript: string) => {
      const trimmed = transcript.trim();
      if (!trimmed) {
        setDictationError("Empty transcript (nothing to insert)");
        return;
      }

      const el = promptRef.current;
      const current = prompt;
      const isFocused = !!el && document.activeElement === el;

      let next = current;
      let caret = current.length;

      if (el && isFocused) {
        const start = typeof el.selectionStart === "number" ? el.selectionStart : current.length;
        const end = typeof el.selectionEnd === "number" ? el.selectionEnd : current.length;
        next = current.slice(0, start) + trimmed + current.slice(end);
        caret = start + trimmed.length;
      } else {
        const spacer = current && !current.endsWith(" ") ? " " : "";
        next = current + spacer + trimmed;
        caret = next.length;
      }

      setPrompt(next);

      requestAnimationFrame(() => {
        const el2 = promptRef.current;
        if (!el2) return;
        el2.focus();
        const safeCaret = Math.max(0, Math.min(caret, el2.value.length));
        el2.setSelectionRange(safeCaret, safeCaret);
      });
    },
    [prompt, setPrompt],
  );

  const startDictation = useCallback(() => {
    const dictationId = createDictationId();

    dictationIdRef.current = dictationId;
    committedTextRef.current = "";
    unstableTextRef.current = "";
    finalPartsRef.current = [];
    audioLevelRef.current = 0;
    stopRequestedRef.current = false;
    dictationStartSentRef.current = false;
    setIsStopRequested(false);
    setLivePreview("");
    setDictationError(null);
    setIsDictating(true);

    stopDictationListener();

    unsubscribeDictationRef.current = getPlatform().onServerEvent(
      (event: ServerEvent) => {
        if (!event.type.startsWith("audio.dictation.")) return;

        const currentId = dictationIdRef.current;
        if (!currentId) return;

        switch (event.type) {
          case "audio.dictation.audio_level": {
            if (event.payload.dictationId !== currentId) return;
            audioLevelRef.current = event.payload.level;
            return;
          }
          case "audio.dictation.partial": {
            if (event.payload.dictationId !== currentId) return;
            committedTextRef.current = event.payload.text;
            unstableTextRef.current = event.payload.unstable ?? "";
            setLivePreview(`${event.payload.text}${event.payload.unstable ?? ""}`.trim());
            return;
          }
          case "audio.dictation.final": {
            if (event.payload.dictationId !== currentId) return;
            if (event.payload.text.trim()) {
              finalPartsRef.current = [...finalPartsRef.current, event.payload.text.trim()];
              setLivePreview(finalPartsRef.current.join(" "));
            }
            return;
          }
          case "audio.dictation.error": {
            if (event.payload.dictationId !== currentId) return;
            stopRequestedRef.current = false;
            dictationStartSentRef.current = false;
            setIsStopRequested(false);
            setDictationError(`${event.payload.code}: ${event.payload.message}`);
            setIsDictating(false);
            stopDictationListener();
            return;
          }
          case "audio.dictation.done": {
            if (event.payload.dictationId !== currentId) return;
            stopRequestedRef.current = false;
            dictationStartSentRef.current = false;
            setIsStopRequested(false);
            const finalText = finalPartsRef.current.join(" ").trim();
            const partialText = `${committedTextRef.current}${unstableTextRef.current}`.trim();
            const transcript = finalText || partialText;

            setIsDictating(false);
            stopDictationListener();
            setLivePreview("");

            if (!transcript) {
              setDictationError("Empty transcript (dictation produced no text)");
              return;
            }

            insertTranscriptIntoPrompt(transcript);
            return;
          }
          default:
            return;
        }
      },
      () => {
        const currentId = dictationIdRef.current;
        if (currentId !== dictationId) return;
        dictationStartSentRef.current = true;
        sendEvent({ type: "audio.dictation.start", payload: { dictationId } });
      },
    );
  }, [insertTranscriptIntoPrompt, sendEvent, stopDictationListener]);

  const stopDictation = useCallback(() => {
    const dictationId = dictationIdRef.current;
    if (!dictationId) return;
    if (stopRequestedRef.current) return;
    stopRequestedRef.current = true;
    setIsStopRequested(true);

    if (!dictationStartSentRef.current) {
      // Listener isn't ready (or start hasn't been sent) — cancel locally.
      stopRequestedRef.current = false;
      dictationStartSentRef.current = false;
      setIsStopRequested(false);
      setIsDictating(false);
      stopDictationListener();
      setLivePreview("");
      return;
    }
    sendEvent({ type: "audio.dictation.stop", payload: { dictationId } });
  }, [sendEvent, stopDictationListener]);

  function WaveformVisualizer({ isRecording }: { isRecording: boolean }) {
    const [bars, setBars] = useState<number[]>(Array(24).fill(0.05));
    const animationRef = useRef<number | null>(null);

    useEffect(() => {
      let running = true;
      if (isRecording) {
        const animate = () => {
          const t = Date.now();
          // Boost the signal significantly (RMS for speech is often 0.01-0.05)
          const energy = Math.min(1, Math.max(0, audioLevelRef.current * 25));
          const floor = 0.05;

          setBars((prev) =>
            prev.map((current, i) => {
              const wave = Math.sin(t / 180 + i * 0.45) * 0.5 + 0.5; // 0..1
              const shape = 0.25 + 0.75 * wave; // 0.25..1.0
              const noise = (Math.random() - 0.5) * 0.06 * energy;
              const target = Math.min(1, Math.max(floor, floor + energy * shape * 0.95 + noise));
              return current * 0.75 + target * 0.25;
            }),
          );
          if (!running) return;
          animationRef.current = requestAnimationFrame(animate);
        };
        animate();
      } else {
        setBars(Array(24).fill(0.05));
      }

      return () => {
        running = false;
        if (animationRef.current !== null) {
          cancelAnimationFrame(animationRef.current);
        }
      };
    }, [isRecording]);

    return (
      <div className="flex h-10 items-end justify-center gap-[3px]">
        {bars.map((height, i) => (
          <div
            key={i}
            className={isRecording ? "w-1.5 rounded-sm bg-accent" : "w-1.5 rounded-sm bg-ink-200"}
            style={{ height: `${height * 100}%` }}
          />
        ))}
      </div>
    );
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter to send (without Shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isDictating) {
        if (!isStopRequested) stopDictation();
        return;
      }
      if (isRunning) { handleStop(); return; }
      handleSend();
      return;
    }

    // Shift+Enter - allow multiline (default behavior)
  };

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    target.style.height = "auto";
    const scrollHeight = target.scrollHeight;
    if (scrollHeight > MAX_HEIGHT) {
      target.style.height = `${MAX_HEIGHT}px`;
      target.style.overflowY = "auto";
    } else {
      target.style.height = `${scrollHeight}px`;
      target.style.overflowY = "hidden";
    }
  };

  useEffect(() => {
    if (!promptRef.current) return;
    promptRef.current.style.height = "auto";
    const scrollHeight = promptRef.current.scrollHeight;
    if (scrollHeight > MAX_HEIGHT) {
      promptRef.current.style.height = `${MAX_HEIGHT}px`;
      promptRef.current.style.overflowY = "auto";
    } else {
      promptRef.current.style.height = `${scrollHeight}px`;
      promptRef.current.style.overflowY = "hidden";
    }
  }, [prompt]);

  return (
    <section className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-surface via-surface to-transparent pb-6 px-2 lg:pb-8 pt-8 lg:ml-[280px]">
      <div className="mx-auto w-full max-w-full">
        <div className="flex w-full items-end gap-3 rounded-2xl border border-ink-900/10 bg-surface px-4 py-3 shadow-card">
          <textarea
            rows={1}
            className="flex-1 resize-none bg-transparent py-1.5 text-sm text-ink-800 placeholder:text-muted focus:outline-none"
            placeholder="Describe what you want agent to handle..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            ref={promptRef}
          />
          <button
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${isDictating ? "bg-error text-white hover:bg-error/90" : "bg-ink-100 text-ink-700 hover:bg-ink-200"
              }`}
            onClick={isDictating ? stopDictation : startDictation}
            disabled={isStopRequested}
            aria-label={isDictating ? "Stop dictation" : "Start dictation"}
            title={isDictating ? "Stop dictation" : "Start dictation"}
          >
            {isDictating ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                <path
                  d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Zm5-3a1 1 0 1 0-2 0 3 3 0 0 1-6 0 1 1 0 1 0-2 0 5 5 0 0 0 4 4.9V18H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.1A5 5 0 0 0 17 11Z"
                  fill="currentColor"
                />
              </svg>
            )}
          </button>
          <button
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${isRunning ? "bg-error text-white hover:bg-error/90" : "bg-accent text-white hover:bg-accent-hover"}`}
            onClick={isRunning ? handleStop : handleSend}
            aria-label={isRunning ? "Stop session" : "Send prompt"}
          >
            {isRunning ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true"><path d="M3.4 20.6 21 12 3.4 3.4l2.8 7.2L16 12l-9.8 1.4-2.8 7.2Z" fill="currentColor" /></svg>
            )}
          </button>
        </div>

        {isDictating && (
          <div className="absolute bottom-full left-0 right-0 mb-4 px-4 z-50">
            <div className="mx-auto w-full max-w-full">
              <div className="flex flex-col items-center gap-2">
                <WaveformVisualizer isRecording={true} />
                {livePreview && (
                  <div className="text-sm font-medium text-ink-900 bg-surface/80 backdrop-blur-sm px-3 py-1.5 rounded-lg shadow-sm border border-ink-900/5">
                    {livePreview}
                  </div>
                )}
                {dictationError && (
                  <div className="text-xs text-error bg-surface/80 backdrop-blur-sm px-2 py-1 rounded shadow-sm">
                    {dictationError}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {!isDictating && dictationError && (
          <div className="mt-3 px-2 text-xs text-error break-words">
            <span className="font-medium">Dictation error:</span> {dictationError}
          </div>
        )}

        <div className="mt-2 px-2 text-xs text-muted text-center">
          Press <span className="font-medium text-ink-700">Enter</span> to send •{" "}
          <span className="font-medium text-ink-700">Shift + Enter</span> for new line
        </div>
      </div>
    </section>
  );
}
