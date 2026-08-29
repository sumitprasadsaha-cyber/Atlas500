import {
  NoteMetadata,
  NoteFormInput,
  NoteValidationResult,
  buildCanonicalNoteMetadata,
  validateCanonicalNoteMetadata,
} from "../domain/notes/types";
import { ClassNote } from "../types";

export * from "../domain/notes/types";

// Backward compatibility alias for any existing callers
export const buildNoteMetadata = buildCanonicalNoteMetadata;
export const validateNoteMetadata = validateCanonicalNoteMetadata;

/**
 * Maps any incoming or legacy note representation to canonical NoteMetadata.
 */
export function migrateNoteToHierarchy(note: ClassNote | any): ClassNote {
  if (!note) return note;

  const rawClass = note.classGrade || note.className || note.class || "Class 10";
  const ext = (note.originalFilename || note.fileName || note.pdfFileName || "note.pdf")
    .split(".")
    .pop()
    ?.toLowerCase() || "pdf";

  const canonical = buildCanonicalNoteMetadata({
    className: rawClass,
    subject: note.subjectName || note.subject,
    gsPaper: note.gsPaper || note.paper || note.generalStudiesPaper || note.gs_paper,
    chapterNumber: note.chapterNumber ?? note.chapterNo,
    chapterName: note.chapterName || note.chapterTitle,
    moduleNumber: note.moduleNumber ?? note.moduleNo ?? note.module_number,
    moduleName: note.moduleName || note.moduleTitle || note.module_name,
    topicNumber: note.topicNumber ?? note.topicNo ?? note.topic_number,
    topicName: note.topicName || note.topicTitle || note.topic_name,
    partLabel: note.partLabel,
    fileName: note.fileName || note.originalFilename || note.pdfFileName || `note.${ext}`,
    fileSize: note.fileSize || note.file_size || 0,
    mimeType: note.mimeType || note.mime_type,
    storagePath: note.storagePath || note.r2Key || note.storageKey,
    pdfUrl: note.pdfUrl || note.publicUrl || note.downloadUrl || "",
    visibility: note.visibility || note.accessType || "all",
    allowedStudentIds: note.allowedStudentIds,
    allowedClasses: note.allowedClasses,
    uploadedBy: note.uploadedBy || "Admin",
    createdAt: note.createdAt || note.uploadedAt || note.uploadedDate,
    updatedAt: note.updatedAt,
  });

  return {
    ...canonical,
    id: note.id || canonical.id,
  } as unknown as ClassNote;
}

/**
 * Searches canonical notes across all hierarchy dimensions:
 * Class, Subject, Paper, Chapter/Module, Topic, and File name.
 */
export function searchHierarchicalNotes(notes: (ClassNote | NoteMetadata)[], searchQuery: string): any[] {
  if (!searchQuery || !searchQuery.trim()) return notes;
  const q = searchQuery.toLowerCase().trim();
  const queryTokens = q.split(/\s+/).filter(Boolean);

  return notes.filter((note: any) => {
    const haystack = [
      note.className || note.classGrade || note.class || "",
      note.subject || note.subjectName || "",
      note.gsPaper || note.paper || note.generalStudiesPaper || note.gs_paper || "",
      note.chapterName || note.chapterTitle || "",
      `chapter ${note.chapterNumber || note.chapterNo || ""}`,
      note.moduleName || note.moduleTitle || "",
      `module ${note.moduleNumber || note.moduleNo || ""}`,
      note.topicName || note.topicTitle || "",
      `topic ${note.topicNumber || note.topicNo || ""}`,
      note.fileName || note.originalFilename || note.pdfFileName || "",
      note.searchableText || "",
    ]
      .join(" ")
      .toLowerCase();

    return queryTokens.every((token) => haystack.includes(token));
  });
}
