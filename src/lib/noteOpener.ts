import { getBucketName, sanitizeStoragePath } from "./storageService";
import { launchFileInNativeViewer, isCapacitorNative } from "./nativeFileOpener";
import { notesLogger } from "./notesLogger";
import { fetchNoteBlobWithCache } from "./nativePdfService";

export interface NoteOpeningTarget {
  url?: string;
  storageKey?: string;
  storagePath?: string;
  pdfUrl?: string;
  downloadUrl?: string;
  publicUrl?: string;
  bucket?: string;
  fileName?: string;
  pdfFileName?: string;
  mimeType?: string;
  fileType?: string;
  studentId?: string;
  subject?: string;
  noteId?: string;
  title?: string;
  onProgress?: (percent: number | null, statusText?: string) => void;
}

/**
 * Detects MIME type for note files to ensure correct inline display in native viewers.
 */
export function getNoteMimeType(fileNameOrUrl: string, mimeType?: string, fileType?: string): string {
  if (mimeType && mimeType.trim() && !mimeType.includes("octet-stream")) {
    return mimeType.trim();
  }
  if (fileType === "image") return "image/jpeg";
  const clean = (fileNameOrUrl || "").split("?")[0].split("#")[0].toLowerCase();
  if (clean.endsWith(".pdf")) return "application/pdf";
  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".heic")) return "image/heic";
  if (clean.endsWith(".heif")) return "image/heif";
  if (clean.endsWith(".gif")) return "image/gif";
  if (clean.endsWith(".svg")) return "image/svg+xml";
  return "application/pdf";
}

/**
 * Robust canonical key extractor.
 * Recovers canonical storagePath from objects, strings, JSON, URLs, or query parameters.
 */
export function extractCanonicalStorageKey(target: any, defaultBucket: string = "academy-connect-files"): string {
  if (!target) return "";

  let candidate = "";

  if (typeof target === "string") {
    candidate = target.trim();
  } else if (typeof target === "object") {
    // Priority 1: storagePath (canonical single source of truth)
    candidate = (
      target.storagePath ||
      target.storage_path ||
      target.storageKey ||
      target.objectKey ||
      target.r2Key ||
      target.downloadKey ||
      target.key ||
      target.pdfUrl ||
      target.downloadUrl ||
      target.publicUrl ||
      target.url ||
      ""
    ).trim();
  }

  if (!candidate) return "";

  // 1. Handle JSON string representation if passed
  if (candidate.startsWith("{")) {
    try {
      const parsed = JSON.parse(candidate);
      return extractCanonicalStorageKey(
        parsed.storagePath ||
        parsed.storageKey ||
        parsed.objectKey ||
        parsed.key ||
        parsed.downloadUrl ||
        parsed.url,
        defaultBucket
      );
    } catch {
      // Ignore JSON parse errors
    }
  }

  // 2. Data / Blob URLs do not have an R2 storage key
  if (candidate.startsWith("data:") || candidate.startsWith("blob:")) {
    return candidate;
  }

  let clean = candidate;

  // 3. Extract from key/storageKey/storagePath query params in URLs
  if (clean.includes("key=") || clean.includes("storageKey=") || clean.includes("storagePath=")) {
    try {
      const fakeBase = "http://localhost";
      const parsedUrl = new URL(clean.startsWith("http") ? clean : `${fakeBase}${clean.startsWith("/") ? "" : "/"}${clean}`);
      const keyParam =
        parsedUrl.searchParams.get("key") ||
        parsedUrl.searchParams.get("storageKey") ||
        parsedUrl.searchParams.get("storagePath");
      if (keyParam) {
        clean = decodeURIComponent(keyParam);
      }
    } catch {
      const match = clean.match(/[?&](?:key|storageKey|storagePath)=([^&]+)/);
      if (match && match[1]) {
        clean = decodeURIComponent(match[1]);
      }
    }
  }

  // 4. Handle HTTP/HTTPS URLs (Cloudflare R2, S3 presigned, or custom CDN)
  if (clean.startsWith("http://") || clean.startsWith("https://")) {
    try {
      const parsedUrl = new URL(clean);
      const keyParam = parsedUrl.searchParams.get("key") || parsedUrl.searchParams.get("storageKey");
      if (keyParam) {
        clean = decodeURIComponent(keyParam);
      } else {
        const segments = parsedUrl.pathname.replace(/^\/+/, "").split("/");
        if (segments[0] === defaultBucket || segments[0] === "academy-connect-files") {
          segments.shift();
        }
        clean = segments.join("/");
      }
    } catch {
      // fallback
    }
  }

  // 5. Safe decode URI component (prevent double encoding / double decoding)
  if (clean.includes("%")) {
    try {
      const decoded = decodeURIComponent(clean);
      // Only keep if decode succeeded without corrupted control characters
      if (decoded) clean = decoded;
    } catch {}
  }

  // 6. Strip query strings and hash fragments if present
  if (clean.includes("?")) {
    clean = clean.split("?")[0];
  }
  if (clean.includes("#")) {
    clean = clean.split("#")[0];
  }

  // 7. Strip leading bucket name if present
  const bucketPrefix = `${defaultBucket}/`;
  if (clean.startsWith(bucketPrefix)) {
    clean = clean.substring(bucketPrefix.length);
  }
  if (clean.startsWith("academy-connect-files/")) {
    clean = clean.substring("academy-connect-files/".length);
  }

  // 8. Normalize slashes, remove leading slashes, prevent traversal
  clean = clean.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/").replace(/\.\./g, "_");

  return clean;
}

