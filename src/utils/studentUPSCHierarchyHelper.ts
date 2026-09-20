import { ClassNote, ChapterNote, Student } from "../types";
import { 
  normalizeClassGrade, 
  inferGSPaperFromSubject, 
  getGSPaperSortIndex,
  isClassGradeMatching,
  isSubjectMatching 
} from "./classNoteHelper";
import { extractUPSCDetails, isUPSCClass } from "./upscHierarchyHelper";
export { isUPSCClass, extractUPSCDetails } from "./upscHierarchyHelper";
import { isNoteAccessibleToStudent } from "./noteAccessHelper";
import { getChapterProgressRecord, getStatusConfig, normalizeStatusLabel } from "./chapterProgressHelper";
import { getUpscHierarchy, ChapterInfo } from "../lib/curriculumService";

export interface StudentUPSCTopicNote {
  id: string;
  topicNo: number | string;
  topicName: string;
  topicLabel: string;
  partNumber?: number | string;
  totalParts?: number | string;
  partLabel?: string;
  cleanBaseName?: string;
  note: ClassNote | ChapterNote;
  isCompleted: boolean;
  fileSize?: number;
  fileName?: string;
  createdAt?: string;
  fileType?: "pdf" | "image";
}

export interface StudentUPSCModule {
  moduleNo: number;
  moduleName: string;
  moduleTitle: string;
  moduleKey: string;
  topics: StudentUPSCTopicNote[];
  totalTopics: number;
  completedTopics: number;
  progressPercent: number;
}

export interface StudentUPSCSubject {
  subject: string;
  subjectKey: string;
  modules: StudentUPSCModule[];
  totalModules: number;
  totalTopics: number;
  completedTopics: number;
  progressPercent: number;
}

export interface StudentUPSCGSPaper {
  gsPaper: string;
  gsPaperKey: string;
  subjects: StudentUPSCSubject[];
  totalSubjects: number;
  totalModules: number;
  totalTopics: number;
  completedTopics: number;
  progressPercent: number;
}

/**
 * Checks whether a specific topic note is marked as completed by the student.
 */
export function isStudentTopicCompleted(
  note: ClassNote | ChapterNote,
  subject: string,
  student: Student
): boolean {
  if (!note) return false;
  if ((note as any).isCompleted === true) return true;

  const subjClean = (subject || note.subject || "").trim();
  const progRecord = getChapterProgressRecord(note.id, subjClean, student?.chapterProgress);
  if (progRecord) {
    const norm = normalizeStatusLabel(progRecord.selectedStatus);
    const config = getStatusConfig(norm);
    if (norm === "Fully Prepared" || config.category === "completed" || progRecord.calculatedProgress === 100) {
      return true;
    }
  }
  return false;
}

/**
 * Returns the list of enrolled/assigned General Studies Papers for a student.
 * Derived strictly from actual visible/published topic notes.
 */
export function getStudentEnrolledGSPapers(
  student: Student,
  allClassNotes: ClassNote[] = []
): string[] {
  if (!student) return [];

  const rawEnrolled = (student.enrolledSubjects || []).filter(
    (s) => typeof s === "string" && s.trim().length > 0
  );

  const paperSet = new Set<string>();

  if (Array.isArray(allClassNotes)) {
    allClassNotes.forEach((cn) => {
      if (!isUPSCClass(cn.classGrade)) return;
      if (!isNoteAccessibleToStudent(cn, student.id, false)) return;

      const details = extractUPSCDetails(cn);
      if (rawEnrolled.length > 0) {
        const matches = rawEnrolled.some((enrolled) =>
          isUPSCClass(enrolled) ||
          enrolled.toLowerCase().trim() === "upsc" ||
          isSubjectMatching(enrolled, details.subject) ||
          isSubjectMatching(enrolled, details.gsPaper) ||
          isSubjectMatching(enrolled, cn.subject) ||
          ((cn as any).subjectName && isSubjectMatching(enrolled, (cn as any).subjectName)) ||
          (details.moduleName && isSubjectMatching(enrolled, details.moduleName))
        );
        if (!matches) return;
      }

      if (details.gsPaper) {
        paperSet.add(details.gsPaper);
      }
    });
  }

  return Array.from(paperSet).sort((a, b) => {
    const idxA = getGSPaperSortIndex(a);
    const idxB = getGSPaperSortIndex(b);
    if (idxA !== idxB) return idxA - idxB;
    return a.localeCompare(b);
  });
}

/**
 * Builds the complete 4-tier hierarchy for UPSC:
 * General Studies Paper -> Subject -> Module -> Topic Note
 * 
 * Derives progress bottom-up strictly from published Topic Notes:
 * Topic Completion -> Module Progress -> Subject Progress -> GS Paper Progress
 * 
 * Empty modules, subjects, or GS papers with zero published notes are excluded.
 */
