import { getBucketName, sanitizeStoragePath } from "./storageService";
import { getR2SignedUrlDetails, getR2PublicUrl } from "./r2Client";
import { openDocumentInNativeApp, isCapacitorNative } from "./nativeFileOpener";

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

  console.log(`[resolveDirectNoteUrl] Resolving note URL: key="${cleanKey}", bucket="${cleanBucket}", mime="${finalMime}"`);

  // 1. Request a verified pre-signed URL from backend with inline Content-Disposition
  try {
    const signedDetails = await getR2SignedUrlDetails({
      bucket: cleanBucket,
      key: cleanKey,
      expiresIn: 3600,
      operation: "getObject",
      contentType: finalMime,
    });

    if (signedDetails.status === 404 || signedDetails.exists === false) {
      throw new Error(`Object not found: "${cleanKey}" does not exist in storage.`);
    }

    if (signedDetails.signedUrl) {
      return signedDetails.signedUrl;
    }
  } catch (signErr: any) {
    if (signErr?.message && signErr.message.includes("Object not found")) {
      throw signErr;
    }
    console.warn("[resolveDirectNoteUrl] Error getting signed URL details:", signErr);
  }

  // 2. Direct public URL fallback if configured
  const directPublicUrl = getR2PublicUrl(cleanBucket, cleanKey);
  if (directPublicUrl && (directPublicUrl.startsWith("http://") || directPublicUrl.startsWith("https://"))) {
    return directPublicUrl;
  }

  // 3. Streaming download proxy fallback
  return `/api/storage?action=download&bucket=${encodeURIComponent(cleanBucket)}&key=${encodeURIComponent(cleanKey)}`;
}

/**
 * Universal Note Opener for Desktop, Android, iOS, and installed PWAs.
 * Immediately captures user gesture activation, resolves URL in single pass, and opens viewer.
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

  // In desktop browser environments, pre-allocate window synchronously within the user gesture window
  let preAllocatedWindow: Window | null = null;
  if (!isCapacitor && !isPWA && !isMobile && typeof window !== "undefined") {
    try {
      preAllocatedWindow = window.open("about:blank", "_blank");
    } catch {
      preAllocatedWindow = null;
    }
  }

  try {
    // Single-pass O(1) URL resolution with 8s timeout guard
    const resolvePromise = resolveDirectNoteUrl(target);
    const timeoutPromise = new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error("Document URL resolution timed out (8s limit).")), 8000)
    );

    const directUrl = await Promise.race([resolvePromise, timeoutPromise]);

    if (!directUrl) {
      throw new Error("Invalid note URL.");
    }

    const fileName =
      typeof target === "object" && target !== null
        ? target.fileName || target.pdfFileName || (target as any).filename || "note.pdf"
        : "note.pdf";
    const mimeType = getNoteMimeType(
      fileName,
      typeof target === "object" && target !== null ? target.mimeType : undefined,
      typeof target === "object" && target !== null ? target.fileType : undefined
    );

    console.log(`[openNote] Successfully resolved note URL:`, {
      directUrl,
      fileName,
      mimeType,
      platform: isCapacitor ? "Capacitor" : isPWA ? "PWA" : isMobile ? "Mobile Web" : "Desktop Web",
    });

    // Track study progress asynchronously in background
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

    // 1. If running on native mobile container (Capacitor Android/iOS), open directly via native FileOpener / intent
    if (isCapacitor) {
      const openedNative = await openDocumentInNativeApp({
        url: directUrl,
        fileName,
        mimeType,
      });

      if (openedNative) {
        if (preAllocatedWindow && !preAllocatedWindow.closed) {
          preAllocatedWindow.close();
        }
        return directUrl;
      }
    }

    // 2. If running inside installed PWA: Navigate current window directly to download/view endpoint (no popup window)
    if (isPWA) {
      if (preAllocatedWindow && !preAllocatedWindow.closed) {
        preAllocatedWindow.close();
      }
      window.location.assign(directUrl);
      return directUrl;
    }

    // 3. Desktop / Standard Web Browser handoff
    if (preAllocatedWindow && !preAllocatedWindow.closed) {
      preAllocatedWindow.location.href = directUrl;
    } else if (isMobile) {
      window.location.assign(directUrl);
    } else {
      const a = document.createElement("a");
      a.href = directUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    return directUrl;
  } catch (err: any) {
    if (preAllocatedWindow && !preAllocatedWindow.closed) {
      preAllocatedWindow.close();
    }
    console.error("[openNote] Note opening failed:", err);
    throw err;
  }
}
