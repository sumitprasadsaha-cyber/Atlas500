/**
 * Atlas v5.0.8 — Structured Notes Logger
 * High-performance, production-hardened logging utility for Notes lifecycle
 */

export type NotesLogLevel = "debug" | "info" | "warn" | "error";

export type NotesLogEvent =
  | "UPLOAD_START"
  | "UPLOAD_PROGRESS"
  | "UPLOAD_VERIFIED"
  | "UPLOAD_SUCCESS"
  | "UPLOAD_ERROR"
  | "REPLACE_START"
  | "REPLACE_SUCCESS"
  | "REPLACE_ERROR"
  | "DELETE_START"
  | "DELETE_SUCCESS"
  | "DELETE_ERROR"
  | "DELETE_CLASS_START"
  | "DELETE_CLASS_SUCCESS"
  | "DELETE_CLASS_ERROR"
  | "RENAME_START"
  | "RENAME_SUCCESS"
  | "RENAME_ERROR"
  | "RENAME_TEST_SYNC_WARN"
  | "DOWNLOAD_START"
  | "DOWNLOAD_CACHED"
  | "DOWNLOAD_PROGRESS"
  | "DOWNLOAD_SUCCESS"
  | "DOWNLOAD_ERROR"
  | "VIEW_OPEN"
  | "VIEW_CLOSE"
  | "CACHE_HIT"
  | "CACHE_MISS"
  | "CACHE_STORE"
  | "CACHE_INVALIDATE"
  | "CACHE_PURGE"
  | "RETRY_ATTEMPT"
  | "OFFLINE_SYNC"
  | "SECURITY_BLOCKED"
  | "VALIDATION_FAILED";

export interface NotesLogPayload {
  noteId?: string;
  noteType?: "school" | "upsc" | string;
  classGrade?: string;
  className?: string;
  subject?: string;
  chapterNumber?: number;
  moduleNumber?: number;
  topicNumber?: number | string;
  topicTitle?: string;
  storageKey?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  durationMs?: number;
  attempt?: number;
  maxAttempts?: number;
  error?: string;
  status?: number;
  cached?: boolean;
  extra?: Record<string, any>;
}

class NotesLogger {
  private isProduction: boolean;

  constructor() {
    this.isProduction =
      typeof process !== "undefined" &&
      process.env &&
      process.env.NODE_ENV === "production";
  }

  private sanitizePayload(payload?: NotesLogPayload): Record<string, any> {
    if (!payload) return {};
    const safe = { ...payload };
    // Strip sensitive secrets if any
    delete (safe as any).apiKey;
    delete (safe as any).secret;
    delete (safe as any).password;
    delete (safe as any).token;
    return safe;
  }

  private formatMessage(event: NotesLogEvent, payload?: NotesLogPayload): string {
    const parts = [`[Atlas Notes ${event}]`];
    if (payload?.noteId) parts.push(`id=${payload.noteId}`);
    if (payload?.fileName) parts.push(`file="${payload.fileName}"`);
    if (payload?.storageKey) parts.push(`key="${payload.storageKey}"`);
    if (payload?.durationMs !== undefined) parts.push(`${payload.durationMs}ms`);
    return parts.join(" ");
  }

  public debug(event: NotesLogEvent, payload?: NotesLogPayload): void {
    if (this.isProduction) return;
    console.debug(`%c[Notes:Debug] ${this.formatMessage(event, payload)}`, "color: #94a3b8", this.sanitizePayload(payload));
  }

  public info(event: NotesLogEvent, payload?: NotesLogPayload): void {
    if (this.isProduction) {
      // In production, keep info logs structured and lightweight
      console.log(JSON.stringify({
        tag: "atlas_notes",
        level: "info",
        event,
        timestamp: new Date().toISOString(),
        ...this.sanitizePayload(payload),
      }));
      return;
    }
    console.log(`%c[Notes:Info] ${this.formatMessage(event, payload)}`, "color: #3b82f6; font-weight: bold;", this.sanitizePayload(payload));
  }

  public warn(event: NotesLogEvent, payload?: NotesLogPayload): void {
    const sanitized = this.sanitizePayload(payload);
    if (this.isProduction) {
      console.warn(JSON.stringify({
        tag: "atlas_notes",
        level: "warn",
        event,
        timestamp: new Date().toISOString(),
        ...sanitized,
      }));
      return;
    }
    console.warn(`[Notes:Warn] ${this.formatMessage(event, payload)}`, sanitized);
  }

  public error(event: NotesLogEvent, payload?: NotesLogPayload): void {
    const sanitized = this.sanitizePayload(payload);
    if (this.isProduction) {
      console.error(JSON.stringify({
        tag: "atlas_notes",
        level: "error",
        event,
        timestamp: new Date().toISOString(),
        ...sanitized,
      }));
      return;
    }
    console.error(`%c[Notes:Error] ${this.formatMessage(event, payload)}`, "color: #ef4444; font-weight: bold;", sanitized);
  }

  /**
   * Helper to measure execution duration of async notes operations
   */
  public async time<T>(
    event: NotesLogEvent,
    payload: NotesLogPayload,
    operation: () => Promise<T>
  ): Promise<T> {
    const start = performance.now();
    try {
      this.info(`${event}_START` as NotesLogEvent, payload);
      const result = await operation();
      const durationMs = Math.round(performance.now() - start);
      this.info(`${event}_SUCCESS` as NotesLogEvent, { ...payload, durationMs });
      return result;
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - start);
      this.error(`${event}_ERROR` as NotesLogEvent, {
        ...payload,
        durationMs,
        error: err?.message || "Unknown operation failure",
      });
      throw err;
    }
  }
}

export const notesLogger = new NotesLogger();
