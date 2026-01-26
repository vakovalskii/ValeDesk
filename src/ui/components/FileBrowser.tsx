import { useEffect, useState } from 'react';
import { getPlatform } from "../platform";
import { dirnameFsPath, isPathWithin, normalizeFsPath } from "../platform/fs-path";

type FileItem = {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
};

type FileBrowserProps = {
  cwd: string;
  onClose: () => void;
};

export function FileBrowser({ cwd, onClose }: FileBrowserProps) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState(cwd);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    loadFiles(currentPath);
  }, [currentPath]);

  const loadFiles = async (path: string) => {
    setLoading(true);
    try {
      // Request file list from electron
      const fileList = await getPlatform().invoke<FileItem[]>('list-directory', path);
      setFiles(fileList || []);
    } catch (error) {
      console.error('Failed to load files:', error);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  // Filter files based on showHidden
  const visibleFiles = showHidden 
    ? files 
    : files.filter(file => !file.name.startsWith('.'));

  const handleFileClick = (file: FileItem) => {
    if (file.isDirectory) {
      // Only navigate to directories within cwd
      if (isPathWithin(file.path, cwd)) {
        setCurrentPath(file.path);
      }
    } else {
      // Open file in system default app
      getPlatform().send('open-file', file.path);
    }
  };

  const goUp = () => {
    // Don't allow going above the initial cwd
    const normalizedCurrent = normalizeFsPath(currentPath);
    const normalizedCwd = normalizeFsPath(cwd);
    if (normalizedCurrent === normalizedCwd || !isPathWithin(currentPath, cwd)) {
      return;
    }

    const parentPath = dirnameFsPath(currentPath);
    // Only navigate if parent is still within cwd
    if (isPathWithin(parentPath, cwd)) {
      setCurrentPath(parentPath);
    }
  };

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-surface border-l border-ink-900/10 shadow-2xl flex flex-col z-40">
      {/* Header */}
      <div className="flex items-center justify-between h-12 px-4 border-b border-ink-900/10 bg-surface-cream">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-ink-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span className="text-sm font-medium text-ink-700">Files</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-ink-500 hover:text-ink-700 hover:bg-ink-100 rounded transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Current path */}
      <div className="px-4 py-2 bg-ink-50 border-b border-ink-900/10">
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={goUp}
            disabled={currentPath === cwd}
            className="p-1 text-ink-600 hover:text-ink-900 hover:bg-white rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Go up"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-xs font-mono text-ink-600 truncate flex-1" title={currentPath}>
            {currentPath}
          </span>
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
            className="rounded border-ink-300"
          />
          Show hidden files
        </label>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-sm text-muted">Loading...</div>
          </div>
        ) : visibleFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 px-4 text-center">
            <div className="text-sm text-muted">
              {files.length === 0 ? 'Empty directory' : 'No visible files'}
            </div>
            {!showHidden && files.length > 0 && (
              <button
                onClick={() => setShowHidden(true)}
                className="mt-2 text-xs text-accent hover:underline"
              >
                Show hidden files
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-ink-900/5">
            {visibleFiles.map((file, idx) => (
              <button
                key={idx}
                onClick={() => handleFileClick(file)}
                className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-ink-50 transition-colors text-left"
              >
                {file.isDirectory ? (
                  <svg className="w-4 h-4 text-accent flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-ink-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-ink-700 truncate">{file.name}</div>
                  {!file.isDirectory && file.size !== undefined && (
                    <div className="text-xs text-ink-500">
                      {formatFileSize(file.size)}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

