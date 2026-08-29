import { sanitizeCanonicalStorageKey, buildCanonicalFilename, inferMimeFromExtension, extractCleanExtension } from "../utils/canonicalFilename";

/**
 * Cloudflare R2 Client (Browser & Isomorphic)
 * 
 * Provides unified, production-ready Cloudflare R2 storage interactions
 * with automatic fallback, progress tracking, and robust error handling.
 */

export interface R2ClientConfig {
  bucket: string;
  publicUrl?: string;
}

export interface R2UploadResult {
  bucket: string;
  key: string;
  url: string;
  size: number;
  mimeType: string;
  etag?: string;
}

export interface R2ObjectInfo {
  key: string;
  size: number;
  lastModified?: string;
  etag?: string;
}

function getRuntimeEnv(key: string, fallback: string = ""): string {
  try {
    if (typeof import.meta !== "undefined" && (import.meta as any).env) {
      const val = (import.meta as any).env[key];
      if (typeof val === "string" && val.length > 0) return val;
    }
  } catch {
    // Ignore runtime env lookup issues
  }
  try {
    if (typeof process !== "undefined" && process.env) {
      const val = process.env[key];
      if (typeof val === "string" && val.length > 0) return val;
    }
  } catch {
    // Ignore process.env lookup issues
  }
  return fallback;
}

/**
 * Returns the default configured Cloudflare R2 bucket name.
 */
export function getR2BucketName(customBucket?: string): string {
  if (customBucket && typeof customBucket === "string" && customBucket.trim().length > 0) {
    const clean = customBucket.trim().replace(/^\/+|\/+$/g, "");
    if (clean.length > 0 && !clean.includes("firebasestorage.app")) {
      return clean;
    }
  }
  const envBucket =
    getRuntimeEnv("R2_BUCKET") ||
    getRuntimeEnv("VITE_R2_BUCKET") ||
    "academy-connect-files";

  return envBucket.trim().replace(/^\/+|\/+$/g, "");
}

/**
 * Generates a public URL for an R2 object if a public URL/domain is configured.
 * Never returns serverless proxy endpoints.
 */
export function getR2PublicUrl(bucket: string, key: string): string {
  const cleanKey = key.replace(/^\/+/, "");
  const customDomain =
    getRuntimeEnv("R2_PUBLIC_URL") ||
    getRuntimeEnv("VITE_R2_PUBLIC_URL") ||
    getRuntimeEnv("R2_CUSTOM_DOMAIN") ||
    getRuntimeEnv("VITE_R2_CUSTOM_DOMAIN");

  if (customDomain && customDomain.trim().length > 0) {
    const base = customDomain.trim().replace(/\/+$/, "");
    return `${base}/${cleanKey}`;
  }

  return "";
}

export interface R2SignedUrlDetails {
  signedUrl: string;
  exists: boolean;
  status: number;
  contentType?: string;
  contentLength?: number;
  bucket: string;
  key: string;
  error?: string;
}

/**
 * Request a pre-signed URL from the backend server for uploading or downloading with full metadata.
 */
