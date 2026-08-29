/**
 * Release 6.0.0 — Storage Integrity Verification Service
 *
 * Architecture-Level Non-Destructive Integrity Auditor for Topic Notes.
 * - Scans all Firestore notes collections (School & UPSC).
 * - Performs non-destructive HeadObject existence & health checks against Cloudflare R2.
 * - Audits metadata consistency (checks canonical storageKey, aliases, topic titles, and extensions).
 * - Identifies orphaned Cloudflare R2 objects (files stored in R2 without corresponding Firestore documents).
 * - Never modifies, mutates, or deletes any data.
 * - Produces comprehensive audit reports on note storage health.
 */

import { fetchAllClassNotesFromFirestore } from "./firestoreService";
import { verifyR2ObjectExists, getR2BucketName, listFromR2, type R2ObjectInfo } from "./r2Client";
import { ClassNote } from "../types";

export interface NoteIntegrityItem {
  noteId: string;
  title: string;
  classGrade: string;
  subject: string;
  chapterNo?: number;
  chapterName?: string;
  topicName?: string;
  storageKey: string;
  status: "healthy" | "missing" | "empty" | "inconsistent" | "error";
  sizeBytes?: number;
  mimeType?: string;
  lastModified?: string;
  errorMessage?: string;
  metadataIssues?: string[];
}

export interface OrphanedObjectItem {
  key: string;
  sizeBytes: number;
  lastModified?: string;
  etag?: string;
}

export interface StorageIntegrityReport {
  timestamp: string;
  bucket: string;
  totalNotes: number;
  healthyCount: number;
  missingCount: number;
  emptyCount: number;
  inconsistentCount: number;
  errorCount: number;
  orphanedCount: number;
  is100PercentHealthy: boolean;
  healthPercentage: number;
  items: NoteIntegrityItem[];
  orphanedObjects: OrphanedObjectItem[];
}

/**
 * Checks Firestore document for metadata consistency anomalies (non-destructive).
 */
function auditMetadataConsistency(note: ClassNote): string[] {
  const issues: string[] = [];

  const primaryKey = note.storageKey || note.storagePath || note.r2Key || note.downloadKey || note.objectKey;
  if (!primaryKey) {
    issues.push("Missing primary storageKey/storagePath");
  } else {
    if (!primaryKey.includes(".")) {
      issues.push("Storage key is missing a valid file extension");
    }
    if (primaryKey.includes("//")) {
      issues.push("Storage key contains redundant consecutive slashes");
    }
  }

  // Check alias consistency
  if (note.storageKey && note.storagePath && note.storageKey !== note.storagePath) {
    issues.push(`Discrepancy between storageKey ("${note.storageKey}") and storagePath ("${note.storagePath}")`);
  }

  if (!note.subject || !note.subject.trim()) {
    issues.push("Missing subject metadata");
  }

  if (!note.classGrade && !note.className && !note.class) {
    issues.push("Missing class/grade metadata");
  }

  return issues;
}

/**
 * Executes a non-destructive storage integrity audit across all persisted Topic Notes.
 */
