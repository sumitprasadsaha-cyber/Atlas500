/**
 * Atlas v5.0.8 — Notes Validation & Duplicate Protection Engine
 * Strict schema validation and duplicate collision protection for School & UPSC.
 */

import { ClassNote } from "../types";
import { NoteMetadata, SchoolNote, UPSCNote } from "../domain/notes/types";
import { sanitizeFolderName } from "../utils/notesHierarchyHelper";

export interface NoteValidationResult {
  isValid: boolean;
  error?: string;
  field?: string;
}

export interface DuplicateDetectionResult {
  hasDuplicate: boolean;
  duplicateNote: ClassNote | null;
  message?: string;
  suggestedTopicNumber?: number;
}

export const ALLOWED_SCHOOL_CLASSES = [
  "Class 6",
  "Class 7",
  "Class 8",
  "Class 9",
  "Class 10",
  "Class 11",
  "Class 12",
];

export const ALLOWED_UPSC_PAPERS = [
  "General Studies Paper I",
  "General Studies Paper II",
  "General Studies Paper III",
  "General Studies Paper IV",
  "Essay",
  "CSAT",
  "Optional Subject",
];

/**
 * Validates metadata before upload or update
 */
export function validateNoteInput(data: {
  noteType?: "school" | "upsc" | string;
  isUPSC?: boolean;
  className?: string;
  classGrade?: string;
  subject?: string;
  generalStudiesPaper?: string;
  gsPaper?: string;
  chapterNumber?: number | string;
  chapterName?: string;
  moduleNumber?: number | string;
  moduleName?: string;
  topicNumber?: number | string;
  topicTitle?: string;
  topicName?: string;
  fileName?: string;
  fileSize?: number;
}): NoteValidationResult {
  const isUpsc =
    data.noteType === "upsc" ||
    data.isUPSC === true ||
    data.className === "UPSC" ||
    data.classGrade === "UPSC" ||
    Boolean(data.gsPaper) ||
    Boolean(data.generalStudiesPaper);

  // 1. Subject validation (Required for both)
  const subject = (data.subject || "").trim();
  if (!subject) {
    return { isValid: false, error: "Subject is required.", field: "subject" };
  }

  if (isUpsc) {
    // UPSC Domain Validation
    const gsPaper = (data.gsPaper || data.generalStudiesPaper || "").trim();
    if (!gsPaper) {
      return { isValid: false, error: "General Studies Paper is required for UPSC notes.", field: "gsPaper" };
    }

    const rawModNo = data.moduleNumber ?? data.chapterNumber;
    const modNo = typeof rawModNo === "number" ? rawModNo : parseInt(String(rawModNo || "").replace(/\D/g, ""), 10);
    if (!modNo || isNaN(modNo) || modNo <= 0) {
      return { isValid: false, error: "Module number must be a valid positive integer.", field: "moduleNumber" };
    }

    const modName = (data.moduleName || data.chapterName || "").trim();
    if (!modName) {
      return { isValid: false, error: "Module title/name is required.", field: "moduleName" };
    }
  } else {
    // School Domain Validation
    const rawClass = (data.className || data.classGrade || "").trim();
    if (!rawClass) {
      return { isValid: false, error: "Class grade (e.g. Class 10) is required.", field: "classGrade" };
    }

    const rawChNo = data.chapterNumber;
    const chNo = typeof rawChNo === "number" ? rawChNo : parseInt(String(rawChNo || "").replace(/\D/g, ""), 10);
    if (!chNo || isNaN(chNo) || chNo <= 0) {
      return { isValid: false, error: "Chapter number must be a valid positive integer.", field: "chapterNumber" };
    }

    const chName = (data.chapterName || "").trim();
    if (!chName) {
      return { isValid: false, error: "Chapter title/name is required.", field: "chapterName" };
    }
  }

  return { isValid: true };
}

/**
 * Checks for collision/duplicate topics in the existing database
 */
