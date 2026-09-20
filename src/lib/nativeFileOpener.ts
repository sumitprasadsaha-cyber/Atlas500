/**
 * Native Document & File Opener
 * Automatically opens documents and media files in the platform's native viewer
 * (PDF Reader, Gallery/Image Viewer, Office Viewer, or OS Default Application).
 */

import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { FileOpener } from "@capacitor-community/file-opener";
import { Filesystem, Directory } from "@capacitor/filesystem";

/**
 * Detects if the current environment is running inside a native mobile container (Capacitor Android/iOS).
 */
export function isCapacitorNative(): boolean {
  if (typeof Capacitor !== "undefined") {
    if (typeof Capacitor.isNativePlatform === "function" && Capacitor.isNativePlatform()) {
      return true;
    }
    const platform = typeof Capacitor.getPlatform === "function" ? Capacitor.getPlatform() : "";
    return platform === "android" || platform === "ios";
  }
  return false;
}

/**
 * Detects if running inside an installed Standalone PWA on iOS/iPadOS/Android/Desktop.
 */
export function isStandalonePWA(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true ||
    (typeof document !== "undefined" && document.referrer?.includes("android-app://"))
  );
}

/**
 * Detects if running on an Apple iPad (including modern iPadOS with MacIntel touch points).
 */
export function isIPad(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad/i.test(navigator.userAgent) || 
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * Converts a Blob to a base64 encoded string.
 */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = reader.result as string;
      const b64 = res.includes(",") ? res.split(",")[1] : res;
      resolve(b64);
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(blob);
  });
}

/**
 * Sanitizes a file name and ensures the extension matches the MIME type.
 */
export function sanitizeFileNameWithExtension(fileName: string, mimeType: string): string {
  let clean = (fileName || "").trim().replace(/[^a-zA-Z0-9._ -]/g, "_");
  if (!clean) {
    clean = "document";
  }
  const lower = clean.toLowerCase();
  if (mimeType.includes("pdf") && !lower.endsWith(".pdf")) {
    clean += ".pdf";
  } else if (mimeType.includes("png") && !lower.endsWith(".png")) {
    clean += ".png";
  } else if ((mimeType.includes("jpeg") || mimeType.includes("jpg")) && !lower.endsWith(".jpg") && !lower.endsWith(".jpeg")) {
    clean += ".jpg";
  } else if (mimeType.includes("webp") && !lower.endsWith(".webp")) {
    clean += ".webp";
  }
  return clean;
}

export interface LaunchNativeFileParams {
  blob: Blob;
  fileName: string;
  mimeType: string;
  objectUrl?: string;
  canonicalUrl?: string;
  targetWindow?: Window | null;
}

/**
 * Launches a downloaded or cached document directly into the device's native/browser default viewer.
 * 
 * Flow:
 * 1. Capacitor Native (Android/iOS): Uses FileOpener to trigger ACTION_VIEW Intent.
 * 2. Browser / iPad Safari / PWA: Seamlessly navigates pre-opened window, native window.open,
 *    or anchor fallback using canonical HTTPS same-origin route for full Safari & WebKit compatibility.
 */
