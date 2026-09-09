/**
 * Atlas v7.9.3 — Subject Sharing Service
 * Facilitates copying/sharing complete subject curricula across classes:
 * - Reuses existing Cloudflare R2 files without duplicating storage
 * - Copies chapters, chapter order, topic notes, metadata, and visibility
 * - Clones attached practice tests and quizzes
 * - Handles optional subject replacement with explicit confirmation
 * - Emits targeted non-destructive update events
 */

import { doc, setDoc } from "firebase/firestore";
import { getFirebaseDb } from "./firebase";
import { ClassNote, TopicPracticeTest } from "../types";
import { 
  SchoolHierarchyData, 
  ChapterInfo, 
  saveSchoolHierarchy 
} from "./curriculumService";
import { 
  saveClassNoteDoc, 
  deleteClassNoteDoc 
} from "./firestoreService";
import { 
  buildTopicTestId, 
  getTopicPracticeTest,
  updateLocalTopicCache,
  deleteTopicPracticeTest,
  sanitizeFirestoreData
} from "./practiceTestService";
import { notesCacheService } from "./notesCacheService";

export interface ShareSubjectOptions {
  sourceClass: string;
  sourceSubject: string;
  destinationClasses: string[];
  notes: ClassNote[];
  schoolHierarchy: SchoolHierarchyData;
  practiceTestBank?: Record<string, TopicPracticeTest>;
  onProgress?: (step: string) => void;
}

export interface ShareSubjectResult {
  successfulClasses: string[];
  failedClasses: string[];
  totalNotesCopied: number;
  totalChaptersCopied: number;
  totalTestsCopied: number;
}

/**
 * Checks if a subject already exists in a given destination class
 */
export function checkSubjectExistsInClass(
  className: string,
  subject: string,
  schoolHierarchy: SchoolHierarchyData,
  notes: ClassNote[]
): boolean {
  const normClass = className.trim().toLowerCase();
  const normSubj = subject.trim().toLowerCase();

  // 1. Check in curriculum hierarchy subjects
  const hierarchySubjects = schoolHierarchy.subjects[className] || [];
  if (hierarchySubjects.some((s) => s.trim().toLowerCase() === normSubj)) {
    return true;
  }

  // 2. Check in existing notes
  const hasNote = notes.some((n) => {
    const c = ((n as any).className || n.classGrade || (n as any).class || "").trim().toLowerCase();
    const s = ((n as any).subjectName || n.subject || "").trim().toLowerCase();
    return c === normClass && s === normSubj;
  });

  return hasNote;
}

/**
 * Copies a complete subject and its chapters, notes, and attached practice tests to destination classes
 */
