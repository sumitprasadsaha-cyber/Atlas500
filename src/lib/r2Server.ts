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

/**
 * Finds a local file path in the workspace storage directory if it exists.
 */
function findLocalFilePath(bucketName: string, cleanKey: string): string | null {
  try {
    const candidates = generateCandidateKeys(cleanKey);
    const candidateBases = [
      path.join(process.cwd(), "data", "storage", bucketName),
      path.join(process.cwd(), "data", "storage"),
      path.join(process.cwd(), "data"),
      path.join(process.cwd(), "public"),
    ];

    for (const base of candidateBases) {
      for (const k of candidates) {
        const p = path.join(base, k);
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          return p;
        }
      }
    }

    // Additional check: search by filename in the target directory
    const fileName = path.basename(cleanKey);
    const dirPart = path.dirname(cleanKey);
    if (fileName && dirPart && dirPart !== ".") {
      for (const base of candidateBases) {
        const targetDir = path.join(base, dirPart);
        if (fs.existsSync(targetDir) && fs.statSync(targetDir).isDirectory()) {
          const files = fs.readdirSync(targetDir);
          const match = files.find((f) => f.toLowerCase() === fileName.toLowerCase() || f.includes(fileName) || fileName.includes(f));
          if (match) {
            const p = path.join(targetDir, match);
            if (fs.existsSync(p) && fs.statSync(p).isFile()) {
              return p;
            }
          }
        }
      }
    }
  } catch {}
  return null;
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
 * Aborts / throws if any are missing.
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

  console.log(`[R2Server-Startup] Environment Validation:`, {
    valid,
    missing,
    accountId: config.accountId ? `${config.accountId.substring(0, 4)}...${config.accountId.substring(config.accountId.length - 4)}` : "MISSING",
    accessKeyId: config.accessKeyId ? `${config.accessKeyId.substring(0, 4)}...` : "MISSING",
    secretAccessKey: config.secretAccessKey ? `[EXISTS len=${config.secretAccessKey.length}]` : "MISSING",
    endpoint: config.endpoint || "MISSING",
    bucket: config.bucket || "MISSING",
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
    config.accountId &&
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
 * Uploads an object directly to Cloudflare R2 bucket and/or local filesystem.
 */
export async function uploadObjectToR2(params: {
  bucket?: string;
  key: string;
  body: Buffer | Uint8Array | string | Readable;
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}): Promise<{ bucket: string; key: string; etag?: string }> {
  const config = getR2ServerConfig();
  const bucketName = (params.bucket || config.bucket || "academy-connect-files").trim();
  const cleanKey = params.key.replace(/^\/+/, "");
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

  // Always write to local storage as durable backup / local cache
  try {
    const localTarget = path.join(process.cwd(), "data", "storage", bucketName, cleanKey);
    fs.mkdirSync(path.dirname(localTarget), { recursive: true });
    fs.writeFileSync(localTarget, bodyBuffer);
  } catch (fsWriteErr) {
    console.warn(`[R2Server-Operation] Local storage write notice:`, fsWriteErr);
  }

  // If R2 is configured, also upload to R2
  if (isR2Configured()) {
    try {
      const client = getR2S3Client();
      const input: PutObjectCommandInput = {
        Bucket: bucketName,
        Key: cleanKey,
        Body: bodyBuffer,
        ContentType: contentType,
        CacheControl: cacheControl,
        Metadata: params.metadata,
      };
      const command = new PutObjectCommand(input);
      const response = await client.send(command);

      console.log(`[R2Server-Operation] PutObject SUCCESS:`, {
        bucket: bucketName,
        key: cleanKey,
        etag: response.ETag,
        httpStatusCode: response.$metadata?.httpStatusCode || 200,
      });

      return {
        bucket: bucketName,
        key: cleanKey,
        etag: response.ETag,
      };
    } catch (err: any) {
      console.warn(`[R2Server-Operation] PutObject to R2 remote failed, using local storage:`, err?.message || err);
      return {
        bucket: bucketName,
        key: cleanKey,
        etag: `local-${Date.now()}`,
      };
    }
  }

  console.log(`[R2Server-Operation] PutObject local save SUCCESS: key="${cleanKey}", size=${bodyBuffer.length}`);
  return {
    bucket: bucketName,
    key: cleanKey,
    etag: `local-${Date.now()}`,
  };
}

/**
 * Checks metadata / existence of an object in Cloudflare R2 bucket or local filesystem.
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
  const config = getR2ServerConfig();
  const bucketName = (params.bucket || config.bucket || "academy-connect-files").trim();
  const cleanKey = (params.key || "").trim().replace(/^\/+/, "");

  if (!cleanKey) {
    return { exists: false };
  }

  // 1. Try AWS S3 Client HeadObject if R2 is configured
  if (isR2Configured()) {
    try {
      const client = getR2S3Client();
      const command = new HeadObjectCommand({
        Bucket: bucketName,
        Key: cleanKey,
      });
      const response = await client.send(command);

      return {
        exists: true,
        contentLength: response.ContentLength,
        contentType: response.ContentType || getMimeTypeFromKey(cleanKey),
        lastModified: response.LastModified,
        etag: response.ETag,
        metadata: response.Metadata,
        resolvedKey: cleanKey,
      };
    } catch (err: any) {
      const isNotFound =
        err?.name === "NoSuchKey" ||
        err?.name === "NotFound" ||
        err?.$metadata?.httpStatusCode === 404 ||
        err?.code === "NoSuchKey" ||
        err?.code === "NotFound";

      if (!isNotFound) {
        // Log S3 error notice only if it's an unexpected error
      }
    }
  }

  // 2. If publicUrl is configured, check via HEAD request
  if (config.publicUrl) {
    try {
      const publicCheckUrl = `${config.publicUrl}/${cleanKey}`;
      const headRes = await fetch(publicCheckUrl, { method: "HEAD" });
      if (headRes.ok || headRes.status === 200 || headRes.status === 206) {
        const len = Number(headRes.headers.get("content-length")) || undefined;
        const ct = headRes.headers.get("content-type") || getMimeTypeFromKey(cleanKey);
        const etag = headRes.headers.get("etag") || undefined;
        const lastMod = headRes.headers.get("last-modified");
        return {
          exists: true,
          contentLength: len,
          contentType: ct,
          etag,
          lastModified: lastMod ? new Date(lastMod) : undefined,
          resolvedKey: cleanKey,
        };
      }
    } catch {}
  }

  // 3. Check local filesystem storage
  const localPath = findLocalFilePath(bucketName, cleanKey);
  if (localPath) {
    try {
      const stats = fs.statSync(localPath);
      return {
        exists: true,
        contentLength: stats.size,
        contentType: getMimeTypeFromKey(cleanKey),
        lastModified: stats.mtime,
        etag: `local-${stats.mtimeMs}`,
        resolvedKey: cleanKey,
      };
    } catch {}
  }

  return {
    exists: false,
    resolvedKey: cleanKey,
  };
}

/**
 * Downloads an object stream from Cloudflare R2 bucket or local filesystem.
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
  const config = getR2ServerConfig();
  const bucketName = (params.bucket || config.bucket || "academy-connect-files").trim();
  const cleanKey = (params.key || "").trim().replace(/^\/+/, "");

  if (!cleanKey) {
    return { body: null, resolvedKey: "" };
  }

  // 1. Try direct S3 Client GetObject if R2 is configured
  if (isR2Configured()) {
    try {
      const client = getR2S3Client();
      const input: GetObjectCommandInput = {
        Bucket: bucketName,
        Key: cleanKey,
        Range: params.range,
      };
      const command = new GetObjectCommand(input);
      const response = await client.send(command);

      return {
        body: (response.Body as unknown as Readable) || null,
        contentType: response.ContentType || getMimeTypeFromKey(cleanKey),
        contentLength: response.ContentLength,
        contentRange: response.ContentRange,
        lastModified: response.LastModified,
        etag: response.ETag,
        metadata: response.Metadata,
        resolvedKey: cleanKey,
      };
    } catch (err: any) {
      const isNotFound =
        err?.name === "NoSuchKey" ||
        err?.name === "NotFound" ||
        err?.$metadata?.httpStatusCode === 404 ||
        err?.code === "NoSuchKey" ||
        err?.code === "NotFound";

      if (!isNotFound) {
        // continue to fallbacks
      }
    }
  }

  // 2. If S3 API returned Unauthorized / error, attempt public URL stream if configured
  if (config.publicUrl) {
    try {
      const publicFetchUrl = `${config.publicUrl}/${cleanKey}`;
      const fetchHeaders: Record<string, string> = {};
      if (params.range) {
        fetchHeaders["Range"] = params.range;
      }
      const pubRes = await fetch(publicFetchUrl, { headers: fetchHeaders });
      if (pubRes.ok || pubRes.status === 200 || pubRes.status === 206) {
        const ct = pubRes.headers.get("content-type") || getMimeTypeFromKey(cleanKey);
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

        return {
          body: bodyStream,
          contentType: ct,
          contentLength: len,
          contentRange: cr,
          etag,
          lastModified: lastMod ? new Date(lastMod) : undefined,
          resolvedKey: cleanKey,
        };
      }
    } catch (pubFetchErr) {
      // Continue to local filesystem fallback
    }
  }

  // 3. Try local filesystem storage
  const localPath = findLocalFilePath(bucketName, cleanKey);
  if (localPath) {
    try {
      const stats = fs.statSync(localPath);
      let stream: Readable;
      if (params.range) {
        const parts = params.range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
        stream = fs.createReadStream(localPath, { start, end });
        return {
          body: stream,
          contentType: getMimeTypeFromKey(cleanKey),
          contentLength: end - start + 1,
          contentRange: `bytes ${start}-${end}/${stats.size}`,
          lastModified: stats.mtime,
          etag: `local-${stats.mtimeMs}`,
          resolvedKey: cleanKey,
        };
      } else {
        stream = fs.createReadStream(localPath);
        return {
          body: stream,
          contentType: getMimeTypeFromKey(cleanKey),
          contentLength: stats.size,
          lastModified: stats.mtime,
          etag: `local-${stats.mtimeMs}`,
          resolvedKey: cleanKey,
        };
      }
    } catch (fsErr) {
      console.warn(`[R2Server-Operation] Local read error for "${cleanKey}":`, fsErr);
    }
  }

  return { body: null, resolvedKey: cleanKey };
}

/**
 * Generates a presigned URL for downloading or uploading to Cloudflare R2.
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

  if (isR2Configured()) {
    try {
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
    } catch {}
  }

  if (operation === "getObject" && config.publicUrl) {
    return `${config.publicUrl}/${cleanKey}`;
  }
  return `/api/storage?action=download&bucket=${encodeURIComponent(bucketName)}&key=${encodeURIComponent(cleanKey)}`;
}

/**
 * Deletes an object from Cloudflare R2 bucket and local filesystem.
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

  // Delete local file if exists
  const localPath = findLocalFilePath(bucketName, cleanKey);
  if (localPath) {
    try {
      fs.unlinkSync(localPath);
    } catch {}
  }

  if (isR2Configured()) {
    try {
      const client = getR2S3Client();
      const input: DeleteObjectCommandInput = {
        Bucket: bucketName,
        Key: cleanKey,
      };
      const command = new DeleteObjectCommand(input);
      await client.send(command);
    } catch (err: any) {
      console.warn(`[R2Server-Operation] Remote R2 DeleteObject warning:`, err?.message || err);
    }
  }

  return {
    success: true,
    bucket: bucketName,
    key: cleanKey,
  };
}

/**
 * Deletes multiple objects from Cloudflare R2 bucket and local filesystem.
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

  for (const k of cleanKeys) {
    const localPath = findLocalFilePath(bucketName, k);
    if (localPath) {
      try {
        fs.unlinkSync(localPath);
      } catch {}
    }
  }

  if (isR2Configured()) {
    try {
      const client = getR2S3Client();
      const command = new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: {
          Objects: cleanKeys.map((k) => ({ Key: k })),
          Quiet: false,
        },
      });
      const response = await client.send(command);
      return {
        success: true,
        deleted: (response.Deleted || []).map((d) => d.Key!).filter(Boolean),
      };
    } catch (err: any) {
      console.warn(`[R2Server-Operation] Remote R2 DeleteObjects notice:`, err?.message || err);
    }
  }

  return {
    success: true,
    deleted: cleanKeys,
  };
}

/**
 * Lists objects in Cloudflare R2 bucket and/or local filesystem matching a prefix.
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

  const objectMap = new Map<string, { key: string; size: number; lastModified?: Date; etag?: string }>();

  // 1. If R2 configured, list from R2
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
      for (const item of response.Contents || []) {
        if (item.Key) {
          objectMap.set(item.Key, {
            key: item.Key,
            size: item.Size || 0,
            lastModified: item.LastModified,
            etag: item.ETag,
          });
        }
      }
    } catch (err: any) {
      console.warn(`[R2Server-Operation] Remote R2 ListObjects notice:`, err?.message || err);
    }
  }

  // 2. Scan local storage directory
  try {
    const localBase = path.join(process.cwd(), "data", "storage", bucketName);
    if (fs.existsSync(localBase)) {
      const scanDir = (dir: string, relPath: string = "") => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const entryRel = relPath ? `${relPath}/${entry.name}` : entry.name;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath, entryRel);
          } else if (entry.isFile()) {
            if (!cleanPrefix || entryRel.startsWith(cleanPrefix)) {
              if (!objectMap.has(entryRel)) {
                const stat = fs.statSync(fullPath);
                objectMap.set(entryRel, {
                  key: entryRel,
                  size: stat.size,
                  lastModified: stat.mtime,
                  etag: `local-${stat.mtimeMs}`,
                });
              }
            }
          }
        }
      };
      scanDir(localBase);
    }
  } catch (fsErr) {
    // ignore
  }

  const objects = Array.from(objectMap.values()).slice(0, params.maxKeys || 1000);
  return {
    objects,
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
