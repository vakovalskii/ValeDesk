import { useState } from "react";

export interface ChangedFile {
  file_path: string;
  lines_added: number;
  lines_removed: number;
  content_old?: string;
  content_new?: string;
}

export interface ChangedFilesProps {
  files: ChangedFile[];
  onApply?: () => void;
  onReject?: () => void;
  onViewDiff?: (file: ChangedFile) => void;
}

export function ChangedFiles({ files, onApply, onReject, onViewDiff }: ChangedFilesProps) {
  const [showAll, setShowAll] = useState(false);

  if (!files || files.length === 0) {
    return null;
  }

  const displayFiles = showAll ? files : files.slice(0, 4);
  const hasMore = files.length > 4;

  const formatNumber = (num: number) => num.toLocaleString();

  return (
    <div className="mt-4 rounded-xl border border-ink-900/10 bg-surface overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-ink-900/5 bg-surface-tertiary">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-ink-800">
            Changed files: {files.length}
          </h4>
        </div>
      </div>

      {/* Files list */}
      <div className="divide-y divide-ink-900/5">
        {displayFiles.map((file, idx) => (
          <div
            key={`${file.file_path}-${idx}`}
            className="flex items-center justify-between px-4 py-3 hover:bg-ink-900/5 transition-colors"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {/* File icon */}
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-info flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" strokeLinecap="round" strokeLinejoin="round"/>
                <polyline points="14 2 14 8 20 8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              
              {/* File path */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-ink-800 truncate">
                  {file.file_path}
                </div>
                {(file.lines_added > 0 || file.lines_removed > 0) && (
                  <div className="text-xs text-muted">
                    {file.lines_added > 0 && (
                      <span className="text-success font-medium">+{formatNumber(file.lines_added)}</span>
                    )}
                    {file.lines_added > 0 && file.lines_removed > 0 && (
                      <span className="text-ink-400 mx-1">·</span>
                    )}
                    {file.lines_removed > 0 && (
                      <span className="text-error font-medium">-{formatNumber(file.lines_removed)}</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* View diff button */}
            {onViewDiff && (
              <button
                onClick={() => onViewDiff(file)}
                className="shrink-0 text-xs font-medium text-accent hover:text-accent/80 px-3 py-1.5 rounded-lg border border-accent/20 hover:border-accent/40 bg-accent/5 hover:bg-accent/10 transition-colors"
              >
                View diff
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Expand button */}
      {hasMore && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="w-full px-4 py-2.5 text-sm font-medium text-accent hover:bg-accent/5 transition-colors flex items-center justify-center gap-2"
        >
          {showAll ? (
            <>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="18 15 12 9 6 15" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Show less
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Show all {files.length} files
            </>
          )}
        </button>
      )}

      {/* Action buttons */}
      <div className="px-4 py-3 bg-surface-tertiary border-t border-ink-900/5 flex gap-2">
        {onApply && (
          <button
            onClick={onApply}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-success hover:bg-success/90 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Apply Changes
          </button>
        )}
        {onReject && (
          <button
            onClick={onReject}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-error border border-error/30 hover:bg-error/5 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Reject
          </button>
        )}
      </div>
    </div>
  );
}
