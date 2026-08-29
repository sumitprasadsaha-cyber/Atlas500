import path from "path";
import { Readable } from "stream";

export const MIME_TO_EXTENSION_MAP: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/pjpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/svg": "svg",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/json": "json",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

export const EXTENSION_TO_MIME_MAP: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  heic: "image/heic",
  heif: "image/heif",
  json: "application/json",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const VALID_EXTENSIONS = new Set(Object.keys(EXTENSION_TO_MIME_MAP));

/**
 * Infers a clean file extension from a MIME type string.
 */
export function inferExtensionFromMime(mimeType?: string | null, fallback = "pdf"): string {
  if (!mimeType) return fallback;
  const cleanMime = String(mimeType).toLowerCase().split(";")[0].trim();
  if (MIME_TO_EXTENSION_MAP[cleanMime]) {
    return MIME_TO_EXTENSION_MAP[cleanMime];
  }
  if (cleanMime.startsWith("image/")) {
    const sub = cleanMime.replace("image/", "").replace("+xml", "").trim();
    if (sub === "jpeg" || sub === "pjpeg") return "jpg";
    if (VALID_EXTENSIONS.has(sub)) return sub;
    return "png";
  }
  if (cleanMime.includes("pdf")) return "pdf";
  if (cleanMime.includes("json")) return "json";
  return fallback;
}

/**
 * Extracts a clean extension from a filename, URL, or MIME type, stripping any corrupted MIME strings.
 */
export function extractCleanExtension(filenameOrPath?: string | null, mimeType?: string | null): string {
  if (!filenameOrPath && !mimeType) return "pdf";

  let raw = String(filenameOrPath || "").trim();

  // Strip query strings and hashes
  if (raw.includes("?")) raw = raw.split("?")[0];
  if (raw.includes("#")) raw = raw.split("#")[0];

  // Remove corrupted MIME suffixes like .primage/png, .image/png, image/png, application/pdf
  raw = raw.replace(/\.(?:pr)?image\/(?:png|jpe?g|webp|gif|svg\+xml|svg)/gi, "");
  raw = raw.replace(/\.application\/(?:pdf|json)/gi, "");
  raw = raw.replace(/\/image\/(?:png|jpe?g|webp|gif)/gi, "");
  raw = raw.replace(/\/application\/pdf/gi, "");

  // Extract trailing extension
  const lastDotIndex = raw.lastIndexOf(".");
  if (lastDotIndex !== -1 && lastDotIndex < raw.length - 1) {
    const possibleExt = raw.substring(lastDotIndex + 1).toLowerCase().trim();
    if (VALID_EXTENSIONS.has(possibleExt)) {
      return possibleExt;
    }
    const cleanedExt = possibleExt.replace(/[^a-z0-9]/gi, "").slice(0, 5).toLowerCase();
    if (VALID_EXTENSIONS.has(cleanedExt)) {
      return cleanedExt;
    }
  }

  if (mimeType) {
    return inferExtensionFromMime(mimeType, "pdf");
  }

  return "pdf";
}

/**
 * Strips directory paths and corrupted MIME suffixes to return a clean base filename.
 */
export function sanitizeFilenameBase(rawName?: string | null, fallback = "note"): string {
  if (!rawName) return fallback;
  let base = String(rawName).trim();

  // Handle path separators
  base = base.replace(/\\/g, "/");
  if (base.includes("/")) {
    base = base.split("/").pop() || fallback;
  }

  // Strip query parameters and hash
  if (base.includes("?")) base = base.split("?")[0];
  if (base.includes("#")) base = base.split("#")[0];

  // Strip corrupted MIME suffixes
  base = base.replace(/\.(?:pr)?image\/(?:png|jpe?g|webp|gif|svg\+xml|svg).*/gi, "");
  base = base.replace(/\.application\/(?:pdf|json).*/gi, "");
  base = base.replace(/\/+image\/.*/gi, "");
  base = base.replace(/\/+application\/.*/gi, "");

  // Remove existing valid extension from base
  const lastDot = base.lastIndexOf(".");
  if (lastDot !== -1) {
    const ext = base.substring(lastDot + 1).toLowerCase();
    if (VALID_EXTENSIONS.has(ext)) {
      base = base.substring(0, lastDot);
    }
  }

  // Sanitize characters: keep alphanumeric, dashes, underscores, periods
  base = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");

  return base || fallback;
}

