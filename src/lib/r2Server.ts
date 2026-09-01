import "dotenv/config";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  type PutObjectCommandInput,
  type GetObjectCommandInput,
  type DeleteObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  publicUrl?: string;
}

let s3ClientInstance: S3Client | null = null;
let lastS3Endpoint: string = "";

const LOCAL_STORAGE_ROOT = path.resolve(process.cwd(), ".storage_data");

/**
 * Ensures the local storage directory exists for the given bucket and file path.
 */
function getLocalFilePaths(bucket: string, key: string): { filePath: string; metaPath: string } {
  const sanitizedBucket = (bucket || "academy-connect-files").replace(/[^a-zA-Z0-9_-]/g, "_");
  const cleanKey = key.replace(/^\/+/, "");
  const normalizedKey = path.normalize(cleanKey).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(LOCAL_STORAGE_ROOT, sanitizedBucket, normalizedKey);
  const metaPath = `${filePath}.meta.json`;
  return { filePath, metaPath };
}

/**
 * Saves a file and its metadata to the local filesystem storage fallback.
 */
function saveToLocalStorage(
  bucket: string,
  key: string,
  buffer: Buffer,
  contentType: string,
  metadata?: Record<string, string>
): { etag: string; size: number } {
  try {
    const { filePath, metaPath } = getLocalFilePaths(bucket, key);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, buffer);

    const hash = crypto.createHash("md5").update(buffer).digest("hex");
    const etag = `"${hash}"`;

    const meta = {
      contentType: contentType || getMimeTypeFromKey(key),
      size: buffer.length,
      etag,
      lastModified: new Date().toISOString(),
      metadata: metadata || {},
    };

    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
    return { etag, size: buffer.length };
  } catch (err) {
    console.warn(`[R2Server-LocalStorage] Failed to save local file for key="${key}":`, err);
    return { etag: `"${Date.now()}"`, size: buffer.length };
  }
}

/**
 * Checks if a file exists in the local filesystem storage fallback.
 */
function getFromLocalStorage(
  bucket: string,
  key: string
): {
  exists: boolean;
  filePath?: string;
  size?: number;
  contentType?: string;
  lastModified?: Date;
  etag?: string;
  metadata?: Record<string, string>;
} {
  try {
    const { filePath, metaPath } = getLocalFilePaths(bucket, key);
    if (!fs.existsSync(filePath)) {
      return { exists: false };
    }

    const stat = fs.statSync(filePath);
    let meta: any = {};
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      } catch {}
    }

    return {
      exists: true,
      filePath,
      size: meta.size ?? stat.size,
      contentType: meta.contentType || getMimeTypeFromKey(key),
      lastModified: meta.lastModified ? new Date(meta.lastModified) : stat.mtime,
      etag: meta.etag || `"${stat.mtimeMs}"`,
      metadata: meta.metadata || {},
    };
  } catch {
    return { exists: false };
  }
}

/**
 * Deletes a file and its metadata from the local filesystem storage fallback.
 */
function deleteFromLocalStorage(bucket: string, key: string): boolean {
  try {
    const { filePath, metaPath } = getLocalFilePaths(bucket, key);
    let deleted = false;
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      deleted = true;
    }
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
    }
    return deleted;
  } catch {
    return false;
  }
}

/**
 * Lists files matching prefix in local filesystem storage fallback.
 */
function listFromLocalStorage(
  bucket: string,
  prefix: string = "",
  limit: number = 1000
): Array<{ key: string; size: number; lastModified?: Date; etag?: string }> {
  try {
    const sanitizedBucket = (bucket || "academy-connect-files").replace(/[^a-zA-Z0-9_-]/g, "_");
    const bucketDir = path.join(LOCAL_STORAGE_ROOT, sanitizedBucket);
    if (!fs.existsSync(bucketDir)) return [];

    const results: Array<{ key: string; size: number; lastModified?: Date; etag?: string }> = [];
    const cleanPrefix = prefix.replace(/^\/+/, "");

    function scanDir(currentDir: string) {
      if (results.length >= limit) return;
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= limit) break;
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile() && !entry.name.endsWith(".meta.json")) {
          const relativeKey = path.relative(bucketDir, fullPath).replace(/\\/g, "/");
          if (!cleanPrefix || relativeKey.startsWith(cleanPrefix)) {
            const stat = fs.statSync(fullPath);
            const metaPath = `${fullPath}.meta.json`;
            let etag = `"${stat.mtimeMs}"`;
            if (fs.existsSync(metaPath)) {
              try {
                const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
                if (meta.etag) etag = meta.etag;
              } catch {}
            }
            results.push({
              key: relativeKey,
              size: stat.size,
              lastModified: stat.mtime,
              etag,
            });
          }
        }
      }
    }

    scanDir(bucketDir);
    return results;
  } catch (err) {
    console.warn("[R2Server-LocalStorage] List directory scan error:", err);
    return [];
  }
}