export async function launchFileInNativeViewer(params: LaunchNativeFileParams): Promise<boolean> {
  const { blob, fileName, mimeType, canonicalUrl } = params;
  const cleanName = sanitizeFileNameWithExtension(fileName, mimeType);
  const objectUrl = params.objectUrl || URL.createObjectURL(blob);

  // Strategy 1: Capacitor Native Mobile (Android / iOS)
  // Launches Android Intent ACTION_VIEW or iOS QuickLook
  if (isCapacitorNative()) {
    try {
      const base64Data = await blobToBase64(blob);
      await Filesystem.writeFile({
        path: cleanName,
        data: base64Data,
        directory: Directory.Cache,
      });
      const fileUriResult = await Filesystem.getUri({
        path: cleanName,
        directory: Directory.Cache,
      });
      await FileOpener.open({
        filePath: fileUriResult.uri,
        contentType: mimeType,
      });
      console.log(`[NativeFileOpener] Launched native ACTION_VIEW via FileOpener for ${cleanName}`);
      return true;
    } catch (capErr: any) {
      console.warn("[NativeFileOpener] Capacitor FileOpener notice:", capErr?.message || capErr);
      try {
        await Browser.open({ url: objectUrl });
        return true;
      } catch (browserErr) {
        console.warn("[NativeFileOpener] Browser.open fallback failed:", browserErr);
      }
    }
  }

  // Determine preferred target URL for web browsers, iPad Safari, and PWA environments:
  // On Safari and iPadOS, blob URLs in new windows/tabs fail with WebKitBlobResource error or show blank.
  // The canonical backend route (/api/storage?action=download...) streams Content-Disposition: inline
  // and Content-Type: application/pdf, allowing iPad Safari and browsers to natively render the document.
  const viewUrl = canonicalUrl && canonicalUrl.trim().length > 0 ? canonicalUrl : objectUrl;

  // Strategy 2A: Synchronously Pre-opened Window Navigation
  // If targetWindow was opened during the user's initial click gesture, navigating it here
  // completely bypasses Safari and browser popup blockers that expire after asynchronous operations.
  if (params.targetWindow && !params.targetWindow.closed) {
    try {
      params.targetWindow.location.href = viewUrl;
      console.log(`[NativeFileOpener] Navigated pre-opened window to: ${viewUrl}`);
      return true;
    } catch (winNavErr) {
      console.warn("[NativeFileOpener] Failed to navigate pre-opened window, falling back:", winNavErr);
    }
  }

  // Strategy 2B: Direct Native Window Launch (without restrictive "noopener" feature which forces null returns)
  try {
    const win = window.open(viewUrl, "_blank");
    if (win) {
      try {
        win.opener = null;
      } catch {}
      console.log(`[NativeFileOpener] Launched file viewer via window.open: ${cleanName}`);
      return true;
    }
  } catch (winErr) {
    console.warn("[NativeFileOpener] window.open blocked/failed:", winErr);
  }

  // Strategy 3: Dynamic Anchor Click Fallback (Without download attribute to keep inline reading experience)
  try {
    const a = document.createElement("a");
    a.href = viewUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try {
        document.body.removeChild(a);
      } catch {}
    }, 1000);
    console.log(`[NativeFileOpener] Launched file viewer via anchor target=_blank: ${cleanName}`);
    return true;
  } catch (anchorErr) {
    console.error("[NativeFileOpener] Anchor fallback failed:", anchorErr);
  }

  // Strategy 4: Standalone PWA / iPad WebKit Navigation Fallback
  // If popups are completely suppressed in standalone iOS PWA mode, navigate the location directly
  if (isStandalonePWA() || isIPad()) {
    try {
      window.location.assign(viewUrl);
      console.log(`[NativeFileOpener] Invoked PWA/iPad location navigation for: ${cleanName}`);
      return true;
    } catch (assignErr) {
      console.error("[NativeFileOpener] Standalone PWA navigation fallback failed:", assignErr);
    }
  }

  return false;
}

/**
 * Legacy wrapper for backward compatibility with remote URLs.
 */
export async function openDocumentInNativeApp(params: {
  url: string;
  fileName: string;
  mimeType: string;
}): Promise<boolean> {
  const { url, fileName, mimeType } = params;

  if (isCapacitorNative()) {
    try {
      console.log(`[NativeFileOpener] Opening natively on mobile: fileName="${fileName}", mimeType="${mimeType}"`);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download document (HTTP ${response.status})`);
      }
      const blob = await response.blob();
      return await launchFileInNativeViewer({ blob, fileName, mimeType, objectUrl: url });
    } catch (err: any) {
      console.warn("[NativeFileOpener] FileOpener failed, falling back to in-app browser:", err?.message || err);
      try {
        await Browser.open({ url });
        return true;
      } catch (browserErr) {
        console.error("[NativeFileOpener] Browser fallback failed:", browserErr);
        return false;
      }
    }
  }

  return false;
}