/**
 * Builds a deterministic canonical filename.
 * Guarantees:
 * - Extension is clean and canonical (e.g., 'png', 'pdf', 'jpg')
 * - MIME type is NEVER concatenated into the filename
 * - Result is strictly `${baseName}.${extension}`
 */
export function buildCanonicalFilename(params: {
  fileName?: string | null;
  originalFilename?: string | null;
  mimeType?: string | null;
  defaultBaseName?: string;
}): string {
  const inputName = params.fileName || params.originalFilename || "";
  const extension = extractCleanExtension(inputName, params.mimeType);
  const baseName = sanitizeFilenameBase(inputName, params.defaultBaseName || "note");

  return `${baseName}.${extension}`;
}

/**
 * Normalizes and sanitizes storage key paths, extracting keys from URLs or query strings,
 * removing leading slashes, decoding URI components, preventing path traversals,
 * and ensuring filenames never contain embedded MIME strings.
 */
export function sanitizeKey(key: string, bucketName?: string): string {
  if (!key) return "";
  let clean = String(key).trim();

  // 0. Handle JSON metadata strings
  if (clean.startsWith("{")) {
    try {
      const parsed = JSON.parse(clean);
      if (parsed.storagePath) {
        clean = String(parsed.storagePath).trim();
      } else if (parsed.key) {
        clean = String(parsed.key).trim();
      } else if (parsed.storageKey) {
        clean = String(parsed.storageKey).trim();
      } else if (parsed.downloadUrl) {
        clean = String(parsed.downloadUrl).trim();
      } else if (parsed.url) {
        clean = String(parsed.url).trim();
      }
    } catch {
      // Ignore JSON parse errors
    }
  }

  // 1. Extract from key/storageKey/storagePath query params in URLs or relative paths
  if (clean.includes("key=") || clean.includes("storageKey=") || clean.includes("storagePath=")) {
    try {
      const fakeBase = "http://localhost";
      const urlObj = new URL(clean.startsWith("http") ? clean : `${fakeBase}${clean.startsWith("/") ? "" : "/"}${clean}`);
      const keyParam = urlObj.searchParams.get("key") || urlObj.searchParams.get("storageKey") || urlObj.searchParams.get("storagePath");
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

  // 2. Normalize slashes & remove quotes
  clean = clean.replace(/\\/g, "/");
  clean = clean.replace(/^["']|["']$/g, "");

  // 3. Handle gs:// or s3:// protocol URLs
  if (clean.startsWith("gs://") || clean.startsWith("s3://")) {
    const withoutPrefix = clean.substring(5);
    const slashIdx = withoutPrefix.indexOf("/");
    if (slashIdx !== -1) {
      clean = withoutPrefix.substring(slashIdx + 1);
    } else {
      clean = "";
    }
  }

  // 4. Handle full HTTP/HTTPS URLs (R2 public domain or proxy URL)
  if (clean.startsWith("http://") || clean.startsWith("https://")) {
    try {
      const urlObj = new URL(clean);
      const pathname = urlObj.pathname;
      const keyParam = urlObj.searchParams.get("key") || urlObj.searchParams.get("storageKey");
      if (keyParam) {
        clean = decodeURIComponent(keyParam);
      } else {
        const segments = pathname.replace(/^\/+/, "").split("/");
        if (bucketName && segments[0] === bucketName) {
          segments.shift();
        }
        clean = segments.join("/");
      }
    } catch {
      // Ignore URL parsing errors
    }
  }

  // 5. Decode URI encoding safely
  if (clean.includes("%")) {
    try {
      let decoded = decodeURIComponent(clean);
      if (decoded.includes("%")) {
        decoded = decodeURIComponent(decoded);
      }
      clean = decoded;
    } catch {
      // ignore
    }
  }

  // 6. Strip query parameters and hash fragments if any remain
  if (clean.includes("?")) {
    clean = clean.split("?")[0];
  }
  if (clean.includes("#")) {
    clean = clean.split("#")[0];
  }

  // 7. Remove leading slashes and collapse duplicate slashes
  clean = clean.replace(/^\/+/, "").replace(/\/{2,}/g, "/");

  // 8. Remove leading bucket name if prefixed
  if (bucketName) {
    const bucketPrefix = `${bucketName}/`;
    if (clean.startsWith(bucketPrefix)) {
      clean = clean.substring(bucketPrefix.length);
    }
  }
  if (clean.startsWith("academy-connect-files/")) {
    clean = clean.substring("academy-connect-files/".length);
  }

  // 9. Re-strip leading slashes after bucket removal
  clean = clean.replace(/^\/+/, "").replace(/\/{2,}/g, "/");

  // 10. Prevent path traversal
  clean = clean.replace(/\.\./g, "_");

  // 11. Clean individual path segments and canonicalize filename
  const segments = clean
    .split("/")
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0 && seg !== "." && seg !== "..");

  if (segments.length === 0) return "";

  // The last segment is the filename
  const filenameSegment = segments.pop()!;
  const cleanFilename = buildCanonicalFilename({
    fileName: filenameSegment,
    defaultBaseName: "note",
  });

  const cleanDirs = segments.map((seg) => {
    return seg
      .replace(/\.(?:pr)?image\/(?:png|jpe?g|webp|gif)/gi, "")
      .replace(/\.application\/pdf/gi, "")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
  }).filter((s) => s.length > 0);

  if (cleanDirs.length === 0) {
    return cleanFilename;
  }

  return `${cleanDirs.join("/")}/${cleanFilename}`;
}

/**
 * Returns standard MIME type based on file extension.
 */
export function getMimeType(keyOrFilename: string, fallback: string = "application/octet-stream"): string {
  const ext = extractCleanExtension(keyOrFilename);
  return EXTENSION_TO_MIME_MAP[ext] || (ext === "pdf" ? "application/pdf" : fallback);
}

/**
 * Safely parses request body from buffer, string, or already parsed object.
 */
export function parseRequestBody<T = any>(body: any): T {
  if (!body) return {} as T;

  if (Buffer.isBuffer(body)) {
    try {
      const str = body.toString("utf-8");
      return JSON.parse(str);
    } catch {
      return { rawBuffer: body } as unknown as T;
    }
  }

  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return { rawString: body } as unknown as T;
    }
  }

  return body as T;
}

/**
 * Converts Readable stream or Buffer into a Buffer with timeout safety and flowing-mode guarantee.
 */
export async function streamToBuffer(stream: Readable | any, timeoutMs: number = 30000): Promise<Buffer> {
  if (Buffer.isBuffer(stream)) return stream;
  if (!stream || typeof stream.on !== "function") return Buffer.alloc(0);
  if (stream.readableEnded || stream._readableState?.ended) {
    if (stream.body && Buffer.isBuffer(stream.body)) return stream.body;
    return Buffer.alloc(0);
  }

  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        resolve(Buffer.concat(chunks));
      }
    }, timeoutMs);

    stream.on("data", (chunk: any) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    stream.on("end", () => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolve(Buffer.concat(chunks));
      }
    });

    stream.on("error", (err: any) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    if (typeof stream.resume === "function") {
      stream.resume();
    }
  });
}