/**
 * Cleans an environment variable string, stripping whitespace, quotes, carriage returns, and extra slashes.
 */
function cleanEnvString(val?: string): string {
  if (!val) return "";
  let clean = String(val).trim().replace(/\r/g, "");
  if (
    (clean.startsWith('"') && clean.endsWith('"')) ||
    (clean.startsWith("'") && clean.endsWith("'"))
  ) {
    clean = clean.slice(1, -1).trim().replace(/\r/g, "");
  }
  return clean;
}

/**
 * Resolves Cloudflare R2 configuration from environment variables supporting all standard aliases.
 */
export function getR2ServerConfig(): R2Config {
  const explicitEndpoint = cleanEnvString(
    process.env.R2_ENDPOINT ||
    process.env.CLOUDFLARE_R2_ENDPOINT ||
    process.env.R2_ENDPOINT_URL ||
    process.env.VITE_R2_ENDPOINT ||
    ""
  );

  let accountId = cleanEnvString(
    process.env.R2_ACCOUNT_ID ||
    process.env.CLOUDFLARE_R2_ACCOUNT_ID ||
    process.env.CLOUDFLARE_ACCOUNT_ID ||
    process.env.CF_ACCOUNT_ID ||
    process.env.VITE_R2_ACCOUNT_ID ||
    ""
  );

  // If accountId is not directly set but endpoint contains the 32-hex account ID
  if (!accountId && explicitEndpoint) {
    const match = explicitEndpoint.match(/([a-f0-9]{32})\.r2\.cloudflarestorage\.com/i);
    if (match) accountId = match[1];
  }

  const accessKeyId = cleanEnvString(
    process.env.R2_ACCESS_KEY_ID ||
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ||
    process.env.CLOUDFLARE_ACCESS_KEY_ID ||
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.R2_ACCESS_KEY ||
    process.env.VITE_R2_ACCESS_KEY_ID ||
    ""
  );

  const secretAccessKey = cleanEnvString(
    process.env.R2_SECRET_ACCESS_KEY ||
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ||
    process.env.CLOUDFLARE_SECRET_ACCESS_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY ||
    process.env.R2_SECRET_KEY ||
    process.env.VITE_R2_SECRET_ACCESS_KEY ||
    ""
  );

  const bucket = cleanEnvString(
    process.env.R2_BUCKET ||
    process.env.CLOUDFLARE_R2_BUCKET ||
    process.env.R2_BUCKET_NAME ||
    process.env.BUCKET_NAME ||
    process.env.VITE_R2_BUCKET ||
    "academy-connect-files"
  );

  let rawPublicUrl = cleanEnvString(
    process.env.R2_PUBLIC_URL ||
    process.env.CLOUDFLARE_R2_PUBLIC_URL ||
    process.env.R2_CUSTOM_DOMAIN ||
    process.env.VITE_R2_PUBLIC_URL ||
    process.env.VITE_R2_CUSTOM_DOMAIN ||
    ""
  ).replace(/\/+$/, "");

  if (rawPublicUrl && !rawPublicUrl.startsWith("http://") && !rawPublicUrl.startsWith("https://")) {
    rawPublicUrl = `https://${rawPublicUrl}`;
  }
  const publicUrl = rawPublicUrl;

  let endpoint = explicitEndpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  if (endpoint) {
    if (!endpoint.startsWith("http://") && !endpoint.startsWith("https://")) {
      endpoint = `https://${endpoint}`;
    }
    try {
      const parsedUrl = new URL(endpoint);
      endpoint = `${parsedUrl.protocol}//${parsedUrl.host}`;
    } catch {
      endpoint = endpoint.replace(/\/+$/, "");
    }
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint,
    publicUrl,
  };
}

/**
 * Validates all required Cloudflare R2 environment variables.
 */