export async function getR2SignedUrlDetails(params: {
  bucket?: string;
  key: string;
  expiresIn?: number;
  operation?: "getObject" | "putObject";
  contentType?: string;
}): Promise<R2SignedUrlDetails> {
  const bucket = getR2BucketName(params.bucket);
  const cleanKey = params.key.replace(/^\/+/, "");
  const baseUrl = getApiBaseUrl();

  try {
    const response = await fetch(`${baseUrl}/api/storage?action=signed-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket,
        key: cleanKey,
        expiresIn: params.expiresIn || 3600,
        operation: params.operation || "getObject",
        contentType: params.contentType,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.signedUrl) {
        return {
          signedUrl: data.signedUrl,
          exists: data.exists !== undefined ? Boolean(data.exists) : true,
          status: data.status || 200,
          contentType: data.contentType,
          contentLength: data.contentLength,
          bucket: data.bucket || bucket,
          key: data.key || cleanKey,
        };
      }
    } else {
      let errText = `HTTP ${response.status}`;
      try {
        const errJson = await response.json();
        errText = errJson.error || errJson.message || errText;
      } catch {}

      if (response.status === 404) {
        console.info(`[R2Client] Note not found in storage (404): key="${cleanKey}"`);
        return {
          signedUrl: "",
          exists: false,
          status: 404,
          bucket,
          key: cleanKey,
          error: errText,
        };
      }

      console.warn(`[R2Client] /api/storage?action=signed-url returned status ${response.status} (${errText}), using download endpoint fallback.`);
      const proxyUrl = `/api/storage?action=download&bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(cleanKey)}`;
      return {
        signedUrl: proxyUrl,
        exists: true,
        status: response.status,
        bucket,
        key: cleanKey,
        error: errText,
      };
    }
  } catch (err: any) {
    console.warn("[R2Client] Failed to fetch presigned URL from /api/storage?action=signed-url:", err);
    const proxyUrl = `/api/storage?action=download&bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(cleanKey)}`;
    return {
      signedUrl: proxyUrl,
      exists: true,
      status: 200,
      bucket,
      key: cleanKey,
      error: err?.message || String(err),
    };
  }

  // Fallback to direct download proxy URL
  const fallbackUrl = `/api/storage?action=download&bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(cleanKey)}`;
  return {
    signedUrl: fallbackUrl,
    exists: true,
    status: 200,
    bucket,
    key: cleanKey,
  };
}

/**
 * Request a pre-signed URL from the backend server for uploading or downloading.
 */
export async function getR2SignedUrl(params: {
  bucket?: string;
  key: string;
  expiresIn?: number;
  operation?: "getObject" | "putObject";
  contentType?: string;
}): Promise<string> {
  const details = await getR2SignedUrlDetails(params);
  return details.signedUrl;
}

function getApiBaseUrl(): string {
  if (typeof window !== "undefined" && window.location && window.location.origin) {
    return "";
  }
  return "http://localhost:3000";
}

/**
 * Uploads a file/blob to Cloudflare R2 with progress tracking via backend proxy or presigned PUT URL.
 */
export async function uploadToR2(params: {
  bucket?: string;
  key: string;
  file: File | Blob;
  mimeType?: string;
  onProgress?: (percent: number) => void;
}): Promise<R2UploadResult> {
  const bucket = getR2BucketName(params.bucket);
  const explicitMime = params.mimeType || (params.file as any).type;
  const canonicalExt = extractCleanExtension(params.key || (params.file as File)?.name, explicitMime);
  const mimeType = explicitMime || inferMimeFromExtension(canonicalExt);
  const cleanKey = sanitizeCanonicalStorageKey(params.key, mimeType);
  const cleanFilename = buildCanonicalFilename({
    fileName: (params.file as File)?.name || cleanKey.split("/").pop() || "note.pdf",
    mimeType,
  });
  const baseUrl = getApiBaseUrl();

  console.log(`[R2Client] Initiating upload to Cloudflare R2: bucket="${bucket}", key="${cleanKey}", size=${params.file.size}`);

  const errors: string[] = [];

  // Step 1: Upload via FormData multipart (Native browser streaming, handles any file format cleanly)
  try {
    const uploadApiUrl = `${baseUrl}/api/storage?action=upload&bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(cleanKey)}&mimeType=${encodeURIComponent(mimeType)}`;

    if (typeof FormData !== "undefined" && typeof XMLHttpRequest !== "undefined") {
      const formResult = await new Promise<R2UploadResult>((resolve, reject) => {
        try {
          const formData = new FormData();
          formData.append("file", params.file, cleanFilename);
          formData.append("bucket", bucket);
          formData.append("key", cleanKey);
          formData.append("mimeType", mimeType);

          const xhr = new XMLHttpRequest();
          xhr.open("POST", uploadApiUrl, true);

          if (xhr.upload && params.onProgress) {
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable && e.total > 0) {
                const pct = Math.min(99, Math.max(0, Math.round((e.loaded / e.total) * 100)));
                params.onProgress!(pct);
              }
            };
          }

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              if (params.onProgress) params.onProgress(100);
              try {
                const resData = JSON.parse(xhr.responseText || "{}");
                const finalUrl = resData.publicUrl || resData.url || getR2PublicUrl(bucket, cleanKey);
                resolve({
                  bucket,
                  key: cleanKey,
                  url: finalUrl,
                  size: params.file.size,
                  mimeType,
                  etag: resData.etag,
                });
              } catch {
                resolve({
                  bucket,
                  key: cleanKey,
                  url: getR2PublicUrl(bucket, cleanKey),
                  size: params.file.size,
                  mimeType,
                });
              }
            } else {
              let errDetail = `HTTP ${xhr.status}`;
              try {
                const parsed = JSON.parse(xhr.responseText);
                errDetail = parsed.error || parsed.message || errDetail;
              } catch {}
              reject(new Error(`FormData Upload: ${errDetail}`));
            }
          };

          xhr.onerror = () => reject(new Error("FormData Upload: Network Error"));
          xhr.ontimeout = () => reject(new Error("FormData Upload: Timeout"));
          xhr.send(formData);
        } catch (err: any) {
          reject(new Error(`FormData Upload Exception: ${err?.message || err}`));
        }
      });

      return formResult;
    }
  } catch (formDataError: any) {
    console.warn("[R2Client] FormData upload attempt encountered an issue:", formDataError);
    errors.push(formDataError?.message || String(formDataError));
  }

  // Step 2: Upload directly via binary body / stream (Fetch or XHR)
  try {
    const uploadApiUrl = `${baseUrl}/api/storage?action=upload&bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(cleanKey)}&mimeType=${encodeURIComponent(mimeType)}`;

    if (typeof XMLHttpRequest !== "undefined") {
      const proxyResult = await new Promise<R2UploadResult>((resolve, reject) => {
        try {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", uploadApiUrl, true);
          xhr.setRequestHeader("Content-Type", mimeType);

          if (xhr.upload && params.onProgress) {
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable && e.total > 0) {
                const pct = Math.min(99, Math.max(0, Math.round((e.loaded / e.total) * 100)));
                params.onProgress!(pct);
              }
            };
          }

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              if (params.onProgress) params.onProgress(100);
              try {
                const resData = JSON.parse(xhr.responseText || "{}");
                const finalUrl = resData.publicUrl || resData.url || getR2PublicUrl(bucket, cleanKey);
                resolve({
                  bucket,
                  key: cleanKey,
                  url: finalUrl,
                  size: params.file.size,
                  mimeType,
                  etag: resData.etag,
                });
              } catch {
                resolve({
                  bucket,
                  key: cleanKey,
                  url: getR2PublicUrl(bucket, cleanKey),
                  size: params.file.size,
                  mimeType,
                });
              }
            } else {
              let errDetail = `HTTP ${xhr.status}`;
              try {
                const parsed = JSON.parse(xhr.responseText);
                errDetail = parsed.error || parsed.message || errDetail;
              } catch {
                // Keep default
              }
              reject(new Error(`Binary Stream Upload: ${errDetail}`));
            }
          };

          xhr.onerror = () => reject(new Error("Binary Stream Upload: Network Error"));
          xhr.ontimeout = () => reject(new Error("Binary Stream Upload: Timeout"));
          xhr.send(params.file);
        } catch (err: any) {
          reject(new Error(`Binary Stream Exception: ${err?.message || err}`));
        }
      });

      return proxyResult;
    } else {
      // Direct binary body upload via fetch
      const res = await fetch(uploadApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": mimeType,
          "Content-Length": params.file.size.toString(),
        },
        body: params.file,
      });

      if (res.ok) {
        if (params.onProgress) params.onProgress(100);
        const resData = await res.json();
        return {
          bucket,
          key: cleanKey,
          url: resData.publicUrl || resData.url || getR2PublicUrl(bucket, cleanKey),
          size: params.file.size,
          mimeType,
          etag: resData.etag,
        };
      } else {
        const text = await res.text();
        errors.push(`Binary Stream HTTP ${res.status}: ${text}`);
      }
    }
  } catch (proxyError: any) {
    console.warn("[R2Client] Binary stream upload attempt encountered an issue:", proxyError);
    errors.push(proxyError?.message || String(proxyError));
  }

  // Step 3: Presigned URL Fallback
  let presignedPutUrl: string | null = null;
  try {
    const presignRes = await fetch(`${baseUrl}/api/storage?action=signed-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket,
        key: cleanKey,
        operation: "putObject",
        contentType: mimeType,
        expiresIn: 3600,
      }),
    });

    if (presignRes.ok) {
      const json = await presignRes.json();
      if (json.signedUrl && !json.signedUrl.startsWith("/api/")) {
        presignedPutUrl = json.signedUrl;
      }
    }
  } catch (err: any) {
    console.warn("[R2Client] Presigned PUT URL negotiation error:", err);
    errors.push(`Presigned Negotiation: ${err?.message || err}`);
  }

  if (presignedPutUrl) {
    const directSuccess = await new Promise<boolean>((resolve) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", presignedPutUrl!, true);
        xhr.setRequestHeader("Content-Type", mimeType);

        if (xhr.upload && params.onProgress) {
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && e.total > 0) {
              const pct = Math.min(99, Math.max(0, Math.round((e.loaded / e.total) * 100)));
              params.onProgress!(pct);
            }
          };
        }

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            if (params.onProgress) params.onProgress(100);
            resolve(true);
          } else {
            console.warn(`[R2Client] Direct PUT failed with HTTP ${xhr.status}`);
            resolve(false);
          }
        };
        xhr.onerror = () => resolve(false);
        xhr.ontimeout = () => resolve(false);
        xhr.send(params.file);
      } catch {
        resolve(false);
      }
    });

    if (directSuccess) {
      const resolvedUrl = getR2PublicUrl(bucket, cleanKey);
      return {
        bucket,
        key: cleanKey,
        url: resolvedUrl,
        size: params.file.size,
        mimeType,
      };
    }
  }

  const detailedError = errors.length > 0 ? errors.join(" | ") : "Network or server connection failed.";
  throw new Error(`Cloudflare R2 Upload Failed: ${detailedError}`);
}