/**
 * Single Canonical Note Download & View URL Generator.
 * The entire application MUST use this function exclusively to generate note URLs.
 * Always formats as: /api/storage?action=download&bucket=<bucket>&key=<storagePath>
 */
export function getCanonicalNoteDownloadUrl(
  storagePathOrTarget: string | NoteOpeningTarget | any,
  bucket?: string
): string {
  if (!storagePathOrTarget) return "";

  // If already a Data or Blob URL (e.g. locally generated PDF), return immediately
  if (typeof storagePathOrTarget === "string") {
    const trimmed = storagePathOrTarget.trim();
    if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
      return trimmed;
    }
  } else if (typeof storagePathOrTarget === "object") {
    const rawUrl = (storagePathOrTarget.url || storagePathOrTarget.pdfUrl || "").trim();
    if (rawUrl.startsWith("data:") || rawUrl.startsWith("blob:")) {
      return rawUrl;
    }
  }

  const effectiveBucket = getBucketName(
    bucket || (typeof storagePathOrTarget === "object" ? storagePathOrTarget?.bucket : undefined) || "academy-connect-files"
  );
  const cleanKey = extractCanonicalStorageKey(storagePathOrTarget, effectiveBucket);

  if (!cleanKey) return "";
  if (cleanKey.startsWith("data:") || cleanKey.startsWith("blob:")) {
    return cleanKey;
  }

  return `/api/storage?action=download&bucket=${encodeURIComponent(effectiveBucket)}&key=${encodeURIComponent(cleanKey)}`;
}

/**
 * Resolves the canonical download URL for opening/viewing notes.
 * Strictly guarantees same-origin backend proxy route delivery.
 */
export async function resolveDirectNoteUrl(target: string | NoteOpeningTarget): Promise<string> {
  const canonicalUrl = getCanonicalNoteDownloadUrl(target);
  if (canonicalUrl) {
    return canonicalUrl;
  }

  if (typeof target === "string" && (target.startsWith("http://") || target.startsWith("https://"))) {
    return target;
  }

  throw new Error("Unable to resolve note URL: Missing canonical storagePath.");
}

/**
 * Universal Note Opener for Desktop, Android, iOS, and installed PWAs.
 * Implements a strict sequential pipeline:
 * 1. Asynchronously downloads and verifies document (status 200, valid MIME, not Cloudflare/HTML challenge, size > 0).
 * 2. Only opens viewer after 100% verification passes.
 * 3. Never freezes UI, keeps scrolling non-blocking.
 */
export async function openNote(target: string | NoteOpeningTarget): Promise<string> {
  const isCapacitor = isCapacitorNative();
  const isPWA =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as any).standalone === true ||
      (typeof document !== "undefined" && document.referrer.includes("android-app://")));
  const isMobile =
    typeof navigator !== "undefined" &&
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  const cleanStoragePath = extractCanonicalStorageKey(target);

  const fileName =
    typeof target === "object" && target !== null
      ? target.fileName || target.pdfFileName || (target as any).filename || "note.pdf"
      : "note.pdf";

  const mimeType = getNoteMimeType(
    fileName,
    typeof target === "object" && target !== null ? target.mimeType : undefined,
    typeof target === "object" && target !== null ? target.fileType : undefined
  );

  const fileType = typeof target === "object" && target !== null ? target.fileType : undefined;

  // 1. Strict Sequential Pipeline: Download & Verify Document First
  const onProgress = typeof target === "object" && target !== null ? target.onProgress : undefined;
  const verifiedNote = await fetchNoteBlobWithCache(
    {
      storageKey: cleanStoragePath,
      storagePath: cleanStoragePath,
      noteId: typeof target === "object" && target !== null ? target.noteId : undefined,
      title: typeof target === "object" && target !== null ? target.title : undefined,
      fileName,
      pdfFileName: fileName,
      mimeType,
      fileType,
      url: typeof target === "object" && target !== null ? target.url : undefined,
    },
    undefined,
    onProgress ? (pct) => onProgress(pct) : undefined
  );

  if (!verifiedNote || !verifiedNote.objectUrl || !verifiedNote.blob || verifiedNote.blob.size <= 0) {
    throw new Error("Failed to verify document.");
  }

  // 2. Track study progress asynchronously in background
  if (typeof target === "object" && target !== null && target.studentId) {
    import("../utils/chapterProgressHelper")
      .then(({ recordNoteOpenedOrDownloaded }) => {
        recordNoteOpenedOrDownloaded(
          target.studentId!,
          target.subject,
          target.noteId || cleanStoragePath
        );
      })
      .catch(() => {});
  }

  // 3. Launch directly into native mobile app chooser or default OS viewer
  const launched = await launchFileInNativeViewer({
    blob: verifiedNote.blob,
    fileName: verifiedNote.fileName,
    mimeType: verifiedNote.mimeType,
    objectUrl: verifiedNote.objectUrl,
  });

  notesLogger.info("VIEW_OPEN", {
    fileName: verifiedNote.fileName,
    storageKey: cleanStoragePath,
    extra: {
      platform: isCapacitor ? "Capacitor" : isPWA ? "PWA" : isMobile ? "Mobile" : "Desktop",
      launched,
      cached: verifiedNote.cached,
    },
  });

  return verifiedNote.objectUrl;
}

