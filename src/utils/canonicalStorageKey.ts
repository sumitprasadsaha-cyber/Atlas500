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

/**
 * Single Canonical Key Builder for Student Practice Test Attempts
 */
export function getStudentAttemptStoragePath(studentId: string): string {
  const clean = String(studentId || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]/g, "_");
  const normalizedId = clean.startsWith("student_") ? clean : `student_${clean || "unknown"}`;
  return `practice_tests/student_attempts/${normalizedId}.json`;
}

/**
 * Single Canonical Key for Global Test Attempts
 */
export function getPracticeTestAttemptsKey(): string {
  return "practice_tests/test_attempts.json";
}

/**
 * Single Canonical Key for Practice Test Bank
 */
export function getPracticeTestsBankKey(): string {
  return "practice_tests/test_bank.json";
}

/**
 * Single Canonical Key Builder for Curriculum Practice Tests
 */
export function buildPracticeTestKey(classGrade: string, subject: string, testId?: string): string {
  const classFolder = formatClassSegment(classGrade);
  const subjFolder = sanitizeFolderSegment(subject, "General");
  const cleanTestId = (testId || `test_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `practice_tests/${classFolder}/${subjFolder}/${cleanTestId}.json`;
}

/**
 * Single Canonical Key Builder for General Images / Assets
 */
export function buildImageStorageKey(category: string, filename?: string, customUuid?: string): string {
  const catFolder = sanitizeFolderSegment(category, "general");
  const canonicalFileName = getCanonicalFileName(filename || "image.png", customUuid);
  return `images/${catFolder}/${canonicalFileName}`;
}

/**
 * =========================================================================
 * METADATA-DRIVEN HIERARCHY PATH BUILDERS
 * Cloudflare R2 has no native folders; every node in the hierarchy
 * (Class, Subject, Chapter, Topic) has an explicit metadata.json object.
 * =========================================================================
 */

export interface HierarchyPathContext {
  category?: "school" | "upsc";
  type?: "school" | "upsc" | "class" | "subject" | "chapter" | "topic" | "gs_paper" | "module";
  nodeType?: "class" | "subject" | "chapter" | "topic" | "gs_paper" | "module";
  className?: string;
  classGrade?: string;
  gsPaper?: string;
  generalStudiesPaper?: string;
  subject?: string;
  subjectName?: string;
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
  topicName?: string;
  topicTitle?: string;
  partLabel?: string;
}

/**
 * School Hierarchy Metadata Paths
 */
export function getClassFolderPath(className: string): string {
  return `class_notes/${formatClassSegment(className)}`;
}

export function getClassMetadataKey(className: string): string {
  return `${getClassFolderPath(className)}/metadata.json`;
}

export function getSubjectFolderPath(className: string, subject: string): string {
  const classPath = getClassFolderPath(className);
  const cleanSubject = sanitizeFolderSegment(subject, "General");
  return `${classPath}/${cleanSubject}`;
}

export function getSubjectMetadataKey(className: string, subject: string): string {
  return `${getSubjectFolderPath(className, subject)}/metadata.json`;
}

export function getChapterFolderPath(
  className: string,
  subject: string,
  chNo: number | string,
  chName?: string | null
): string {
  const subjectPath = getSubjectFolderPath(className, subject);
  const chFolder = formatChapterSegment(chNo, chName);
  return `${subjectPath}/${chFolder}`;
}

export function getChapterMetadataKey(
  className: string,
  subject: string,
  chNo: number | string,
  chName?: string | null
): string {
  return `${getChapterFolderPath(className, subject, chNo, chName)}/metadata.json`;
}

export function getTopicFolderPath(
  className: string,
  subject: string,
  chNo: number | string,
  chName: string | null | undefined,
  topicNo: number | string | null | undefined,
  topicName: string | null | undefined
): string {
  const chapterPath = getChapterFolderPath(className, subject, chNo, chName);
  const topicFolder = formatTopicSegment(topicNo, topicName) || "Topic_01_General";
  return `${chapterPath}/${topicFolder}`;
}

export function getTopicMetadataKey(
  className: string,
  subject: string,
  chNo: number | string,
  chName: string | null | undefined,
  topicNo: number | string | null | undefined,
  topicName: string | null | undefined
): string {
  return `${getTopicFolderPath(className, subject, chNo, chName, topicNo, topicName)}/metadata.json`;
}

/**
 * UPSC Hierarchy Metadata Paths
 */
export function getGSPaperFolderPath(gsPaper: string): string {
  return `upsc/${formatGSPaperSegment(gsPaper)}`;
}

export function getGSPaperMetadataKey(gsPaper: string): string {
  return `${getGSPaperFolderPath(gsPaper)}/metadata.json`;
}

export function getUPSCOrSubjectFolderPath(gsPaper: string, subject: string): string {
  const paperPath = getGSPaperFolderPath(gsPaper);
  const cleanSubject = sanitizeFolderSegment(subject, "General");
  return `${paperPath}/${cleanSubject}`;
}

export function getUPSCOrSubjectMetadataKey(gsPaper: string, subject: string): string {
  return `${getUPSCOrSubjectFolderPath(gsPaper, subject)}/metadata.json`;
}

export function getUPSCModuleFolderPath(
  gsPaper: string,
  subject: string,
  modNo: number | string,
  modName?: string | null
): string {
  const subjectPath = getUPSCOrSubjectFolderPath(gsPaper, subject);
  const modFolder = formatModuleSegment(modNo, modName);
  return `${subjectPath}/${modFolder}`;
}

export function getUPSCModuleMetadataKey(
  gsPaper: string,
  subject: string,
  modNo: number | string,
  modName?: string | null
): string {
  return `${getUPSCModuleFolderPath(gsPaper, subject, modNo, modName)}/metadata.json`;
}

export function getUPSCTopicFolderPath(
  gsPaper: string,
  subject: string,
  modNo: number | string,
  modName: string | null | undefined,
  topicNo: number | string | null | undefined,
  topicName: string | null | undefined
): string {
  const modulePath = getUPSCModuleFolderPath(gsPaper, subject, modNo, modName);
  const topicFolder = formatTopicSegment(topicNo, topicName) || "Topic_01_General";
  return `${modulePath}/${topicFolder}`;
}

export function getUPSCTopicMetadataKey(
  gsPaper: string,
  subject: string,
  modNo: number | string,
  modName: string | null | undefined,
  topicNo: number | string | null | undefined,
  topicName: string | null | undefined
): string {
  return `${getUPSCTopicFolderPath(gsPaper, subject, modNo, modName, topicNo, topicName)}/metadata.json`;
}

export interface HierarchyNodeInfo {
  id: string;
  name: string;
  type: "class" | "subject" | "chapter" | "topic" | "gs_paper" | "module";
  category: "school" | "upsc";
  number?: number;
  folderPath: string;
  metadataKey: string;
  parentFolderPath?: string;
  parentMetadataKey?: string;
}

/**
 * Computes all ancestor and current hierarchy node metadata paths for a given note or hierarchy position.
 * Returns an ordered array of nodes from Root -> Class/GS Paper -> Subject -> Chapter/Module -> Topic.
 */
export function getHierarchyLineage(ctx: HierarchyPathContext): HierarchyNodeInfo[] {
  const rawClass = ctx.className || ctx.classGrade || "";
  const isUPSC =
    ctx.category === "upsc" ||
    ctx.type === "upsc" ||
    rawClass.trim().toUpperCase() === "UPSC" ||
    Boolean(ctx.gsPaper || ctx.generalStudiesPaper || ctx.moduleNumber || ctx.moduleNo || ctx.moduleName || ctx.moduleTitle);

  const lineage: HierarchyNodeInfo[] = [];

  if (isUPSC) {
    const rawPaper = ctx.gsPaper || ctx.generalStudiesPaper || "GS1";
    const paperFolder = formatGSPaperSegment(rawPaper);
    const paperPath = `upsc/${paperFolder}`;
    const paperKey = `${paperPath}/metadata.json`;

    lineage.push({
      id: `upsc_paper_${paperFolder.toLowerCase()}`,
      name: rawPaper,
      type: "gs_paper",
      category: "upsc",
      folderPath: paperPath,
      metadataKey: paperKey,
    });

    const rawSubj = ctx.subject || ctx.subjectName;
    if (rawSubj) {
      const cleanSubj = sanitizeFolderSegment(rawSubj, "General");
      const subjPath = `${paperPath}/${cleanSubj}`;
      const subjKey = `${subjPath}/metadata.json`;

      lineage.push({
        id: `upsc_subj_${paperFolder.toLowerCase()}_${cleanSubj.toLowerCase()}`,
        name: rawSubj,
        type: "subject",
        category: "upsc",
        folderPath: subjPath,
        metadataKey: subjKey,
        parentFolderPath: paperPath,
        parentMetadataKey: paperKey,
      });

      const rawModNo = ctx.moduleNumber ?? ctx.moduleNo ?? ctx.chapterNumber ?? ctx.chapterNo;
      const rawModName = ctx.moduleName || ctx.moduleTitle || ctx.chapterName || ctx.chapterTitle;

      if (rawModNo !== undefined && rawModNo !== null) {
        const modNo = typeof rawModNo === "number" ? rawModNo : parseInt(String(rawModNo).replace(/\D/g, ""), 10) || 1;
        const modFolder = formatModuleSegment(modNo, rawModName);
        const modPath = `${subjPath}/${modFolder}`;
        const modKey = `${modPath}/metadata.json`;

        lineage.push({
          id: `upsc_mod_${paperFolder.toLowerCase()}_${cleanSubj.toLowerCase()}_${modNo}`,
          name: rawModName || `Module ${modNo}`,
          type: "module",
          category: "upsc",
          number: modNo,
          folderPath: modPath,
          metadataKey: modKey,
          parentFolderPath: subjPath,
          parentMetadataKey: subjKey,
        });

        const rawTopicNo = ctx.topicNumber ?? ctx.topicNo;
        const rawTopicName = ctx.topicName || ctx.topicTitle || ctx.partLabel;

        if (rawTopicNo !== undefined || rawTopicName) {
          const topicFolder = formatTopicSegment(rawTopicNo, rawTopicName) || "Topic_01_General";
          const topicPath = `${modPath}/${topicFolder}`;
          const topicKey = `${topicPath}/metadata.json`;
          const topicNum = rawTopicNo !== undefined ? (typeof rawTopicNo === "number" ? rawTopicNo : parseInt(String(rawTopicNo).replace(/\D/g, ""), 10) || 1) : undefined;

          lineage.push({
            id: `upsc_topic_${paperFolder.toLowerCase()}_${cleanSubj.toLowerCase()}_${modNo}_${topicFolder.toLowerCase()}`,
            name: rawTopicName || `Topic ${rawTopicNo || 1}`,
            type: "topic",
            category: "upsc",
            number: topicNum,
            folderPath: topicPath,
            metadataKey: topicKey,
            parentFolderPath: modPath,
            parentMetadataKey: modKey,
          });
        }
      }
    }
  } else {
    // School hierarchy
    const cleanClass = rawClass || "Class 10";
    const classFolder = formatClassSegment(cleanClass);
    const classPath = `class_notes/${classFolder}`;
    const classKey = `${classPath}/metadata.json`;

    lineage.push({
      id: `school_class_${classFolder.toLowerCase()}`,
      name: cleanClass,
      type: "class",
      category: "school",
      folderPath: classPath,
      metadataKey: classKey,
    });

    const rawSubj = ctx.subject || ctx.subjectName;
    if (rawSubj) {
      const cleanSubj = sanitizeFolderSegment(rawSubj, "General");
      const subjPath = `${classPath}/${cleanSubj}`;
      const subjKey = `${subjPath}/metadata.json`;

      lineage.push({
        id: `school_subj_${classFolder.toLowerCase()}_${cleanSubj.toLowerCase()}`,
        name: rawSubj,
        type: "subject",
        category: "school",
        folderPath: subjPath,
        metadataKey: subjKey,
        parentFolderPath: classPath,
        parentMetadataKey: classKey,
      });

      const rawChNo = ctx.chapterNumber ?? ctx.chapterNo;
      const rawChName = ctx.chapterName || ctx.chapterTitle;

      if (rawChNo !== undefined && rawChNo !== null) {
        const chNo = typeof rawChNo === "number" ? rawChNo : parseInt(String(rawChNo).replace(/\D/g, ""), 10) || 1;
        const chFolder = formatChapterSegment(chNo, rawChName);
        const chPath = `${subjPath}/${chFolder}`;
        const chKey = `${chPath}/metadata.json`;

        lineage.push({
          id: `school_ch_${classFolder.toLowerCase()}_${cleanSubj.toLowerCase()}_${chNo}`,
          name: rawChName || `Chapter ${chNo}`,
          type: "chapter",
          category: "school",
          number: chNo,
          folderPath: chPath,
          metadataKey: chKey,
          parentFolderPath: subjPath,
          parentMetadataKey: subjKey,
        });

        const rawTopicNo = ctx.topicNumber ?? ctx.topicNo;
        const rawTopicName = ctx.topicName || ctx.topicTitle || ctx.partLabel;

        if (rawTopicNo !== undefined || rawTopicName) {
          const topicFolder = formatTopicSegment(rawTopicNo, rawTopicName) || "Topic_01_General";
          const topicPath = `${chPath}/${topicFolder}`;
          const topicKey = `${topicPath}/metadata.json`;
          const topicNum = rawTopicNo !== undefined ? (typeof rawTopicNo === "number" ? rawTopicNo : parseInt(String(rawTopicNo).replace(/\D/g, ""), 10) || 1) : undefined;

          lineage.push({
            id: `school_topic_${classFolder.toLowerCase()}_${cleanSubj.toLowerCase()}_${chNo}_${topicFolder.toLowerCase()}`,
            name: rawTopicName || `Topic ${rawTopicNo || 1}`,
            type: "topic",
            category: "school",
            number: topicNum,
            folderPath: topicPath,
            metadataKey: topicKey,
            parentFolderPath: chPath,
            parentMetadataKey: chKey,
          });
        }
      }
    }
  }

  return lineage;
}


