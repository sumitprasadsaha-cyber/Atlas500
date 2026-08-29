/**
 * Unified Cloudflare R2 Storage Service
 * 
 * Production-ready storage service with Cloudflare R2.
 * Preserves all method signatures, path conventions, UPSC hierarchy structures,
 * progress callbacks, and viewer resolution logic.
 */

import {
  getR2BucketName,
  getR2PublicUrl,
  getR2SignedUrl,
  getR2SignedUrlDetails,
  uploadToR2,
  downloadFromR2,
  deleteFromR2,
  deleteMultipleFromR2,
  listFromR2,
  verifyR2ObjectExists,
  type R2UploadResult,
  type R2ObjectInfo,
} from "./r2Client";
import { safeLocalStorageSetItem } from "./safeStorage";
import {
  generateTopicNoteKey,
  buildCanonicalStorageKey,
  getCanonicalFileName,
  getFileExtension,
  type CanonicalStorageKeyParams,
} from "../utils/canonicalStorageKey";
import { saveClassNoteDoc, deleteClassNoteDoc, getLocalClassNotes } from "./firestoreService";
import { notesCacheService } from "./notesCacheService";
import { notesLogger } from "./notesLogger";
import { deleteTopicPracticeTest } from "./practiceTestService";
import type { ClassNote } from "../types";
import { buildCanonicalNoteMetadata, validateCanonicalNoteMetadata } from "../domain/notes/types";

// Re-export canonical key generator as single source of truth
export { generateTopicNoteKey, buildCanonicalStorageKey };

export interface UploadTopicNoteParams {
  file: File | Blob;
  metadata: {
    id?: string;
    type?: "school" | "upsc";
    noteType?: "school" | "upsc";
    className?: string;
    classGrade?: string;
    subject?: string;
    subjectName?: string;
    gsPaper?: string;
    generalStudiesPaper?: string;
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
    title?: string;
    visibility?: "all" | "selected" | "hidden";
    allowedStudentIds?: string[];
    allowedClasses?: string[];
    uploadedBy?: string;
    isDownloadable?: boolean;
  };
  onProgress?: (percent: number) => void;
}

export interface ReplaceTopicNoteParams {
  noteId: string;
  currentNote: ClassNote;
  newFile: File;
  onProgress?: (percent: number) => void;
}

export interface DeleteTopicNoteParams {
  noteId: string;
  note?: ClassNote;
  objectKey?: string;
}

export interface GetTopicNoteParams {
  noteId?: string;
  note?: ClassNote;
  objectKey?: string;
}

/**
 * 1. Single Upload Pipeline
 * Converts File -> ArrayBuffer only once, validates size > 0, uploads to Cloudflare R2,
 * verifies object existence, and persists to Firestore.
 */