export function detectDuplicateTopic(
  existingNotes: ClassNote[],
  target: {
    id?: string;
    noteType?: "school" | "upsc" | string;
    isUPSC?: boolean;
    className?: string;
    classGrade?: string;
    subject?: string;
    generalStudiesPaper?: string;
    gsPaper?: string;
    chapterNumber?: number | string;
    chapterName?: string;
    moduleNumber?: number | string;
    moduleName?: string;
    topicNumber?: number | string;
    topicTitle?: string;
    topicName?: string;
    fileName?: string;
  }
): DuplicateDetectionResult {
  if (!Array.isArray(existingNotes) || existingNotes.length === 0) {
    return { hasDuplicate: false, duplicateNote: null };
  }

  const isUpsc =
    target.noteType === "upsc" ||
    target.isUPSC === true ||
    target.className === "UPSC" ||
    target.classGrade === "UPSC" ||
    Boolean(target.gsPaper) ||
    Boolean(target.generalStudiesPaper);

  const normSubj = (target.subject || "").trim().toLowerCase();
  const rawTargetTopicNo = target.topicNumber;
  const parsedTargetTopicNo =
    rawTargetTopicNo !== undefined && rawTargetTopicNo !== null && String(rawTargetTopicNo).trim() !== ""
      ? typeof rawTargetTopicNo === "number"
        ? rawTargetTopicNo
        : parseInt(String(rawTargetTopicNo).replace(/\D/g, ""), 10)
      : undefined;

  const targetTopicTitle = (target.topicTitle || target.topicName || "").trim().toLowerCase();

  let maxTopicNo = 0;

  for (const note of existingNotes) {
    // Ignore comparing against self when replacing or renaming existing note
    if (target.id && note.id === target.id) continue;

    const noteIsUpsc =
      note.isUPSC ||
      (note as any).type === "upsc" ||
      (note as any).noteType === "upsc" ||
      note.classGrade === "UPSC" ||
      (note as any).className === "UPSC";

    // Strict cross-domain separation
    if (isUpsc !== noteIsUpsc) continue;

    const noteSubj = (note.subject || (note as any).subjectName || "").trim().toLowerCase();
    if (noteSubj !== normSubj) continue;

    if (isUpsc) {
      const targetPaper = (target.gsPaper || target.generalStudiesPaper || "").trim().toLowerCase();
      const notePaper = (note.paper || (note as any).gsPaper || note.generalStudiesPaper || "").trim().toLowerCase();
      if (targetPaper && notePaper && targetPaper !== notePaper) continue;

      const targetModNo = Number(target.moduleNumber || target.chapterNumber || 1);
      const noteModNo = Number((note as any).moduleNumber || note.chapterNo || 1);
      if (targetModNo !== noteModNo) continue;
    } else {
      const targetClass = (target.className || target.classGrade || "").trim().toLowerCase();
      const noteClass = (note.classGrade || (note as any).className || "").trim().toLowerCase();
      if (targetClass !== noteClass) continue;

      const targetChNo = Number(target.chapterNumber || (target as any).chapterNo || 1);
      const noteChNo = Number((note as any).chapterNumber || note.chapterNo || 1);
      if (targetChNo !== noteChNo) continue;
    }

    // Check topic number matching
    const noteTopicNo = (note as any).topicNumber ?? (note as any).topicNo;
    const parsedNoteTopicNo =
      noteTopicNo !== undefined && noteTopicNo !== null && String(noteTopicNo).trim() !== ""
        ? typeof noteTopicNo === "number"
          ? noteTopicNo
          : parseInt(String(noteTopicNo).replace(/\D/g, ""), 10)
        : undefined;

    if (parsedNoteTopicNo && parsedNoteTopicNo > maxTopicNo) {
      maxTopicNo = parsedNoteTopicNo;
    }

    const noteTopicTitle = (
      (note as any).topicTitle ||
      (note as any).topicName ||
      note.partLabel ||
      ""
    ).trim().toLowerCase();

    // 1. Exact topic number collision
    if (
      parsedTargetTopicNo !== undefined &&
      parsedNoteTopicNo !== undefined &&
      parsedTargetTopicNo === parsedNoteTopicNo
    ) {
      return {
        hasDuplicate: true,
        duplicateNote: note,
        message: `Topic ${parsedTargetTopicNo} already exists ("${(note as any).topicTitle || (note as any).topicName || note.fileName || "Existing Note"}").`,
        suggestedTopicNumber: maxTopicNo + 1,
      };
    }

    // 2. Exact topic title collision in the same chapter/module
    if (
      targetTopicTitle &&
      noteTopicTitle &&
      targetTopicTitle === noteTopicTitle &&
      targetTopicTitle.length > 2
    ) {
      return {
        hasDuplicate: true,
        duplicateNote: note,
        message: `A topic named "${(note as any).topicTitle || (note as any).topicName}" already exists in this section.`,
        suggestedTopicNumber: maxTopicNo + 1,
      };
    }
  }

  return {
    hasDuplicate: false,
    duplicateNote: null,
    suggestedTopicNumber: maxTopicNo + 1,
  };
}

/**
 * Natural ordering comparator for topics (orders by topic number, then title)
 */
export function sortNotesByTopicNumber(a: ClassNote, b: ClassNote): number {
  // 1. Chapter / Module number
  const chA = (a as any).chapterNumber ?? (a as any).moduleNumber ?? a.chapterNo ?? 1;
  const chB = (b as any).chapterNumber ?? (b as any).moduleNumber ?? b.chapterNo ?? 1;
  if (chA !== chB) return chA - chB;

  // 2. Topic number
  const rawTopA = (a as any).topicNumber ?? (a as any).topicNo;
  const rawTopB = (b as any).topicNumber ?? (b as any).topicNo;

  const topA =
    rawTopA !== undefined && rawTopA !== null && String(rawTopA).trim() !== ""
      ? typeof rawTopA === "number"
        ? rawTopA
        : parseFloat(String(rawTopA).replace(/[^0-9.]/g, "")) || 0
      : 999999;

  const topB =
    rawTopB !== undefined && rawTopB !== null && String(rawTopB).trim() !== ""
      ? typeof rawTopB === "number"
        ? rawTopB
        : parseFloat(String(rawTopB).replace(/[^0-9.]/g, "")) || 0
      : 999999;

  if (topA !== topB) return topA - topB;

  // 3. Alphabetical topic title fallback
  const titleA = ((a as any).topicTitle || (a as any).topicName || a.fileName || "").toLowerCase();
  const titleB = ((b as any).topicTitle || (b as any).topicName || b.fileName || "").toLowerCase();
  return titleA.localeCompare(titleB);
}
