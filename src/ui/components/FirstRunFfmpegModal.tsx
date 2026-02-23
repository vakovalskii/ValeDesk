import * as Dialog from "@radix-ui/react-dialog";
import { getPlatform } from "../platform";

export type FfmpegDownloadProgress = Record<string, { percent: number; label?: string }> | null;

type FirstRunFfmpegModalProps = {
  open: boolean;
  onClose: () => void;
  onDownload: () => void;
  downloadProgress: FfmpegDownloadProgress;
};

export function FirstRunFfmpegModal({
  open,
  onClose,
  onDownload,
  downloadProgress,
}: FirstRunFfmpegModalProps) {
  const handleDownload = () => {
    getPlatform().sendClientEvent({ type: "ffmpeg.firstrun.asked", payload: { download: true } });
    onDownload();
  };

  const handleLater = () => {
    getPlatform().sendClientEvent({ type: "ffmpeg.firstrun.asked", payload: { download: false } });
    onClose();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !downloadProgress && handleLater()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] -translate-x-1/2 -translate-y-1/2 w-full max-w-md rounded-2xl border border-ink-900/10 bg-surface shadow-2xl p-6">
          <Dialog.Title className="text-lg font-semibold text-ink-900">
            Download FFmpeg?
          </Dialog.Title>
          <p className="mt-2 text-sm text-ink-600">
            FFmpeg enables media conversion and processing in commands and skills. You can download it now or enable it later in Settings → Tools.
          </p>

          {downloadProgress && Object.keys(downloadProgress).length > 0 ? (
            <div className="mt-4 space-y-3">
              {Object.entries(downloadProgress).map(([id, { percent, label }]) => (
                <div key={id} className="space-y-1">
                  <p className="text-xs font-medium text-ink-600">{label ?? id}</p>
                  <div className="w-full h-2 bg-ink-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent transition-all duration-150"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <p className="text-xs text-ink-500">{Math.round(percent)}%</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-6 flex gap-3">
              <button
                onClick={handleLater}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-ink-600 bg-ink-50 rounded-lg hover:bg-ink-100 transition-colors"
              >
                Later
              </button>
              <button
                onClick={handleDownload}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-accent rounded-lg hover:bg-accent/90 transition-colors"
              >
                Download
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
