import { useState, useEffect, useMemo, Fragment, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { diffLines as computeDiffLines } from "diff";
import type { ChangedFile } from "./ChangedFiles";
import { getPlatform } from "../platform";
import { useAppStore } from "../store/useAppStore";

// Check which platform is being used
const isTauri = typeof (window as any).__TAURI__ !== "undefined";
const isElectron = typeof (window as any).electron !== "undefined";
console.log(`[DiffViewer] Platform detection: Tauri=${isTauri}, Electron=${isElectron}`);

interface DiffViewerModalProps {
  file: ChangedFile | null;
  files?: ChangedFile[];
  cwd?: string;
  open: boolean;
  onClose: () => void;
  onFileChange?: (file: ChangedFile) => void;
}

interface DiffLineItem {
  type: "added" | "removed" | "unchanged";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export function DiffViewerModal({ file, files = [], cwd, open, onClose, onFileChange }: DiffViewerModalProps) {
  const [oldContent, setOldContent] = useState<string>("");
  const [newContent, setNewContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentChangeBlockIndex, setCurrentChangeBlockIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  // Get settings from store
  const apiSettings = useAppStore((state) => state.apiSettings);
  const useGitForDiff = apiSettings?.useGitForDiff ?? true;

  // Find current file index in files array
  const currentFileIndex = useMemo(() => {
    if (!file || files.length === 0) return -1;
    return files.findIndex(f => f.file_path === file.file_path);
  }, [file, files]);

  const hasPreviousFile = currentFileIndex > 0;
  const hasNextFile = currentFileIndex >= 0 && currentFileIndex < files.length - 1;

  const handlePreviousFile = () => {
    if (hasPreviousFile && onFileChange) {
      onFileChange(files[currentFileIndex - 1]);
      setCurrentChangeBlockIndex(0);
    }
  };

  const handleNextFile = () => {
    if (hasNextFile && onFileChange) {
      onFileChange(files[currentFileIndex + 1]);
      setCurrentChangeBlockIndex(0);
    }
  };

  useEffect(() => {
    if (!open || !file) {
      // Reset content when modal is closed
      if (!open) {
        setOldContent("");
        setNewContent("");
        setError(null);
        setLoading(false);
      }
      return;
    }

    // If we have snapshots from tool_use message, use them directly
    if (file.content_old !== undefined && file.content_new !== undefined) {
      setOldContent(file.content_old);
      setNewContent(file.content_new);
      setLoading(false);
      setError(null);
      return;
    }

    // Otherwise, load from disk (fallback for ChangedFiles component)
    if (!cwd) {
      setError("Working directory not available");
      setLoading(false);
      return;
    }

    const loadFileContents = async () => {
      setLoading(true);
      setError(null);
      // Reset content before loading new file
      setOldContent("");
      setNewContent("");
      
      try {
        // Get old content based on settings
        let oldContentValue = "";
        
        if (useGitForDiff) {
          // Use git (original behavior)
          try {
            console.log(`[DiffViewer] Getting old content for ${file.file_path} in cwd ${cwd}`);
            oldContentValue = await getPlatform().invoke<string>("get-file-old-content", file.file_path, cwd, true);
            console.log(`[DiffViewer] Old content length: ${oldContentValue.length} for ${file.file_path}`);
          } catch (err) {
            // If file doesn't exist in git, use empty string
            console.error(`[DiffViewer] File ${file.file_path} not found in git HEAD, treating as new file:`, err);
            oldContentValue = "";
          }
        } else {
          // Use file snapshot
          try {
            // First, try to get saved snapshot
            oldContentValue = await getPlatform().invoke<string>("get-file-snapshot", file.file_path, cwd);
            
            // If no snapshot exists, read current file and save it as snapshot
            // This happens on first open - we save the current state as "old" for future diffs
            if (!oldContentValue) {
              try {
                const currentContent = await getPlatform().invoke<string>("get-file-new-content", file.file_path, cwd);
                // Save current content as snapshot for future diffs
                await getPlatform().invoke("save-file-snapshot", file.file_path, cwd, currentContent);
                // For first time, old content equals current (no changes yet)
                oldContentValue = currentContent;
              } catch (err) {
                // File doesn't exist yet, treat as new file
                oldContentValue = "";
              }
            }
          } catch (err) {
            console.log(`Failed to get file snapshot for ${file.file_path}, treating as new file`);
            oldContentValue = "";
          }
        }

        // Get new content (current file)
        // Always read from disk - this contains the current/new content after write_file/edit_file
        let newContentValue = "";
        try {
          console.log(`[DiffViewer] Getting new content for ${file.file_path} in cwd ${cwd}`);
          newContentValue = await getPlatform().invoke<string>("get-file-new-content", file.file_path, cwd);
          console.log(`[DiffViewer] New content length: ${newContentValue.length} for ${file.file_path}`);
        } catch (err) {
          // If file doesn't exist on disk, it's a new file
          console.error(`[DiffViewer] File ${file.file_path} not found on disk, treating as new file:`, err);
          newContentValue = "";
        }

        setOldContent(oldContentValue);
        setNewContent(newContentValue);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        console.error("Failed to load file contents:", err);
      } finally {
        setLoading(false);
      }
    };

    loadFileContents();
  }, [open, file?.file_path, file?.content_old, file?.content_new, cwd, useGitForDiff]);

  // Compute diff lines with synchronization for side-by-side display
  const computedDiffLines = useMemo(() => {
    if (!oldContent && !newContent) return [];
    
    const changes = computeDiffLines(oldContent, newContent);
    
    interface SyncedDiffLine {
      oldLine?: DiffLineItem;
      newLine?: DiffLineItem;
      needsSpacing?: boolean; // Add spacing before this line if it starts a change block
    }
    
    const result: SyncedDiffLine[] = [];
    let oldLineNum = 1;
    let newLineNum = 1;
    let prevWasChange = false; // Track if previous block was a change
    let i = 0;
    
    while (i < changes.length) {
      const change = changes[i];
      const lines = change.value.split("\n");
      // Remove last empty line if change ends with newline
      if (change.value.endsWith("\n") && lines[lines.length - 1] === "") {
        lines.pop();
      }
      
      const isChange = change.added || change.removed;
      const needsSpacing = isChange && !prevWasChange; // Add spacing when entering a change block
      
      if (change.removed) {
        // Check if next change is added (common case: deletion followed by addition)
        const nextChange = i + 1 < changes.length ? changes[i + 1] : null;
        const removedLines = lines;
        const addedLines = nextChange?.added ? nextChange.value.split("\n") : [];
        
        // Remove last empty line if nextChange ends with newline
        if (nextChange?.added && nextChange.value.endsWith("\n") && addedLines[addedLines.length - 1] === "") {
          addedLines.pop();
        }
        
        // Synchronize removed and added lines side-by-side
        const maxLines = Math.max(removedLines.length, addedLines.length);
        for (let j = 0; j < maxLines; j++) {
          result.push({
            oldLine: j < removedLines.length ? {
              type: "removed",
              content: removedLines[j],
              oldLineNumber: oldLineNum++,
            } : undefined,
            newLine: j < addedLines.length ? {
              type: "added",
              content: addedLines[j],
              newLineNumber: newLineNum++,
            } : undefined,
            needsSpacing: j === 0 ? needsSpacing : false,
          });
        }
        
        // Skip next change if it was added (we already processed it)
        if (nextChange?.added) {
          i += 2;
        } else {
          i++;
        }
        prevWasChange = true;
      } else if (change.added) {
        // Standalone added lines (without preceding removal)
        for (let j = 0; j < lines.length; j++) {
          result.push({
            newLine: {
              type: "added",
              content: lines[j],
              newLineNumber: newLineNum++,
            },
            needsSpacing: j === 0 ? needsSpacing : false,
          });
        }
        i++;
        prevWasChange = true;
      } else {
        // Unchanged lines: show in both columns
        for (let j = 0; j < lines.length; j++) {
          result.push({
            oldLine: {
              type: "unchanged",
              content: lines[j],
              oldLineNumber: oldLineNum++,
              newLineNumber: newLineNum++,
            },
            newLine: {
              type: "unchanged",
              content: lines[j],
              oldLineNumber: oldLineNum - 1,
              newLineNumber: newLineNum - 1,
            },
            needsSpacing: j === 0 ? needsSpacing : false,
          });
        }
        i++;
        prevWasChange = false;
      }
    }
    
    return result;
  }, [oldContent, newContent]);

  // Find all change block indices (where blocks of changes start)
  const changeBlockIndices = useMemo(() => {
    const indices: number[] = [];
    let prevWasUnchanged = true; // Track if previous line was unchanged
    
    computedDiffLines.forEach((line, idx) => {
      const isChange = line.oldLine?.type === "removed" || line.newLine?.type === "added";
      
      // Block starts if:
      // 1. needsSpacing is true (spacing before change block) - this is the main indicator
      // 2. OR it's the first change in the file (idx === 0 and isChange)
      // 3. OR it's a change after unchanged lines (transition from unchanged to changed)
      if (line.needsSpacing) {
        indices.push(idx);
      } else if (isChange && prevWasUnchanged && idx > 0) {
        // Change block starts without spacing (e.g., changes at the start of file)
        indices.push(idx);
      }
      
      // Update tracking
      if (!isChange) {
        prevWasUnchanged = true;
      } else {
        prevWasUnchanged = false;
      }
    });
    
    return indices;
  }, [computedDiffLines]);

  const hasPreviousChange = currentChangeBlockIndex > 0;
  const hasNextChange = currentChangeBlockIndex < changeBlockIndices.length - 1;

  const handlePreviousChange = () => {
    if (hasPreviousChange) {
      const newIndex = currentChangeBlockIndex - 1;
      console.log(`[DiffViewer] Navigating to previous change block: ${newIndex} (line index: ${changeBlockIndices[newIndex]})`);
      setCurrentChangeBlockIndex(newIndex);
      scrollToChangeBlock(newIndex);
    }
  };

  const handleNextChange = () => {
    if (hasNextChange) {
      const newIndex = currentChangeBlockIndex + 1;
      console.log(`[DiffViewer] Navigating to next change block: ${newIndex} (line index: ${changeBlockIndices[newIndex]})`);
      setCurrentChangeBlockIndex(newIndex);
      scrollToChangeBlock(newIndex);
    }
  };

  const scrollToChangeBlock = (blockIndex: number) => {
    if (scrollContainerRef.current && blockIndex >= 0 && blockIndex < changeBlockIndices.length) {
      setTimeout(() => {
        const container = scrollContainerRef.current;
        if (container) {
          // Find all elements with this block index
          const elements = container.querySelectorAll(`[data-change-block-index="${blockIndex}"]`);
          console.log(`[DiffViewer] Looking for block ${blockIndex}, found ${elements.length} elements`);
          if (elements.length > 0) {
            const targetElement = elements[0] as HTMLElement;
            // Get the position of the target element relative to the scroll container
            const containerRect = container.getBoundingClientRect();
            const targetRect = targetElement.getBoundingClientRect();
            
            // Calculate scroll position: target position - container position - offset for sticky header
            // Sticky header height is approximately 40px (py-2 = 0.5rem = 8px top/bottom, text-sm = ~14px line height)
            const stickyHeaderHeight = 40;
            const scrollOffset = targetRect.top - containerRect.top + container.scrollTop - stickyHeaderHeight - 8; // 8px extra padding
            
            // Smooth scroll to the calculated position
            container.scrollTo({
              top: Math.max(0, scrollOffset),
              behavior: "smooth"
            });
          } else {
            console.warn(`[DiffViewer] Could not find element with data-change-block-index="${blockIndex}". Total blocks: ${changeBlockIndices.length}, block indices:`, changeBlockIndices);
          }
        }
      }, 50);
    }
  };

  // Reset change block index when file changes
  useEffect(() => {
    setCurrentChangeBlockIndex(0);
  }, [file?.file_path]);

  // Scroll to first change when content is loaded or file changes
  useEffect(() => {
    if (!loading && !error && changeBlockIndices.length > 0) {
      // Small delay to ensure DOM is updated
      setTimeout(() => {
        scrollToChangeBlock(0); // 0 is the index of the first block
        setCurrentChangeBlockIndex(0);
      }, 150);
    }
  }, [loading, error, file?.file_path, changeBlockIndices.length]);

  if (!file) {
    return null;
  }

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] h-[85vh] bg-surface border border-ink-900/10 rounded-xl shadow-xl z-50 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-ink-900/10">
            <div className="flex items-center gap-4 flex-1 min-w-0">
              {/* File navigation buttons */}
              {files.length > 1 && (
                <div className="flex items-center gap-2 shrink-0 border-r border-ink-900/10 pr-4">
                  <button
                    onClick={handlePreviousFile}
                    disabled={!hasPreviousFile}
                    className="p-1.5 text-ink-400 hover:text-ink-600 disabled:text-ink-300 disabled:cursor-not-allowed transition-colors rounded hover:bg-ink-900/5"
                    aria-label="Previous file"
                    title="Previous file"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 19l-7-7 7-7"
                      />
                    </svg>
                  </button>
                  <span className="text-sm text-ink-500 min-w-[60px] text-center">
                    {currentFileIndex >= 0 ? `${currentFileIndex + 1} / ${files.length}` : ""}
                  </span>
                  <button
                    onClick={handleNextFile}
                    disabled={!hasNextFile}
                    className="p-1.5 text-ink-400 hover:text-ink-600 disabled:text-ink-300 disabled:cursor-not-allowed transition-colors rounded hover:bg-ink-900/5"
                    aria-label="Next file"
                    title="Next file"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                </div>
              )}
              {/* Change block navigation buttons */}
              {changeBlockIndices.length > 1 && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handlePreviousChange}
                    disabled={!hasPreviousChange}
                    className="p-1.5 text-ink-400 hover:text-ink-600 disabled:text-ink-300 disabled:cursor-not-allowed transition-colors rounded hover:bg-ink-900/5"
                    aria-label="Previous change"
                    title="Previous change block"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 15l7-7 7 7"
                      />
                    </svg>
                  </button>
                  <span className="text-sm text-ink-500 min-w-[60px] text-center">
                    {changeBlockIndices.length > 0 ? `${currentChangeBlockIndex + 1} / ${changeBlockIndices.length}` : ""}
                  </span>
                  <button
                    onClick={handleNextChange}
                    disabled={!hasNextChange}
                    className="p-1.5 text-ink-400 hover:text-ink-600 disabled:text-ink-300 disabled:cursor-not-allowed transition-colors rounded hover:bg-ink-900/5"
                    aria-label="Next change"
                    title="Next change block"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>
                </div>
              )}
              <Dialog.Title className="text-lg font-semibold text-ink-800 truncate flex-1">
                Diff: {file.file_path}
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                className="text-ink-400 hover:text-ink-600 transition-colors shrink-0 ml-4"
                aria-label="Close"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </Dialog.Close>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden relative">
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-ink-500">Loading file contents...</div>
              </div>
            ) : error ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-error">{error}</div>
              </div>
            ) : (
              <div className="h-full overflow-auto" ref={scrollContainerRef}>
                {/* Grid container with synchronized columns */}
                <div className="grid grid-cols-2">
                  {/* Header Row */}
                  <div className="sticky top-0 bg-surface-tertiary px-4 py-2 border-b border-r border-ink-900/10 text-sm font-medium text-ink-700 z-10">
                    Old Version
                  </div>
                  <div className="sticky top-0 bg-surface-tertiary px-4 py-2 border-b border-ink-900/10 text-sm font-medium text-ink-700 z-10">
                    New Version
                  </div>

                  {/* Diff Lines - synchronized by index */}
                  {computedDiffLines.map((syncedLine, idx) => {
                    const oldLine = syncedLine.oldLine;
                    const newLine = syncedLine.newLine;
                    const needsSpacing = syncedLine.needsSpacing;
                    // Find which change block this line belongs to (index in changeBlockIndices array)
                    const changeBlockIndex = changeBlockIndices.indexOf(idx);
                    const isChangeBlockStart = changeBlockIndex >= 0;
                    
                    return (
                      <Fragment key={`diff-${idx}`}>
                        {/* Spacing row before change blocks */}
                        {needsSpacing && isChangeBlockStart && (
                          <>
                            <div 
                              data-change-block-index={changeBlockIndex}
                              className="h-2 bg-surface border-r border-ink-900/10" 
                            />
                            <div 
                              data-change-block-index={changeBlockIndex}
                              className="h-2 bg-surface" 
                            />
                          </>
                        )}
                        
                        {/* Old Version Cell */}
                        <div
                          {...(isChangeBlockStart && !needsSpacing ? { "data-change-block-index": changeBlockIndex } : {})}
                          className={`px-4 py-0.5 flex items-start font-mono text-sm border-r border-ink-900/10 ${
                            oldLine?.type === "removed"
                              ? "bg-error/10 text-error"
                              : oldLine?.type === "unchanged"
                              ? "text-ink-700"
                              : "bg-surface-secondary"
                          }`}
                        >
                          {oldLine ? (
                            <>
                              <span className="text-ink-400 mr-4 select-none w-8 text-right shrink-0">
                                {oldLine.oldLineNumber || " "}
                              </span>
                              <span className="flex-1 whitespace-pre-wrap break-words">
                                {oldLine.content || " "}
                              </span>
                            </>
                          ) : (
                            <span className="flex-1">&nbsp;</span>
                          )}
                        </div>

                        {/* New Version Cell */}
                        <div
                          {...(isChangeBlockStart && !needsSpacing ? { "data-change-block-index": changeBlockIndex } : {})}
                          className={`px-4 py-0.5 flex items-start font-mono text-sm ${
                            newLine?.type === "added"
                              ? "bg-success/10 text-success"
                              : newLine?.type === "unchanged"
                              ? "text-ink-700"
                              : "bg-surface-secondary"
                          }`}
                        >
                          {newLine ? (
                            <>
                              <span className="text-ink-400 mr-4 select-none w-8 text-right shrink-0">
                                {newLine.newLineNumber || " "}
                              </span>
                              <span className="flex-1 whitespace-pre-wrap break-words">
                                {newLine.content || " "}
                              </span>
                            </>
                          ) : (
                            <span className="flex-1">&nbsp;</span>
                          )}
                        </div>
                      </Fragment>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
