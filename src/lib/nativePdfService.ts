/**
 * Atlas v5.0.8 — High-Performance Native File Loading & Offline Service
 * Intelligent binary caching, stream loading with AbortController, offline fallback,
 * and native viewer integration.
 */

import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { openNote, resolveDirectNoteUrl, getNoteMimeType, NoteOpeningTarget } from "./noteOpener";
import { notesCacheService } from "./notesCacheService";
import { notesLogger } from "./notesLogger";
import { ClassNote } from "../types";

export { openNote, resolveDirectNoteUrl, getNoteMimeType };

export type NoteViewerState = "idle" | "downloading" | "opening" | "opened" | "error";

export interface OpenPdfOptions {
  storageKey?: string;
  storage_key?: string;
  storagePath?: string;
  storage_path?: string;
  objectKey?: string;
  r2Key?: string;
  key?: string;
  url?: string;
  publicUrl?: string;
  fileUrl?: string;
  downloadUrl?: string;
  bucket?: string;
  noteId?: string;
  fileName?: string;
  pdfFileName?: string;
  filename?: string;
  mimeType?: string;
  mime_type?: string;
  fileType?: "pdf" | "image" | string;
  title?: string;
  storageProvider?: string;
  studentId?: string;
  subject?: string;
  onProgress?: (percent: number | null, statusText: string) => void;
}

export interface OpenPdfResult {
  success: boolean;
  message?: string;
  signedUrl?: string;
  isNative?: boolean;
  blob?: Blob;
  objectUrl?: string;
  cached?: boolean;
}

/**
 * Checks if running in a native Capacitor mobile environment (Android or iOS).
 */
export function isNativePlatform(): boolean {
  if (typeof Capacitor !== "undefined") {
    if (typeof Capacitor.isNativePlatform === "function" && Capacitor.isNativePlatform()) {
      return true;
    }
    const platform = typeof Capacitor.getPlatform === "function" ? Capacitor.getPlatform() : "";
    if (platform === "android" || platform === "ios") {
      return true;
    }
  }
  return false;
}

/**
 * Detects current runtime platform and browser details for diagnostic logging.
 */
export function getRuntimePlatformDetails() {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isAndroid = /android/i.test(ua);
  const isIOS =
    /iphone|ipad|ipod/i.test(ua) ||
    (typeof navigator !== "undefined" && navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1);
  const isDesktop = !isAndroid && !isIOS;
  const isPWA =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as any).standalone === true ||
      document.referrer.includes("android-app://"));
  const isNative = isNativePlatform();

  let browser = "Unknown";
  if (/firefox|fxios/i.test(ua)) browser = "Firefox";
  else if (/edg/i.test(ua)) browser = "Edge";
  else if (/chrome|crios/i.test(ua)) browser = "Chrome";
  else if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) browser = "Safari";

  return {
    platform: isNative ? "Capacitor Native" : isPWA ? "PWA Standalone" : "Web Browser",
    browser,
    userAgent: ua,
    isAndroid,
    isIOS,
    isDesktop,
    isPWA,
    isNative,
  };
}

/**
 * Determines whether a given note or file is an image based on fileType, mimeType, or filename extension.
 */
export function isImageFile(fileName?: string, url?: string, mimeType?: string, fileType?: string): boolean {
  if (fileType === "image") return true;
  if (mimeType && mimeType.toLowerCase().startsWith("image/")) return true;
  const str = (fileName || url || "").toLowerCase();
  return /\.(png|jpg|jpeg|webp|gif|bmp|svg|heic|heif)(\?.*)?$/i.test(str);
}

/**
 * Resolves standard MIME type based on file extension or provided MIME type.
 */
export function getMimeType(fileNameOrUrl: string, mimeType?: string, isImg?: boolean): string {
  return getNoteMimeType(fileNameOrUrl, mimeType, isImg ? "image" : undefined);
}

export interface DocumentVerificationResult {
  valid: boolean;
  reason?: string;
  isCloudflare?: boolean;
}

/**
 * Strictly verifies that a downloaded binary blob is a genuine document (PDF or image)
 * and NOT a Cloudflare challenge page, HTML error page, empty body, or security check.
 */
