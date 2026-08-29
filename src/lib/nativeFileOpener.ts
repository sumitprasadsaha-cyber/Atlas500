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
 * Opens a remote or local document directly in the device's native viewer application.
 *
 * MIME Type routing:
 * - application/pdf -> Device Native PDF Viewer (Google PDF Viewer, Adobe Acrobat, Apple QuickLook)
 * - image/* -> Native Image Viewer / Gallery
 * - other -> OS Default Application
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

      // 1. Fetch binary data
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download document (HTTP ${response.status})`);
      }
      const blob = await response.blob();
      const base64Data = await blobToBase64(blob);

      // 2. Clean filename
      const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_") || `document_${Date.now()}.${mimeType === "application/pdf" ? "pdf" : "dat"}`;

      // 3. Save to device temporary cache directory
      await Filesystem.writeFile({
        path: cleanName,
        data: base64Data,
        directory: Directory.Cache,
      });

      // 4. Retrieve native file URI
      const fileUriResult = await Filesystem.getUri({
        path: cleanName,
        directory: Directory.Cache,
      });

      // 5. Open via native OS intent
      await FileOpener.open({
        filePath: fileUriResult.uri,
        contentType: mimeType || "application/pdf",
      });

      console.log(`[NativeFileOpener] Successfully launched native viewer intent for ${cleanName}`);
      return true;
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
