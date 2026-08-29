/**
 * Canonical Filename and Storage Key Builder
 * 
 * Strict separation of concerns:
 * - Object keys and filenames NEVER contain MIME types (e.g., "image/png").
 * - MIME types belong strictly in Content-Type headers, Firestore metadata, and HTTP metadata.
 * - Guarantees deterministic, safe, and uncorrupted file extensions and UUID/slug-based filenames.
 */

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
 * Resolves standard MIME type from extension or filename, without ever altering the key.
 */
export function inferMimeFromExtension(filenameOrExt?: string | null, fallback = "application/octet-stream"): string {
  if (!filenameOrExt) return fallback;
  const clean = String(filenameOrExt).trim().toLowerCase().split("?")[0].split("#")[0];
  const ext = clean.includes(".") ? clean.split(".").pop() || "" : clean;
  return EXTENSION_TO_MIME_MAP[ext] || (ext === "pdf" ? "application/pdf" : fallback);
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
    // Validate if it's a known extension
    if (VALID_EXTENSIONS.has(possibleExt)) {
      return possibleExt;
    }
    // Clean alphanumeric extension up to 5 chars
    const cleanedExt = possibleExt.replace(/[^a-z0-9]/gi, "").slice(0, 5).toLowerCase();
    if (VALID_EXTENSIONS.has(cleanedExt)) {
      return cleanedExt;
    }
  }

  // If filename had no valid extension, infer strictly from MIME type
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

  // Strip corrupted MIME suffixes like .primage/png, .image/png, .application/pdf, etc.
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
 * 
 * Example:
 * buildCanonicalFilename({ fileName: "51E04BD5-AF70-42D5-A75D-B08A31A0589F.primage/png", mimeType: "image/png" })
 * => "51E04BD5-AF70-42D5-A75D-B08A31A0589F.png"
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
 * Cleans a complete storage key (e.g. R2 / S3 path), ensuring no segment contains MIME types
 * and the final filename is clean.
 */
export function sanitizeCanonicalStorageKey(rawKey: string | null | undefined, mimeType?: string | null): string {
  if (!rawKey) return "";
  let clean = String(rawKey).trim().replace(/\\/g, "/");

  // Remove query params and hashes
  if (clean.includes("?")) clean = clean.split("?")[0];
  if (clean.includes("#")) clean = clean.split("#")[0];

  // Remove leading slashes and collapse duplicate slashes
  clean = clean.replace(/^\/+/, "").replace(/\/{2,}/g, "/");

  const segments = clean.split("/").filter((s) => s.length > 0 && s !== "." && s !== "..");
  if (segments.length === 0) return "";

  // The last segment is the filename
  const filenameSegment = segments.pop()!;
  const cleanFilename = buildCanonicalFilename({
    fileName: filenameSegment,
    mimeType,
    defaultBaseName: "note",
  });

  // Clean directory segments (ensure no directory segment accidentally has MIME or invalid chars)
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
