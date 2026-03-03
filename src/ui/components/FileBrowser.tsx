import { useEffect, useRef, useState } from 'react';
import { getPlatform } from "../platform";
import { dirnameFsPath, isPathWithin, normalizeFsPath } from "../platform/fs-path";
import { useI18n } from "../i18n";
import { FilePreviewPanel } from "./FilePreviewPanel";

// --- Thumbnail request queue (max N concurrent IPC calls) ---
const THUMB_CONCURRENCY = 1;
let _thumbActive = 0;
const _thumbQueue: Array<() => void> = [];

function enqueueThumbnail(fn: () => Promise<void>): void {
  const run = () => {
    _thumbActive++;
    fn().finally(() => {
      _thumbActive--;
      if (_thumbQueue.length > 0) {
        const next = _thumbQueue.shift()!;
        next();
      }
    });
  };
  if (_thumbActive < THUMB_CONCURRENCY) {
    run();
  } else {
    _thumbQueue.push(run);
  }
}

export type FileItem = {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
};

type FileBrowserProps = {
  cwd: string;
  onClose: () => void;
  /** true = single click opens built-in preview panel; false = single click opens in OS app (old behaviour) */
  useBuiltinViewer?: boolean;
};

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.tif', '.tiff', '.heic', '.heif']);

function getExt(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx === -1 ? '' : name.slice(idx).toLowerCase();
}

function isImage(name: string): boolean {
  return IMAGE_EXTS.has(getExt(name));
}

// Thumbnail for a single file row — lazy-loads via IntersectionObserver with debounce + queue
function FileThumbnail({ path }: { path: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const triedRef = useRef(false);

  useEffect(() => {
    if (!ref.current) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) {
          // Element left viewport — cancel pending debounce
          if (debounceTimer !== null) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
          }
          return;
        }
        if (triedRef.current) return;

        // Debounce: wait 200ms to skip rapidly scrolled-past items
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (triedRef.current) return;
          triedRef.current = true;
          enqueueThumbnail(() =>
            getPlatform()
              .invoke<string | null>('get-thumbnail', path, 64)
              .then((dataUrl) => { if (dataUrl) setSrc(dataUrl); })
              .catch(() => {/* silently ignore */})
          );
        }, 80);
      },
      { threshold: 0.1 }
    );
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      if (debounceTimer !== null) clearTimeout(debounceTimer);
    };
  }, [path]);

  return (
    <div ref={ref} className="w-10 h-10 flex-shrink-0 rounded overflow-hidden bg-ink-100 flex items-center justify-center">
      {src ? (
        <img src={src} alt="" className="w-full h-full object-cover" />
      ) : (
        <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      )}
    </div>
  );
}

export function FileBrowser({ cwd, onClose, useBuiltinViewer = true }: FileBrowserProps) {
  const { t } = useI18n();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState(cwd);
  const [showHidden, setShowHidden] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);

  useEffect(() => {
    loadFiles(currentPath);
  }, [currentPath]);

  // Close preview when navigating to another directory
  useEffect(() => {
    setSelectedFile(null);
  }, [currentPath]);

  const loadFiles = async (path: string) => {
    setLoading(true);
    try {
      const fileList = await getPlatform().invoke<FileItem[]>('list-directory', path);
      setFiles(fileList || []);
    } catch (error) {
      console.error('Failed to load files:', error);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  const visibleFiles = showHidden
    ? files
    : files.filter(file => !file.name.startsWith('.'));

  const handleFileClick = (file: FileItem) => {
    if (file.isDirectory) {
      if (isPathWithin(file.path, cwd)) {
        setCurrentPath(file.path);
      }
    } else if (useBuiltinViewer) {
      // Built-in viewer: single click toggles preview panel
      setSelectedFile(prev => prev?.path === file.path ? null : file);
    } else {
      // OS mode: single click opens in system app (old behaviour)
      getPlatform().send('open-file', file.path);
    }
  };

  const handleFileDoubleClick = (file: FileItem) => {
    if (!file.isDirectory) {
      // Double click always opens in OS app
      getPlatform().send('open-file', file.path);
    }
  };

  const goUp = () => {
    const normalizedCurrent = normalizeFsPath(currentPath);
    const normalizedCwd = normalizeFsPath(cwd);
    if (normalizedCurrent === normalizedCwd || !isPathWithin(currentPath, cwd)) {
      return;
    }
    const parentPath = dirnameFsPath(currentPath);
    if (isPathWithin(parentPath, cwd)) {
      setCurrentPath(parentPath);
    }
  };

  return (
    <>
      <div className="fixed right-0 top-0 h-full w-80 bg-surface border-l border-ink-900/10 shadow-2xl flex flex-col z-40">
        {/* Header */}
        <div className="flex items-center justify-between h-12 px-4 border-b border-ink-900/10 bg-surface-cream">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-ink-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span className="text-sm font-medium text-ink-700">{t("fileBrowser.files")}</span>
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
              title={t("fileBrowser.goUp")}
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
            {t("fileBrowser.showHiddenFiles")}
          </label>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="text-sm text-muted">{t("fileBrowser.loading")}</div>
            </div>
          ) : visibleFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 px-4 text-center">
              <div className="text-sm text-muted">
                {files.length === 0 ? t("fileBrowser.emptyDirectory") : t("fileBrowser.noVisibleFiles")}
              </div>
              {!showHidden && files.length > 0 && (
                <button
                  onClick={() => setShowHidden(true)}
                  className="mt-2 text-xs text-accent hover:underline"
                >
                  {t("fileBrowser.showHiddenFiles")}
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-ink-900/5">
              {visibleFiles.map((file, idx) => {
                const selected = selectedFile?.path === file.path;
                return (
                  <button
                    key={idx}
                    onClick={() => handleFileClick(file)}
                    onDoubleClick={() => handleFileDoubleClick(file)}
                    className={`w-full px-4 py-2 flex items-center gap-2.5 transition-colors text-left ${
                      selected
                        ? 'bg-accent/10 hover:bg-accent/15'
                        : 'hover:bg-ink-50'
                    }`}
                  >
                    {/* Icon / thumbnail */}
                    {file.isDirectory ? (
                      <svg className="w-8 h-8 text-accent flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                    ) : isImage(file.name) ? (
                      <FileThumbnail path={file.path} />
                    ) : (
                      <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center">
                        <svg className="w-5 h-5 text-ink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                    )}

                    {/* Name + size */}
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm truncate ${selected ? 'text-accent font-medium' : 'text-ink-700'}`}>
                        {file.name}
                      </div>
                      {!file.isDirectory && file.size !== undefined && (
                        <div className="text-xs text-ink-500">
                          {formatFileSize(file.size)}
                        </div>
                      )}
                    </div>

                    {/* Chevron for selected file */}
                    {selected && !file.isDirectory && (
                      <svg className="w-3 h-3 text-accent flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Hint at bottom */}
        {!loading && visibleFiles.length > 0 && (
          <div className="px-4 py-2 border-t border-ink-900/10 bg-ink-50">
            <p className="text-xs text-ink-400">
              {useBuiltinViewer
                ? t("fileBrowser.clickToPreview")
                : t("fileBrowser.clickToOpen")}
            </p>
          </div>
        )}
      </div>

      {/* Preview panel — slides in to the left of FileBrowser */}
      {useBuiltinViewer && selectedFile && (
        <FilePreviewPanel
          file={selectedFile}
          onClose={() => setSelectedFile(null)}
        />
      )}
    </>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
