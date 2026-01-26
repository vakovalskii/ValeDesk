import { useEffect, useState } from 'react';
import { getPlatform } from "../platform";

export function AppFooter() {
  const [buildInfo, setBuildInfo] = useState<{
    version: string;
    commit: string;
    commitShort: string;
  } | null>(null);

  useEffect(() => {
    // Get build info from Electron main process
    getPlatform()
      .invoke('get-build-info')
      .then((info) => setBuildInfo(info as any))
      .catch((error) => {
        console.error('[AppFooter] get-build-info failed', { error });
      });
  }, []);

  const handleCommitClick = async () => {
    if (!buildInfo || buildInfo.commit === 'unknown') return;
    const url = `https://github.com/vakovalskii/LocalDesk/commit/${buildInfo.commit}`;
    try {
      await getPlatform().invoke('open-external-url', url);
    } catch (error) {
      console.error('[AppFooter] open-external-url failed', { error, url });
    }
  };

  if (!buildInfo) return null;

  return (
    <div className="fixed bottom-0 left-[280px] right-0 h-6 bg-surface-secondary/80 backdrop-blur-sm border-t border-ink-900/10 flex items-center justify-center px-4 text-xs text-muted z-10">
      <div className="flex items-center gap-3">
        <span className="font-medium">LocalDesk v{buildInfo.version}</span>
        <span className="text-ink-400">•</span>
        <button
          onClick={handleCommitClick}
          className="font-mono hover:text-accent transition-colors cursor-pointer select-none"
          title={`Click to view commit on GitHub: ${buildInfo.commit}`}
          disabled={buildInfo.commit === 'unknown'}
        >
          {buildInfo.commitShort}
        </button>
      </div>
    </div>
  );
}