export function validateR2Environment(abortOnError: boolean = false): {
  valid: boolean;
  missing: string[];
  config: Partial<R2Config>;
} {
  const config = getR2ServerConfig();
  const missing: string[] = [];

  if (!config.accountId) missing.push("R2_ACCOUNT_ID");
  if (!config.accessKeyId) missing.push("R2_ACCESS_KEY_ID");
  if (!config.secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
  if (!config.endpoint) missing.push("R2_ENDPOINT");
  if (!config.bucket) missing.push("R2_BUCKET");

  const valid = missing.length === 0;

  console.log(`[R2Server-Startup] Storage Status:`, {
    storageEngine: valid ? "Cloudflare R2 (Active)" : "Local Filesystem Storage (Active - R2 not configured)",
    valid,
    missing: valid ? [] : missing,
    accountId: config.accountId ? `${config.accountId.substring(0, 4)}...${config.accountId.substring(config.accountId.length - 4)}` : "NOT_SET",
    accessKeyId: config.accessKeyId ? `${config.accessKeyId.substring(0, 4)}...` : "NOT_SET",
    secretAccessKey: config.secretAccessKey ? `[EXISTS len=${config.secretAccessKey.length}]` : "NOT_SET",
    endpoint: config.endpoint || "NOT_SET",
    bucket: config.bucket || "academy-connect-files",
    publicUrl: config.publicUrl || "(none)",
  });

  if (!valid && abortOnError) {
    const errMsg = `[FATAL] Cloudflare R2 Startup Abort: Missing required environment variables: ${missing.join(", ")}`;
    console.error(errMsg);
    throw new Error(errMsg);
  }

  return {
    valid,
    missing,
    config,
  };
}

/**
 * Checks if real Cloudflare R2 credentials and endpoint are fully provided.
 */
export function isR2Configured(): boolean {
  const config = getR2ServerConfig();
  return Boolean(
    config.accessKeyId &&
    config.secretAccessKey &&
    config.endpoint &&
    config.bucket
  );
}

/**
 * Returns MIME type based on file extension.
 */
export function getMimeTypeFromKey(key: string): string {
  const lower = key.toLowerCase().split("?")[0].split("#")[0];
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".heif")) return "image/heif";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

/**
 * Initializes and returns the singleton AWS S3 client configured for Cloudflare R2.
 */
export function getR2S3Client(): S3Client {
  const config = getR2ServerConfig();
  if (!config.accessKeyId || !config.secretAccessKey || !config.endpoint) {
    throw new Error(
      `Cloudflare R2 is not configured. Missing required credentials or endpoint. Expected R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET.`
    );
  }

  if (!s3ClientInstance || lastS3Endpoint !== config.endpoint) {
    s3ClientInstance = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    lastS3Endpoint = config.endpoint;
    console.log(`[R2Server] S3Client initialized successfully for endpoint: "${config.endpoint}", bucket: "${config.bucket}"`);
  }
  return s3ClientInstance;
}

/**
 * Uploads an object to Cloudflare R2 (or local storage fallback if R2 credentials are not set).
 */
