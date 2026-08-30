import React, { useState, useEffect } from "react";
import { topicDownloadProgress } from "../../lib/topicDownloadProgress";

export interface TopicDownloadProgressBarProps {
  topicId?: string | null;
  storageKey?: string | null;
  progress?: number | null;
  className?: string;
}

/**
 * Hook to subscribe to an individual topic note's download progress.
 */
export function useTopicDownloadProgress(
  topicId?: string | null,
  storageKey?: string | null
): { progress: number | null | undefined; isDownloading: boolean } {
  const [progress, setProgress] = useState<number | null | undefined>(() => {
    if (topicId) {
      const p = topicDownloadProgress.getProgress(topicId);
      if (p !== undefined) return p;
    }
    if (storageKey) {
      const p = topicDownloadProgress.getProgress(storageKey);
      if (p !== undefined) return p;
    }
    return undefined;
  });

  useEffect(() => {
    const unsub1 = topicId
      ? topicDownloadProgress.subscribe(topicId, (p) => setProgress(p))
      : null;
    const unsub2 =
      storageKey && storageKey !== topicId
        ? topicDownloadProgress.subscribe(storageKey, (p) => setProgress(p))
        : null;

    return () => {
      if (unsub1) unsub1();
      if (unsub2) unsub2();
    };
  }, [topicId, storageKey]);

  return {
    progress,
    isDownloading: progress !== undefined,
  };
}

/**
 * Horizontal Progress Bar with real-time percentage display.
 * Example: [██████████------] 52%
 */
export function TopicDownloadProgressBar({
  topicId,
  storageKey,
  progress: directProgress,
  className = "",
}: TopicDownloadProgressBarProps) {
  const { progress: subscribedProgress } = useTopicDownloadProgress(topicId, storageKey);
  const rawProgress = directProgress !== undefined ? directProgress : subscribedProgress;

  const isDeterminate = typeof rawProgress === "number" && !isNaN(rawProgress);
  const clampedPercent = isDeterminate
    ? Math.max(0, Math.min(100, Math.round(rawProgress!)))
    : null;

  return (
    <div
      className={`inline-flex items-center gap-2 px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/80 border border-blue-200/80 dark:border-blue-800/80 text-blue-700 dark:text-blue-300 shrink-0 select-none shadow-2xs ${className}`}
      role="progressbar"
      aria-valuenow={isDeterminate ? clampedPercent! : undefined}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {/* Horizontal Progress Bar Track */}
      <div className="w-16 sm:w-20 h-2 bg-blue-200/90 dark:bg-blue-900/90 rounded-full overflow-hidden relative shrink-0">
        {isDeterminate ? (
          <div
            className="h-full bg-blue-600 dark:bg-blue-400 rounded-full transition-all duration-150 ease-out"
            style={{ width: `${clampedPercent}%` }}
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-r from-blue-400 via-blue-600 to-blue-400 dark:from-blue-600 dark:via-blue-400 dark:to-blue-600 rounded-full animate-pulse" />
        )}
      </div>

      {/* Percentage Indicator or Status Label */}
      <span className="text-[11px] font-bold tabular-nums shrink-0 min-w-[26px]">
        {isDeterminate ? `${clampedPercent}%` : "Downloading…"}
      </span>
    </div>
  );
}

export default TopicDownloadProgressBar;