export async function verifyDocumentBlob(
  blob: Blob,
  expectedType?: string,
  fileName?: string,
  contentTypeHeader?: string | null
): Promise<DocumentVerificationResult> {
  if (!blob || blob.size <= 0) {
    return { valid: false, reason: "File is empty (0 bytes)" };
  }

  // A genuine document/image payload is at least 32 bytes
  if (blob.size < 32) {
    return { valid: false, reason: "File size is too small to be a valid document" };
  }

  // Inspect the header bytes for HTML / Cloudflare challenge markers
  const headerSlice = blob.slice(0, 2048);
  const headerText = await headerSlice.text();
  const lowerText = headerText.toLowerCase();

  // Cloudflare Challenge / HTML verification check
  const isHtml =
    lowerText.includes("<!doctype html") ||
    lowerText.includes("<html") ||
    lowerText.includes("<head") ||
    lowerText.includes("<title>") ||
    lowerText.includes("<script") ||
    lowerText.includes("challenge-platform") ||
    lowerText.includes("cf-browser-verification") ||
    lowerText.includes("cf-chl-") ||
    lowerText.includes("__cf_chl_") ||
    lowerText.includes("cf-turnstile") ||
    lowerText.includes("just a moment...") ||
    lowerText.includes("attention required! | cloudflare") ||
    lowerText.includes("cloudflare ray id") ||
    lowerText.includes("enable javascript and cookies to continue") ||
    lowerText.includes("access denied") ||
    lowerText.includes("error 403") ||
    lowerText.includes("error 404") ||
    lowerText.includes("error 500") ||
    lowerText.includes("403 forbidden") ||
    lowerText.includes("404 not found") ||
    (lowerText.startsWith("<?xml") && lowerText.includes("<error>"));

  if (isHtml) {
    const isCloudflare =
      lowerText.includes("cloudflare") ||
      lowerText.includes("challenge") ||
      lowerText.includes("cf-") ||
      lowerText.includes("just a moment");
    return {
      valid: false,
      isCloudflare,
      reason: isCloudflare
        ? "Cloudflare verification challenge detected"
        : "HTML or error response returned instead of document",
    };
  }

  // Validate Content-Type header if present
  if (contentTypeHeader) {
    const ct = contentTypeHeader.toLowerCase();
    if (ct.includes("text/html") || ct.includes("application/xhtml+xml")) {
      return { valid: false, reason: `Unsupported content-type: ${contentTypeHeader}` };
    }
  }

  const isImg = isImageFile(fileName, undefined, blob.type, expectedType);

  if (isImg) {
    const buffer = await headerSlice.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isGif = headerText.startsWith("GIF87a") || headerText.startsWith("GIF89a");
    const isWebp = headerText.startsWith("RIFF") && headerText.includes("WEBP");
    const isSvg = headerText.includes("<svg");
    const isBmp = bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d;

    if (isJpeg || isPng || isGif || isWebp || isSvg || isBmp) {
      return { valid: true };
    }
  }

  // Check PDF signature (%PDF-)
  if (headerText.includes("%PDF-") || headerText.startsWith("%PDF")) {
    return { valid: true };
  }

  if (blob.type.includes("pdf") && (headerText.includes("%PDF") || blob.size > 100)) {
    return { valid: true };
  }

  // Check for non-HTML binary data
  const buffer = await headerSlice.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let nonAscii = 0;
  for (let i = 0; i < Math.min(bytes.length, 64); i++) {
    if (bytes[i] === 0 || bytes[i] > 127) nonAscii++;
  }
  if (nonAscii > 2 && !headerText.startsWith("<")) {
    return { valid: true };
  }

  return { valid: false, reason: "Document signature verification failed" };
}

/**
 * Fetches and strictly verifies note binary data with intelligent IndexedDB cache
 * and AbortSignal support.
 */
export async function fetchNoteBlobWithCache(
  options: OpenPdfOptions,
  signal?: AbortSignal,
  onProgress?: (percent: number) => void
): Promise<{ blob: Blob; mimeType: string; fileName: string; objectUrl: string; cached: boolean }> {
  const storageKey =
    options.storageKey ||
    options.storagePath ||
    options.r2Key ||
    options.key ||
    options.url ||
    "";
  const fileName = options.fileName || options.pdfFileName || options.filename || "note.pdf";
  const mimeType = getNoteMimeType(fileName, options.mimeType, options.fileType);

  // 1. Check offline / IndexedDB cache first
  const cached = await notesCacheService.getCachedBlob(storageKey);
  if (cached && cached.blob && cached.blob.size > 0) {
    const check = await verifyDocumentBlob(cached.blob, options.fileType, fileName, cached.mimeType);
    if (check.valid) {
      notesLogger.info("VERIFICATION_PASSED", { storageKey, fileName, fileSize: cached.blob.size, cached: true });
      notesLogger.info("DOWNLOAD_CACHED", { storageKey, fileName });
      if (onProgress) onProgress(100);
      const objectUrl = URL.createObjectURL(cached.blob);
      return {
        blob: cached.blob,
        mimeType: cached.mimeType || mimeType,
        fileName: cached.fileName || fileName,
        objectUrl,
        cached: true,
      };
    } else {
      // Invalidate corrupted/invalid cache
      await notesCacheService.invalidateBlobCache(storageKey);
    }
  }

  // 2. If offline and not in cache, throw helpful offline error
  if (!notesCacheService.getOnlineStatus() || (typeof navigator !== "undefined" && !navigator.onLine)) {
    throw new Error("This note is not available offline. Connect to the internet to download it.");
  }

  notesLogger.info("DOWNLOAD_START", { storageKey, fileName });

  // 3. Resolve direct URL to download
  let targetUrl = "";
  try {
    targetUrl = await resolveDirectNoteUrl(options);
  } catch {
    // Fallback to streaming download proxy if direct signed URL fails
    targetUrl = `/api/r2/download?key=${encodeURIComponent(storageKey.replace(/^\/+/, ""))}`;
  }

  // 4. Stream response with real progress and abort support
  const response = await fetch(targetUrl, { signal });
  if (!response.ok || response.status !== 200) {
    notesLogger.error("DOWNLOAD_ERROR", { storageKey, fileName, status: response.status });
    if (response.status === 404) {
      throw new Error("File not found in cloud storage.");
    }
    throw new Error(`Failed to load note (Server returned status ${response.status}).`);
  }

  const contentTypeHeader = response.headers.get("content-type");
  const contentLength = Number(response.headers.get("content-length") || 0);
  let blob: Blob;

  if (response.body && contentLength > 0 && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        receivedBytes += value.length;
        if (onProgress) {
          const pct = Math.min(99, Math.round((receivedBytes / contentLength) * 100));
          onProgress(pct);
        }
      }
    }
    blob = new Blob(chunks, { type: mimeType });
  } else {
    blob = await response.blob();
  }

  // 5. Strict Document Verification Pipeline
  const verification = await verifyDocumentBlob(blob, options.fileType, fileName, contentTypeHeader);

  if (!verification.valid) {
    if (verification.isCloudflare) {
      notesLogger.warn("CLOUDFLARE_CHALLENGE_DETECTED", {
        storageKey,
        fileName,
        fileSize: blob.size,
        extra: { reason: verification.reason },
      });
    } else {
      notesLogger.warn("INVALID_CONTENT_DETECTED", {
        storageKey,
        fileName,
        fileSize: blob.size,
        extra: { reason: verification.reason },
      });
    }
    notesLogger.error("VERIFICATION_FAILED", {
      storageKey,
      fileName,
      error: verification.reason || "Verification failed",
    });
    throw new Error(verification.reason || "Verification failed");
  }

  notesLogger.info("VERIFICATION_PASSED", {
    storageKey,
    fileName,
    fileSize: blob.size,
    mimeType,
  });

  // 6. Store in local cache for instant future retrieval & offline access
  await notesCacheService.setCachedBlob({
    key: storageKey,
    blob,
    mimeType,
    fileName,
  });

  const objectUrl = URL.createObjectURL(blob);

  notesLogger.info("DOWNLOAD_SUCCESS", {
    storageKey,
    fileName,
    fileSize: blob.size,
  });

  if (onProgress) onProgress(100);

  return {
    blob,
    mimeType,
    fileName,
    objectUrl,
    cached: false,
  };
}