export interface ParsedMultipartPart {
  name: string;
  filename?: string;
  contentType: string;
  data: Buffer;
}

export interface ParsedMultipartResult {
  fields: Record<string, string>;
  files: ParsedMultipartPart[];
}

/**
 * High-performance, zero-dependency multipart/form-data buffer parser.
 * Supports CRLF (\r\n\r\n), LF (\n\n), quoted/unquoted boundaries, and mixed stream formats.
 */
export function parseMultipartFormData(buffer: Buffer, boundary: string): ParsedMultipartResult {
  const result: ParsedMultipartResult = {
    fields: {},
    files: [],
  };

  if (!buffer || buffer.length === 0 || !boundary) {
    return result;
  }

  // Clean boundary: remove quotes and leading dashes if already present
  const cleanBoundary = boundary.replace(/^["']|["']$/g, "").replace(/^--+/, "");
  const boundaryBuffer = Buffer.from(`--${cleanBoundary}`);
  const crlfcrlf = Buffer.from("\r\n\r\n");
  const lflf = Buffer.from("\n\n");

  let start = buffer.indexOf(boundaryBuffer);
  while (start !== -1) {
    const nextStart = buffer.indexOf(boundaryBuffer, start + boundaryBuffer.length);
    if (nextStart === -1) break;

    // Slice part data including headers and trailing delimiter
    const partBuffer = buffer.subarray(start + boundaryBuffer.length, nextStart);
    
    // Find delimiter between headers and body: try \r\n\r\n then \n\n
    let headerEndIndex = partBuffer.indexOf(crlfcrlf);
    let delimiterLength = crlfcrlf.length;
    if (headerEndIndex === -1) {
      headerEndIndex = partBuffer.indexOf(lflf);
      delimiterLength = lflf.length;
    }

    if (headerEndIndex !== -1) {
      const headerText = partBuffer.subarray(0, headerEndIndex).toString("utf-8");
      // Strip leading \r\n or \n from headers if present
      const cleanHeaders = headerText.replace(/^[\r\n]+/, "");
      
      // Body is after headers delimiter and before trailing \r\n or \n
      let bodyData = partBuffer.subarray(headerEndIndex + delimiterLength);
      if (bodyData.length >= 2 && bodyData[bodyData.length - 2] === 0x0d && bodyData[bodyData.length - 1] === 0x0a) {
        bodyData = bodyData.subarray(0, bodyData.length - 2);
      } else if (bodyData.length >= 1 && bodyData[bodyData.length - 1] === 0x0a) {
        bodyData = bodyData.subarray(0, bodyData.length - 1);
      }

      // Parse headers
      const nameMatch = cleanHeaders.match(/name="([^"]+)"/i) || cleanHeaders.match(/name=([^\r\n;\s]+)/i);
      const filenameMatch = cleanHeaders.match(/filename="([^"]+)"/i) || cleanHeaders.match(/filename=([^\r\n;\s]+)/i);
      const contentTypeMatch = cleanHeaders.match(/Content-Type:\s*([^\r\n;]+)/i);

      const fieldName = nameMatch ? nameMatch[1] : "";
      const filename = filenameMatch ? filenameMatch[1] : undefined;
      const contentType = contentTypeMatch ? contentTypeMatch[1].trim() : "application/octet-stream";

      if (fieldName) {
        if (filename !== undefined) {
          result.files.push({
            name: fieldName,
            filename,
            contentType,
            data: bodyData,
          });
        } else {
          result.fields[fieldName] = bodyData.toString("utf-8");
        }
      }
    }

    start = nextStart;
  }

  return result;
}

