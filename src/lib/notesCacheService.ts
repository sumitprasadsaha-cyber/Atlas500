/**
 * Atlas v5.0.8 — Intelligent Notes Cache & Offline Service
 * Enterprise IndexedDB + Memory Cache with deterministic invalidation,
 * offline fallback, and LRU blob storage.
 */

import { ClassNote } from "../types";
import { notesLogger } from "./notesLogger";

const DB_NAME = "atlas_notes_cache_v508";
const DB_VERSION = 1;
const STORE_METADATA = "notes_metadata";
const STORE_BLOBS = "notes_blobs";

const MAX_CACHED_BLOBS = 60; // Max items in local blob storage
const METADATA_CACHE_KEY = "all_notes_catalog";

export interface CachedBlobEntry {
  key: string; // Storage key or Note ID
  blob: Blob;
  mimeType: string;
  fileName: string;
  size: number;
  cachedAt: number;
  lastAccessed: number;
}

export interface CachedMetadataEntry {
  key: string;
  notes: ClassNote[];
  version: string;
  cachedAt: number;
}

class NotesCacheService {
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private memoryBlobCache = new Map<string, { blob: Blob; mimeType: string; fileName: string; timestamp: number }>();
  private isOnline: boolean = typeof navigator !== "undefined" ? navigator.onLine : true;
  private onlineListeners = new Set<() => void>();

  constructor() {
    if (typeof window !== "undefined") {
      this.initDb();
      window.addEventListener("online", () => {
        this.isOnline = true;
        notesLogger.info("OFFLINE_SYNC", { extra: { status: "online" } });
        this.notifyOnline();
      });
      window.addEventListener("offline", () => {
        this.isOnline = false;
        notesLogger.warn("OFFLINE_SYNC", { extra: { status: "offline" } });
      });
    }
  }

  public getOnlineStatus(): boolean {
    if (typeof navigator !== "undefined") {
      return navigator.onLine;
    }
    return this.isOnline;
  }

  public onOnlineReturn(callback: () => void): () => void {
    this.onlineListeners.add(callback);
    return () => {
      this.onlineListeners.delete(callback);
    };
  }