export async function auditStorageIntegrity(
  onProgress?: (checked: number, total: number, currentNoteTitle: string) => void
): Promise<StorageIntegrityReport> {
  const bucket = getR2BucketName();
  console.log(`[Storage Integrity Audit] Starting non-destructive audit on bucket: "${bucket}" (v6.0.0)...`);

  const allNotes: ClassNote[] = await fetchAllClassNotesFromFirestore();
  const total = allNotes.length;
  console.log(`[Storage Integrity Audit] Found ${total} notes in Firestore.`);

  let healthyCount = 0;
  let missingCount = 0;
  let emptyCount = 0;
  let inconsistentCount = 0;
  let errorCount = 0;
  const items: NoteIntegrityItem[] = [];
  const registeredStorageKeys = new Set<string>();

  for (let i = 0; i < total; i++) {
    const note = allNotes[i];
    const storageKey =
      note.storagePath ||
      note.storageKey ||
      note.r2Key ||
      note.downloadKey ||
      note.objectKey ||
      "";
    const title =
      note.topicName ||
      note.topicTitle ||
      note.partLabel ||
      note.fileName ||
      note.pdfFileName ||
      `Note ${note.id}`;

    if (onProgress) {
      onProgress(i + 1, total, title);
    }

    const metadataIssues = auditMetadataConsistency(note);

    if (!storageKey) {
      missingCount++;
      items.push({
        noteId: note.id,
        title,
        classGrade: note.classGrade || (note as any).className || "Class 10",
        subject: note.subject || "General",
        chapterNo: note.chapterNo,
        chapterName: note.chapterName,
        topicName: note.topicName,
        storageKey: "(missing key in Firestore)",
        status: "missing",
        errorMessage: "Document has no storage key or path persisted in Firestore metadata.",
        metadataIssues,
      });
      continue;
    }

    const cleanKey = storageKey.replace(/^\/+/, "");
    registeredStorageKeys.add(cleanKey);

    try {
      // Non-destructive HeadObject check
      const check = await verifyR2ObjectExists({
        bucket,
        key: cleanKey,
      });

      if (!check || !check.exists) {
        missingCount++;
        items.push({
          noteId: note.id,
          title,
          classGrade: note.classGrade || (note as any).className || "Class 10",
          subject: note.subject || "General",
          chapterNo: note.chapterNo,
          chapterName: note.chapterName,
          topicName: note.topicName,
          storageKey: cleanKey,
          status: "missing",
          errorMessage: `Object not found in R2 storage at key "${cleanKey}".`,
          metadataIssues,
        });
      } else if (check.size !== undefined && check.size <= 0) {
        emptyCount++;
        items.push({
          noteId: note.id,
          title,
          classGrade: note.classGrade || (note as any).className || "Class 10",
          subject: note.subject || "General",
          chapterNo: note.chapterNo,
          chapterName: note.chapterName,
          topicName: note.topicName,
          storageKey: cleanKey,
          status: "empty",
          sizeBytes: 0,
          errorMessage: "R2 object exists but has 0 bytes content-length.",
          metadataIssues,
        });
      } else if (metadataIssues.length > 0) {
        inconsistentCount++;
        items.push({
          noteId: note.id,
          title,
          classGrade: note.classGrade || (note as any).className || "Class 10",
          subject: note.subject || "General",
          chapterNo: note.chapterNo,
          chapterName: note.chapterName,
          topicName: note.topicName,
          storageKey: cleanKey,
          status: "inconsistent",
          sizeBytes: check.size ?? note.fileSize,
          mimeType: note.mimeType,
          lastModified: note.updatedAt || note.createdAt,
          errorMessage: `Metadata inconsistency detected: ${metadataIssues.join("; ")}`,
          metadataIssues,
        });
      } else {
        healthyCount++;
        items.push({
          noteId: note.id,
          title,
          classGrade: note.classGrade || (note as any).className || "Class 10",
          subject: note.subject || "General",
          chapterNo: note.chapterNo,
          chapterName: note.chapterName,
          topicName: note.topicName,
          storageKey: cleanKey,
          status: "healthy",
          sizeBytes: check.size ?? note.fileSize,
          mimeType: note.mimeType,
          lastModified: note.updatedAt || note.createdAt,
        });
      }
    } catch (err: any) {
      errorCount++;
      items.push({
        noteId: note.id,
        title,
        classGrade: note.classGrade || (note as any).className || "Class 10",
        subject: note.subject || "General",
        chapterNo: note.chapterNo,
        chapterName: note.chapterName,
        topicName: note.topicName,
        storageKey: cleanKey,
        status: "error",
        errorMessage: err?.message || "Storage verification request failed.",
        metadataIssues,
      });
    }
  }

  // Scan Cloudflare R2 bucket for orphaned objects (non-destructive)
  const orphanedObjects: OrphanedObjectItem[] = [];
  try {
    const classNotesObjects = await listFromR2({ bucket, prefix: "class_notes/", limit: 1000 }).catch(() => [] as R2ObjectInfo[]);
    const upscObjects = await listFromR2({ bucket, prefix: "upsc/", limit: 1000 }).catch(() => [] as R2ObjectInfo[]);
    const allR2Objects = [...classNotesObjects, ...upscObjects];

    for (const obj of allR2Objects) {
      const cleanObjKey = obj.key.replace(/^\/+/, "");
      // Skip directory placeholders
      if (cleanObjKey.endsWith("/") || cleanObjKey.endsWith(".keep") || cleanObjKey.endsWith(".gitkeep")) {
        continue;
      }
      if (!registeredStorageKeys.has(cleanObjKey)) {
        orphanedObjects.push({
          key: cleanObjKey,
          sizeBytes: obj.size,
          lastModified: obj.lastModified,
          etag: obj.etag,
        });
      }
    }
  } catch (orphanScanErr) {
    console.warn("[Storage Integrity Audit] Orphaned files scan skipped or failed:", orphanScanErr);
  }

  const is100PercentHealthy = total > 0 && healthyCount === total && orphanedObjects.length === 0;
  const healthPercentage = total > 0 ? Math.round((healthyCount / total) * 100) : 100;

  console.log(
    `[Storage Integrity Audit] Audit finished: ${healthyCount}/${total} healthy (${healthPercentage}%), ` +
      `${orphanedObjects.length} orphaned objects, ${inconsistentCount} inconsistent metadata.`
  );

  return {
    timestamp: new Date().toISOString(),
    bucket,
    totalNotes: total,
    healthyCount,
    missingCount,
    emptyCount,
    inconsistentCount,
    errorCount,
    orphanedCount: orphanedObjects.length,
    is100PercentHealthy,
    healthPercentage,
    items,
    orphanedObjects,
  };
}
