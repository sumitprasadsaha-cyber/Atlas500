/**
 * Canonical Storage Key & Filename Architecture (Permanent Single Source of Truth)
 * 
 * Rules:
 * 1. Generate ONE canonical storage key exactly once. This key is immutable.
 * 2. The storage key must never be regenerated from other fields.
 * 3. File extension comes ONLY from the uploaded file (path.extname(file.name)). Never from MIME types.
 * 4. buildCanonicalStorageKey() is the SINGLE helper for generating storage keys.
 * 5. Firestore stores storageKey exactly as uploaded.
 * 6. Retrieval, Viewer, Signed URL, Download, Delete, Replace, Verification, Existence check ALL use note.storageKey directly.
 * 7. Replace reads existing storageKey, deletes old object, uploads new object to new canonical storageKey, stores new key.
 * 8. Delete deletes exactly note.storageKey.
 * 9. Upload validation verifies stored filename equals canonical filename and confirms object exists in R2.
 * 10. Single source of truth across frontend and backend.
 */

export interface CanonicalStorageKeyParams {
  type?: "school" | "upsc";
  noteType?: "school" | "upsc";
  className?: string;
  classGrade?: string;
  class?: string;
  subject?: string;
  subjectName?: string;
  gsPaper?: string;
  generalStudiesPaper?: string;
  paper?: string;
  chapterNumber?: number | string;
  chapterNo?: number | string;
  chapterName?: string;
  chapterTitle?: string;
  moduleNumber?: number | string;
  moduleNo?: number | string;
  moduleName?: string;
  moduleTitle?: string;
  topicNumber?: number | string;
  topicNo?: number | string;
  topic_number?: number | string;
  topicName?: string;
  topicTitle?: string;
  topic_name?: string;
  partLabel?: string;
  file?: { name: string; size?: number; type?: string } | null;
  fileName?: string;
  originalFilename?: string;
  pdfFileName?: string;
  customId?: string;
  uuid?: string;
  id?: string;
}

/**
 * Generates a standard uppercase UUID v4.
 */
export function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().toUpperCase();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
    .replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16).toUpperCase();
    });
}

/**
 * Extracts file extension ONLY from the file's name.
 * Rule 3: Never derive extension from MIME type. Never concatenate MIME.
 */