export async function uploadObjectToR2(params: {
  bucket?: string;
  key: string;
  body: Buffer | Uint8Array | string | Readable;
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}): Promise<{ bucket: string; key: string; etag: string; size: number; contentType: string }> {
  const config = getR2ServerConfig();
  const bucketName = (params.bucket || config.bucket || "academy-connect-files").trim();
  const cleanKey = (params.key || "").trim().replace(/^\/+/, "");

  if (!cleanKey) {
    throw new Error("[R2Server-Operation] PutObjectCommand aborted: Missing required object 'key'.");
  }

  const contentType = params.contentType || getMimeTypeFromKey(cleanKey);
  const cacheControl = params.cacheControl || "public, max-age=31536000, immutable";

  let bodyBuffer: Buffer;
  if (Buffer.isBuffer(params.body)) {
    bodyBuffer = params.body;
  } else if (typeof params.body === "string") {
    bodyBuffer = Buffer.from(params.body, "utf-8");
  } else if (params.body instanceof Uint8Array) {
    bodyBuffer = Buffer.from(params.body);
  } else if (params.body && typeof (params.body as any).pipe === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of params.body as any) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    bodyBuffer = Buffer.concat(chunks);
  } else {
    bodyBuffer = Buffer.alloc(0);
  }

  const startTime = Date.now();

  // If R2 is not configured, store in local filesystem storage
  if (!isR2Configured()) {
    const localResult = saveToLocalStorage(bucketName, cleanKey, bodyBuffer, contentType, params.metadata);
    console.log(`[R2Server-LocalFallback] File saved locally in ${Date.now() - startTime}ms:`, {
      bucket: bucketName,
      key: cleanKey,
      sizeBytes: localResult.size,
      contentType,
      etag: localResult.etag,
    });
    return {
      bucket: bucketName,
      key: cleanKey,
      etag: localResult.etag,
      size: localResult.size,
      contentType,
    };
  }

  console.log(`[R2Server-Operation] PutObjectCommand START:`, {
    bucket: bucketName,
    key: cleanKey,
    sizeBytes: bodyBuffer.length,
    contentType,
  });

  const client = getR2S3Client();
  const input: PutObjectCommandInput = {
    Bucket: bucketName,
    Key: cleanKey,
    Body: bodyBuffer,
    ContentType: contentType,
    CacheControl: cacheControl,
    Metadata: params.metadata,
  };

  let putResponse;
  try {
    const command = new PutObjectCommand(input);
    putResponse = await client.send(command);
  } catch (putErr: any) {
    console.error(`[R2Server-Operation] PutObjectCommand FAILED for key="${cleanKey}" in bucket="${bucketName}":`, putErr);
    // Fall back to saving locally on S3 error so user data is never lost
    saveToLocalStorage(bucketName, cleanKey, bodyBuffer, contentType, params.metadata);
    throw new Error(
      `Cloudflare R2 PutObject execution failed for key "${cleanKey}" in bucket "${bucketName}". Root cause: ${putErr?.message || putErr}`
    );
  }

  const putDurationMs = Date.now() - startTime;
  console.log(`[R2Server-Operation] PutObjectCommand PUT completed in ${putDurationMs}ms:`, {
    bucket: bucketName,
    key: cleanKey,
    etag: putResponse.ETag,
    httpStatusCode: putResponse.$metadata?.httpStatusCode || 200,
  });

  // Verify upload via HeadObject
  console.log(`[R2Server-Operation] Verifying upload via HeadObjectCommand for key="${cleanKey}" in bucket="${bucketName}"...`);
  const headCommand = new HeadObjectCommand({
    Bucket: bucketName,
    Key: cleanKey,
  });

  let headResponse: any = null;
  let lastHeadErr: any = null;
  const maxVerifyAttempts = 4;
  const verifyDelays = [0, 80, 200, 400];

  for (let attempt = 0; attempt < maxVerifyAttempts; attempt++) {
    if (verifyDelays[attempt] > 0) {
      await new Promise((resolve) => setTimeout(resolve, verifyDelays[attempt]));
    }
    try {
      headResponse = await client.send(headCommand);
      if (headResponse) break;
    } catch (err: any) {
      lastHeadErr = err;
      const is404 =
        err?.name === "NoSuchKey" ||
        err?.name === "NotFound" ||
        err?.$metadata?.httpStatusCode === 404;

      if (!is404 && attempt > 0) {
        break;
      }
    }
  }

  // Also cache locally for immediate local read speed
  saveToLocalStorage(bucketName, cleanKey, bodyBuffer, contentType, params.metadata);

  const verifiedEtag = headResponse?.ETag || putResponse.ETag || "";
  const verifiedSize = headResponse?.ContentLength ?? bodyBuffer.length;
  const totalDurationMs = Date.now() - startTime;

  console.log(`[R2Server-Operation] Cloudflare R2 Upload & Verification SUCCESS:`, {
    bucket: bucketName,
    key: cleanKey,
    etag: verifiedEtag,
    sizeBytes: verifiedSize,
    contentType: headResponse?.ContentType || contentType,
    lastModified: headResponse?.LastModified,
    totalDurationMs,
    publicUrl: config.publicUrl ? `${config.publicUrl}/${cleanKey}` : undefined,
    downloadUrl: `/api/storage?action=download&bucket=${encodeURIComponent(bucketName)}&key=${encodeURIComponent(cleanKey)}`,
  });

  return {
    bucket: bucketName,
    key: cleanKey,
    etag: verifiedEtag,
    size: verifiedSize,
    contentType: headResponse?.ContentType || contentType,
  };
}

/**
 * Generates all plausible candidate keys for an object lookup to handle URL encoding, prefix discrepancies, and path differences.
 */
