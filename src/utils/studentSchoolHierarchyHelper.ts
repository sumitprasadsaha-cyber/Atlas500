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
import { getSchoolHierarchy, SchoolHierarchyData, ChapterInfo } from "../lib/curriculumService";
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
import {
  getAccessibleSubjectsForClass,
  getAccessibleClassesGrantedToClass,
  getCanonicalOwnerClass,
  isNoteAccessibleInClass,
  normalizeClassId,
} from "../lib/curriculumAccessService";

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
  ownerClass?: string;
  isAccessible?: boolean;
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

export interface AccessibleClassGroup {
  ownerClass: string;
  ownerClassKey: string;
  subjects: StudentSchoolSubject[];
  totalModules: number;
  totalTopics: number;
  completedTopics: number;
  progressPercent: number;
}

export interface StudentCurriculumHierarchyResult {
  myClass: StudentSchoolClassHierarchy;
  accessibleClasses: AccessibleClassGroup[];
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
  
  const rawChNo = (note as any).chapterNumber ?? (note as any).chapterNo ?? note.chapterNo ?? 1;
  const moduleNo = typeof rawChNo === "number" ? rawChNo : parseInt(String(rawChNo).replace(/\D/g, ""), 10) || 1;
  const rawChName = (note as any).chapterTitle || (note as any).chapterName || note.chapterName || `Chapter ${moduleNo}`;
  const moduleName = rawChName.trim();
  const moduleTitle = moduleName.toLowerCase().startsWith("chapter") || moduleName.toLowerCase().startsWith("module")
    ? moduleName
    : `Chapter ${moduleNo}: ${moduleName}`;

  const parsed = parseNotePartInfo(note, 0);
  const topicNo = (note as any).topicNumber ?? note.topicNo ?? parsed.topicNo ?? parsed.partNumber ?? 1;
  const rawTopicName = (note as any).topicName || (note as any).name || (note as any).topicTitle || parsed.topicName || parsed.partLabel || `Topic ${topicNo}`;
  const topicName = typeof rawTopicName === "string" 
    ? rawTopicName.replace(/^[\(\[\{-]?\s*(?:topic|part|pt)\b\.?[\s_]*\d+[\)\]\}]?[\s_.:–\-]*\s*/gi, "").replace(/_/g, " ").trim() || rawTopicName
    : String(rawTopicName);
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
    (c) => normalizeClassGrade(c).toLowerCase() === studentClass.toLowerCase() || c.toLowerCase().trim() === studentClass.toLowerCase()
  ) || Object.keys(schoolHierarchy.subjects || {}).find(
    (c) => normalizeClassGrade(c).toLowerCase() === studentClass.toLowerCase() || c.toLowerCase().trim() === studentClass.toLowerCase()
  ) || student.classGrade || "";

  const removed = Object.entries(schoolHierarchy.removedSubjects || {}).flatMap(([clsKey, list]) => {
    if (clsKey.toLowerCase().trim() === matchingClassKey.toLowerCase().trim() || normalizeClassGrade(clsKey).toLowerCase() === studentClass.toLowerCase()) {
      return (list || []).map((s) => s.toLowerCase().trim());
    }
    return [];
  });

  const adminSubjs = Object.entries(schoolHierarchy.subjects || {}).flatMap(([clsKey, list]) => {
    if (clsKey.toLowerCase().trim() === matchingClassKey.toLowerCase().trim() || normalizeClassGrade(clsKey).toLowerCase() === studentClass.toLowerCase()) {
      return list || [];
    }
    return [];
  });

  const subjectsSet = new Set<string>();
  const rawEnrolled = (student.enrolledSubjects || []).filter((s) => typeof s === "string" && s.trim());

  if (rawEnrolled.length > 0) {
    rawEnrolled.forEach((sub) => {
      if (!removed.includes(sub.trim().toLowerCase())) {
        subjectsSet.add(sub.trim());
      }
    });
  } else {
    // If student has no specific subjects enrolled, automatically receive all subjects from Admin hierarchy & allowed access
    const accessibleSubjs = getAccessibleSubjectsForClass(studentClass, schoolHierarchy, allClassNotes);
    accessibleSubjs.forEach((sub) => {
      if (!removed.includes(sub.toLowerCase().trim())) {
        subjectsSet.add(sub);
      }
    });

    adminSubjs.forEach((sub) => {
      if (!removed.includes(sub.toLowerCase().trim())) {
        subjectsSet.add(sub);
      }
    });

    if (Array.isArray(allClassNotes)) {
      allClassNotes.forEach((cn) => {
        if (cn.subject && cn.subject.trim() && (isClassGradeMatching(cn.classGrade, student.classGrade) || isNoteAccessibleInClass(cn, studentClass))) {
          if (!removed.includes(cn.subject.trim().toLowerCase())) {
            subjectsSet.add(cn.subject.trim());
          }
        }
      });
    }
  }

  return Array.from(subjectsSet).sort((a, b) => a.localeCompare(b));
}