export interface UploadPayload {
  buffer: Buffer;
  key: string;
  bucket: string;
  contentType: string;
  fileName?: string;
  size: number;
  fields?: Record<string, string>;
}

/**
 * Extracts normalized upload payload from diverse HTTP request structures
 * (multipart/form-data, raw binary buffer, base64 in JSON, or streaming requests).
 */
export async function extractUploadPayload(req: any): Promise<UploadPayload> {
  const rawContentType = String(req.headers?.["content-type"] || req.headers?.["Content-Type"] || "");
  const reqContentType = rawContentType.toLowerCase();
  
  let rawBuffer: Buffer = Buffer.alloc(0);
  if (Buffer.isBuffer(req.body)) {
    rawBuffer = req.body;
  } else if (typeof req.body === "string") {
    rawBuffer = Buffer.from(req.body, "latin1");
  } else if (req.body?.rawBuffer && Buffer.isBuffer(req.body.rawBuffer)) {
    rawBuffer = req.body.rawBuffer;
  } else if (req.body?.buffer && Buffer.isBuffer(req.body.buffer)) {
    rawBuffer = req.body.buffer;
  } else if (typeof req.on === "function" && req.readable && !req.readableEnded) {
    rawBuffer = await streamToBuffer(req);
  }

  let resolvedBuffer: Buffer = Buffer.alloc(0);
  let resolvedKey = (req.query?.key as string) || (req.query?.storageKey as string) || (req.query?.objectKey as string) || (req.body?.key as string) || (req.body?.storageKey as string) || (req.body?.objectKey as string) || "";
  let resolvedBucket = (req.query?.bucket as string) || (req.body?.bucket as string) || "";
  let resolvedContentType = (req.query?.mimeType as string) || (req.query?.contentType as string) || (req.body?.mimeType as string) || (req.body?.contentType as string) || "";
  let resolvedFileName = (req.query?.filename as string) || (req.query?.fileName as string) || (req.body?.filename as string) || (req.body?.fileName as string) || "";
  let extractedFields: Record<string, string> = {};

  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    for (const [k, v] of Object.entries(req.body)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        extractedFields[k] = String(v);
      }
    }
  }

  // 1. Handle multipart/form-data
  if (reqContentType.includes("multipart/form-data")) {
    const boundaryMatch = rawContentType.match(/boundary=([^;]+)/i);
    const boundary = boundaryMatch ? boundaryMatch[1].trim().replace(/^["']|["']$/g, "") : "";
    if (boundary && rawBuffer.length > 0) {
      const parsed = parseMultipartFormData(rawBuffer, boundary);
      extractedFields = { ...extractedFields, ...parsed.fields };
      if (parsed.files.length > 0) {
        const filePart = parsed.files.find((f) => f.name === "file" || f.name === "pdf" || f.name === "image" || f.name === "note") || parsed.files[0];
        resolvedBuffer = filePart.data;
        resolvedFileName = resolvedFileName || filePart.filename || "";
        resolvedContentType = resolvedContentType || filePart.contentType || getMimeType(resolvedFileName);
      }
      resolvedKey = resolvedKey || parsed.fields.key || parsed.fields.storageKey || parsed.fields.objectKey || parsed.fields.storagePath || parsed.fields.path || "";
      resolvedBucket = resolvedBucket || parsed.fields.bucket || "";
      resolvedContentType = resolvedContentType || parsed.fields.mimeType || parsed.fields.contentType || "";
    }
  }

  // 2. Handle JSON with base64 payload
  if (resolvedBuffer.length === 0) {
    if (req.body && typeof req.body === "object" && req.body.base64) {
      resolvedBuffer = Buffer.from(req.body.base64, "base64");
      resolvedKey = resolvedKey || req.body.key || req.body.storageKey || req.body.objectKey || req.body.storagePath || "";
      resolvedBucket = resolvedBucket || req.body.bucket || "";
      resolvedContentType = resolvedContentType || req.body.mimeType || req.body.contentType || "";
    } else if (rawBuffer.length > 0 && reqContentType.includes("application/json")) {
      try {
        const parsed = JSON.parse(rawBuffer.toString("utf-8"));
        if (parsed.base64) {
          resolvedBuffer = Buffer.from(parsed.base64, "base64");
          resolvedKey = resolvedKey || parsed.key || parsed.storageKey || parsed.objectKey || parsed.storagePath || "";
          resolvedBucket = resolvedBucket || parsed.bucket || "";
          resolvedContentType = resolvedContentType || parsed.mimeType || parsed.contentType || "";
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
              extractedFields[k] = String(v);
            }
          }
        }
      } catch {}
    }
  }

  // 3. Handle raw binary buffer directly
  if (resolvedBuffer.length === 0 && rawBuffer.length > 0) {
    resolvedBuffer = rawBuffer;
  }

  // 4. Resolve MIME Type & Filename fallbacks
  if (!resolvedContentType || resolvedContentType === "application/octet-stream") {
    resolvedContentType = getMimeType(resolvedKey || resolvedFileName || "file.pdf");
  }

  return {
    buffer: resolvedBuffer,
    key: resolvedKey,
    bucket: resolvedBucket,
    contentType: resolvedContentType,
    fileName: resolvedFileName,
    size: resolvedBuffer.length,
    fields: extractedFields,
  };
}