export async function copySubjectToClasses(
  options: ShareSubjectOptions
): Promise<ShareSubjectResult> {
  const {
    sourceClass,
    sourceSubject,
    destinationClasses,
    notes,
    schoolHierarchy,
    practiceTestBank = {},
    onProgress,
  } = options;

  const successfulClasses: string[] = [];
  const failedClasses: string[] = [];
  let totalNotesCopied = 0;
  let totalChaptersCopied = 0;
  let totalTestsCopied = 0;

  // 1. Identify all source chapters and their order
  onProgress?.("Copying Chapters...");
  const chaptersMap = new Map<number, string>();
  const hierChapters = schoolHierarchy.chapters[sourceClass]?.[sourceSubject] || [];
  hierChapters.forEach((ch) => chaptersMap.set(ch.number, ch.name));

  // Also collect all source notes
  const sourceNotes = notes.filter((n) => {
    const c = ((n as any).className || n.classGrade || (n as any).class || "").trim().toLowerCase();
    const s = ((n as any).subjectName || n.subject || "").trim().toLowerCase();
    return c === sourceClass.trim().toLowerCase() && s === sourceSubject.trim().toLowerCase();
  });

  // Extract chapters from notes if not yet represented in hierarchy
  sourceNotes.forEach((n) => {
    const chNo = (n as any).chapterNumber ?? n.chapterNo ?? 1;
    const chName = (n as any).chapterTitle || (n as any).chapterName || `Chapter ${chNo}`;
    if (!chaptersMap.has(chNo)) {
      chaptersMap.set(chNo, chName);
    }
  });

  const sourceChapterList: ChapterInfo[] = Array.from(chaptersMap.entries())
    .map(([number, name]) => ({ number, name }))
    .sort((a, b) => a.number - b.number);

  // Deep clone mutable copy of school hierarchy
  let updatedHierarchy: SchoolHierarchyData = {
    ...schoolHierarchy,
    classes: [...(schoolHierarchy.classes || [])],
    subjects: { ...(schoolHierarchy.subjects || {}) },
    chapters: { ...(schoolHierarchy.chapters || {}) },
    removedSubjects: { ...(schoolHierarchy.removedSubjects || {}) },
  };

  const db = await getFirebaseDb();

  // Process each destination class sequentially so partial failures don't stop the rest
  for (const destClass of destinationClasses) {
    try {
      onProgress?.(`Copying Chapters to ${destClass}...`);

      // If replacing existing subject in destClass, delete previous database notes & tests
      const existingDestNotes = notes.filter((n) => {
        const c = ((n as any).className || n.classGrade || (n as any).class || "").trim().toLowerCase();
        const s = ((n as any).subjectName || n.subject || "").trim().toLowerCase();
        return c === destClass.trim().toLowerCase() && s === sourceSubject.trim().toLowerCase();
      });

      for (const oldNote of existingDestNotes) {
        try {
          // Delete only Firestore record, never delete the shared R2 file
          await deleteClassNoteDoc(oldNote.id);
          const rawChNo = (oldNote as any).chapterNumber ?? oldNote.chapterNo ?? 1;
          const chNo = typeof rawChNo === "number" ? rawChNo : parseInt(String(rawChNo).replace(/\D/g, ""), 10) || 1;
          const topicName = ((oldNote as any).topicTitle || (oldNote as any).topicName || oldNote.partLabel || "").trim();
          if (topicName) {
            await deleteTopicPracticeTest(destClass, sourceSubject, chNo, topicName).catch(() => {});
          }
        } catch (delErr) {
          console.warn(`[SubjectSharing] Notice cleaning up previous note ${oldNote.id}:`, delErr);
        }
      }

      // Update curriculum hierarchy for destClass
      if (!updatedHierarchy.classes.includes(destClass)) {
        updatedHierarchy.classes.push(destClass);
      }
      if (!updatedHierarchy.subjects[destClass]) {
        updatedHierarchy.subjects[destClass] = [];
      }
      if (!updatedHierarchy.subjects[destClass].includes(sourceSubject)) {
        updatedHierarchy.subjects[destClass].push(sourceSubject);
      }

      // Remove from removedSubjects if previously removed
      if (updatedHierarchy.removedSubjects[destClass]) {
        updatedHierarchy.removedSubjects[destClass] = updatedHierarchy.removedSubjects[destClass].filter(
          (s) => s.trim().toLowerCase() !== sourceSubject.trim().toLowerCase()
        );
      }

      if (!updatedHierarchy.chapters[destClass]) {
        updatedHierarchy.chapters[destClass] = {};
      }
      // Exact copy of chapter list and ordering
      updatedHierarchy.chapters[destClass][sourceSubject] = sourceChapterList.map((ch) => ({ ...ch }));
      totalChaptersCopied += sourceChapterList.length;

      // Copy Topics and attached Practice Tests
      onProgress?.(`Copying Topics to ${destClass}...`);

      for (const srcNote of sourceNotes) {
        const newNoteId = `note_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const srcChNo = Number((srcNote as any).chapterNumber ?? srcNote.chapterNo ?? 1);
        const srcTopicName = ((srcNote as any).topicTitle || (srcNote as any).topicName || srcNote.partLabel || "").trim();

        let clonedPracticeTestId: string | null = null;

        // Check if there is an attached practice test
        if (srcTopicName) {
          const srcTestId = (srcNote as any).practiceTestId || buildTopicTestId(sourceClass, sourceSubject, srcChNo, srcTopicName);
          let testData: TopicPracticeTest | null = practiceTestBank[srcTestId] || null;

          if (!testData || !testData.questions || testData.questions.length === 0) {
            testData = await getTopicPracticeTest(sourceClass, sourceSubject, srcChNo, srcTopicName).catch(() => null);
          }

          if (testData && testData.questions && testData.questions.length > 0) {
            const destTestId = buildTopicTestId(destClass, sourceSubject, srcChNo, srcTopicName);
            const clonedQuestions = (testData.questions || []).map((q, qIdx) => ({
              ...q,
              id: `q_${Date.now()}_${qIdx}_${Math.random().toString(36).substring(2, 7)}`,
              classGrade: destClass,
              className: destClass,
              subject: sourceSubject,
              subjectName: sourceSubject,
              chapterNo: srcChNo,
              chapterName: srcNote.chapterName || `Chapter ${srcChNo}`,
              topicName: srcTopicName,
            }));

            const clonedPracticeTest: TopicPracticeTest = {
              ...testData,
              id: destTestId,
              testId: destTestId,
              noteId: newNoteId,
              topicNoteId: newNoteId,
              classGrade: destClass,
              subject: sourceSubject,
              chapterNo: srcChNo,
              chapterName: srcNote.chapterName || `Chapter ${srcChNo}`,
              topicName: srcTopicName,
              questions: clonedQuestions,
              questionCount: clonedQuestions.length,
              hasTest: true,
              hasPracticeTest: true,
              updatedAt: new Date().toISOString(),
            };

            if (db) {
              const sanitizedTest = sanitizeFirestoreData(clonedPracticeTest);
              await setDoc(doc(db, "topic_practice_tests", destTestId), sanitizedTest, { merge: true });
              await setDoc(doc(db, "practice_tests", destTestId), sanitizedTest, { merge: true }).catch(() => {});
            }

            updateLocalTopicCache(clonedPracticeTest);
            clonedPracticeTestId = destTestId;
            totalTestsCopied++;
          }
        }

        // Build cloned note retaining all R2 file references, permissions, and metadata
        const clonedNote: ClassNote = {
          ...srcNote,
          id: newNoteId,
          noteId: newNoteId,
          classGrade: destClass,
          className: destClass,
          class: destClass,
          classId: destClass.toLowerCase().replace(/\s+/g, "-"),
          subject: sourceSubject,
          subjectName: sourceSubject,
          subjectId: sourceSubject.toLowerCase().replace(/\s+/g, "-"),

          // Chapters & topics
          chapterNo: srcChNo,
          chapterNumber: srcChNo,
          chapterName: srcNote.chapterName || `Chapter ${srcChNo}`,
          chapterTitle: (srcNote as any).chapterTitle || srcNote.chapterName || `Chapter ${srcChNo}`,
          topicNo: (srcNote as any).topicNumber ?? srcNote.topicNo,
          topicNumber: (srcNote as any).topicNumber ?? srcNote.topicNo,
          topicName: srcTopicName,
          topicTitle: srcTopicName,
          partLabel: srcNote.partLabel,

          // Keep exact storage & R2 file references (DO NOT duplicate R2 files)
          pdfUrl: srcNote.pdfUrl,
          pdfFileName: srcNote.pdfFileName,
          originalFilename: srcNote.originalFilename,
          storedFilename: srcNote.storedFilename,
          fileName: srcNote.fileName,
          storagePath: srcNote.storagePath,
          storageKey: srcNote.storageKey,
          objectKey: srcNote.objectKey,
          r2Key: srcNote.r2Key,
          downloadKey: srcNote.downloadKey,
          downloadUrl: srcNote.downloadUrl,
          publicUrl: srcNote.publicUrl,
          bucket: srcNote.bucket,
          fileType: srcNote.fileType,
          fileSize: srcNote.fileSize,
          mimeType: srcNote.mimeType,

          // Permissions & access rules
          visibility: srcNote.visibility || "all",
          accessRules: srcNote.accessRules,
          allowedStudentIds: srcNote.allowedStudentIds,
          allowedClasses: srcNote.allowedClasses
            ? Array.from(new Set([...srcNote.allowedClasses, destClass]))
            : undefined,
          accessType: srcNote.accessType,
          teachMode: srcNote.teachMode,
          teach_mode: srcNote.teach_mode,
          isTeachMode: srcNote.isTeachMode,
          searchableText: srcNote.searchableText,

          // Practice test linkage
          hasPracticeTest: Boolean(clonedPracticeTestId),
          hasTest: Boolean(clonedPracticeTestId),
          practiceTestId: clonedPracticeTestId,

          createdAt: new Date().toISOString(),
          uploadedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await saveClassNoteDoc(clonedNote);
        totalNotesCopied++;
      }

      successfulClasses.push(destClass);
    } catch (err) {
      console.error(`[SubjectSharing] Failed to copy subject to ${destClass}:`, err);
      failedClasses.push(destClass);
    }
  }

  // Finalizing step: commit curriculum hierarchy and invalidate cache
  onProgress?.("Finalizing...");
  await saveSchoolHierarchy(updatedHierarchy);
  await notesCacheService.invalidateMetadataCache();

  return {
    successfulClasses,
    failedClasses,
    totalNotesCopied,
    totalChaptersCopied,
    totalTestsCopied,
  };
}