/**
 * Builds a single StudentSchoolSubject directly from the canonical owner's curriculum:
 * - Reads chapters from schoolHierarchy.chapters[targetClass][subjectName]
 * - Reads topic notes from allClassNotes where note belongs to targetClass & subjectName
 * - Computes topic completion for the student via student.chapterProgress
 * - Computes module progress and subject progress bottom-up
 */
export function buildSingleSchoolSubject(
  subjectName: string,
  targetClass: string,
  student: Student,
  allClassNotes: ClassNote[] = [],
  isAccessible: boolean = false
): StudentSchoolSubject {
  const schoolHierarchy = getSchoolHierarchy();
  const normTargetClass = normalizeClassGrade(targetClass).toLowerCase();

  const matchingClassKey =
    schoolHierarchy.classes.find(
      (c) => normalizeClassGrade(c).toLowerCase() === normTargetClass || c.toLowerCase().trim() === normTargetClass
    ) ||
    Object.keys(schoolHierarchy.subjects || {}).find(
      (c) => normalizeClassGrade(c).toLowerCase() === normTargetClass || c.toLowerCase().trim() === normTargetClass
    ) ||
    targetClass;

  const sKey = subjectName.toLowerCase().trim();

  // Module map: moduleKey -> module info
  const moduleMap = new Map<
    string,
    {
      moduleNo: number;
      moduleName: string;
      moduleTitle: string;
      topics: StudentSchoolTopicNote[];
    }
  >();

  // 1. Populate chapters from schoolHierarchy.chapters
  let adminChapters: ChapterInfo[] = [];

  Object.entries(schoolHierarchy.chapters || {}).forEach(([clsKey, chMap]) => {
    if (
      clsKey.toLowerCase().trim() === matchingClassKey.toLowerCase().trim() ||
      normalizeClassGrade(clsKey).toLowerCase() === normTargetClass
    ) {
      Object.entries(chMap || {}).forEach(([subjKey, chList]) => {
        if (isSubjectMatching(subjKey, subjectName)) {
          adminChapters = chList || [];
        }
      });
    }
  });

  // If no chapters found directly under matchingClassKey, check canonical owner if any
  if (adminChapters.length === 0) {
    const canonicalOwner = getCanonicalOwnerClass(subjectName, targetClass);
    if (canonicalOwner && schoolHierarchy.chapters?.[canonicalOwner]) {
      const ownerSubjMatch = Object.keys(schoolHierarchy.chapters[canonicalOwner]).find((sub) =>
        isSubjectMatching(sub, subjectName)
      );
      if (ownerSubjMatch) {
        adminChapters = schoolHierarchy.chapters[canonicalOwner][ownerSubjMatch] || [];
      }
    }
  }

  // Pre-seed modules from admin chapters
  adminChapters.forEach((ch) => {
    const mKey = `mod_${ch.number}`;
    if (!moduleMap.has(mKey)) {
      moduleMap.set(mKey, {
        moduleNo: ch.number,
        moduleName: ch.name,
        moduleTitle:
          ch.name.toLowerCase().startsWith("chapter") || ch.name.toLowerCase().startsWith("module")
            ? ch.name
            : `Chapter ${ch.number}: ${ch.name}`,
        topics: [],
      });
    }
  });

  // 2. Gather notes belonging to targetClass and subjectName
  if (Array.isArray(allClassNotes)) {
    allClassNotes.forEach((cn) => {
      // Must match subject
      if (!isSubjectMatching(cn.subject, subjectName)) return;

      // Must belong to targetClass directly (canonical source)
      const cnClass = (cn as any).className || cn.classGrade || (cn as any).class || "";
      if (!isClassGradeMatching(cnClass, targetClass) && normalizeClassId(cnClass) !== normalizeClassId(targetClass)) {
        return;
      }

      // Check student accessibility
      if (!isNoteAccessibleToStudent(cn, student.id, false)) return;

      const details = extractSchoolDetails(cn);
      const mKey = `mod_${details.moduleNo}`;

      if (!moduleMap.has(mKey)) {
        moduleMap.set(mKey, {
          moduleNo: details.moduleNo,
          moduleName: details.moduleName,
          moduleTitle: details.moduleTitle,
          topics: [],
        });
      }

      const modEntry = moduleMap.get(mKey)!;
      const isDup = modEntry.topics.some(
        (t) => t.id === cn.id || (t.note.storagePath && cn.storagePath && t.note.storagePath === cn.storagePath)
      );

      if (!isDup) {
        const isCompleted = isStudentSchoolTopicCompleted(cn, subjectName, student);
        const fileSize = (cn as any).fileSize || (cn as any).file_size;
        const fileName = cn.pdfFileName || (cn as any).fileName || (cn as any).filename;
        const createdAt = (cn as any).createdAt || (cn as any).uploadedAt;
        const fileType = (cn as any).fileType || ((fileName && /\.(png|jpe?g|webp)$/i.test(fileName)) ? "image" : "pdf");

        modEntry.topics.push({
          id: cn.id,
          topicNo: details.topicNo,
          topicName: details.topicName,
          topicLabel: details.topicLabel,
          note: cn,
          isCompleted,
          fileSize,
          fileName,
          createdAt,
          fileType,
        });
      }
    });
  }

  // 3. Sort modules & topics and aggregate progress bottom-up
  const sortedModKeys = Array.from(moduleMap.keys()).sort((a, b) => {
    const mA = moduleMap.get(a)!.moduleNo;
    const mB = moduleMap.get(b)!.moduleNo;
    return mA - mB;
  });

  const modules: StudentSchoolModule[] = [];
  let subjTotalTopics = 0;
  let subjCompletedTopics = 0;

  for (const mKey of sortedModKeys) {
    const mEntry = moduleMap.get(mKey)!;

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

  const subjProgress = subjTotalTopics > 0 ? Math.round((subjCompletedTopics / subjTotalTopics) * 100) : 0;

  return {
    subject: subjectName,
    subjectKey: sKey,
    ownerClass: targetClass,
    isAccessible,
    modules,
    totalModules: modules.length,
    totalTopics: subjTotalTopics,
    completedTopics: subjCompletedTopics,
    progressPercent: subjProgress,
  };
}

/**
 * Builds the complete 4-tier hierarchy for School students:
 * Partitioned into:
 * 1. `myClass`: student's enrolled/native class curriculum
 * 2. `accessibleClasses`: permission-granted classes with canonical owner subjects
 * 
 * Rules:
 * - Content belongs to the owner class.
 * - Progress belongs to the student.
 * - Only classes containing at least one accessible subject are included.
 */
export function buildCompleteStudentSchoolHierarchy(
  student: Student,
  allClassNotes: ClassNote[] = []
): StudentCurriculumHierarchyResult {
  const schoolHierarchy = getSchoolHierarchy();
  const studentClass = student.classGrade ? normalizeClassGrade(student.classGrade) : "Class 10";

  const matchingClassKey =
    schoolHierarchy.classes.find(
      (c) => normalizeClassGrade(c).toLowerCase() === studentClass.toLowerCase() || c.toLowerCase().trim() === studentClass.toLowerCase()
    ) ||
    Object.keys(schoolHierarchy.subjects || {}).find(
      (c) => normalizeClassGrade(c).toLowerCase() === studentClass.toLowerCase() || c.toLowerCase().trim() === studentClass.toLowerCase()
    ) ||
    studentClass;

  const removedSubjs = Object.entries(schoolHierarchy.removedSubjects || {}).flatMap(([clsKey, list]) => {
    if (
      clsKey.toLowerCase().trim() === matchingClassKey.toLowerCase().trim() ||
      normalizeClassGrade(clsKey).toLowerCase() === studentClass.toLowerCase()
    ) {
      return (list || []).map((s) => s.toLowerCase().trim());
    }
    return [];
  });

  const rawEnrolled = (student?.enrolledSubjects || []).filter(
    (s) => typeof s === "string" && s.trim().length > 0
  );

  // A. Build My Class (Native Subjects)
  const nativeSubjectsSet = new Set<string>();

  // From hierarchy.subjects
  const hierarchySubjs = (matchingClassKey && schoolHierarchy.subjects?.[matchingClassKey]) || [];
  hierarchySubjs.forEach((s) => {
    if (s && s.trim()) nativeSubjectsSet.add(s.trim());
  });

  // From hierarchy.chapters
  const hierarchyChapters = (matchingClassKey && schoolHierarchy.chapters?.[matchingClassKey]) || {};
  Object.keys(hierarchyChapters).forEach((s) => {
    if (s && s.trim()) nativeSubjectsSet.add(s.trim());
  });

  // From notes belonging directly to student's own class
  if (Array.isArray(allClassNotes)) {
    allClassNotes.forEach((cn) => {
      if (isClassGradeMatching(cn.classGrade, studentClass)) {
        if (cn.subject && cn.subject.trim()) {
          nativeSubjectsSet.add(cn.subject.trim());
        }
      }
    });
  }

  let myClassSubjNames = Array.from(nativeSubjectsSet).filter(
    (s) => !removedSubjs.includes(s.toLowerCase().trim())
  );

  if (rawEnrolled.length > 0) {
    myClassSubjNames = myClassSubjNames.filter((sName) =>
      rawEnrolled.some((enrolled) => isSubjectMatching(enrolled, sName))
    );
  }

  myClassSubjNames.sort((a, b) => a.localeCompare(b));

  const myClassSubjects: StudentSchoolSubject[] = myClassSubjNames.map((sName) =>
    buildSingleSchoolSubject(sName, studentClass, student, allClassNotes, false)
  );

  let myClassTotalModules = 0;
  let myClassTotalTopics = 0;
  let myClassCompletedTopics = 0;

  myClassSubjects.forEach((sub) => {
    myClassTotalModules += sub.totalModules;
    myClassTotalTopics += sub.totalTopics;
    myClassCompletedTopics += sub.completedTopics;
  });

  const myClassProgress =
    myClassTotalTopics > 0 ? Math.round((myClassCompletedTopics / myClassTotalTopics) * 100) : 0;

  const myClassHierarchy: StudentSchoolClassHierarchy = {
    className: matchingClassKey,
    classKey: matchingClassKey.toLowerCase().replace(/\s+/g, "_"),
    subjects: myClassSubjects,
    totalSubjects: myClassSubjects.length,
    totalModules: myClassTotalModules,
    totalTopics: myClassTotalTopics,
    completedTopics: myClassCompletedTopics,
    progressPercent: myClassProgress,
  };

  // B. Build Accessible Classes (Permission-Based)
  // Retrieve:
  // 1. the student’s own class
  // 2. all Class Access permissions granted to that class
  // 3. the owner classes
  // 4. the permitted subjects
  const accessibleClassesInfo = getAccessibleClassesGrantedToClass(studentClass);
  const accessibleClassGroups: AccessibleClassGroup[] = [];

  accessibleClassesInfo.forEach((classInfo) => {
    const groupSubjects: StudentSchoolSubject[] = [];

    classInfo.subjects.forEach((sName) => {
      // Build subject directly from owner's curriculum
      const subjObj = buildSingleSchoolSubject(sName, classInfo.ownerClass, student, allClassNotes, true);
      // Only include if subject has modules/topics or is valid in owner curriculum
      groupSubjects.push(subjObj);
    });

    // Only show classes that contain at least one accessible subject. Do not show empty classes.
    if (groupSubjects.length > 0) {
      let groupTotalModules = 0;
      let groupTotalTopics = 0;
      let groupCompletedTopics = 0;

      groupSubjects.forEach((s) => {
        groupTotalModules += s.totalModules;
        groupTotalTopics += s.totalTopics;
        groupCompletedTopics += s.completedTopics;
      });

      const groupProgress =
        groupTotalTopics > 0 ? Math.round((groupCompletedTopics / groupTotalTopics) * 100) : 0;

      accessibleClassGroups.push({
        ownerClass: classInfo.ownerClass,
        ownerClassKey: classInfo.ownerClassKey,
        subjects: groupSubjects,
        totalModules: groupTotalModules,
        totalTopics: groupTotalTopics,
        completedTopics: groupCompletedTopics,
        progressPercent: groupProgress,
      });
    }
  });

  return {
    myClass: myClassHierarchy,
    accessibleClasses: accessibleClassGroups,
  };
}

/**
 * Backwards-compatible wrapper returning the StudentSchoolClassHierarchy.
 */
export function buildStudentSchoolHierarchy(
  student: Student,
  allClassNotes: ClassNote[] = [],
  enrolledSubjectsFilter?: string[]
): StudentSchoolClassHierarchy {
  const result = buildCompleteStudentSchoolHierarchy(student, allClassNotes);
  return result.myClass;
}
