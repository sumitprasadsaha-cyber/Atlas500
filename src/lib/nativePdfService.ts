/**
 * Atlas v5.0.8 — High-Performance Native File Loading & Offline Service
 * Intelligent binary caching, stream loading with AbortController, offline fallback,
 * and native viewer integration.
 */

import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import {
  openNote,
  resolveDirectNoteUrl,
  getNoteMimeType,
  getCanonicalNoteDownloadUrl,
  extractCanonicalStorageKey,
  NoteOpeningTarget,
} from "./noteOpener";
import { notesCacheService } from "./notesCacheService";
import { notesLogger } from "./notesLogger";
import { topicDownloadProgress } from "./topicDownloadProgress";
import { ClassNote } from "../types";

export { openNote, resolveDirectNoteUrl, getNoteMimeType, getCanonicalNoteDownloadUrl, extractCanonicalStorageKey };

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

let previousBlobUrl: string | null = null;

/**
 * Revokes any previously allocated object URL to prevent memory leaks and blob collisions.
 */
export function revokePreviousNoteBlob(): void {
  if (previousBlobUrl) {
    try {
      URL.revokeObjectURL(previousBlobUrl);
    } catch {}
    previousBlobUrl = null;
  }
}

/**
 * Fetches and strictly verifies note binary data fresh from the topic's unique URL.
 * Never reuses previous blobs, object URLs, responses, or cached variables.
 */