export function getFileExtension(filename?: string | null): string {
  if (!filename) return "pdf";
  const clean = String(filename).trim().split("?")[0].split("#")[0].replace(/\\/g, "/").split("/").pop() || "";
  const lastDot = clean.lastIndexOf(".");
  if (lastDot !== -1 && lastDot < clean.length - 1) {
    const ext = clean.substring(lastDot + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (ext) return ext;
  }
  return "pdf";
}

/**
 * Normalizes and formats filename strictly from the input file extension and UUID.
 * Result format: `<UUID>.<ext>` or `<cleanBaseName>.<ext>` if UUID already provided.
 * Rule 3: MIME types are never appended or sanitized into filename.
 */
export function getCanonicalFileName(rawFileName?: string | null, customUuid?: string): string {
  const ext = getFileExtension(rawFileName);
  const clean = String(rawFileName || "").trim().split("?")[0].split("#")[0].replace(/\\/g, "/").split("/").pop() || "";

  // If a custom UUID is provided, use it
  if (customUuid) {
    const cleanUuid = customUuid.replace(/[^a-zA-Z0-9-]/g, "");
    return `${cleanUuid}.${ext}`;
  }

  // Check if rawFileName base is already a UUID
  const lastDot = clean.lastIndexOf(".");
  const base = lastDot !== -1 ? clean.substring(0, lastDot) : clean;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(base);

  if (isUuid) {
    return `${base.toUpperCase()}.${ext}`;
  }

  const generated = generateUUID();
  return `${generated}.${ext}`;
}

/**
 * Sanitizes a path folder segment (alphanumeric and underscores).
 */
export function sanitizeFolderSegment(segment?: string | null, fallback = "General"): string {
  if (!segment) return fallback;
  const clean = String(segment)
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return clean || fallback;
}

/**
 * Pads numbers to two digits (e.g. 6 -> "06").
 */
function pad2(num: number | string): string {
  const n = parseInt(String(num).replace(/\D/g, ""), 10) || 1;
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Formats GS Paper folder (e.g. GS1, GS2, GS3, GS4, Essay, CSAT, Optional).
 */
export function formatGSPaperSegment(paper?: string | null): string {
  if (!paper) return "GS1";
  const clean = String(paper).trim();
  const m = clean.match(/(?:GS|Paper|General\s*Studies\s*Paper)\s*([1-4]|I{1,3}|IV)/i);
  if (m) {
    const val = m[1].toUpperCase();
    const map: Record<string, string> = { "1": "GS1", "2": "GS2", "3": "GS3", "4": "GS4", "I": "GS1", "II": "GS2", "III": "GS3", "IV": "GS4" };
    return map[val] || `GS_${val}`;
  }
  if (/^essay$/i.test(clean)) return "Essay";
  if (/^csat$/i.test(clean)) return "CSAT";
  if (/^ethics$/i.test(clean)) return "GS4";
  if (/^optional$/i.test(clean)) return "Optional";
  return sanitizeFolderSegment(clean, "GS1");
}

/**
 * Formats Class folder (e.g. "Class_9", "Class_10").
 */
export function formatClassSegment(classGrade?: string | null): string {
  if (!classGrade) return "Class_10";
  const clean = String(classGrade).trim();
  const m = clean.match(/(?:Class|Grade)?\s*(\d+)/i);
  if (m) {
    return `Class_${m[1]}`;
  }
  return sanitizeFolderSegment(clean, "Class_10");
}

/**
 * Formats Chapter/Module folder (e.g. "Chapter_06_How_Forces_Affect_Motion").
 */
export function formatChapterSegment(chNo: number | string, chName?: string | null): string {
  const padded = pad2(chNo);
  const rawName = (chName || "").replace(/^(?:chapter|ch|module|mod)\s*\.?\s*\d+\s*(?:[:–\-]|–|-)?\s*/i, "").trim();
  const cleanName = sanitizeFolderSegment(rawName, "");
  return cleanName ? `Chapter_${padded}_${cleanName}` : `Chapter_${padded}`;
}

export function formatModuleSegment(modNo: number | string, modName?: string | null): string {
  const padded = pad2(modNo);
  const rawName = (modName || "").replace(/^(?:module|mod|chapter|ch)\s*\.?\s*\d+\s*(?:[:–\-]|–|-)?\s*/i, "").trim();
  const cleanName = sanitizeFolderSegment(rawName, "");
  return cleanName ? `Module_${padded}_${cleanName}` : `Module_${padded}`;
}

/**
 * Formats Topic folder (e.g. "Topic_01_Test").
 */
export function formatTopicSegment(topicNo?: number | string | null, topicName?: string | null): string | undefined {
  const rawNo = topicNo !== undefined && topicNo !== null && String(topicNo).trim() !== "" ? String(topicNo).trim() : "";
  const rawName = (topicName || "").replace(/^(?:topic|part|pt)\s*\.?\s*\d+\s*(?:[:–\-]|–|-)?\s*/i, "").trim();

  if (!rawNo && !rawName) return undefined;

  const padded = rawNo ? pad2(rawNo) : "";
  const cleanName = sanitizeFolderSegment(rawName, "");

  if (padded && cleanName) {
    return `Topic_${padded}_${cleanName}`;
  }
  if (padded) {
    return `Topic_${padded}`;
  }
  if (cleanName) {
    return `Topic_${cleanName}`;
  }
  return undefined;
}

/**
 * Single Canonical Topic Note Key Builder (Requirement 2 & Rule 4).
 * Generates ONE immutable canonical storage key for Cloudflare R2.
 * 
 * Format:
 * School: class_notes/<Class>/<Subject>/<Chapter>/<Topic>/<UUID>.ext
 * UPSC: upsc/<GSPaper>/<Subject>/<Module>/<Topic>/<UUID>.ext
 * 
 * Examples:
 * School: class_notes/Class_9/Science/Chapter_06_How_Forces_Affect_Motion/Topic_01_Test/51E04BD5-AF70-42D5-A75D-B08A31A0589F.png
 * UPSC: upsc/GS1/Polity/Module_01_Indian_Constitution/Topic_01_Preamble/51E04BD5-AF70-42D5-A75D-B08A31A0589F.png
 */
export function generateTopicNoteKey(params: CanonicalStorageKeyParams): string {
  const rawFileName = (typeof params.file === "object" && params.file ? params.file.name : null) ||
    params.fileName ||
    params.originalFilename ||
    params.pdfFileName ||
    "note.pdf";

  const customUuid = params.customId || params.uuid || params.id;
  const canonicalFileName = getCanonicalFileName(rawFileName, customUuid);

  const rawClass = params.className || params.classGrade || params.class || "";
  const isUPSC =
    params.type === "upsc" ||
    params.noteType === "upsc" ||
    rawClass.trim().toUpperCase() === "UPSC" ||
    Boolean(params.gsPaper || params.generalStudiesPaper || params.paper || params.moduleNumber || params.moduleNo || params.moduleName || params.moduleTitle);

  const cleanSubject = sanitizeFolderSegment(params.subject || params.subjectName || "General", "General");

  // Topic parsing
  const rawTopicNo = params.topicNumber ?? params.topicNo ?? params.topic_number;
  const rawTopicName = params.topicName || params.topicTitle || params.topic_name || params.partLabel;
  const topicFolder = formatTopicSegment(rawTopicNo, rawTopicName);

  if (isUPSC) {
    const gsPaperFolder = formatGSPaperSegment(params.gsPaper || params.generalStudiesPaper || params.paper);
    const modNo = params.moduleNumber ?? params.moduleNo ?? params.chapterNumber ?? params.chapterNo ?? 1;
    const modName = params.moduleName || params.moduleTitle || params.chapterName || params.chapterTitle || "General";
    const moduleFolder = formatModuleSegment(modNo, modName);

    const folderPath = topicFolder
      ? `upsc/${gsPaperFolder}/${cleanSubject}/${moduleFolder}/${topicFolder}`
      : `upsc/${gsPaperFolder}/${cleanSubject}/${moduleFolder}`;

    return `${folderPath}/${canonicalFileName}`;
  } else {
    const classFolder = formatClassSegment(rawClass);
    const chNo = params.chapterNumber ?? params.chapterNo ?? 1;
    const chName = params.chapterName || params.chapterTitle || "General";
    const chapterFolder = formatChapterSegment(chNo, chName);

    const folderPath = topicFolder
      ? `class_notes/${classFolder}/${cleanSubject}/${chapterFolder}/${topicFolder}`
      : `class_notes/${classFolder}/${cleanSubject}/${chapterFolder}`;

    return `${folderPath}/${canonicalFileName}`;
  }
}

/**
 * Backward-compatible alias for generateTopicNoteKey.
 */
export function buildCanonicalStorageKey(params: CanonicalStorageKeyParams): string {
  return generateTopicNoteKey(params);
}

/**
 * Validates whether an uploaded object's key matches the canonical storage key structure.
 */
export function validateStorageKey(key: string): { isValid: boolean; error?: string; canonicalFileName?: string } {
  if (!key || typeof key !== "string" || !key.trim()) {
    return { isValid: false, error: "Storage key is empty or invalid" };
  }
  const clean = key.trim().replace(/^\/+/, "");
  const segments = clean.split("/");
  if (segments.length < 3) {
    return { isValid: false, error: "Storage key path has insufficient hierarchy segments" };
  }
  const filename = segments[segments.length - 1];
  if (!filename.includes(".")) {
    return { isValid: false, error: "Storage key filename is missing an extension" };
  }
  if (filename.includes("/") || filename.includes("\\")) {
    return { isValid: false, error: "Storage key filename contains illegal path separators" };
  }
  return { isValid: true, canonicalFileName: filename };
}