/**
 * Robust slugifier for hierarchical storage keys:
 * Converts to lowercase, replaces spaces/underscores with hyphens, removes special characters.
 */
export function slugify(text: string | number | undefined | null): string {
  if (text === undefined || text === null) return "";
  const str = String(text).trim().toLowerCase();
  return str
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function slugifyClass(classGrade?: string): string {
  if (!classGrade) return "class-general";
  const clean = classGrade.trim().toLowerCase();
  if (clean.includes("upsc")) return "upsc";

  const romanMap: Record<string, number> = {
    xii: 12, xi: 11, x: 10, ix: 9, viii: 8, vii: 7, vi: 6, v: 5, iv: 4, iii: 3, ii: 2, i: 1
  };
  const numMatch = clean.match(/\d+/);
  if (numMatch) {
    return `class-${numMatch[0]}`;
  }
  for (const [roman, num] of Object.entries(romanMap)) {
    if (new RegExp(`\\b${roman}\\b`, "i").test(clean)) {
      return `class-${num}`;
    }
  }
  return slugify(classGrade) || "class-general";
}

export function slugifyGSPaper(paper?: string): string {
  if (!paper) return "gs-paper-1";
  const clean = paper.trim().toLowerCase();
  if (clean.includes("paper iv") || clean.includes("paper 4") || clean.includes("gs iv") || clean.includes("gs 4") || clean.includes("gs-4")) return "gs-paper-4";
  if (clean.includes("paper iii") || clean.includes("paper 3") || clean.includes("gs iii") || clean.includes("gs 3") || clean.includes("gs-3")) return "gs-paper-3";
  if (clean.includes("paper ii") || clean.includes("paper 2") || clean.includes("gs ii") || clean.includes("gs 2") || clean.includes("gs-2")) return "gs-paper-2";
  if (clean.includes("paper i") || clean.includes("paper 1") || clean.includes("gs i") || clean.includes("gs 1") || clean.includes("gs-1")) return "gs-paper-1";
  if (clean.includes("essay")) return "essay";
  if (clean.includes("csat")) return "csat";
  if (clean.includes("optional")) return "optional";
  return slugify(paper) || "gs-paper-1";
}

export function slugifySubject(subject?: string): string {
  if (!subject) return "general";
  return slugify(subject) || "general";
}

export function slugifyChapter(chapterNo?: number | string, chapterName?: string): string {
  let num = 1;
  if (chapterNo !== undefined && chapterNo !== null && chapterNo !== "") {
    const parsed = parseInt(String(chapterNo), 10);
    if (!isNaN(parsed) && parsed > 0) num = parsed;
  }
  let nameClean = (chapterName || "").trim();
  nameClean = nameClean.replace(/^(?:chapter|ch)\s*\d+[\s:-]*/i, "").trim();
  const nameSlug = slugify(nameClean);
  if (nameSlug) {
    return `chapter-${num}-${nameSlug}`;
  }
  return `chapter-${num}`;
}

export function slugifyModule(moduleNo?: number | string, moduleName?: string): string {
  let num = 1;
  if (moduleNo !== undefined && moduleNo !== null && moduleNo !== "") {
    const parsed = parseInt(String(moduleNo), 10);
    if (!isNaN(parsed) && parsed > 0) num = parsed;
  }
  let nameClean = (moduleName || "").trim();
  nameClean = nameClean.replace(/^(?:module|mod)\s*\d+[\s:-]*/i, "").trim();
  const nameSlug = slugify(nameClean);
  if (nameSlug) {
    return `module-${num}-${nameSlug}`;
  }
  return `module-${num}`;
}

export function slugifyTopic(topicNo?: number | string, topicName?: string): string {
  let numStr = "1";
  if (topicNo !== undefined && topicNo !== null && String(topicNo).trim() !== "") {
    const cleanNum = String(topicNo).trim().replace(/^(?:topic|part|t)\s*/i, "").trim();
    if (cleanNum) numStr = cleanNum;
  }
  let nameClean = (topicName || "").trim();
  nameClean = nameClean.replace(/^(?:topic|part)\s*\d+[\s:-]*/i, "").trim();
  const nameSlug = slugify(nameClean);
  const safeNumSlug = slugify(numStr);
  if (nameSlug) {
    return `topic-${safeNumSlug}-${nameSlug}`;
  }
  return `topic-${safeNumSlug}`;
}

export function generateHierarchicalNotePaths(params: {
  classGrade?: string;
  subject?: string;
  generalStudiesPaper?: string;
  chapterNo?: number | string;
  chapterName?: string;
  moduleNo?: number | string;
  moduleName?: string;
  topicNo?: number | string;
  topicName?: string;
  partLabel?: string;
  extension?: string;
}) {
  const rawClass = String(params.classGrade || "Class 10").trim();
  const isUPSC = rawClass.toUpperCase().includes("UPSC");
  const rawSubject = String(params.subject || "General").trim();
  const subjectSlug = slugifySubject(rawSubject);
  const ext = (params.extension || "pdf").replace(/^\.+/, "").toLowerCase();

  const rawTopicNo = params.topicNo || params.partLabel || "1";
  const rawTopicName = params.topicName || (typeof params.partLabel === "string" && !/^\d+$/.test(params.partLabel) ? params.partLabel : "");
  const topicSlug = slugifyTopic(rawTopicNo, rawTopicName);
  const topicNumber = String(rawTopicNo).replace(/^(?:topic|part)\s*/i, "").trim() || "1";
  const topicTitle = rawTopicName || `Topic ${topicNumber}`;

  if (isUPSC) {
    const rawGSPaper = params.generalStudiesPaper || "General Studies Paper I";
    const gsPaperSlug = slugifyGSPaper(rawGSPaper);
    const modNo = params.moduleNo || params.chapterNo || 1;
    const modName = params.moduleName || params.chapterName || `Module ${modNo}`;
    const moduleSlug = slugifyModule(modNo, modName);
    const moduleNumber = typeof modNo === "number" ? modNo : parseInt(String(modNo), 10) || 1;
    const moduleTitle = modName.replace(/^(?:module|mod)\s*\d+[\s:-]*/i, "").trim() || `Module ${moduleNumber}`;

    const folderPath = `notes/upsc/${gsPaperSlug}/${subjectSlug}/${moduleSlug}/${topicSlug}`;
    const documentId = `topic_upsc_${gsPaperSlug}_${subjectSlug}_${moduleSlug}_${topicSlug}`;

    return {
      isUPSC: true,
      classSlug: "upsc",
      className: "UPSC",
      subjectSlug,
      subjectName: rawSubject,
      gsPaperSlug,
      gsPaperName: rawGSPaper,
      moduleSlug,
      moduleNumber,
      moduleTitle,
      topicSlug,
      topicNumber,
      topicTitle,
      folderPath,
      pdfKey: `${folderPath}/note.${ext}`,
      metadataKey: `${folderPath}/metadata.json`,
      practiceTestKey: `${folderPath}/practice-test.json`,
      documentId,
      searchableText: `UPSC ${rawGSPaper} ${rawSubject} Module ${moduleNumber} ${moduleTitle} Topic ${topicNumber} ${topicTitle}`.trim(),
    };
  } else {
    const classSlug = slugifyClass(rawClass);
    const className = rawClass.startsWith("Class ") ? rawClass : `Class ${rawClass.replace(/\D/g, "") || "10"}`;
    const chNo = params.chapterNo || 1;
    const chName = params.chapterName || `Chapter ${chNo}`;
    const chapterSlug = slugifyChapter(chNo, chName);
    const chapterNumber = typeof chNo === "number" ? chNo : parseInt(String(chNo), 10) || 1;
    const chapterTitle = chName.replace(/^(?:chapter|ch)\s*\d+[\s:-]*/i, "").trim() || `Chapter ${chapterNumber}`;

    const folderPath = `notes/${classSlug}/${subjectSlug}/${chapterSlug}/${topicSlug}`;
    const documentId = `topic_${classSlug}_${subjectSlug}_${chapterSlug}_${topicSlug}`;

    return {
      isUPSC: false,
      classSlug,
      className,
      subjectSlug,
      subjectName: rawSubject,
      chapterSlug,
      chapterNumber,
      chapterTitle,
      topicSlug,
      topicNumber,
      topicTitle,
      folderPath,
      pdfKey: `${folderPath}/note.${ext}`,
      metadataKey: `${folderPath}/metadata.json`,
      practiceTestKey: `${folderPath}/practice-test.json`,
      documentId,
      searchableText: `${className} ${rawSubject} Chapter ${chapterNumber} ${chapterTitle} Topic ${topicNumber} ${topicTitle}`.trim(),
    };
  }
}