/**
 * Downloads a file/blob from Cloudflare R2.
 */
export async function downloadFromR2(params: {
  bucket?: string;
  key: string;
}): Promise<{ blob: Blob; mimeType: string }> {
  const bucket = getR2BucketName(params.bucket);
  const cleanKey = params.key.replace(/^\/+/, "");

  // 1. Same-Origin /api/storage?action=download proxy endpoint (fast streaming, 0 CORS issues)
  const baseUrl = getApiBaseUrl();
  const proxyUrl = `${baseUrl}/api/storage?action=download&bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(cleanKey)}`;
  try {
    const proxyRes = await fetch(proxyUrl);
    if (proxyRes.ok) {
      const blob = await proxyRes.blob();
      if (blob && blob.size > 0) {
        return {
          blob,
          mimeType: proxyRes.headers.get("content-type") || "application/octet-stream",
        };
      }
    } else if (proxyRes.status === 404) {
      throw new Error(`File not found in Cloudflare R2 (key: "${cleanKey}")`);
    }
  } catch (proxyErr: any) {
    if (proxyErr?.message?.includes("File not found")) {
      throw proxyErr;
    }
    console.warn("[R2Client] Proxy download notice, attempting alternative URL:", proxyErr?.message || proxyErr);
  }

  // 2. Fallback to signed URL or public URL
  const viewUrl = await getR2SignedUrl({ bucket, key: cleanKey, expiresIn: 3600 });
  const res = await fetch(viewUrl);
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`File not found in Cloudflare R2 (key: "${cleanKey}")`);
    }
    throw new Error(`Cloudflare R2 download failed with status HTTP ${res.status}`);
  }

  const blob = await res.blob();
  return {
    blob,
    mimeType: res.headers.get("content-type") || "application/octet-stream",
  };
}