export async function fetchNoteBlobWithCache(
  options: OpenPdfOptions,
  signal?: AbortSignal,
  onProgress?: (percent: number) => void
): Promise<{ blob: Blob; mimeType: string; fileName: string; objectUrl: string; cached: boolean }> {
  const canonicalStoragePath = extractCanonicalStorageKey(options, options.bucket || "academy-connect-files");
  const fileName = options.fileName || options.pdfFileName || options.filename || "note.pdf";
  const mimeType = getNoteMimeType(fileName, options.mimeType, options.fileType);
  const bucket = options.bucket || "academy-connect-files";

  // 1. Revoke any previous Blob Object URL before opening a new note
  revokePreviousNoteBlob();

  // 2. Offline check
  if (!notesCacheService.getOnlineStatus() || (typeof navigator !== "undefined" && !navigator.onLine)) {
    throw new Error("This note is not available offline. Connect to the internet to download it.");
  }

  notesLogger.info("DOWNLOAD_START", { storageKey: canonicalStoragePath, fileName });

  // 3. Resolve single canonical proxy download URL
  const targetUrl = getCanonicalNoteDownloadUrl(options, bucket);

  // Trace 3: Log the URL generated by the client
  console.log("[Trace 3: Client Generated URL]", {
    generatedUrl: targetUrl,
    canonicalStoragePath,
    bucket,
    requestTarget: targetUrl,
    actualFetchRequestUrl: typeof window !== "undefined" ? `${window.location.origin}${targetUrl.startsWith("/") ? "" : "/"}${targetUrl}` : targetUrl,
    method: "GET",
  });

  console.log("[NoteDeliveryPipeline] Initiating note download:", {
    stage: "CANONICAL_PROXY_FETCH",
    topicId: options.noteId || canonicalStoragePath || "topic-note",
    topicName: options.title || fileName || "Topic Note",
    canonicalStoragePath,
    bucket,
    targetUrl,
  });

  // 4. Download selected topic's file fresh with real-time percentage progress
  const topicId = options.noteId || canonicalStoragePath || "topic-note";
  topicDownloadProgress.setProgress(topicId, null);
  if (options.noteId && canonicalStoragePath && options.noteId !== canonicalStoragePath) {
    topicDownloadProgress.setProgress(canonicalStoragePath, null);
  }
  if (onProgress) {
    onProgress(0);
  }

  let response: Response;
  try {
    response = await fetch(targetUrl, { signal, cache: "no-store" });
  } catch (netErr: any) {
    topicDownloadProgress.clearProgress(topicId);
    if (options.noteId && canonicalStoragePath) topicDownloadProgress.clearProgress(canonicalStoragePath);
    console.error("[NoteDeliveryPipeline] Network fetch failed:", {
      storagePath: canonicalStoragePath,
      targetUrl,
      error: netErr?.message || netErr,
    });
    throw new Error(`Unable to reach note server: ${netErr?.message || "Network connection failed"}.`);
  }

  if (!response.ok || (response.status !== 200 && response.status !== 206)) {
    topicDownloadProgress.clearProgress(topicId);
    if (options.noteId && canonicalStoragePath) topicDownloadProgress.clearProgress(canonicalStoragePath);

    const responseStatus = response.status;
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((val, key) => {
      responseHeaders[key] = val;
    });

    console.error("[NoteDeliveryPipeline] Server returned non-200 status:", {
      storagePath: canonicalStoragePath,
      targetUrl,
      bucket,
      status: responseStatus,
      statusText: response.statusText,
      headers: responseHeaders,
    });

    notesLogger.error("DOWNLOAD_ERROR", { storageKey: canonicalStoragePath, fileName, status: responseStatus });
    if (responseStatus === 404) {
      throw new Error(`Note not found: The file "${canonicalStoragePath}" was not found in storage.`);
    }
    throw new Error(`Failed to load note (Server returned status ${responseStatus}).`);
  }

  const contentTypeHeader = response.headers.get("content-type");
  const contentLengthHeader = response.headers.get("content-length");
  const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;

  let blob: Blob;

  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        receivedBytes += value.length;

        if (totalBytes > 0) {
          const pct = Math.min(99, Math.round((receivedBytes / totalBytes) * 100));
          topicDownloadProgress.setProgress(topicId, pct);
          if (options.noteId && canonicalStoragePath) topicDownloadProgress.setProgress(canonicalStoragePath, pct);
          if (onProgress) onProgress(pct);
        } else {
          topicDownloadProgress.setProgress(topicId, null);
          if (options.noteId && canonicalStoragePath) topicDownloadProgress.setProgress(canonicalStoragePath, null);
          if (onProgress) onProgress(null as any);
        }
      }
    }
    blob = new Blob(chunks, { type: mimeType });
  } else {
    const responseData = await response.arrayBuffer();
    blob = new Blob([responseData], { type: mimeType });
  }

  console.log("Blob Size:", blob.size);
  console.log("Blob Type:", blob.type);

  // 5. Strict Document Verification Pipeline
  const verification = await verifyDocumentBlob(blob, options.fileType, fileName, contentTypeHeader);

  if (!verification.valid) {
    topicDownloadProgress.clearProgress(topicId);
    if (options.noteId && canonicalStoragePath) topicDownloadProgress.clearProgress(canonicalStoragePath);
    if (verification.isCloudflare) {
      notesLogger.warn("CLOUDFLARE_CHALLENGE_DETECTED", {
        storageKey: canonicalStoragePath,
        fileName,
        fileSize: blob.size,
        extra: { reason: verification.reason },
      });
    } else {
      notesLogger.warn("INVALID_CONTENT_DETECTED", {
        storageKey: canonicalStoragePath,
        fileName,
        fileSize: blob.size,
        extra: { reason: verification.reason },
      });
    }
    notesLogger.error("VERIFICATION_FAILED", {
      storageKey: canonicalStoragePath,
      fileName,
      error: verification.reason || "Verification failed",
    });
    throw new Error(verification.reason || "Verification failed");
  }

  notesLogger.info("VERIFICATION_PASSED", {
    storageKey: canonicalStoragePath,
    fileName,
    fileSize: blob.size,
    mimeType,
  });

  // Set progress to 100% immediately before creating object URL and opening
  topicDownloadProgress.setProgress(topicId, 100);
  if (options.noteId && canonicalStoragePath) topicDownloadProgress.setProgress(canonicalStoragePath, 100);
  if (onProgress) onProgress(100);

  // 6. Create fresh object URL
  const objectUrl = URL.createObjectURL(blob);
  previousBlobUrl = objectUrl;

  notesLogger.info("DOWNLOAD_SUCCESS", {
    storageKey: canonicalStoragePath,
    fileName,
    fileSize: blob.size,
  });

  // Clear download progress so the progress bar hides cleanly as the note opens
  setTimeout(() => {
    topicDownloadProgress.clearProgress(topicId);
    if (options.noteId && canonicalStoragePath) topicDownloadProgress.clearProgress(canonicalStoragePath);
  }, 400);

  return {
    blob,
    mimeType,
    fileName,
    objectUrl,
    cached: false,
  };
}

/**
 * Background preloads adjacent topic notes (safe no-op to ensure zero stale blob cross-contamination).
 */
export function preloadAdjacentNotes(_notes: ClassNote[], _currentIndex: number): void {
  // Safe no-op to strictly preserve topic isolation and fresh downloads
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