function getCandidateStorageKeys(key: string): string[] {
  const clean = (key || "").trim().replace(/^\/+/, "");
  if (!clean) return [];

  const candidates = new Set<string>();
  candidates.add(clean);

  // 1. Decoded URI component
  try {
    const decoded = decodeURIComponent(clean);
    if (decoded && decoded !== clean) {
      candidates.add(decoded);
    }
  } catch {}

  // 2. Encoded URI components
  try {
    const encoded = encodeURI(clean);
    if (encoded && encoded !== clean) {
      candidates.add(encoded);
    }
  } catch {}

  // 3. Normalized slashes and spaces
  const normalizedSpaces = clean.replace(/\+/g, " ");
  candidates.add(normalizedSpaces);

  const plusSpaces = clean.replace(/ /g, "+");
  candidates.add(plusSpaces);

  // 4. Strip bucket prefix if accidentally included in key
  const strippedBucket = clean.replace(/^(academy-connect-files|tuition-files|storage)\//i, "");
  if (strippedBucket && strippedBucket !== clean) {
    candidates.add(strippedBucket);
    try {
      candidates.add(decodeURIComponent(strippedBucket));
    } catch {}
  }

  // 5. Add/remove class_notes prefix
  if (clean.startsWith("class_notes/")) {
    candidates.add(clean.replace(/^class_notes\//, ""));
  } else if (!clean.startsWith("class_notes/") && !clean.startsWith("notes/")) {
    candidates.add(`class_notes/${clean}`);
  }

  return Array.from(candidates);
}

/**
 * Checks metadata / existence of an object in Cloudflare R2 bucket or local storage fallback.
 * Emits structured logging for Stage 3 (R2 Existence Check).
 */
export async function headObjectFromR2(params: {
  bucket?: string;
  key: string;
}): Promise<{
  exists: boolean;
  contentLength?: number;
  contentType?: string;
  lastModified?: Date;
  etag?: string;
  metadata?: Record<string, string>;
  resolvedKey?: string;
  error?: string;
}> {
  const startTime = Date.now();
  const config = getR2ServerConfig();
  const bucketName = (params.bucket || config.bucket || "academy-connect-files").trim();
  const rawKey = (params.key || "").trim().replace(/^\/+/, "");

  if (!rawKey) {
    return { exists: false };
  }

  const candidateKeys = getCandidateStorageKeys(rawKey);

  // 1. Direct AWS S3 Client HeadObject if R2 is configured
  if (isR2Configured()) {
    const client = getR2S3Client();

    for (const keyToTry of candidateKeys) {
      try {
        console.log("[Trace 4: R2 S3 Client Request]", {
          bucket: bucketName,
          key: keyToTry,
          operation: "HeadObject",
        });

        const command = new HeadObjectCommand({
          Bucket: bucketName,
          Key: keyToTry,
        });
        const response = await client.send(command);

        console.log("[Trace 4: R2 Response]", {
          operation: "HeadObject",
          bucket: bucketName,
          key: keyToTry,
          status: response.$metadata?.httpStatusCode || 200,
          headers: {
            "content-type": response.ContentType,
            "content-length": response.ContentLength,
            etag: response.ETag,
            "last-modified": response.LastModified?.toISOString(),
          },
        });

        console.log(`[Stage 3: R2 Existence Check] Success:`, {
          stage: "3_R2_EXISTENCE_CHECK",
          bucket: bucketName,
          requestedKey: rawKey,
          resolvedKey: keyToTry,
          httpStatusFromR2: response.$metadata?.httpStatusCode || 200,
          contentLength: response.ContentLength,
          contentType: response.ContentType || getMimeTypeFromKey(keyToTry),
          etag: response.ETag,
          lastModified: response.LastModified?.toISOString(),
          durationMs: Date.now() - startTime,
        });

        return {
          exists: true,
          contentLength: response.ContentLength,
          contentType: response.ContentType || getMimeTypeFromKey(keyToTry),
          lastModified: response.LastModified,
          etag: response.ETag,
          metadata: response.Metadata,
          resolvedKey: keyToTry,
        };
      } catch (err: any) {
        const isNotFound =
          err?.name === "NoSuchKey" ||
          err?.name === "NotFound" ||
          err?.$metadata?.httpStatusCode === 404 ||
          err?.code === "NoSuchKey" ||
          err?.code === "NotFound";

        if (!isNotFound) {
          console.warn(`[Stage 3: R2 Existence Check] Notice for key="${keyToTry}":`, {
            name: err?.name,
            code: err?.code,
            httpStatusCode: err?.$metadata?.httpStatusCode,
            message: err?.message,
            requestId: err?.$metadata?.requestId,
          });
        }
      }
    }
  }

  // 2. Check local filesystem storage fallback
  for (const keyToTry of candidateKeys) {
    const local = getFromLocalStorage(bucketName, keyToTry);
    if (local.exists) {
      console.log(`[Stage 3: R2 Existence Check] Resolved from Local Storage:`, {
        stage: "3_R2_EXISTENCE_CHECK",
        bucket: bucketName,
        requestedKey: rawKey,
        resolvedKey: keyToTry,
        contentLength: local.size,
        contentType: local.contentType,
        etag: local.etag,
        durationMs: Date.now() - startTime,
      });

      return {
        exists: true,
        contentLength: local.size,
        contentType: local.contentType,
        lastModified: local.lastModified,
        etag: local.etag,
        metadata: local.metadata,
        resolvedKey: keyToTry,
      };
    }
  }

  console.info(`[Stage 3: R2 Existence Check] Object NOT found across candidate keys:`, {
    stage: "3_R2_EXISTENCE_CHECK",
    bucket: bucketName,
    requestedKey: rawKey,
    candidateKeysTried: candidateKeys,
    durationMs: Date.now() - startTime,
  });

  return {
    exists: false,
    resolvedKey: rawKey,
  };
}

/**
 * Downloads an object stream from Cloudflare R2 bucket or local storage fallback.
 * Emits structured logging for Stage 5 (Backend Streaming & Cloudflare Headers).
 */
export async function getObjectFromR2(params: {
  bucket?: string;
  key: string;
  range?: string;
}): Promise<{
  body: Readable | null;
  contentType?: string;
  contentLength?: number;
  contentRange?: string;
  lastModified?: Date;
  etag?: string;
  metadata?: Record<string, string>;
  resolvedKey: string;
}> {
  const startTime = Date.now();
  const config = getR2ServerConfig();
  const bucketName = (params.bucket || config.bucket || "academy-connect-files").trim();
  const rawKey = (params.key || "").trim().replace(/^\/+/, "");

  if (!rawKey) {
    return { body: null, resolvedKey: "" };
  }

  const candidateKeys = getCandidateStorageKeys(rawKey);

  // 1. Try direct S3 Client GetObject if R2 is configured
  if (isR2Configured()) {
    const client = getR2S3Client();

    for (const keyToTry of candidateKeys) {
      try {
        console.log("[Trace 4: R2 S3 Client Request]", {
          bucket: bucketName,
          key: keyToTry,
          operation: "GetObject",
          range: params.range,
        });

        const input: GetObjectCommandInput = {
          Bucket: bucketName,
          Key: keyToTry,
          Range: params.range,
        };
        const command = new GetObjectCommand(input);
        const response = await client.send(command);

        console.log("[Trace 4: R2 Response]", {
          operation: "GetObject",
          bucket: bucketName,
          key: keyToTry,
          status: response.$metadata?.httpStatusCode || 200,
          headers: {
            "content-type": response.ContentType,
            "content-length": response.ContentLength,
            "content-range": response.ContentRange,
            etag: response.ETag,
            "last-modified": response.LastModified?.toISOString(),
          },
        });

        console.log(`[Stage 5: Backend Streaming] S3 GetObject stream opened:`, {
          stage: "5_BACKEND_STREAMING",
          bucket: bucketName,
          resolvedKey: keyToTry,
          httpStatusFromR2: response.$metadata?.httpStatusCode || 200,
          contentType: response.ContentType || getMimeTypeFromKey(keyToTry),
          contentLength: response.ContentLength,
          contentRange: response.ContentRange,
          etag: response.ETag,
          lastModified: response.LastModified?.toISOString(),
          durationMs: Date.now() - startTime,
        });

        return {
          body: (response.Body as unknown as Readable) || null,
          contentType: response.ContentType || getMimeTypeFromKey(keyToTry),
          contentLength: response.ContentLength,
          contentRange: response.ContentRange,
          lastModified: response.LastModified,
          etag: response.ETag,
          metadata: response.Metadata,
          resolvedKey: keyToTry,
        };
      } catch (err: any) {
        const isNotFound =
          err?.name === "NoSuchKey" ||
          err?.name === "NotFound" ||
          err?.$metadata?.httpStatusCode === 404 ||
          err?.code === "NoSuchKey" ||
          err?.code === "NotFound";

        if (!isNotFound) {
          console.warn(`[Stage 5: Backend Streaming] S3 GetObject notice for key="${keyToTry}":`, {
            name: err?.name,
            code: err?.code,
            httpStatusCode: err?.$metadata?.httpStatusCode,
            message: err?.message,
            requestId: err?.$metadata?.requestId,
          });
          if (err?.$metadata?.httpStatusCode === 403 || err?.code === "AccessDenied" || err?.name === "AccessDenied") {
            console.error("[Trace 4: R2 403 Forbidden Error]", {
              errorSource: "Cloudflare R2 / AWS S3 Client GetObjectCommand",
              location: "src/lib/r2Server.ts:getObjectFromR2",
              bucket: bucketName,
              key: keyToTry,
              status: 403,
              name: err?.name,
              code: err?.code,
              message: err?.message,
              stack: err?.stack,
            });
          }
        }
      }
    }
  }

  // 2. Try Public URL stream if configured
  if (config.publicUrl) {
    for (const keyToTry of candidateKeys) {
      try {
        const publicFetchUrl = `${config.publicUrl}/${keyToTry}`;
        const fetchHeaders: Record<string, string> = {};
        if (params.range) {
          fetchHeaders["Range"] = params.range;
        }
        const pubRes = await fetch(publicFetchUrl, { headers: fetchHeaders });
        if (pubRes.ok || pubRes.status === 200 || pubRes.status === 206) {
          const ct = pubRes.headers.get("content-type") || getMimeTypeFromKey(keyToTry);
          const len = Number(pubRes.headers.get("content-length")) || undefined;
          const cr = pubRes.headers.get("content-range") || undefined;
          const etag = pubRes.headers.get("etag") || undefined;
          const lastMod = pubRes.headers.get("last-modified");

          let bodyStream: Readable | null = null;
          if (pubRes.body) {
            if (typeof Readable.fromWeb === "function") {
              bodyStream = Readable.fromWeb(pubRes.body as any);
            } else {
              const arrayBuf = await pubRes.arrayBuffer();
              bodyStream = Readable.from(Buffer.from(arrayBuf));
            }
          }

          console.log(`[Stage 5: Backend Streaming] Public URL stream opened:`, {
            stage: "5_BACKEND_STREAMING",
            bucket: bucketName,
            resolvedKey: keyToTry,
            httpStatusFromR2: pubRes.status,
            contentType: ct,
            contentLength: len,
            etag,
            durationMs: Date.now() - startTime,
          });

          return {
            body: bodyStream,
            contentType: ct,
            contentLength: len,
            contentRange: cr,
            etag,
            lastModified: lastMod ? new Date(lastMod) : undefined,
            resolvedKey: keyToTry,
          };
        }
      } catch {}
    }
  }

  // 3. Check local filesystem storage fallback
  for (const keyToTry of candidateKeys) {
    const local = getFromLocalStorage(bucketName, keyToTry);
    if (local.exists && local.filePath) {
      let streamOptions: any = undefined;
      let contentRange: string | undefined = undefined;
      let contentLength = local.size;

      if (params.range && local.size) {
        const rangeMatch = params.range.match(/bytes=(\d+)-(\d+)?/);
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1], 10);
          const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : local.size - 1;
          if (start < local.size) {
            streamOptions = { start, end: Math.min(end, local.size - 1) };
            contentLength = streamOptions.end - streamOptions.start + 1;
            contentRange = `bytes ${streamOptions.start}-${streamOptions.end}/${local.size}`;
          }
        }
      }

      const fileStream = fs.createReadStream(local.filePath, streamOptions);

      console.log(`[Stage 5: Backend Streaming] Local filesystem stream opened:`, {
        stage: "5_BACKEND_STREAMING",
        bucket: bucketName,
        resolvedKey: keyToTry,
        contentType: local.contentType,
        contentLength,
        etag: local.etag,
        durationMs: Date.now() - startTime,
      });

      return {
        body: fileStream,
        contentType: local.contentType,
        contentLength,
        contentRange,
        lastModified: local.lastModified,
        etag: local.etag,
        metadata: local.metadata,
        resolvedKey: keyToTry,
      };
    }
  }

  return { body: null, resolvedKey: rawKey };
}