/**
 * Deletes an object from Cloudflare R2 bucket.
 */
export async function deleteFromR2(params: {
  bucket?: string;
  key: string;
}): Promise<{ success: boolean; bucket: string; key: string }> {
  const bucket = getR2BucketName(params.bucket);
  const cleanKey = params.key.replace(/^\/+/, "");
  const baseUrl = getApiBaseUrl();
  const endpoint = `${baseUrl}/api/storage?action=delete`;
  const payload = { bucket, key: cleanKey };

  console.log(`[R2Client] Deleting note:`);
  console.log(`  - Cloudflare object key: ${cleanKey}`);
  console.log(`  - API endpoint: ${endpoint}`);
  console.log(`  - Request body:`, payload);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errMessage = `HTTP ${response.status}`;
    try {
      const parsed = await response.json();
      errMessage = parsed.error || parsed.details || errMessage;
    } catch {
      // ignore
    }
    console.error(`[R2Client] Cloudflare R2 deletion failed (${response.status}): ${errMessage}`);
    throw new Error(`Cloudflare R2 deletion failed: ${errMessage}`);
  }

  const result = await response.json().catch(() => ({ success: true }));
  console.log(`[R2Client] Deletion confirmed from storage for key: "${cleanKey}"`);
  return { success: true, bucket, key: cleanKey, ...result };
}

