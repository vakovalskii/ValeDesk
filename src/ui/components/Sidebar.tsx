import { useMemo, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useAppStore } from "../store/useAppStore";
import { SpinnerIcon } from "./SpinnerIcon";

interface SidebarProps {
  connected: boolean;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onOpenSettings: () => void;
  currentModel?: string | null;
}

export function Sidebar({
  onNewSession,
  onDeleteSession,
  onOpenSettings,
  currentModel
}: SidebarProps) {
  const sessions = useAppStore((state) => state.sessions);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const setActiveSessionId = useAppStore((state) => state.setActiveSessionId);
  const sendEvent = useAppStore((state) => state.sendEvent);
  const [searchQuery, setSearchQuery] = useState("");

  const formatCwd = (cwd?: string) => {
    if (!cwd) return "Working dir unavailable";
    const parts = cwd.split(/[\\/]+/).filter(Boolean);
    const tail = parts.slice(-2).join("/");
    return `/${tail || cwd}`;
  };

  const formatNumberWithSpaces = (num: number | undefined): string => {
    if (num === undefined) return "0";
    return num.toLocaleString("ru-RU", { useGrouping: true });
  };

  const sessionList = useMemo(() => {
    let list = Object.values(sessions);
    
    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      list = list.filter(session => 
        session.title.toLowerCase().includes(query) ||
        session.cwd?.toLowerCase().includes(query)
      );
    }
    
    // Sort: pinned first, then by updatedAt
    list.sort((a, b) => {
      const aPinned = a.isPinned || false;
      const bPinned = b.isPinned || false;
      
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });
    
    return list;
  }, [sessions, searchQuery]);

  const togglePin = (sessionId: string) => {
    const session = sessions[sessionId];
    if (!session) return;
    
    const newPinnedState = !session.isPinned;
    sendEvent({ type: 'session.pin', payload: { sessionId, isPinned: newPinnedState } });
  };


  return (
    <aside className="fixed inset-y-0 left-0 flex h-full w-[280px] flex-col gap-4 border-r border-ink-900/5 bg-[#FAF9F6] px-4 pb-4 pt-12">
      <div 
        className="absolute top-0 left-0 right-0 h-12"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
      <button
        className="w-full rounded-xl border border-ink-900/10 bg-surface px-4 py-2.5 text-sm font-medium text-ink-700 hover:bg-surface-tertiary hover:border-ink-900/20 transition-colors"
        onClick={onNewSession}
      >
        + New Chat
      </button>
      
      <button
        className="w-full flex items-center justify-center gap-2 rounded-xl border border-ink-900/10 bg-surface px-4 py-2.5 text-sm font-medium text-ink-700 hover:bg-surface-tertiary hover:border-ink-900/20 transition-colors"
        onClick={onOpenSettings}
        title="API Settings"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24" />
        </svg>
        Settings
      </button>

      {/* Search input */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search sessions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-xl border border-ink-900/10 bg-surface pl-9 pr-4 py-2 text-sm text-ink-800 placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors"
        />
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8" strokeWidth="2"/>
          <path d="m21 21-4.35-4.35" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </div>
      
      {currentModel && (
        <div className="w-full rounded-lg border border-info/20 bg-info/5 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-info flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path d="M13 7H7v6h6V7z"/>
              <path fillRule="evenodd" d="M7 2a1 1 0 012 0v1h2V2a1 1 0 112 0v1h2a2 2 0 012 2v2h1a1 1 0 110 2h-1v2h1a1 1 0 110 2h-1v2a2 2 0 01-2 2h-2v1a1 1 0 11-2 0v-1H9v1a1 1 0 11-2 0v-1H5a2 2 0 01-2-2v-2H2a1 1 0 110-2h1V9H2a1 1 0 010-2h1V5a2 2 0 012-2h2V2zM5 5h10v10H5V5z" clipRule="evenodd"/>
            </svg>
            <span className="text-xs font-medium text-info truncate" title={currentModel}>{currentModel}</span>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2 overflow-y-auto">
        {sessionList.length === 0 && (
          <div className="rounded-xl border border-ink-900/5 bg-surface px-4 py-5 text-center text-xs text-muted">
            No sessions yet. Start by sending a prompt.
          </div>
        )}
        {sessionList.map((session) => (
          <div
            key={session.id}
            className={`cursor-pointer rounded-xl border px-2 py-3 text-left transition ${
              session.isPinned 
                ? (activeSessionId === session.id ? "border-info/50 bg-info/10" : "border-info/30 bg-info/5 hover:bg-info/10")
                : (activeSessionId === session.id ? "border-accent/30 bg-accent-subtle" : "border-ink-900/5 bg-surface hover:bg-surface-tertiary")
            }`}
            onClick={() => setActiveSessionId(session.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveSessionId(session.id); } }}
            role="button"
            tabIndex={0}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
                {session.isPinned && (
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-info flex-shrink-0 fill-info" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M12 2v8m0 0l4-4m-4 4L8 6m4 4l-2 10h4l-2-10z" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
                <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
                  <div className="flex items-center gap-1.5">
                    {session.status === "running" && (
                      <SpinnerIcon className="h-3.5 w-3.5 text-info flex-shrink-0" />
                    )}
                    <div className={`text-[12px] font-medium truncate ${session.status === "running" ? "text-info" : session.status === "completed" ? "text-success" : session.status === "error" ? "text-error" : "text-ink-800"}`}>
                      {session.title}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-0.5 text-xs text-muted">
                    <span className="truncate">{formatCwd(session.cwd)}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {(session.inputTokens !== undefined || session.outputTokens !== undefined) && (
                  <Tooltip.Provider>
                    <Tooltip.Root delayDuration={200}>
                      <Tooltip.Trigger asChild>
                        <button
                          className="flex-shrink-0 rounded-full p-1.5 text-ink-400 hover:text-ink-600 hover:bg-ink-900/5"
                          aria-label="View token usage"
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" strokeLinecap="round" strokeLinejoin="round"/>
                            <circle cx="12" cy="17" r="1" fill="currentColor" />
                          </svg>
                        </button>
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Content className="z-50 rounded-lg border border-ink-900/10 bg-white px-3 py-2 text-sm shadow-lg" sideOffset={5}>
                          <div className="flex flex-col gap-1">
                            <div className="text-xs text-muted">
                              <span className="font-medium">Input:</span> {formatNumberWithSpaces(session.inputTokens)} tokens
                            </div>
                            <div className="text-xs text-muted">
                              <span className="font-medium">Output:</span> {formatNumberWithSpaces(session.outputTokens)} tokens
                            </div>
                          </div>
                          <Tooltip.Arrow className="fill-white" />
                        </Tooltip.Content>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  </Tooltip.Provider>
                )}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button className="flex-shrink-0 rounded-full p-1.5 text-ink-500 hover:bg-ink-900/10" aria-label="Open session menu" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                        <circle cx="5" cy="12" r="1.7" />
                        <circle cx="12" cy="12" r="1.7" />
                        <circle cx="19" cy="12" r="1.7" />
                      </svg>
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content className="z-50 min-w-[220px] rounded-xl border border-ink-900/10 bg-white p-1 shadow-lg" align="center" sideOffset={8}>
                      <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 outline-none hover:bg-ink-900/5" onSelect={() => togglePin(session.id)}>
                        <svg viewBox="0 0 24 24" className={`h-4 w-4 ${session.isPinned ? 'text-info fill-info' : 'text-ink-500'}`} fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M12 2v8m0 0l4-4m-4 4L8 6m4 4l-2 10h4l-2-10z" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        {session.isPinned ? 'Unpin' : 'Pin'} session
                      </DropdownMenu.Item>
                      <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 outline-none hover:bg-ink-900/5" onSelect={() => onDeleteSession(session.id)}>
                        <svg viewBox="0 0 24 24" className="h-4 w-4 text-error/80" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M7 7l1 12a1 1 0 0 0 1 .9h6a1 1 0 0 0 1-.9l1-12" />
                        </svg>
                        Delete this session
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