export async function uploadTopicNote(params: UploadTopicNoteParams): Promise<ClassNote> {
  const { file, metadata, onProgress } = params;

  if (!file || file.size <= 0) {
    throw new Error("Invalid file. File size must be greater than 0 bytes.");
  }

  const rawFileName = (file as File)?.name || "note.pdf";
  const canonicalFileName = getCanonicalFileName(rawFileName);
  const cleanExt = getFileExtension(rawFileName);
  const mimeType = (file as any).type || (cleanExt === "pdf" ? "application/pdf" : `image/${cleanExt}`);

  // 1. Generate ONE canonical storage key
  const canonicalStorageKey = generateTopicNoteKey({
    className: metadata.classGrade || metadata.className || "Class 10",
    subject: metadata.subject || metadata.subjectName || "General",
    gsPaper: metadata.gsPaper || metadata.generalStudiesPaper,
    chapterNumber: metadata.chapterNumber ?? metadata.chapterNo,
    chapterName: metadata.chapterName || metadata.chapterTitle,
    moduleNumber: metadata.moduleNumber ?? metadata.moduleNo,
    moduleName: metadata.moduleName || metadata.moduleTitle,
    topicNumber: metadata.topicNumber ?? metadata.topicNo ?? metadata.partLabel,
    topicName: metadata.topicName || metadata.topicTitle || metadata.title,
    partLabel: metadata.partLabel,
    fileName: canonicalFileName,
  });

  // 2. Logging: Generated Key, Received File Name, Buffer Size
  console.log(`[StorageService] Upload Pipeline Started:`);
  console.log(`  - Generated Key: "${canonicalStorageKey}"`);
  console.log(`  - Received File Name: "${rawFileName}" -> Canonical: "${canonicalFileName}"`);
  console.log(`  - Buffer Size: ${file.size} bytes`);
  notesLogger.info("UPLOAD_START", {
    storageKey: canonicalStorageKey,
    fileName: canonicalFileName,
    fileSize: file.size,
  });

  const bucket = getR2BucketName();

  // 3. Upload to Cloudflare R2
  const uploadResult = await uploadToR2({
    bucket,
    key: canonicalStorageKey,
    file,
    mimeType,
    onProgress: (pct) => {
      if (onProgress) onProgress(Math.min(95, pct));
    },
  });

  // 4. Verify object existence in R2 before writing database record
  const verifyCheck = await verifyR2ObjectExists({ bucket, key: canonicalStorageKey });
  if (!verifyCheck || !verifyCheck.exists) {
    await deleteFromR2({ bucket, key: canonicalStorageKey }).catch(() => {});
    throw new Error(`Upload verification failed: HeadObject confirmed object does not exist in R2 for key "${canonicalStorageKey}".`);
  }

  // 5. Logging: Upload Success
  console.log(`[StorageService] Upload Success for key: "${canonicalStorageKey}"`);
  notesLogger.info("UPLOAD_SUCCESS", {
    storageKey: canonicalStorageKey,
    durationMs: Date.now(),
  });

  const downloadUrl = `/api/storage?action=download&bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(canonicalStorageKey)}`;
  const publicUrl = uploadResult.url || getR2PublicUrl(bucket, canonicalStorageKey);

  const isUPSC = metadata.type === "upsc" || metadata.noteType === "upsc" || metadata.classGrade === "UPSC";
  const chapterNo = isUPSC ? metadata.moduleNumber : metadata.chapterNumber;
  const chapterName = isUPSC ? metadata.moduleName : metadata.chapterName;

  const noteId = metadata.id || `note_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const createdNote: ClassNote = {
    id: noteId,
    classGrade: metadata.classGrade || metadata.className || "Class 10",
    subject: metadata.subject || metadata.subjectName || "General",
    chapterNo: Number(chapterNo) || 1,
    chapterName: String(chapterName || "Chapter 1"),
    topicNo: metadata.topicNumber ?? metadata.topicNo,
    topicName: metadata.topicName || metadata.topicTitle || metadata.title || "Topic Note",
    partLabel: metadata.partLabel,
    fileName: canonicalFileName,
    originalFilename: rawFileName,
    pdfFileName: canonicalFileName,
    objectKey: canonicalStorageKey,
    storageKey: canonicalStorageKey,
    storagePath: canonicalStorageKey,
    r2Key: canonicalStorageKey,
    downloadKey: canonicalStorageKey,
    pdfUrl: downloadUrl,
    publicUrl,
    downloadUrl,
    fileSize: file.size,
    mimeType,
    visibility: metadata.visibility || "all",
    allowedStudentIds: metadata.allowedStudentIds,
    allowedClasses: metadata.allowedClasses,
    uploadedBy: metadata.uploadedBy || "Admin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 6. Persist to Firestore database
  await saveClassNoteDoc(createdNote);

  // 7. Logging: Database Update
  console.log(`[StorageService] Database Update Success: noteId="${createdNote.id}", objectKey="${canonicalStorageKey}"`);
  notesLogger.info("UPLOAD_SUCCESS", {
    noteId: createdNote.id,
    storageKey: canonicalStorageKey,
  });

  // 8. Purge caches
  await notesCacheService.invalidateMetadataCache();
  await notesCacheService.invalidateBlobCache(canonicalStorageKey);

  if (onProgress) onProgress(100);
  return createdNote;
}

/**
 * 2. Replace Pipeline
 * Generates canonical key, uploads new file, verifies HEAD check,
 * removes old storage key (if changed), and updates Firestore document.
 */
export async function replaceTopicNote(params: ReplaceTopicNoteParams): Promise<ClassNote> {
  const { noteId, currentNote, newFile, onProgress } = params;

  if (!newFile || newFile.size <= 0) {
    throw new Error("Invalid replacement file. File size must be greater than 0 bytes.");
  }

  const existingObjectKey =
    currentNote.objectKey ||
    currentNote.storageKey ||
    currentNote.storagePath ||
    currentNote.r2Key ||
    "";

  const rawFileName = newFile.name || "note.pdf";
  const canonicalFileName = getCanonicalFileName(rawFileName);
  const cleanExt = getFileExtension(rawFileName);
  const mimeType = newFile.type || (cleanExt === "pdf" ? "application/pdf" : `image/${cleanExt}`);

  // Generate canonical key for replacement
  const newStorageKey = generateTopicNoteKey({
    className: (currentNote as any).classGrade || (currentNote as any).className || "Class 10",
    subject: (currentNote as any).subject || (currentNote as any).subjectName || "General",
    gsPaper: (currentNote as any).gsPaper || (currentNote as any).generalStudiesPaper,
    chapterNumber: (currentNote as any).chapterNumber ?? (currentNote as any).chapterNo ?? 1,
    chapterName: (currentNote as any).chapterName ?? (currentNote as any).chapterTitle ?? "Chapter 1",
    moduleNumber: (currentNote as any).moduleNumber ?? (currentNote as any).moduleNo ?? 1,
    moduleName: (currentNote as any).moduleName ?? (currentNote as any).moduleTitle ?? "Module 1",
    topicNumber: (currentNote as any).topicNumber ?? (currentNote as any).topicNo,
    topicName: (currentNote as any).topicName ?? (currentNote as any).topicTitle,
    partLabel: (currentNote as any).partLabel,
    fileName: canonicalFileName,
  });

  // Logging: Generated Key, Received File Name, Buffer Size
  console.log(`[StorageService] Replace Pipeline Started:`);
  console.log(`  - Note ID: "${noteId}"`);
  console.log(`  - Old Object Key: "${existingObjectKey}"`);
  console.log(`  - New Object Key: "${newStorageKey}"`);
  console.log(`  - Received File: "${rawFileName}" (${newFile.size} bytes)`);
  notesLogger.info("REPLACE_START", {
    noteId,
    storageKey: newStorageKey,
    fileSize: newFile.size,
  });

  const bucket = getR2BucketName();
  let newFileUploaded = false;

  try {
    // 1. Upload new file to R2
    const uploadRes = await uploadToR2({
      bucket,
      key: newStorageKey,
      file: newFile,
      mimeType,
      onProgress: (pct) => {
        if (onProgress) onProgress(Math.min(95, pct));
      },
    });
    newFileUploaded = true;

    // 2. Verify object existence via HeadObject
    const headCheck = await verifyR2ObjectExists({ bucket, key: newStorageKey });
    if (!headCheck || !headCheck.exists) {
      throw new Error(`Replacement verification failed: HeadObject confirmed object does not exist for key "${newStorageKey}".`);
    }

    // Logging: Upload Success
    console.log(`[StorageService] Replace Upload Success: "${newStorageKey}"`);
    notesLogger.info("REPLACE_SUCCESS", {
      noteId,
      storageKey: newStorageKey,
    });

    const downloadUrl = `/api/storage?action=download&bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(newStorageKey)}`;
    const publicUrl = uploadRes.url || getR2PublicUrl(bucket, newStorageKey);

    const updatedNote: ClassNote = {
      ...currentNote,
      originalFilename: rawFileName,
      fileName: canonicalFileName,
      pdfFileName: canonicalFileName,
      objectKey: newStorageKey,
      r2Key: newStorageKey,
      storageKey: newStorageKey,
      storagePath: newStorageKey,
      downloadKey: newStorageKey,
      pdfUrl: downloadUrl,
      publicUrl,
      downloadUrl,
      fileSize: newFile.size,
      mimeType,
      updatedAt: new Date().toISOString(),
    };

    // 3. Update Firestore record
    await saveClassNoteDoc(updatedNote);

    // 4. Clean up old object in R2 ONLY after Firestore update succeeds
    if (existingObjectKey && existingObjectKey !== newStorageKey) {
      await deleteFromR2({ bucket, key: existingObjectKey }).catch((delErr) => {
        console.warn(`[StorageService] Note: could not delete old key "${existingObjectKey}":`, delErr);
      });
    }

    // Logging: Database Update
    console.log(`[StorageService] Database Update Success for Replaced Note: noteId="${noteId}"`);
    notesLogger.info("REPLACE_SUCCESS", {
      noteId,
      storageKey: newStorageKey,
      fileSize: updatedNote.fileSize,
    });

    // 5. Invalidate caches
    await notesCacheService.invalidateMetadataCache();
    if (existingObjectKey) {
      await notesCacheService.invalidateBlobCache(existingObjectKey);
    }
    await notesCacheService.invalidateBlobCache(newStorageKey);

    if (onProgress) onProgress(100);
    return updatedNote;
  } catch (err: any) {
    if (newFileUploaded && existingObjectKey && existingObjectKey !== newStorageKey) {
      console.warn(`[StorageService] Rolling back replacement upload "${newStorageKey}"...`);
      await deleteFromR2({ bucket, key: newStorageKey }).catch(() => {});
    }
    throw err;
  }
}

/**
 * 3. Delete Pipeline
 * Reads database objectKey, deletes object from R2, deletes Firestore document,
 * cleans up practice tests, and invalidates cache.
 */
export async function deleteTopicNote(params: DeleteTopicNoteParams): Promise<{ success: boolean; deletedKey: string }> {
  const { noteId, note } = params;
  const targetKey =
    note?.objectKey ||
    note?.storageKey ||
    note?.storagePath ||
    note?.r2Key ||
    params.objectKey ||
    "";

  console.log(`[StorageService] Delete Pipeline Started: noteId="${noteId}", targetKey="${targetKey}"`);
  notesLogger.info("DELETE_START", { noteId, storageKey: targetKey });

  const bucket = getR2BucketName();

  // 1. Delete object from R2 if key is present
  if (targetKey) {
    await deleteFromR2({ bucket, key: targetKey }).catch((err) => {
      console.warn(`[StorageService] R2 delete notice for key "${targetKey}":`, err);
    });
    console.log(`[StorageService] Delete Success for R2 Key: "${targetKey}"`);
    notesLogger.info("DELETE_SUCCESS", { noteId, storageKey: targetKey });
  }

  // 2. Delete Firestore database record
  await deleteClassNoteDoc(noteId);
  console.log(`[StorageService] Database Record Deleted: noteId="${noteId}"`);
  notesLogger.info("DELETE_SUCCESS", { noteId });

  // 3. Clean up associated practice tests
  if (note) {
    const isUpsc = note.isUPSC || (note as any).type === "upsc" || (note as any).noteType === "upsc" || note.classGrade === "UPSC";
    const classGrade = isUpsc ? "UPSC" : ((note as any).className || note.classGrade || "Class 10");
    const subject = (note as any).subjectName || note.subject || "";
    const rawChNo = (note as any).chapterNumber ?? note.chapterNo ?? (note as any).moduleNumber ?? 1;
    const chapterNo = typeof rawChNo === "number" ? rawChNo : parseInt(String(rawChNo).replace(/\D/g, ""), 10) || 1;
    const topicName = ((note as any).topicTitle || (note as any).topicName || note.partLabel || "").trim();

    if (subject && topicName) {
      await deleteTopicPracticeTest(classGrade, subject, chapterNo, topicName).catch(() => {});
    }
  }

  // 4. Invalidate caches
  await notesCacheService.invalidateMetadataCache();
  if (targetKey) {
    await notesCacheService.invalidateBlobCache(targetKey);
  }

  return { success: true, deletedKey: targetKey };
}

/**
 * 4. Retrieval Pipeline
 * Uses database.objectKey directly as single source of truth.
 * Never guesses filenames or reconstructs paths.
 */
export async function getTopicNote(params: GetTopicNoteParams): Promise<(ClassNote & { viewUrl: string; downloadUrl: string }) | null> {
  const { noteId, objectKey } = params;

  let resolvedNote = params.note;
  if (!resolvedNote && noteId) {
    const allNotes = getLocalClassNotes();
    resolvedNote = allNotes.find((n) => n.id === noteId);
  }

  const targetKey =
    resolvedNote?.objectKey ||
    resolvedNote?.storageKey ||
    resolvedNote?.storagePath ||
    resolvedNote?.r2Key ||
    objectKey ||
    "";

  if (!resolvedNote && !targetKey) {
    return null;
  }

  const bucket = getR2BucketName();
  const downloadUrl = `/api/storage?action=download&bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(targetKey)}`;
  const viewUrl = getR2PublicUrl(bucket, targetKey) || downloadUrl;
  const fileName = targetKey.split("/").pop() || "note.pdf";

  const baseNote: ClassNote = resolvedNote || {
    id: noteId || "unknown",
    classGrade: "Class 10",
    subject: "General",
    chapterNo: 1,
    chapterName: "Chapter 1",
    fileName,
    pdfFileName: fileName,
    originalFilename: fileName,
    objectKey: targetKey,
    storageKey: targetKey,
    storagePath: targetKey,
    pdfUrl: downloadUrl,
    downloadUrl,
    createdAt: new Date().toISOString(),
  };

  return {
    ...baseNote,
    objectKey: targetKey,
    storageKey: targetKey,
    storagePath: targetKey,
    viewUrl,
    downloadUrl,
  };
}

const PDF_MIME_TYPE = "application/pdf";

function getRuntimeEnvValue(key: string, fallback = ""): string {
  try {
    const env = typeof import.meta !== "undefined" ? (import.meta as any).env : undefined;
    if (env && typeof env[key] === "string") {
      return env[key];
    }
  } catch {
    // Ignore env lookup issues in non-Vite runtimes.
  }
  return fallback;
}

function isInvalidStorageReference(input: string): boolean {
  const clean = String(input || "").trim().toLowerCase();
  if (clean.includes("/api/r2/")) {
    return false; // Valid proxy endpoint
  }
  return (
    clean.startsWith("blob:") ||
    clean.startsWith("data:") ||
    clean.startsWith("file://") ||
    clean.includes("temporary") ||
    clean.includes("temp/") ||
    clean.includes("tmp/")
  );
}

function normalizeUploadedStoragePath(bucket: string, rawPath: string): string {
  const sanitized = sanitizeStoragePath(rawPath, bucket);
  if (!sanitized) {
    throw new Error("Invalid storage path specified.");
  }
  return sanitized;
}

function validatePdfBlob(blob: Blob | null): Blob {
  if (!blob) {
    throw new Error("File not found.");
  }

  if (!(blob instanceof Blob)) {
    throw new Error("Invalid PDF response.");
  }

  if (blob.size <= 0) {
    throw new Error("Empty file.");
  }

  const mimeType = (blob.type || "").toLowerCase();
  if (mimeType && mimeType !== PDF_MIME_TYPE && !mimeType.includes("octet-stream")) {
    throw new Error(`Invalid PDF MIME type: ${mimeType}`);
  }

  return blob;
}

export interface R2UploadMetadata {
  storageProvider: "r2";
  bucket: string;
  storagePath: string;
  storageKey?: string;
  objectKey?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
  uploadedBy: string;
  downloadUrl: string;
}

/**
 * Returns the configured Cloudflare R2 bucket name.
 */
export function getBucketName(customBucket?: string): string {
  return getR2BucketName(customBucket);
}

/**
 * Sanitizes and normalizes raw storage paths or URLs into a clean, relative Cloudflare R2 storage key.
 * Ensures:
 * - No leading slashes
 * - No double slashes
 * - Bucket name is not duplicated inside path
 * - No undefined, null, or empty path segments
 * - Only valid URL-safe characters in path segments
 */
export function sanitizeStoragePath(rawPath: string | null | undefined, bucketName?: string): string {
  if (!rawPath) return "";

  let cleaned = String(rawPath).trim();
  if (!cleaned) return "";

  if (isInvalidStorageReference(cleaned)) {
    console.error(`[StorageService] Rejected invalid storage reference:`, cleaned);
    return "";
  }

  // 0. Handle JSON metadata strings
  if (cleaned.startsWith("{")) {
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed.storagePath) {
        cleaned = String(parsed.storagePath).trim();
      } else if (parsed.downloadUrl) {
        cleaned = String(parsed.downloadUrl).trim();
      } else if (parsed.url) {
        cleaned = String(parsed.url).trim();
      }
    } catch (e) {
      // Ignore JSON parse errors
    }
  }

  // 1. Check for /api/storage, /api/notes, /api/r2 endpoints or any query parameters
  if (
    cleaned.includes("/api/storage") ||
    cleaned.includes("/api/notes") ||
    cleaned.includes("/api/r2/") ||
    cleaned.includes("key=") ||
    cleaned.includes("storageKey=") ||
    cleaned.includes("storagePath=")
  ) {
    try {
      const fakeBase = "http://localhost";
      const urlObj = new URL(cleaned.startsWith("http") ? cleaned : `${fakeBase}${cleaned.startsWith("/") ? "" : "/"}${cleaned}`);
      const keyParam = urlObj.searchParams.get("key") || urlObj.searchParams.get("storageKey") || urlObj.searchParams.get("storagePath");
      if (keyParam) {
        cleaned = decodeURIComponent(keyParam);
      }
    } catch {
      const match = cleaned.match(/[?&](?:key|storageKey|storagePath)=([^&]+)/);
      if (match && match[1]) {
        cleaned = decodeURIComponent(match[1]);
      }
    }
  }

  // 2. Normalize slashes & remove quotes
  cleaned = cleaned.replace(/\\/g, "/");
  cleaned = cleaned.replace(/^["']|["']$/g, "");

  // 3. Handle gs:// or s3:// protocol URLs
  if (cleaned.startsWith("gs://") || cleaned.startsWith("s3://")) {
    const withoutPrefix = cleaned.substring(5);
    const slashIdx = withoutPrefix.indexOf("/");
    if (slashIdx !== -1) {
      cleaned = withoutPrefix.substring(slashIdx + 1);
    } else {
      cleaned = "";
    }
  }

  // 4. Extract path from full HTTPS URLs (e.g. public R2 domain or proxy URL)
  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
    try {
      const urlObj = new URL(cleaned);
      const pathname = urlObj.pathname;

      if (pathname.includes("/api/r2/download") && urlObj.searchParams.get("key")) {
        return sanitizeStoragePath(urlObj.searchParams.get("key")!, bucketName);
      }

      const storageObjMatch = pathname.match(
        /\/storage\/v1\/object\/(?:public|sign|authenticated)\/[^\/]+\/(.+)/
      );
      if (storageObjMatch && storageObjMatch[1]) {
        try {
          cleaned = decodeURIComponent(storageObjMatch[1]);
        } catch {
          cleaned = storageObjMatch[1];
        }
      } else {
        const pathSegments = pathname.replace(/^\/+/, "").split("/");
        const activeBucket = getBucketName(bucketName);
        if (pathSegments[0] === activeBucket) {
          pathSegments.shift();
        }
        if (pathSegments.length > 0) {
          cleaned = pathSegments.join("/");
        } else {
          return "";
        }
      }
    } catch (e) {
      // Ignore URL parsing errors
    }
  }

  // 5. Safely decode URI encoded characters if present
  if (cleaned.includes("%")) {
    try {
      let decoded = decodeURIComponent(cleaned);
      if (decoded.includes("%")) {
        decoded = decodeURIComponent(decoded);
      }
      cleaned = decoded;
    } catch {
      // Keep cleaned as is if decode fails
    }
  }

  // 6. Strip query parameters and hash fragments (if any remain)
  if (cleaned.includes("?")) {
    cleaned = cleaned.split("?")[0];
  }
  if (cleaned.includes("#")) {
    cleaned = cleaned.split("#")[0];
  }

  // 7. Remove leading and duplicate slashes
  cleaned = cleaned.replace(/^\/+/, "").replace(/\/+/g, "/");

  // 8. Strip duplicate bucket prefix if present (only if it's the actual R2 bucket name 'academy-connect-files/')
  if (cleaned.startsWith("academy-connect-files/")) {
    cleaned = cleaned.substring("academy-connect-files/".length);
  }
  if (cleaned.startsWith("notes/notes/")) {
    cleaned = "notes/" + cleaned.substring("notes/notes/".length);
  }
  if (cleaned.startsWith("profile-photos/profile-photos/")) {
    cleaned = "profile-photos/" + cleaned.substring("profile-photos/profile-photos/".length);
  }
  if (cleaned.startsWith("reports/reports/")) {
    cleaned = "reports/" + cleaned.substring("reports/reports/".length);
  }

  // Strip leading slashes again after prefix removal
  cleaned = cleaned.replace(/^\/+/, "");

  // 9. Remove trailing slashes
  cleaned = cleaned.replace(/\/+$/, "");

  // 10. Clean individual path segments
  const segments = cleaned
    .split("/")
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0 && seg !== "." && seg !== "..");

  const finalPath = segments.join("/");
  return finalPath;
}

/**
 * Path builder helpers ensuring sanitized input segments
 */
export function buildNoteStoragePath(studentId: string, fileName: string): string {
  const safeStudentId = (studentId || "general").replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = Date.now();
  const cleanFileName = (fileName || "document.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
  const raw = `notes/${safeStudentId}/${timestamp}-${cleanFileName}`;
  return sanitizeStoragePath(raw);
}

export function buildProfilePhotoStoragePath(userId: string, originalFileName: string = "profile.png"): string {
  const safeUserId = (userId || "user").replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000000);
  const cleanFileName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const raw = `profile-photos/${safeUserId}/${timestamp}-${random}-${cleanFileName}`;
  return sanitizeStoragePath(raw);
}

export function buildReportStoragePath(studentId: string, fileName: string): string {
  const safeStudentId = (studentId || "student").replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000000);
  const cleanFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const raw = `reports/${safeStudentId}/${timestamp}-${random}-${cleanFileName}`;
  return sanitizeStoragePath(raw);
}

export function buildQuestionImageStoragePath(topicOrTestId: string, originalFileName: string = "image.png"): string {
  const safeTopic = (topicOrTestId || "practice-tests").replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000000);
  const cleanFileName = (originalFileName || "image.png").replace(/[^a-zA-Z0-9._-]/g, "_");
  const raw = `question-images/${safeTopic}/${timestamp}-${random}-${cleanFileName}`;
  return sanitizeStoragePath(raw);
}

/**
 * Uploads a file or blob to Cloudflare R2 Storage.
 * Logs bucket name, upload key, and storage responses.
 * Throws exact error message if upload fails.
 */
export async function uploadFileToR2(
  bucketInput: string,
  rawPath: string,
  file: File | Blob,
  fileName: string,
  uploadedBy: string = "System",
  onProgress?: (percent: number) => void
): Promise<R2UploadMetadata> {
  const bucket = getBucketName(bucketInput);
  const sanitizedPath = normalizeUploadedStoragePath(bucket, rawPath);
  const isPdf = fileName.toLowerCase().endsWith(".pdf");
  const isImage = fileName.toLowerCase().match(/\.(png|jpg|jpeg|webp|gif|svg)$/i) || (!isPdf && (file.type || "").startsWith("image"));
  const mimeType = file.type || (isPdf ? PDF_MIME_TYPE : isImage ? "image/jpeg" : "application/octet-stream");

  console.log(`[StorageService] Uploading file to Cloudflare R2:`);
  console.log(`  - Bucket Name: "${bucket}"`);
  console.log(`  - Storage Path: "${sanitizedPath}"`);
  console.log(`  - File Name: "${fileName}"`);
  console.log(`  - Size: ${file.size} bytes`);
  console.log(`  - MIME Type: "${mimeType}"`);

  if (!sanitizedPath) {
    const pathError = "Invalid storage path constructed (path is empty).";
    console.error(`[StorageService] Upload Aborted: ${pathError}`);
    throw new Error(`Cloudflare R2 Storage Error: ${pathError}`);
  }

  const uploadResult = await uploadToR2({
    bucket,
    key: sanitizedPath,
    file,
    mimeType,
    onProgress,
  });

  const successPath = sanitizedPath;
  let downloadUrl = uploadResult.url;

  try {
    const resolved = await getResolvedViewUrl(bucket, successPath);
    if (resolved) downloadUrl = resolved;
  } catch (urlError) {
    console.warn("[StorageService] Failed to generate resolved URL post-upload, using public URL:", urlError);
  }

  const metadata: R2UploadMetadata = {
    storageProvider: "r2",
    bucket,
    storagePath: successPath,
    storageKey: successPath,
    objectKey: successPath,
    fileName,
    fileSize: file.size,
    mimeType,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
    downloadUrl,
  };

  console.log(`[StorageService] Cloudflare R2 upload complete. Metadata:`, metadata);
  return metadata;
}

/**
 * Uploads a PDF note to Cloudflare R2.
 */
export async function uploadPdfToStorage(
  studentId: string,
  subject: string,
  fileName: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<string> {
  const fileHash = `${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}_${file.size}`;
  const localCacheKey = `uploaded_pdf_${studentId}_${fileHash}`;

  let cachedResult = "";
  try {
    const storageApi = typeof globalThis !== "undefined" ? (globalThis as any).localStorage : undefined;
    cachedResult = storageApi ? storageApi.getItem(localCacheKey) || "" : "";
  } catch {
    cachedResult = "";
  }

  if (cachedResult) {
    try {
      const parsed = JSON.parse(cachedResult);
      if (parsed && parsed.storagePath) {
        console.log(`[StorageService] Reusing cached upload metadata:`, parsed);
        if (onProgress) onProgress(100);
        return cachedResult;
      }
    } catch (e) {
      // Ignore stale cache
    }
  }

  const bucket = getBucketName();
  const storagePath = buildNoteStoragePath(studentId, fileName);

  console.log(`[StorageService] Initiating PDF note upload to R2. Bucket: "${bucket}", Path: "${storagePath}"`);

  const metadata = await uploadFileToR2(
    bucket,
    storagePath,
    file,
    fileName,
    "Admin",
    onProgress
  );

  const resultString = JSON.stringify(metadata);
  safeLocalStorageSetItem(localCacheKey, resultString);

  return resultString;
}

/**
 * Uploads a profile photo to Cloudflare R2.
 */
export async function uploadProfilePhoto(
  userId: string,
  dataUrl: string,
  originalFileName: string = "profile.png"
): Promise<R2UploadMetadata> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();

  const bucket = getBucketName();
  const storagePath = buildProfilePhotoStoragePath(userId, originalFileName);

  console.log(`[StorageService] Uploading profile photo to R2. Bucket: "${bucket}", Path: "${storagePath}"`);

  const metadata = await uploadFileToR2(
    bucket,
    storagePath,
    blob,
    originalFileName,
    "User"
  );

  return metadata;
}

/**
 * Uploads a progress or performance report to Cloudflare R2.
 */
export async function uploadReportToStorage(
  studentId: string,
  reportBlob: Blob,
  fileName: string
): Promise<R2UploadMetadata> {
  const bucket = getBucketName();
  const storagePath = buildReportStoragePath(studentId, fileName);

  console.log(`[StorageService] Uploading report to R2. Bucket: "${bucket}", Path: "${storagePath}"`);

  const metadata = await uploadFileToR2(
    bucket,
    storagePath,
    reportBlob,
    fileName,
    "Admin"
  );

  return metadata;
}

/**
 * Helper to compress image blobs before storage upload or data URL fallback
 */
async function compressImageForStorage(blob: Blob, maxDim = 1000, quality = 0.85): Promise<{ blob: Blob; dataUrl: string }> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.createImageBitmap) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = (reader.result as string) || "";
        resolve({ blob, dataUrl: res });
      };
      reader.readAsDataURL(blob);
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let width = img.width;
      let height = img.height;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        canvas.toBlob(
          (compressedBlob) => {
            resolve({ blob: compressedBlob || blob, dataUrl });
          },
          "image/jpeg",
          quality
        );
      } else {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve({ blob, dataUrl: (reader.result as string) || "" });
        };
        reader.readAsDataURL(blob);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve({ blob, dataUrl: (reader.result as string) || "" });
      };
      reader.readAsDataURL(blob);
    };
    img.src = url;
  });
}

/**
 * Uploads a question image to Cloudflare R2.
 */
export async function uploadQuestionImageToStorage(
  topicOrTestId: string,
  fileInput: File | Blob | string,
  fileName: string = "question-image.png"
): Promise<R2UploadMetadata> {
  let blob: Blob;
  let cleanName = fileName;

  if (typeof fileInput === "string") {
    if (fileInput.startsWith("data:") || fileInput.startsWith("blob:")) {
      const res = await fetch(fileInput);
      blob = await res.blob();
    } else {
      return {
        storageProvider: "r2",
        bucket: getBucketName(),
        storagePath: fileInput,
        fileName: cleanName,
        fileSize: 0,
        mimeType: "image/png",
        uploadedAt: new Date().toISOString(),
        uploadedBy: "Admin",
        downloadUrl: fileInput,
      };
    }
  } else {
    blob = fileInput;
    if (fileInput instanceof File && fileInput.name) {
      cleanName = fileInput.name;
    }
  }

  const bucket = getBucketName();
  const storagePath = buildQuestionImageStoragePath(topicOrTestId, cleanName);

  console.log(`[StorageService] Uploading question image to R2. Bucket: "${bucket}", Path: "${storagePath}"`);

  // Compress image before upload to keep payload small and crisp
  const compressed = await compressImageForStorage(blob, 1000, 0.85);

  try {
    const metadata = await uploadFileToR2(
      bucket,
      storagePath,
      compressed.blob,
      cleanName,
      "Admin"
    );
    return metadata;
  } catch (err: any) {
    console.warn("[StorageService] Cloudflare R2 upload error, using compressed Data URL fallback:", err);
    return {
      storageProvider: "r2",
      bucket,
      storagePath: storagePath,
      fileName: cleanName,
      fileSize: compressed.blob.size,
      mimeType: "image/jpeg",
      uploadedAt: new Date().toISOString(),
      uploadedBy: "Admin",
      downloadUrl: compressed.dataUrl,
    };
  }
}

/**
 * Resolves a fresh signed URL (or public URL) for viewing or downloading files from Cloudflare R2.
 */
export async function getResolvedViewUrl(
  bucketInput?: string,
  rawPathOrUrl?: string
): Promise<string> {
  const bucket = getBucketName(bucketInput);

  if (!rawPathOrUrl) {
    console.error("[StorageService] Missing storage path or URL");
    throw new Error("File path is missing.");
  }

  let cleanInput = String(rawPathOrUrl).trim();

  // Parse JSON metadata string if provided
  if (cleanInput.startsWith("{")) {
    try {
      const parsed = JSON.parse(cleanInput);
      if (parsed.storagePath) {
        cleanInput = String(parsed.storagePath).trim();
      } else if (parsed.downloadUrl) {
        cleanInput = String(parsed.downloadUrl).trim();
      } else if (parsed.url) {
        cleanInput = String(parsed.url).trim();
      }
    } catch (e) {
      // Ignore JSON parse errors
    }
  }

  if (cleanInput.startsWith("data:") || cleanInput.startsWith("blob:")) {
    console.log("[StorageService] Path is Base64 Data or Blob URL.");
    return cleanInput;
  }

  if (isInvalidStorageReference(cleanInput)) {
    console.error(`[StorageService] Rejected invalid storage path reference for bucket "${bucket}":`, cleanInput);
    throw new Error("Invalid storage path specified.");
  }

  // If cleanInput is already a full external HTTP/HTTPS URL not pointing to internal storage, return directly
  if (cleanInput.startsWith("http://") || cleanInput.startsWith("https://")) {
    const isInternal = cleanInput.includes("/api/r2/") || cleanInput.includes("r2.cloudflarestorage.com") || cleanInput.includes("/storage/v1/object/");
    if (!isInternal) {
      console.log(`[StorageService] Using external direct URL: ${cleanInput}`);
      return cleanInput;
    }
  }

  const sanitizedPath = sanitizeStoragePath(cleanInput, bucket).replace(/^\/+/, "");

  console.log(`[StorageService] Resolving View URL:`);
  console.log(`  - Bucket: "${bucket}"`);
  console.log(`  - Raw Input: "${rawPathOrUrl}"`);
  console.log(`  - Sanitized Relative Path: "${sanitizedPath}"`);

  if (!sanitizedPath) {
    if (cleanInput.startsWith("http://") || cleanInput.startsWith("https://")) {
      return cleanInput;
    }
    throw new Error("Invalid storage path specified.");
  }

  // 1. If direct public R2 domain/URL is configured, return it directly
  const directPublicUrl = getR2PublicUrl(bucket, sanitizedPath);
  if (directPublicUrl && !directPublicUrl.includes("/api/")) {
    console.log(`[StorageService] Using direct public R2 URL: ${directPublicUrl}`);
    return directPublicUrl;
  }

  // 2. Request direct pre-signed URL with inline Content-Disposition from Cloudflare R2
  try {
    const signedDetails = await getR2SignedUrlDetails({
      bucket,
      key: sanitizedPath,
      expiresIn: 3600,
      operation: "getObject",
    });
    if (signedDetails.signedUrl && !signedDetails.signedUrl.includes("/api/")) {
      console.log(`[StorageService] Using direct pre-signed R2 URL: ${signedDetails.signedUrl}`);
      return signedDetails.signedUrl;
    }
  } catch (signErr) {
    console.warn("[StorageService] Pre-signed URL retrieval warning:", signErr);
  }

  if (cleanInput.startsWith("http://") || cleanInput.startsWith("https://")) {
    return cleanInput;
  }

  throw new Error("Unable to resolve direct Cloudflare R2 storage URL.");
}

/**
 * Downloads a file directly from Cloudflare R2.
 */
export async function downloadFileFromStorage(
  bucketInput: string,
  rawStoragePath: string,
  fileName: string
): Promise<void> {
  const bucket = getBucketName(bucketInput);
  const storagePath = sanitizeStoragePath(rawStoragePath, bucket);

  console.log("=== [CLOUDFLARE R2 DOWNLOAD AUDIT] ===");
  console.log("bucket:", bucket);
  console.log("storagePath:", storagePath);

  if (!storagePath) {
    throw new Error("Invalid storage path specified.");
  }

  const { blob } = await downloadFromR2({ bucket, key: storagePath });
  const validatedBlob = validatePdfBlob(blob);

  console.log(`[StorageService] Download validation succeeded. bucket=${bucket} path=${storagePath} blobSize=${validatedBlob.size} mimeType=${validatedBlob.type || "unknown"}`);

  const blobUrl = URL.createObjectURL(validatedBlob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

  console.log(`[StorageService] Successfully downloaded: ${fileName}`);
}

/**
 * Deletes a file from Cloudflare R2.
 */
export async function deleteFileFromStorage(
  rawStoragePath: string,
  bucketInput?: string
): Promise<{ success: boolean; data?: any; storagePath: string; bucket: string }> {
  const bucket = getBucketName(bucketInput);
  if (!rawStoragePath) {
    console.warn("[StorageService] No storage path provided for deletion.");
    return { success: true, storagePath: "", bucket };
  }

  let cleanPath = String(rawStoragePath).trim();

  // If rawStoragePath is a JSON metadata string, parse it to extract storage path or URL
  if (cleanPath.startsWith("{")) {
    try {
      const parsed = JSON.parse(cleanPath);
      cleanPath = parsed.storagePath || parsed.downloadUrl || parsed.url || cleanPath;
    } catch (e) {
      // ignore
    }
  }

  if (
    cleanPath.startsWith("data:") ||
    cleanPath.startsWith("blob:") ||
    (cleanPath.startsWith("http") && !cleanPath.includes("r2") && !cleanPath.includes("/api/r2/"))
  ) {
    console.log(`[StorageService] Path is base64 data, blob URL, or external URL. Skipping Cloudflare R2 deletion.`);
    return { success: true, storagePath: cleanPath, bucket };
  }

  const storagePath = sanitizeStoragePath(cleanPath, bucket);

  if (!storagePath) {
    console.warn(`[StorageService] Unable to sanitize storage path from cleanPath="${cleanPath}".`);
    return { success: true, storagePath: "", bucket };
  }

  console.log(`[StorageService] Invoking Cloudflare R2 delete: bucket="${bucket}", storagePath="${storagePath}"`);

  try {
    const result = await deleteFromR2({ bucket, key: storagePath });
    console.log(`[StorageService] Successfully removed file from Cloudflare R2: "${storagePath}"`);

    // Clear entry from browser Cache Storage if present
    try {
      if (typeof window !== "undefined" && "caches" in window) {
        const cache = await caches.open("student-pdf-cache");
        const keys = await cache.keys();
        for (const req of keys) {
          if (req.url.includes(storagePath) || req.url.includes(encodeURIComponent(storagePath))) {
            await cache.delete(req);
            console.log(`[StorageService Cache] Removed cached entry for path: ${storagePath}`);
          }
        }
      }
    } catch (cacheErr) {
      console.warn(`[StorageService Cache] Warning while clearing Cache Storage:`, cacheErr);
    }

    return { success: true, data: result, storagePath, bucket };
  } catch (error: any) {
    const errorMsg = error.message || JSON.stringify(error);
    const isNotFound =
      errorMsg.toLowerCase().includes("not found") ||
      errorMsg.toLowerCase().includes("does not exist") ||
      errorMsg.toLowerCase().includes("not_found") ||
      error.status === 404;

    if (isNotFound) {
      console.warn(`[StorageService Warning] File no longer exists in Cloudflare R2: "${storagePath}". Proceeding.`);
      return { success: true, storagePath, bucket };
    }

    console.error(`[StorageService Error] Cloudflare R2 removal failed for path "${storagePath}":`, error);
    throw new Error(`Cloudflare R2 deletion failed: ${errorMsg}`);
  }
}
