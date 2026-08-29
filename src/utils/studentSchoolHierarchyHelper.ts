/**
 * Student School Hierarchy Service & Bottom-Up Progress Aggregation
 * 
 * Implements the 4-tier School hierarchy:
 * Class -> Subject -> Module/Chapter -> Topic Note
 * 
 * Fully driven by the Admin Console single source of truth:
 * - Admin Curriculum Hierarchy (`getSchoolHierarchy()`)
 * - Live Class Notes (`allClassNotes`)
 * - Student Completion Progress (`student.chapterProgress`)
 */

import { Student, ClassNote, ChapterNote } from "../types";
import { getSchoolHierarchy, SchoolHierarchyData } from "../lib/curriculumService";
import { isNoteAccessibleToStudent } from "./noteAccessHelper";
import {
  isClassGradeMatching,
  normalizeClassGrade,
  isSubjectMatching
} from "./classNoteHelper";
import {
  parseNotePartInfo,
  getFormattedTopicLabel
} from "./chapterNotesHelper";
import { getChapterProgressRecord, normalizeStatusLabel, getStatusConfig } from "./chapterProgressHelper";

export interface StudentSchoolTopicNote {
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

export interface StudentSchoolModule {
  moduleNo: number;
  moduleName: string;
  moduleTitle: string;
  moduleKey: string;
  topics: StudentSchoolTopicNote[];
  totalTopics: number;
  completedTopics: number;
  progressPercent: number;
}

export interface StudentSchoolSubject {
  subject: string;
  subjectKey: string;
  modules: StudentSchoolModule[];
  totalModules: number;
  totalTopics: number;
  completedTopics: number;
  progressPercent: number;
}

export interface StudentSchoolClassHierarchy {
  className: string;
  classKey: string;
  subjects: StudentSchoolSubject[];
  totalSubjects: number;
  totalModules: number;
  totalTopics: number;
  completedTopics: number;
  progressPercent: number;
}

/**
 * Check if a student has completed a given topic note.
 */
export function isStudentSchoolTopicCompleted(
  note: ClassNote | ChapterNote,
  subject: string,
  student: Student
): boolean {
  if (!note) return false;
  if ((note as ChapterNote).isCompleted) return true;

  if (student?.chapterProgress) {
    const prog = getChapterProgressRecord(note.id, subject, student.chapterProgress);
    if (prog) {
      const norm = normalizeStatusLabel(prog.selectedStatus);
      const conf = getStatusConfig(prog.selectedStatus);
      if (norm === "Fully Prepared" || (conf && conf.category === "completed") || prog.calculatedProgress === 100) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Extracts school details from a ClassNote or ChapterNote.
 */
export function extractSchoolDetails(note: ClassNote | ChapterNote): {
  className: string;
  subject: string;
  moduleNo: number;
  moduleName: string;
  moduleTitle: string;
  topicNo: number | string;
  topicName: string;
  topicLabel: string;
} {
  const className = (note as any).className || note.classGrade || (note as any).class || "Class 10";
  const subject = (note as any).subjectName || note.subject || "General";
  
  const rawChNo = (note as any).chapterNumber ?? note.chapterNo ?? 1;
  const moduleNo = typeof rawChNo === "number" ? rawChNo : parseInt(String(rawChNo).replace(/\D/g, ""), 10) || 1;
  const rawChName = (note as any).chapterTitle || (note as any).chapterName || note.chapterName || `Chapter ${moduleNo}`;
  const moduleName = rawChName.trim();
  const moduleTitle = moduleName.toLowerCase().startsWith("chapter") || moduleName.toLowerCase().startsWith("module")
    ? moduleName
    : `Chapter ${moduleNo}: ${moduleName}`;

  const parsed = parseNotePartInfo(note, 0);
  const topicNo = parsed.topicNo || parsed.partNumber || 1;
  const topicName = parsed.topicName || parsed.partLabel || (note as any).topicTitle || `Part ${topicNo}`;
  const topicLabel = getFormattedTopicLabel(note) || (parsed.topicLabel ? parsed.topicLabel : `Topic ${topicNo}: ${topicName}`);

  return {
    className,
    subject,
    moduleNo,
    moduleName,
    moduleTitle,
    topicNo,
    topicName,
    topicLabel,
  };
}

/**
 * Get all enrolled subjects for a School student based on:
 * 1. Admin School Hierarchy (`schoolHierarchy.subjects[className]`)
 * 2. Live Class Notes (`allClassNotes`)
 * 3. Student's `enrolledSubjects` filter
 */
export function getStudentEnrolledSchoolSubjects(
  student: Student,
  allClassNotes: ClassNote[] = []
): string[] {
  if (!student) return [];

  const schoolHierarchy = getSchoolHierarchy();
  const studentClass = student.classGrade ? normalizeClassGrade(student.classGrade) : "";
  
  const matchingClassKey = schoolHierarchy.classes.find(
    (c) => normalizeClassGrade(c).toLowerCase() === studentClass.toLowerCase()
  ) || student.classGrade || "";

  const removed = (matchingClassKey && schoolHierarchy.removedSubjects?.[matchingClassKey]) || [];
  const adminSubjs = (matchingClassKey && schoolHierarchy.subjects?.[matchingClassKey]) || [];

  const subjectsSet = new Set<string>();
  const rawEnrolled = (student.enrolledSubjects || []).filter((s) => typeof s === "string" && s.trim());

  if (rawEnrolled.length > 0) {
    rawEnrolled.forEach((sub) => {
      if (!removed.includes(sub.trim())) {
        subjectsSet.add(sub.trim());
      }
    });
  } else {
    // If student has no specific subjects enrolled, automatically receive all subjects from Admin hierarchy
    adminSubjs.forEach((sub) => {
      if (!removed.includes(sub)) {
        subjectsSet.add(sub);
      }
    });

    if (Array.isArray(allClassNotes)) {
      allClassNotes.forEach((cn) => {
        if (cn.subject && cn.subject.trim() && isClassGradeMatching(cn.classGrade, student.classGrade)) {
          if (!removed.includes(cn.subject.trim())) {
            subjectsSet.add(cn.subject.trim());
          }
        }
      });
    }
  }

  return Array.from(subjectsSet).sort((a, b) => a.localeCompare(b));
}

/**
 * Builds the complete 4-tier hierarchy for School students:
 * Class -> Subject -> Module/Chapter -> Topic Note
 * 
 * Uses live Admin Curriculum Hierarchy & Class Notes as single source of truth.
 * Progress is computed bottom-up: Topic Completion -> Module Progress -> Subject Progress -> Class Progress.
 */
export function buildStudentSchoolHierarchy(
  student: Student,
  allClassNotes: ClassNote[] = [],
  enrolledSubjectsFilter?: string[]
): StudentSchoolClassHierarchy {
  const schoolHierarchy = getSchoolHierarchy();
  const studentClass = student.classGrade ? normalizeClassGrade(student.classGrade) : "Class 10";
  
  const matchingClassKey = schoolHierarchy.classes.find(
    (c) => normalizeClassGrade(c).toLowerCase() === studentClass.toLowerCase()
  ) || studentClass;

  const removedSubjs = schoolHierarchy.removedSubjects?.[matchingClassKey] || [];
  const rawEnrolled = enrolledSubjectsFilter || (student?.enrolledSubjects || []).filter(
    (s) => typeof s === "string" && s.trim().length > 0
  );

  // Subject Map: subjectKey -> { subjectName, moduleMap }
  const subjMap = new Map<
    string,
    {
      subjectName: string;
      moduleMap: Map<
        string,
        {
          moduleNo: number;
          moduleName: string;
          moduleTitle: string;
          topics: StudentSchoolTopicNote[];
        }
      >;
    }
  >();

  // 1. Pre-populate subjects and chapters/modules from Admin School Hierarchy
  const adminSubjs = schoolHierarchy.subjects?.[matchingClassKey] || [];
  adminSubjs.forEach((sName) => {
    if (removedSubjs.includes(sName)) return;

    if (rawEnrolled.length > 0) {
      const matches = rawEnrolled.some((enrolled) => isSubjectMatching(enrolled, sName));
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
    const adminChapters = schoolHierarchy.chapters?.[matchingClassKey]?.[sName] || [];
    adminChapters.forEach((ch) => {
      const mKey = `mod_${ch.number}`;
      if (!subjEntry.moduleMap.has(mKey)) {
        subjEntry.moduleMap.set(mKey, {
          moduleNo: ch.number,
          moduleName: ch.name,
          moduleTitle: ch.name.toLowerCase().startsWith("chapter") || ch.name.toLowerCase().startsWith("module")
            ? ch.name
            : `Chapter ${ch.number}: ${ch.name}`,
          topics: [],
        });
      }
    });
  });

  // 2. Gather accessible notes from live Class Notes (admin repository)
  const accessibleNotes: (ClassNote | ChapterNote)[] = [];
  if (Array.isArray(allClassNotes)) {
    allClassNotes.forEach((cn) => {
      if (!isClassGradeMatching(cn.classGrade, studentClass)) return;
      if (!isNoteAccessibleToStudent(cn, student.id, false)) return;

      const details = extractSchoolDetails(cn);
      if (removedSubjs.includes(details.subject)) return;

      if (rawEnrolled.length > 0) {
        const matches = rawEnrolled.some(
          (enrolled) => isSubjectMatching(enrolled, details.subject) || isSubjectMatching(enrolled, cn.subject)
        );
        if (!matches) return;
      }

      accessibleNotes.push(cn);
    });
  }

  // 3. Populate live topic notes into the hierarchy
  accessibleNotes.forEach((note) => {
    const details = extractSchoolDetails(note);
    const sKey = details.subject.toLowerCase().trim();

    if (!subjMap.has(sKey)) {
      subjMap.set(sKey, {
        subjectName: details.subject,
        moduleMap: new Map(),
      });
    }
    const subjEntry = subjMap.get(sKey)!;

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

    const isDup = modEntry.topics.some(
      (t) => t.id === note.id || (t.note.storagePath && note.storagePath && t.note.storagePath === note.storagePath)
    );

    if (!isDup) {
      const isCompleted = isStudentSchoolTopicCompleted(note, details.subject, student);
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

  // 4. Aggregate progress bottom-up
  const sortedSubjKeys = Array.from(subjMap.keys()).sort((a, b) => {
    const nameA = subjMap.get(a)!.subjectName;
    const nameB = subjMap.get(b)!.subjectName;
    return nameA.localeCompare(nameB);
  });

  const subjects: StudentSchoolSubject[] = [];
  let classTotalModules = 0;
  let classTotalTopics = 0;
  let classCompletedTopics = 0;

  for (const sKey of sortedSubjKeys) {
    const sEntry = subjMap.get(sKey)!;
    const sortedModKeys = Array.from(sEntry.moduleMap.keys()).sort((a, b) => {
      const mA = sEntry.moduleMap.get(a)!.moduleNo;
      const mB = sEntry.moduleMap.get(b)!.moduleNo;
      return mA - mB;
    });

    const modules: StudentSchoolModule[] = [];
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

    classTotalModules += subjTotalModules;
    classTotalTopics += subjTotalTopics;
    classCompletedTopics += subjCompletedTopics;

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

  const classTotalSubjects = subjects.length;
  const classProgress = classTotalTopics > 0 ? Math.round((classCompletedTopics / classTotalTopics) * 100) : 0;

  return {
    className: matchingClassKey,
    classKey: matchingClassKey.toLowerCase().replace(/\s+/g, "_"),
    subjects,
    totalSubjects: classTotalSubjects,
    totalModules: classTotalModules,
    totalTopics: classTotalTopics,
    completedTopics: classCompletedTopics,
    progressPercent: classProgress,
  };
}
