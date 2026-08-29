import { ClassNote, ChapterNote, Student } from "../types";
import { 
  normalizeClassGrade, 
  inferGSPaperFromSubject, 
  getGSPaperSortIndex,
  isClassGradeMatching,
  isSubjectMatching 
} from "./classNoteHelper";
import { extractUPSCDetails, isUPSCClass } from "./upscHierarchyHelper";
import { isNoteAccessibleToStudent } from "./noteAccessHelper";
import { getChapterProgressRecord, getStatusConfig, normalizeStatusLabel } from "./chapterProgressHelper";
import { getUpscHierarchy } from "../lib/curriculumService";

export interface StudentUPSCTopicNote {
  id: string;
  topicNo: number | string;
  topicName: string;
  topicLabel: string;
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
 * Single source of truth: Admin's `getUpscHierarchy()` + `allClassNotes` + student's `enrolledSubjects`.
 */
export function getStudentEnrolledGSPapers(
  student: Student,
  allClassNotes: ClassNote[] = []
): string[] {
  if (!student) return [];

  const upscHierarchy = getUpscHierarchy();
  const rawEnrolled = (student.enrolledSubjects || []).filter(
    (s) => typeof s === "string" && s.trim().length > 0
  );

  const paperSet = new Set<string>();

  if (rawEnrolled.length > 0) {
    rawEnrolled.forEach((enrolled) => {
      const clean = enrolled.trim();
      const norm = clean.toLowerCase();

      // Check if it's directly a GS Paper name or matching an admin-created paper
      const adminPaperMatch = upscHierarchy.papers.find(
        (p) => p.toLowerCase().trim() === norm || isSubjectMatching(p, clean)
      );

      if (adminPaperMatch) {
        paperSet.add(adminPaperMatch);
      } else if (norm.includes("paper") || norm.includes("general studies") || norm.includes("gs") || norm === "essay" || norm === "csat") {
        if (norm.includes("paper i") && !norm.includes("paper ii") && !norm.includes("paper iii") && !norm.includes("paper iv")) {
          paperSet.add("General Studies Paper I");
        } else if (norm.includes("paper ii") && !norm.includes("paper iii")) {
          paperSet.add("General Studies Paper II");
        } else if (norm.includes("paper iii")) {
          paperSet.add("General Studies Paper III");
        } else if (norm.includes("paper iv")) {
          paperSet.add("General Studies Paper IV");
        } else if (norm === "essay") {
          paperSet.add("Essay");
        } else if (norm === "csat") {
          paperSet.add("CSAT");
        } else {
          paperSet.add(clean);
        }
      } else {
        // Infer GS Paper from subject name
        const inferred = inferGSPaperFromSubject(clean);
        if (inferred) {
          paperSet.add(inferred);
        }

        // Check if this subject is under any admin-defined paper
        Object.entries(upscHierarchy.subjects).forEach(([pName, sList]) => {
          if (Array.isArray(sList) && sList.some((s) => isSubjectMatching(s, clean))) {
            paperSet.add(pName);
          }
        });
      }
    });

    // Also check all available notes that match the enrolled items
    if (Array.isArray(allClassNotes)) {
      allClassNotes.forEach((cn) => {
        if (isUPSCClass(cn.classGrade)) {
          const details = extractUPSCDetails(cn);
          const matchesEnrolled = rawEnrolled.some((e) => 
            isSubjectMatching(e, details.subject) || 
            isSubjectMatching(e, details.gsPaper) ||
            isSubjectMatching(e, cn.subject)
          );
          if (matchesEnrolled && details.gsPaper) {
            paperSet.add(details.gsPaper);
          }
        }
      });
    }
  } else {
    // If no explicit enrolled subjects, include all papers configured by Admin
    if (upscHierarchy.papers && upscHierarchy.papers.length > 0) {
      upscHierarchy.papers.forEach((p) => paperSet.add(p));
    }

    if (Array.isArray(allClassNotes)) {
      allClassNotes.forEach((cn) => {
        if (isUPSCClass(cn.classGrade)) {
          const details = extractUPSCDetails(cn);
          if (details.gsPaper) {
            paperSet.add(details.gsPaper);
          }
        }
      });
    }
  }

  // If still empty, provide canonical GS Papers
  if (paperSet.size === 0) {
    paperSet.add("General Studies Paper I");
    paperSet.add("General Studies Paper II");
    paperSet.add("General Studies Paper III");
    paperSet.add("General Studies Paper IV");
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
 * Derives progress bottom-up strictly from Topic Notes:
 * Topic Completion -> Module Progress -> Subject Progress -> GS Paper Progress
 * 
 * Single source of truth: Admin's `getUpscHierarchy()` + `allClassNotes`.
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
      if (!isNoteAccessibleToStudent(cn, student.id, false)) return;

      const details = extractUPSCDetails(cn);
      const removedForPaper = upscHierarchy.removedSubjects?.[details.gsPaper] || [];
      if (removedForPaper.includes(details.subject)) return;

      if (rawEnrolled.length > 0) {
        const matches = rawEnrolled.some((enrolled) => {
          if (isSubjectMatching(enrolled, details.subject)) return true;
          if (isSubjectMatching(enrolled, details.gsPaper)) return true;
          if (isSubjectMatching(enrolled, cn.subject)) return true;
          if (details.moduleName && isSubjectMatching(enrolled, details.moduleName)) return true;
          return false;
        });
        if (!matches) return;
      }

      accessibleNotes.push(cn);
    });
  }

  // 2. Map structure: gsPaper -> subjectKey -> moduleKey -> topics[]
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

  // Determine papers to ensure exist
  const papersToInclude = enrolledPapersFilter || getStudentEnrolledGSPapers(student, allClassNotes);
  papersToInclude.forEach((p) => {
    if (!paperMap.has(p)) {
      paperMap.set(p, new Map());
    }
  });

  // Pre-populate Subjects & Modules from Admin UPSC Hierarchy
  papersToInclude.forEach((p) => {
    const subjMap = paperMap.get(p)!;
    const adminSubjs = upscHierarchy.subjects?.[p] || [];
    const removedSubjs = upscHierarchy.removedSubjects?.[p] || [];

    adminSubjs.forEach((sName) => {
      if (removedSubjs.includes(sName)) return;

      if (rawEnrolled.length > 0) {
        const matches = rawEnrolled.some(
          (enrolled) => isSubjectMatching(enrolled, sName) || isSubjectMatching(enrolled, p)
        );
        if (!matches) return;
      }

      const sKey = sName.toLowerCase().trim();
      if (!subjMap.has(sKey)) {
        subjMap.set(sKey, {
          subjectName: sName,
          moduleMap: new Map(),
        });
      }

      const subjEntry = subjMap.get(sKey)!;
      const adminModules = upscHierarchy.modules?.[p]?.[sName] || [];
      adminModules.forEach((m) => {
        const mKey = `mod_${m.number}`;
        if (!subjEntry.moduleMap.has(mKey)) {
          subjEntry.moduleMap.set(mKey, {
            moduleNo: m.number,
            moduleName: m.name,
            moduleTitle: m.name.toLowerCase().startsWith("module") || m.name.toLowerCase().startsWith("chapter")
              ? m.name
              : `Module ${m.number}: ${m.name}`,
            topics: [],
          });
        }
      });
    });
  });

  // Populate map with live topic notes
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
      subjEntry.moduleMap.set(mKey, {
        moduleNo: details.moduleNo,
        moduleName: details.moduleName,
        moduleTitle: details.moduleTitle,
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