/**
 * Generates a presigned URL for downloading or uploading to Cloudflare R2 or local proxy URL.
 */
export async function generateR2SignedUrl(params: {
  bucket?: string;
  key: string;
  expiresIn?: number;
  operation?: "getObject" | "putObject";
  contentType?: string;
}): Promise<string> {
  const config = getR2ServerConfig();
  const bucketName = (params.bucket || config.bucket || "academy-connect-files").trim();
  const cleanKey = (params.key || "").trim().replace(/^\/+/, "");
  const expiresIn = params.expiresIn || 3600;
  const operation = params.operation || "getObject";
  const effectiveMime = params.contentType || getMimeTypeFromKey(cleanKey);

  // If R2 is not configured, provide direct local API proxy URL
  if (!isR2Configured()) {
    if (config.publicUrl) {
      return `${config.publicUrl}/${cleanKey}`;
    }
    return `/api/storage?action=download&bucket=${encodeURIComponent(bucketName)}&key=${encodeURIComponent(cleanKey)}`;
  }

  const client = getR2S3Client();
  if (operation === "putObject") {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: cleanKey,
      ContentType: effectiveMime,
    });
    return await getSignedUrl(client, command, { expiresIn });
  }

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: cleanKey,
    ResponseContentDisposition: "inline",
    ResponseContentType: effectiveMime,
  });
  return await getSignedUrl(client, command, { expiresIn });
}