/**
 * Background preloads adjacent topic notes into cache to achieve near-instant opening
 */
export function preloadAdjacentNotes(notes: ClassNote[], currentIndex: number): void {
  if (!Array.isArray(notes) || notes.length <= 1 || currentIndex < 0) return;

  const adjacentIndices = [currentIndex + 1, currentIndex - 1].filter(
    (idx) => idx >= 0 && idx < notes.length
  );

  for (const idx of adjacentIndices) {
    const note = notes[idx];
    const storageKey = note.storagePath || note.r2Key || (note as any).storageKey;
    if (!storageKey) continue;

    // Check if already in cache
    notesCacheService.getCachedBlob(storageKey).then((cached) => {
      if (!cached && notesCacheService.getOnlineStatus()) {
        // Preload in background without blocking
        const fileName = note.fileName || (note as any).originalFilename || "note.pdf";
        resolveDirectNoteUrl({
          storageKey,
          fileName,
          fileType: (note as any).fileType,
          mimeType: (note as any).mimeType,
        })
          .then((url) => fetch(url))
          .then((res) => (res.ok ? res.blob() : null))
          .then((blob) => {
            if (blob) {
              notesCacheService.setCachedBlob({
                key: storageKey,
                blob,
                mimeType: (note as any).mimeType || getMimeType(fileName),
                fileName,
              });
            }
          })
          .catch(() => {});
      }
    });
  }
}

/**
 * Directly opens a note using device-native browser or viewer in a single O(1) pass.
 */
export async function openPdfWithNativeViewer(options: OpenPdfOptions): Promise<OpenPdfResult> {
  try {
    const directUrl = await openNote(options);
    return {
      success: true,
      signedUrl: directUrl,
      isNative: isNativePlatform(),
    };
  } catch (err: any) {
    console.error("[nativePdfService] Failed opening note:", err);
    throw err;
  }
}

/**
 * Top-level unified function for Admin Console and Student Console.
 */
export async function openNoteInNativeViewer(
  options: OpenPdfOptions & { studentId?: string; subject?: string }
): Promise<OpenPdfResult> {
  return await openPdfWithNativeViewer(options);
}

/**
 * Saves and opens a client-side generated PDF blob on native browser.
 */
export async function saveAndOpenGeneratedPdf(pdfBlob: Blob, fileName: string): Promise<void> {
  const objectUrl = URL.createObjectURL(pdfBlob);
  const win = window.open(objectUrl, "_blank", "noopener,noreferrer");
  if (!win || win.closed || typeof win.closed === "undefined") {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

/**
 * Invalidates cache helper.
 */
export async function invalidateNoteCache(rawPathOrUrl: string, noteId?: string, isImg?: boolean): Promise<void> {
  await notesCacheService.invalidateBlobCache(rawPathOrUrl);
  if (noteId) {
    await notesCacheService.invalidateBlobCache(noteId);
  }
}