  private notifyOnline() {
    this.onlineListeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.warn("[NotesCacheService] online listener notice:", err);
      }
    });
  }

  private initDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;
    if (typeof indexedDB === "undefined") {
      this.dbPromise = Promise.resolve(null);
      return this.dbPromise;
    }

    this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_METADATA)) {
            db.createObjectStore(STORE_METADATA, { keyPath: "key" });
          }
          if (!db.objectStoreNames.contains(STORE_BLOBS)) {
            const blobStore = db.createObjectStore(STORE_BLOBS, { keyPath: "key" });
            blobStore.createIndex("lastAccessed", "lastAccessed", { unique: false });
          }
        };

        req.onsuccess = () => {
          resolve(req.result);
        };

        req.onerror = () => {
          notesLogger.warn("CACHE_MISS", { error: "IndexedDB open failed, falling back to memory" });
          resolve(null);
        };
      } catch {
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  // ==========================================
  // METADATA CACHING
  // ==========================================

  public async getCachedNotes(): Promise<ClassNote[] | null> {
    try {
      const db = await this.initDb();
      if (!db) return null;

      return new Promise((resolve) => {
        const tx = db.transaction(STORE_METADATA, "readonly");
        const store = tx.objectStore(STORE_METADATA);
        const req = store.get(METADATA_CACHE_KEY);

        req.onsuccess = () => {
          const res = req.result as CachedMetadataEntry | undefined;
          if (res && Array.isArray(res.notes)) {
            notesLogger.debug("CACHE_HIT", { extra: { count: res.notes.length } });
            resolve(res.notes);
          } else {
            resolve(null);
          }
        };

        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  public async setCachedNotes(notes: ClassNote[]): Promise<void> {
    try {
      const db = await this.initDb();
      if (!db || !Array.isArray(notes)) return;

      const entry: CachedMetadataEntry = {
        key: METADATA_CACHE_KEY,
        notes,
        version: "6.1.0",
        cachedAt: Date.now(),
      };

      const tx = db.transaction(STORE_METADATA, "readwrite");
      const store = tx.objectStore(STORE_METADATA);
      store.put(entry);

      notesLogger.debug("CACHE_STORE", { extra: { count: notes.length } });
    } catch (err) {
      console.warn("[NotesCacheService] setCachedNotes notice:", err);
    }
  }

  public async invalidateMetadataCache(): Promise<void> {
    try {
      const db = await this.initDb();
      if (!db) return;

      const tx = db.transaction(STORE_METADATA, "readwrite");
      const store = tx.objectStore(STORE_METADATA);
      store.delete(METADATA_CACHE_KEY);

      notesLogger.info("CACHE_INVALIDATE", { extra: { target: "metadata" } });
    } catch {}
  }

  // ==========================================
  // BINARY BLOB (PDF/IMAGE) CACHING & OFFLINE
  // ==========================================

  public normalizeStorageKey(keyOrUrl: string): string {
    if (!keyOrUrl) return "";
    return keyOrUrl.replace(/^https?:\/\/[^\/]+/, "").replace(/^\/+/, "").split("?")[0].trim();
  }

  public async getCachedBlob(keyOrUrl: string): Promise<{ blob: Blob; mimeType: string; fileName: string } | null> {
    const cleanKey = this.normalizeStorageKey(keyOrUrl);
    if (!cleanKey) return null;

    // 1. Check in-memory fast cache
    const mem = this.memoryBlobCache.get(cleanKey);
    if (mem) {
      notesLogger.debug("CACHE_HIT", { storageKey: cleanKey, extra: { source: "memory" } });
      return { blob: mem.blob, mimeType: mem.mimeType, fileName: mem.fileName };
    }

    // 2. Check IndexedDB persistent store
    try {
      const db = await this.initDb();
      if (!db) return null;

      return new Promise((resolve) => {
        const tx = db.transaction(STORE_BLOBS, "readwrite");
        const store = tx.objectStore(STORE_BLOBS);
        const req = store.get(cleanKey);

        req.onsuccess = () => {
          const entry = req.result as CachedBlobEntry | undefined;
          if (entry && entry.blob) {
            // Update lastAccessed for LRU
            entry.lastAccessed = Date.now();
            store.put(entry);

            // Populate memory cache
            this.memoryBlobCache.set(cleanKey, {
              blob: entry.blob,
              mimeType: entry.mimeType,
              fileName: entry.fileName,
              timestamp: Date.now(),
            });

            notesLogger.info("CACHE_HIT", {
              storageKey: cleanKey,
              fileSize: entry.size,
              extra: { source: "indexeddb" },
            });

            resolve({ blob: entry.blob, mimeType: entry.mimeType, fileName: entry.fileName });
          } else {
            notesLogger.debug("CACHE_MISS", { storageKey: cleanKey });
            resolve(null);
          }
        };

        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  public async setCachedBlob(params: {
    key: string;
    blob: Blob;
    mimeType: string;
    fileName: string;
  }): Promise<void> {
    const cleanKey = this.normalizeStorageKey(params.key);
    if (!cleanKey || !params.blob) return;

    // 1. Store in memory
    this.memoryBlobCache.set(cleanKey, {
      blob: params.blob,
      mimeType: params.mimeType,
      fileName: params.fileName,
      timestamp: Date.now(),
    });

    // 2. Persist to IndexedDB with LRU management
    try {
      const db = await this.initDb();
      if (!db) return;

      const entry: CachedBlobEntry = {
        key: cleanKey,
        blob: params.blob,
        mimeType: params.mimeType,
        fileName: params.fileName,
        size: params.blob.size,
        cachedAt: Date.now(),
        lastAccessed: Date.now(),
      };

      const tx = db.transaction(STORE_BLOBS, "readwrite");
      const store = tx.objectStore(STORE_BLOBS);
      store.put(entry);

      notesLogger.info("CACHE_STORE", {
        storageKey: cleanKey,
        fileSize: params.blob.size,
        mimeType: params.mimeType,
      });

      // Periodic LRU Eviction check
      this.evictOldBlobsIfExceeded(db);
    } catch (err) {
      console.warn("[NotesCacheService] setCachedBlob notice:", err);
    }
  }

  public async invalidateBlobCache(keyOrUrl: string): Promise<void> {
    const cleanKey = this.normalizeStorageKey(keyOrUrl);
    if (!cleanKey) return;

    this.memoryBlobCache.delete(cleanKey);

    try {
      const db = await this.initDb();
      if (!db) return;

      const tx = db.transaction(STORE_BLOBS, "readwrite");
      const store = tx.objectStore(STORE_BLOBS);
      store.delete(cleanKey);

      notesLogger.info("CACHE_INVALIDATE", { storageKey: cleanKey });
    } catch {}
  }

  public async clearAllBlobCache(): Promise<void> {
    this.memoryBlobCache.clear();
    try {
      const db = await this.initDb();
      if (!db) return;

      const tx = db.transaction(STORE_BLOBS, "readwrite");
      const store = tx.objectStore(STORE_BLOBS);
      store.clear();

      notesLogger.info("CACHE_PURGE", { extra: { scope: "all_blobs" } });
    } catch {}
  }

  private async evictOldBlobsIfExceeded(db: IDBDatabase): Promise<void> {
    try {
      const tx = db.transaction(STORE_BLOBS, "readwrite");
      const store = tx.objectStore(STORE_BLOBS);
      const countReq = store.count();

      countReq.onsuccess = () => {
        const count = countReq.result;
        if (count > MAX_CACHED_BLOBS) {
          const overflow = count - MAX_CACHED_BLOBS;
          const index = store.index("lastAccessed");
          const cursorReq = index.openCursor();
          let deleted = 0;

          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor && deleted < overflow) {
              const itemKey = (cursor.value as CachedBlobEntry).key;
              store.delete(itemKey);
              this.memoryBlobCache.delete(itemKey);
              deleted++;
              cursor.continue();
            }
          };
        }
      };
    } catch {}
  }
}

export const notesCacheService = new NotesCacheService();