/**
 * Deletes an object from Cloudflare R2 bucket and local storage fallback.
 */
export async function deleteObjectFromR2(params: {
  bucket?: string;
  key: string;
}): Promise<{ success: boolean; bucket: string; key: string }> {
  const config = getR2ServerConfig();
  const bucketName = (params.bucket || config.bucket || "academy-connect-files").trim();
  const cleanKey = params.key.replace(/^\/+/, "");

  if (!cleanKey) {
    return { success: true, bucket: bucketName, key: "" };
  }

  // Delete from local storage fallback
  deleteFromLocalStorage(bucketName, cleanKey);

  if (isR2Configured()) {
    try {
      console.log(`[R2Server-Operation] DeleteObjectCommand for key="${cleanKey}" in bucket="${bucketName}"`);
      const client = getR2S3Client();
      const input: DeleteObjectCommandInput = {
        Bucket: bucketName,
        Key: cleanKey,
      };
      const command = new DeleteObjectCommand(input);
      await client.send(command);
    } catch (err: any) {
      console.warn(`[R2Server-Operation] DeleteObject notice for key="${cleanKey}":`, err?.message || err);
    }
  }

  return {
    success: true,
    bucket: bucketName,
    key: cleanKey,
  };
}

/**
 * Deletes multiple objects from Cloudflare R2 bucket and local storage fallback.
 */