export function buildStudentUPSCHierarchy(
  student: Student,
  allClassNotes: ClassNote[] = [],
  enrolledPapersFilter?: string[]
): StudentUPSCGSPaper[] {
  const upscHierarchy = getUpscHierarchy();

  // 1. Gather all accessible UPSC notes from live Admin ClassNotes
  const accessibleNotes: (ClassNote | ChapterNote)[] = [];

  const rawEnrolled = (student?.enrolledSubjects || []).filter(
    (s) => typeof s === "string" && s.trim().length > 0
  );

  // Central class notes
  if (Array.isArray(allClassNotes)) {
    allClassNotes.forEach((cn) => {
      if (!isUPSCClass(cn.classGrade)) return;
      if (!isNoteAccessibleToStudent(cn, student?.id, false)) return;

      const details = extractUPSCDetails(cn);
      const removedForPaper = upscHierarchy.removedSubjects?.[details.gsPaper] || [];
      if (removedForPaper.some((r) => r.toLowerCase().trim() === details.subject.toLowerCase().trim())) return;

      if (rawEnrolled.length > 0) {
        const matches = rawEnrolled.some((enrolled) => {
          if (isUPSCClass(enrolled) || enrolled.toLowerCase().trim() === "upsc") return true;
          if (isSubjectMatching(enrolled, details.subject)) return true;
          if (isSubjectMatching(enrolled, details.gsPaper)) return true;
          if (isSubjectMatching(enrolled, cn.subject)) return true;
          if ((cn as any).subjectName && isSubjectMatching(enrolled, (cn as any).subjectName)) return true;
          if (details.moduleName && isSubjectMatching(enrolled, details.moduleName)) return true;
          return false;
        });
        if (!matches) return;
      }

      if (enrolledPapersFilter && enrolledPapersFilter.length > 0) {
        const matchesFilter = enrolledPapersFilter.some((p) =>
          p.toLowerCase().trim() === details.gsPaper.toLowerCase().trim()
        );
        if (!matchesFilter) return;
      }

      accessibleNotes.push(cn);
    });
  }

  // If no accessible topic notes exist, return empty hierarchy
  if (accessibleNotes.length === 0) {
    return [];
  }

  // Admin modules map for looking up canonical module titles if configured
  const adminModulesMap: Record<string, ChapterInfo[]> = {};
  Object.entries(upscHierarchy.modules || {}).forEach(([pKey, sMap]) => {
    Object.entries(sMap || {}).forEach(([sKey, modList]) => {
      const combinedKey = `${pKey.toLowerCase().trim()}:::${sKey.toLowerCase().trim()}`;
      adminModulesMap[combinedKey] = modList || [];
    });
  });

  // 2. Map structure populated strictly from live accessible topic notes
  const paperMap = new Map<
    string,
    Map<
      string,
      {
        subjectName: string;
        moduleMap: Map<
          string,
          {
            moduleNo: number;
            moduleName: string;
            moduleTitle: string;
            topics: StudentUPSCTopicNote[];
          }
        >;
      }
    >
  >();

  accessibleNotes.forEach((note) => {
    const details = extractUPSCDetails(note);
    const gsPaper = details.gsPaper;

    if (!paperMap.has(gsPaper)) {
      paperMap.set(gsPaper, new Map());
    }
    const subjMap = paperMap.get(gsPaper)!;

    const subjKey = details.subject.toLowerCase().trim();
    if (!subjMap.has(subjKey)) {
      subjMap.set(subjKey, {
        subjectName: details.subject,
        moduleMap: new Map(),
      });
    }
    const subjEntry = subjMap.get(subjKey)!;

    const mKey = `mod_${details.moduleNo}`;
    if (!subjEntry.moduleMap.has(mKey)) {
      // Find module title from curriculum if defined by admin
      const combinedKey = `${gsPaper.toLowerCase().trim()}:::${subjKey}`;
      const adminMods = adminModulesMap[combinedKey] || [];
      const adminMod = adminMods.find((m) => m.number === details.moduleNo);

      const modName = adminMod ? adminMod.name : details.moduleName;
      const modTitle = adminMod
        ? (adminMod.name.toLowerCase().startsWith("module") || adminMod.name.toLowerCase().startsWith("chapter")
            ? adminMod.name
            : `Module ${adminMod.number}: ${adminMod.name}`)
        : details.moduleTitle;

      subjEntry.moduleMap.set(mKey, {
        moduleNo: details.moduleNo,
        moduleName: modName,
        moduleTitle: modTitle,
        topics: [],
      });
    }
    const modEntry = subjEntry.moduleMap.get(mKey)!;

    // Check duplicate topic note
    const isDup = modEntry.topics.some(
      (t) => t.id === note.id || (t.note.storagePath && note.storagePath && t.note.storagePath === note.storagePath)
    );

    if (!isDup) {
      const isCompleted = isStudentTopicCompleted(note, details.subject, student);
      const fileSize = (note as any).fileSize || (note as any).file_size;
      const fileName = note.pdfFileName || (note as any).fileName || (note as any).filename;
      const createdAt = (note as any).createdAt || (note as any).uploadedAt;
      const fileType = (note as any).fileType || ((fileName && /\.(png|jpe?g|webp)$/i.test(fileName)) ? "image" : "pdf");

      modEntry.topics.push({
        id: note.id,
        topicNo: details.topicNo,
        topicName: details.topicName,
        topicLabel: details.topicLabel,
        partNumber: details.partNumber,
        totalParts: details.totalParts,
        partLabel: details.partLabel,
        cleanBaseName: details.cleanBaseName,
        note,
        isCompleted,
        fileSize,
        fileName,
        createdAt,
        fileType,
      });
    }
  });

  // 3. Build & aggregate results bottom-up
  const sortedPaperKeys = Array.from(paperMap.keys()).sort((a, b) => {
    const idxA = getGSPaperSortIndex(a);
    const idxB = getGSPaperSortIndex(b);
    if (idxA !== idxB) return idxA - idxB;
    return a.localeCompare(b);
  });

  const result: StudentUPSCGSPaper[] = [];

  for (const gsPaper of sortedPaperKeys) {
    const subjMap = paperMap.get(gsPaper)!;
    const sortedSubjKeys = Array.from(subjMap.keys()).sort((a, b) => {
      const nameA = subjMap.get(a)!.subjectName;
      const nameB = subjMap.get(b)!.subjectName;
      return nameA.localeCompare(nameB);
    });

    const subjects: StudentUPSCSubject[] = [];
    let paperTotalModules = 0;
    let paperTotalTopics = 0;
    let paperCompletedTopics = 0;

    for (const sKey of sortedSubjKeys) {
      const sEntry = subjMap.get(sKey)!;
      const sortedModKeys = Array.from(sEntry.moduleMap.keys()).sort((a, b) => {
        const mA = sEntry.moduleMap.get(a)!.moduleNo;
        const mB = sEntry.moduleMap.get(b)!.moduleNo;
        return mA - mB;
      });

      const modules: StudentUPSCModule[] = [];
      let subjTotalTopics = 0;
      let subjCompletedTopics = 0;

      for (const mKey of sortedModKeys) {
        const mEntry = sEntry.moduleMap.get(mKey)!;

        // CRITICAL DATA-VISIBILITY RULE:
        // Exclude empty modules from student-facing hierarchy
        if (mEntry.topics.length === 0) continue;

        // Sort topics numerically
        mEntry.topics.sort((t1, t2) => {
          const num1 = typeof t1.topicNo === "number" ? t1.topicNo : parseInt(String(t1.topicNo), 10);
          const num2 = typeof t2.topicNo === "number" ? t2.topicNo : parseInt(String(t2.topicNo), 10);
          if (!isNaN(num1) && !isNaN(num2) && num1 !== num2) return num1 - num2;
          return t1.topicLabel.localeCompare(t2.topicLabel, undefined, { numeric: true });
        });

        const modTotalTopics = mEntry.topics.length;
        const modCompletedTopics = mEntry.topics.filter((t) => t.isCompleted).length;
        const modProgress = modTotalTopics > 0 ? Math.round((modCompletedTopics / modTotalTopics) * 100) : 0;

        subjTotalTopics += modTotalTopics;
        subjCompletedTopics += modCompletedTopics;

        modules.push({
          moduleNo: mEntry.moduleNo,
          moduleName: mEntry.moduleName,
          moduleTitle: mEntry.moduleTitle,
          moduleKey: mKey,
          topics: mEntry.topics,
          totalTopics: modTotalTopics,
          completedTopics: modCompletedTopics,
          progressPercent: modProgress,
        });
      }

      // CRITICAL DATA-VISIBILITY RULE:
      // Exclude empty subjects from student-facing hierarchy
      if (modules.length === 0) continue;

      const subjTotalModules = modules.length;
      const subjProgress = subjTotalTopics > 0 ? Math.round((subjCompletedTopics / subjTotalTopics) * 100) : 0;

      paperTotalModules += subjTotalModules;
      paperTotalTopics += subjTotalTopics;
      paperCompletedTopics += subjCompletedTopics;

      subjects.push({
        subject: sEntry.subjectName,
        subjectKey: sKey,
        modules,
        totalModules: subjTotalModules,
        totalTopics: subjTotalTopics,
        completedTopics: subjCompletedTopics,
        progressPercent: subjProgress,
      });
    }

    // CRITICAL DATA-VISIBILITY RULE:
    // Exclude empty GS Papers from student-facing hierarchy
    if (subjects.length === 0) continue;

    const paperTotalSubjects = subjects.length;
    const paperProgress = paperTotalTopics > 0 ? Math.round((paperCompletedTopics / paperTotalTopics) * 100) : 0;

    result.push({
      gsPaper,
      gsPaperKey: gsPaper.toLowerCase().replace(/\s+/g, "_"),
      subjects,
      totalSubjects: paperTotalSubjects,
      totalModules: paperTotalModules,
      totalTopics: paperTotalTopics,
      completedTopics: paperCompletedTopics,
      progressPercent: paperProgress,
    });
  }

  return result;
}
