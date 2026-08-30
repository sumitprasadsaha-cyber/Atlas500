import { getBucketName, sanitizeStoragePath } from "./storageService";
import { getR2SignedUrlDetails, getR2PublicUrl } from "./r2Client";
import { launchFileInNativeViewer, openDocumentInNativeApp, isCapacitorNative } from "./nativeFileOpener";
import { notesCacheService } from "./notesCacheService";
import { notesLogger } from "./notesLogger";
import { fetchNoteBlobWithCache } from "./nativePdfService";

export interface NoteOpeningTarget {
  url?: string;
  storageKey?: string;
  storagePath?: string;
  pdfUrl?: string;
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
 * Resolves a direct HTTPS URL to Cloudflare R2 for opening/viewing notes.
 * Strictly O(1) single-pass resolution.
 */
export async function resolveDirectNoteUrl(target: string | NoteOpeningTarget): Promise<string> {
  let rawUrl = "";
  let storageKey = "";
  let bucket = "academy-connect-files";
  let mimeType = "";
  let fileType = "";
  let fileName = "";

  if (typeof target === "string") {
    rawUrl = target.trim();
  } else if (target && typeof target === "object") {
    rawUrl = (target.url || target.pdfUrl || "").trim();
    storageKey = (
      target.storageKey ||
      target.storagePath ||
      (target as any).storage_path ||
      (target as any).objectKey ||
      (target as any).r2Key ||
      (target as any).key ||
      ""
    ).trim();
    bucket = target.bucket || "academy-connect-files";
    fileName = target.fileName || target.pdfFileName || (target as any).filename || "";
    mimeType = target.mimeType || (target as any).mime_type || "";
    fileType = target.fileType || "";
  }

  // Handle JSON metadata strings if passed as rawUrl
  if (rawUrl.startsWith("{")) {
    try {
      const parsed = JSON.parse(rawUrl);
      storageKey = parsed.storageKey || parsed.storagePath || parsed.objectKey || storageKey;
      rawUrl = parsed.downloadUrl || parsed.url || "";
      if (parsed.bucket) bucket = parsed.bucket;
      if (parsed.mimeType) mimeType = parsed.mimeType;
    } catch {}
  }

  // If already a Data URL or Blob URL (e.g. locally generated PDF), return directly
  if (rawUrl.startsWith("data:") || rawUrl.startsWith("blob:")) {
    return rawUrl;
  }

  // If rawUrl is already a resolved direct download API URL, return immediately (avoids double resolution)
  if (rawUrl.startsWith("/api/storage?action=download") || rawUrl.startsWith("/api/r2/download") || rawUrl.startsWith("/api/files/download")) {
    return rawUrl;
  }

  // Extract storageKey if rawUrl contains query parameters or relative paths
  if (rawUrl.includes("key=") || rawUrl.includes("storageKey=") || rawUrl.includes("storagePath=")) {
    try {
      const fakeBase = "http://localhost";
      const parsedUrl = new URL(rawUrl.startsWith("http") ? rawUrl : `${fakeBase}${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`);
      const keyParam = parsedUrl.searchParams.get("key") || parsedUrl.searchParams.get("storageKey") || parsedUrl.searchParams.get("storagePath");
      if (keyParam) {
        storageKey = decodeURIComponent(keyParam);
      }
      rawUrl = ""; // Force resolving direct Cloudflare URL
    } catch {}
  }

  // If rawUrl is a relative path or storage key (not http/https), treat it as storageKey
  if (!storageKey && rawUrl && !rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) {
    storageKey = rawUrl;
    rawUrl = "";
  }

  const cleanBucket = getBucketName(bucket);
  const cleanKey = storageKey ? sanitizeStoragePath(storageKey, cleanBucket).replace(/^\/+/, "") : "";
  const finalMime = getNoteMimeType(fileName || cleanKey || rawUrl, mimeType, fileType);

  // If cleanKey is empty and rawUrl is already a direct external HTTPS URL to Cloudflare R2 or CDN (not pointing to /api/), return it directly
  if (!cleanKey && rawUrl && (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) && !rawUrl.includes("/api/")) {
    return rawUrl;
  }

  if (!cleanKey) {
    if (rawUrl) return rawUrl;
    throw new Error("Unable to open note: Missing file storage key.");
  }

  console.log(`[Stage 1: Metadata Lookup] Resolving note storage info:`, {
    stage: "1_METADATA_LOOKUP",
    storageKey: cleanKey,
    rawKey: storageKey,
    bucket: cleanBucket,
    mimeType: finalMime,
    fileName,
  });

  // 1. Verify object existence and retrieve secure retrieval metadata from backend
  try {
    const signedDetails = await getR2SignedUrlDetails({
      bucket: cleanBucket,
      key: cleanKey,
      expiresIn: 3600,
      operation: "getObject",
      contentType: finalMime,
    });

    if (signedDetails.status === 404 || signedDetails.exists === false) {
      console.warn(`[Stage 3: R2 Existence Check] Object does NOT exist in storage: key="${cleanKey}"`);
      throw new Error(`Object not found: "${cleanKey}" does not exist in storage.`);
    }

    console.log(`[Stage 4: URL Resolution] Verified storage resolution:`, {
      stage: "4_URL_RESOLUTION",
      key: cleanKey,
      bucket: cleanBucket,
      downloadUrl: signedDetails.downloadUrl,
      expiryTimestamp: signedDetails.expiryTimestamp,
      contentLength: signedDetails.contentLength,
    });

    // Prefer the secure backend download proxy route to ensure immunity against Cloudflare Bot Fight Mode, WAF challenges, and CORS 403s
    if (signedDetails.downloadUrl) {
      return signedDetails.downloadUrl;
    }
  } catch (signErr: any) {
    if (signErr?.message && signErr.message.includes("Object not found")) {
      throw signErr;
    }
    console.warn("[Stage 4: URL Resolution] Signed URL detail check notice:", signErr?.message || signErr);
  }

  // 2. Direct streaming download proxy fallback
  return `/api/storage?action=download&bucket=${encodeURIComponent(cleanBucket)}&key=${encodeURIComponent(cleanKey)}`;
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

  const storageKey =
    typeof target === "string"
      ? target
      : target?.storageKey ||
        target?.storagePath ||
        (target as any)?.storage_path ||
        (target as any)?.objectKey ||
        (target as any)?.r2Key ||
        target?.url ||
        target?.pdfUrl ||
        "";

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
      storageKey,
      storagePath: storageKey,
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
          target.noteId || target.storageKey || target.storagePath || ""
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
    storageKey,
    extra: {
      platform: isCapacitor ? "Capacitor" : isPWA ? "PWA" : isMobile ? "Mobile" : "Desktop",
      launched,
      cached: verifiedNote.cached,
    },
  });

  return verifiedNote.objectUrl;
}