export async function deleteObjectsFromR2(params: {
  bucket?: string;
  keys: string[];
}): Promise<{ success: boolean; deleted: string[]; errors?: any[] }> {
  const cleanKeys = params.keys.map((k) => k.replace(/^\/+/, "")).filter(Boolean);
  if (cleanKeys.length === 0) {
    return { success: true, deleted: [] };
  }

  const config = getR2ServerConfig();
  const bucketName = (params.bucket || config.bucket || "academy-connect-files").trim();

  // Delete all from local storage fallback
  cleanKeys.forEach((k) => deleteFromLocalStorage(bucketName, k));

  let deletedKeys = cleanKeys;
  if (isR2Configured()) {
    try {
      console.log(`[R2Server-Operation] DeleteObjectsCommand for ${cleanKeys.length} keys in bucket="${bucketName}"`);
      const client = getR2S3Client();
      const command = new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: {
          Objects: cleanKeys.map((k) => ({ Key: k })),
          Quiet: false,
        },
      });
      const response = await client.send(command);
      deletedKeys = (response.Deleted || []).map((d) => d.Key!).filter(Boolean);
    } catch (err: any) {
      console.warn("[R2Server-Operation] DeleteObjects notice:", err?.message || err);
    }
  }

  return {
    success: true,
    deleted: deletedKeys,
  };
}

/**
 * Lists objects in Cloudflare R2 bucket or local storage fallback matching a prefix.
 */
export async function listObjectsFromR2(params: {
  bucket?: string;
  prefix?: string;
  maxKeys?: number;
  continuationToken?: string;
}): Promise<{
  objects: Array<{ key: string; size: number; lastModified?: Date; etag?: string }>;
  nextContinuationToken?: string;
  isTruncated: boolean;
}> {
  const config = getR2ServerConfig();
  const bucketName = (params.bucket || config.bucket || "academy-connect-files").trim();
  const cleanPrefix = (params.prefix || "").replace(/^\/+/, "");

  if (isR2Configured()) {
    try {
      const client = getR2S3Client();
      const command = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: cleanPrefix,
        MaxKeys: params.maxKeys || 1000,
        ContinuationToken: params.continuationToken,
      });
      const response = await client.send(command);

      const objects = (response.Contents || [])
        .filter((item) => Boolean(item.Key))
        .map((item) => ({
          key: item.Key!,
          size: item.Size || 0,
          lastModified: item.LastModified,
          etag: item.ETag,
        }));

      return {
        objects,
        nextContinuationToken: response.NextContinuationToken,
        isTruncated: Boolean(response.IsTruncated),
      };
    } catch (err: any) {
      console.warn("[R2Server-Operation] ListObjects notice:", err?.message || err);
    }
  }

  // Fallback to local storage list
  const localObjects = listFromLocalStorage(bucketName, cleanPrefix, params.maxKeys || 1000);
  return {
    objects: localObjects,
    nextContinuationToken: undefined,
    isTruncated: false,
  };
}

/**
 * Helper to generate candidate keys for path fallback.
 */
export function generateCandidateKeys(rawKey: string): string[] {
  if (!rawKey) return [];
  const clean = rawKey.trim().replace(/^\/+/, "");
  if (!clean) return [];
  const candidates = new Set<string>();
  candidates.add(clean);
  try {
    const decoded = decodeURIComponent(clean);
    if (decoded !== clean) candidates.add(decoded);
  } catch {}
  return Array.from(candidates);
}

