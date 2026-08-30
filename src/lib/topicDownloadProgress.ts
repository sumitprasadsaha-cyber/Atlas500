/**
 * Topic Download Progress Service
 * Tracks real-time streaming download percentages independently for each topic note.
 */

type ProgressCallback = (percent: number | null) => void;

class TopicDownloadProgressManager {
  private progressMap = new Map<string, number | null>();
  private listeners = new Map<string, Set<ProgressCallback>>();

  public setProgress(key: string, percent: number | null): void {
    if (!key) return;
    const cleanKey = String(key).trim();
    if (!cleanKey) return;

    this.progressMap.set(cleanKey, percent);
    const subs = this.listeners.get(cleanKey);
    if (subs) {
      subs.forEach((cb) => {
        try {
          cb(percent);
        } catch {}
      });
    }
  }

  public clearProgress(key: string): void {
    if (!key) return;
    const cleanKey = String(key).trim();
    if (!cleanKey) return;

    this.progressMap.delete(cleanKey);
    const subs = this.listeners.get(cleanKey);
    if (subs) {
      subs.forEach((cb) => {
        try {
          cb(null);
        } catch {}
      });
    }
  }

  public getProgress(key?: string | null): number | null | undefined {
    if (!key) return undefined;
    return this.progressMap.get(String(key).trim());
  }

  public isDownloading(key?: string | null): boolean {
    if (!key) return false;
    return this.progressMap.has(String(key).trim());
  }

  public subscribe(key: string, callback: ProgressCallback): () => void {
    const cleanKey = String(key).trim();
    if (!cleanKey) return () => {};

    if (!this.listeners.has(cleanKey)) {
      this.listeners.set(cleanKey, new Set());
    }
    this.listeners.get(cleanKey)!.add(callback);

    if (this.progressMap.has(cleanKey)) {
      try {
        callback(this.progressMap.get(cleanKey)!);
      } catch {}
    }

    return () => {
      const subs = this.listeners.get(cleanKey);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.listeners.delete(cleanKey);
        }
      }
    };
  }
}

export const topicDownloadProgress = new TopicDownloadProgressManager();