/**
 * Deletes multiple objects from Cloudflare R2 bucket.
 */
export async function deleteMultipleFromR2(params: {
  bucket?: string;
  keys: string[];
}): Promise<{ success: boolean; deleted: string[] }> {
  const bucket = getR2BucketName(params.bucket);
  const cleanKeys = params.keys.map((k) => k.replace(/^\/+/, "")).filter(Boolean);
  const baseUrl = getApiBaseUrl();
  const endpoint = `${baseUrl}/api/storage?action=delete-multiple`;
  const payload = { bucket, keys: cleanKeys };

  if (cleanKeys.length === 0) {
    return { success: true, deleted: [] };
  }

  console.log(`[R2Client] Batch deleting ${cleanKeys.length} objects from storage:`);
  console.log(`  - API endpoint: ${endpoint}`);
  console.log(`  - Request body:`, payload);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errMessage = `HTTP ${response.status}`;
    try {
      const parsed = await response.json();
      errMessage = parsed.error || parsed.details || errMessage;
    } catch {
      // ignore
    }
    throw new Error(`Cloudflare R2 multiple deletion failed: ${errMessage}`);
  }

  const data = await response.json();
  return { success: true, deleted: data.deleted || cleanKeys };
}

/**
 * Checks metadata / existence of an object in Cloudflare R2 bucket or server storage.
 */
export async function verifyR2ObjectExists(params: {
  bucket?: string;
  key: string;
}): Promise<{
  exists: boolean;
  bucket: string;
  key: string;
  size?: number;
  mimeType?: string;
}> {
  const bucket = getR2BucketName(params.bucket);
  const cleanKey = params.key.replace(/^\/+/, "");
  const baseUrl = getApiBaseUrl();

  try {
    const res = await fetch(
      `${baseUrl}/api/storage?action=exists&bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(cleanKey)}`
    );
    if (res.ok) {
      const data = await res.json();
      return {
        exists: Boolean(data.exists),
        bucket: data.bucket || bucket,
        key: data.key || cleanKey,
        size: data.contentLength,
        mimeType: data.contentType,
      };
    }
  } catch (err) {
    console.warn("[R2Client] verifyR2ObjectExists probe failed:", err);
  }

  return { exists: false, bucket, key: cleanKey };
}

/**
 * Lists objects in Cloudflare R2 bucket matching a prefix.
 */
export async function listFromR2(params: {
  bucket?: string;
  prefix?: string;
  limit?: number;
}): Promise<R2ObjectInfo[]> {
  const bucket = getR2BucketName(params.bucket);
  const cleanPrefix = (params.prefix || "").replace(/^\/+/, "");
  const baseUrl = getApiBaseUrl();

  const response = await fetch(`${baseUrl}/api/storage?action=list`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket,
      prefix: cleanPrefix,
      limit: params.limit || 1000,
    }),
  });

  if (!response.ok) {
    throw new Error(`Cloudflare R2 list failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.objects || [];
}
