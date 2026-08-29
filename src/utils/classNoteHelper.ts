import { ClassNote, Student, ChapterNote } from "../types";
import { groupUPSCNotesHierarchy, GroupedUPSCGSPaperItem } from "./upscHierarchyHelper";
import { getSchoolHierarchy, getUpscHierarchy } from "../lib/curriculumService";

export function normalizeClassGrade(grade?: string): string {
  if (!grade) return "";
  const trimmed = grade.trim();
  if (/^upsc$/i.test(trimmed) || /^class\s+upsc$/i.test(trimmed) || /upsc/i.test(trimmed)) {
    return "UPSC";
  }
  const match = trimmed.match(/\d+/);
  if (match) {
    return `Class ${match[0]}`;
  }
  // Check roman numerals (e.g. Class X, Class IX, etc.)
  const romanMap: Record<string, number> = {
    xii: 12, xi: 11, x: 10, ix: 9, viii: 8, vii: 7, vi: 6, v: 5, iv: 4, iii: 3, ii: 2, i: 1
  };
  const cleanGrade = trimmed.toLowerCase().replace(/class|grade|std|standard/g, "").trim();
  if (cleanGrade && romanMap[cleanGrade]) {
    return `Class ${romanMap[cleanGrade]}`;
  }
  if (/^class/i.test(trimmed)) {
    return trimmed;
  }
  return trimmed;
}

export function isClassGradeMatching(gradeA?: string, gradeB?: string): boolean {
  if (!gradeA || !gradeB) return false;
  const normA = normalizeClassGrade(gradeA).toLowerCase();
  const normB = normalizeClassGrade(gradeB).toLowerCase();
  return normA === normB;
}

/**
 * Normalizes subject string and extracts teach mode if present.
 * Trims whitespace, cleans redundant spaces, handles case-insensitivity.
 */
export function normalizeSubjectAndTeachMode(
  subject?: string,
  explicitTeachMode?: string | boolean
): {
  normalizedSubjectKey: string; // e.g. "international relations"
  normalizedTeachModeKey: string; // e.g. "teach_mode" or ""
  compositeKey: string; // e.g. "international relations:::teach_mode"
  displaySubject: string; // e.g. "International Relations (Teach Mode)" or "International Relations"
  baseSubject: string; // e.g. "International Relations"
  teachMode?: string; // e.g. "Teach Mode" or undefined
  hasTeachMode: boolean;
} {
  const rawSubject = (subject || "").trim();

  // Detect teach mode from explicit parameter or subject text
  let hasTeachMode = false;
  if (typeof explicitTeachMode === "boolean") {
    hasTeachMode = explicitTeachMode;
  } else if (typeof explicitTeachMode === "string" && explicitTeachMode.trim()) {
    hasTeachMode = /teach/i.test(explicitTeachMode);
  }

  if (/[\(\[\{]?\s*teach\s*mode\s*[\)\]\}]?/i.test(rawSubject)) {
    hasTeachMode = true;
  }

  // Extract base subject by stripping "(Teach Mode)", "[Teach Mode]", "Teach Mode"
  let cleanedBase = rawSubject
    .replace(/[\(\[\{]\s*teach\s*mode\s*[\)\]\}]/gi, "")
    .replace(/\bteach\s*mode\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  // If base subject was ONLY "Teach Mode", keep raw subject
  if (!cleanedBase) {
    cleanedBase = rawSubject || "General";
  }

  const baseNormKey = cleanedBase.toLowerCase().replace(/\s+/g, " ").trim();
  const teachModeNormKey = hasTeachMode ? "teach_mode" : "";
  const compositeKey = `${baseNormKey}:::${teachModeNormKey}`;

  const teachModeStr = hasTeachMode ? "Teach Mode" : undefined;
  const displaySubject = hasTeachMode
    ? `${cleanedBase} (Teach Mode)`
    : cleanedBase;

  return {
    normalizedSubjectKey: baseNormKey,
    normalizedTeachModeKey: teachModeNormKey,
    compositeKey,
    displaySubject,
    baseSubject: cleanedBase,
    teachMode: teachModeStr,
    hasTeachMode,
  };
}

/**
 * Normalizes chapter number and name into a canonical key.
 * Ensures Chapter 22, Module 22, etc. map to the exact same chapter group.
 */
export function normalizeChapterKey(
  chapterNo?: number | string,
  chapterName?: string
): {
  normalizedChapterKey: string; // e.g. "ch_22"
  chapterNo: number;
  chapterName: string;
} {
  let chNum = 0;
  if (chapterNo !== undefined && chapterNo !== null && chapterNo !== "") {
    chNum = parseInt(String(chapterNo), 10);
    if (isNaN(chNum)) chNum = 0;
  }

  const rawName = (chapterName || "").trim();

  // If chapterNo was not a valid number or was 0, attempt to extract from chapterName
  if (chNum <= 0 && rawName) {
    const match = rawName.match(/(?:chapter|module|ch|mod)\s*(\d+)/i);
    if (match) {
      chNum = parseInt(match[1], 10);
    }
  }

  let cleanName = rawName;
  if (!cleanName) {
    cleanName = chNum > 0 ? `Chapter ${chNum}` : "General";
  }

  const normalizedKey = chNum > 0
    ? `ch_${chNum}`
    : `name_${cleanName.toLowerCase().replace(/\s+/g, " ").trim()}`;

  return {
    normalizedChapterKey: normalizedKey,
    chapterNo: chNum,
    chapterName: cleanName,
  };
}

export function isSubjectMatching(subA?: string, subB?: string): boolean {
  if (!subA || !subB) return false;
  const rawA = subA.trim().toLowerCase();
  const rawB = subB.trim().toLowerCase();
  if (rawA === rawB) return true;

  // Universal match for "all" or "all subjects"
  if (rawA === "all" || rawA === "all subjects" || rawB === "all" || rawB === "all subjects") return true;

  // Compare normalized composite keys
  const normInfoA = normalizeSubjectAndTeachMode(subA);
  const normInfoB = normalizeSubjectAndTeachMode(subB);
  if (normInfoA.compositeKey === normInfoB.compositeKey) return true;
  if (normInfoA.normalizedSubjectKey === normInfoB.normalizedSubjectKey) return true;

  const a = normInfoA.normalizedSubjectKey;
  const b = normInfoB.normalizedSubjectKey;
  if (a === b) return true;

  // UPSC specific subject aliases (Strict 1-to-1 canonical group matching, never bleed across different subjects)
  const isPolityA = a === "polity" || a === "political science" || a === "polity & governance" || a === "polity and governance" || a === "indian polity" || a === "governance" || a === "constitution";
  const isPolityB = b === "polity" || b === "political science" || b === "polity & governance" || b === "polity and governance" || b === "indian polity" || b === "governance" || b === "constitution";
  if (isPolityA && isPolityB) return true;

  const isEconA = a === "economics" || a === "economy" || a === "indian economy" || a === "eco";
  const isEconB = b === "economics" || b === "economy" || b === "indian economy" || b === "eco";
  if (isEconA && isEconB) return true;

  const isHistA = a === "history" || a === "indian history" || a === "ancient history" || a === "medieval history" || a === "modern history" || a === "hist";
  const isHistB = b === "history" || b === "indian history" || b === "ancient history" || b === "medieval history" || b === "modern history" || b === "hist";
  if (isHistA && isHistB) return true;

  const isGeoA = a === "geography" || a === "physical geography" || a === "indian geography" || a === "world geography" || a === "geo";
  const isGeoB = b === "geography" || b === "physical geography" || b === "indian geography" || b === "world geography" || b === "geo";
  if (isGeoA && isGeoB) return true;

  const isEnvA = a === "environment" || a === "ecology" || a === "environment & ecology" || a === "environment and ecology" || a === "env";
  const isEnvB = b === "environment" || b === "ecology" || b === "environment & ecology" || b === "environment and ecology" || b === "env";
  if (isEnvA && isEnvB) return true;

  const isSciTechA = a === "science & technology" || a === "science and technology" || a === "science & tech" || a === "sci & tech" || a === "s&t" || a === "science & tech.";
  const isSciTechB = b === "science & technology" || b === "science and technology" || b === "science & tech" || b === "sci & tech" || b === "s&t" || b === "science & tech.";
  if (isSciTechA && isSciTechB) return true;

  const isIrA = a === "international relations" || a === "ir" || a === "international affairs";
  const isIrB = b === "international relations" || b === "ir" || b === "international affairs";
  if (isIrA && isIrB) return true;

  const isEthicsA = a === "ethics" || a === "ethics & integrity" || a === "ethics, integrity & aptitude" || a === "ethics and integrity" || a === "ethics, integrity and aptitude";
  const isEthicsB = b === "ethics" || b === "ethics & integrity" || b === "ethics, integrity & aptitude" || b === "ethics and integrity" || b === "ethics, integrity and aptitude";
  if (isEthicsA && isEthicsB) return true;

  const isCaA = a === "current affairs" || a === "current issues" || a === "daily current affairs" || a === "ca";
  const isCaB = b === "current affairs" || b === "current issues" || b === "daily current affairs" || b === "ca";
  if (isCaA && isCaB) return true;

  const isGsA = a === "general studies" || a === "gs";
  const isGsB = b === "general studies" || b === "gs";
  if (isGsA && isGsB) return true;

  const isCsatA = a === "csat" || a === "aptitude" || a === "general mental ability" || a === "paper 2";
  const isCsatB = b === "csat" || b === "aptitude" || b === "general mental ability" || b === "paper 2";
  if (isCsatA && isCsatB) return true;

  // General academic subject aliases
  const isMathA = a === "math" || a === "maths" || a === "mathematics";
  const isMathB = b === "math" || b === "maths" || b === "mathematics";
  if (isMathA && isMathB) return true;

  const isSciA = a === "sci" || a === "science" || a === "general science";
  const isSciB = b === "sci" || b === "science" || b === "general science";
  if (isSciA && isSciB) return true;

  const isEngA = a === "eng" || a === "english" || a === "english grammar" || a === "english literature";
  const isEngB = b === "eng" || b === "english" || b === "english grammar" || b === "english literature";
  if (isEngA && isEngB) return true;

  const isPhyA = a === "phy" || a === "physics";
  const isPhyB = b === "phy" || b === "physics";
  if (isPhyA && isPhyB) return true;

  const isChemA = a === "chem" || a === "chemistry";
  const isChemB = b === "chem" || b === "chemistry";
  if (isChemA && isChemB) return true;

  const isBioA = a === "bio" || a === "biology";
  const isBioB = b === "bio" || b === "biology";
  if (isBioA && isBioB) return true;

  const isSstA = a === "sst" || a === "social science" || a === "social studies" || a === "social";
  const isSstB = b === "sst" || b === "social science" || b === "social studies" || b === "social";
  if (isSstA && isSstB) return true;

  const isCsA = a === "cs" || a === "computer science" || a === "computer" || a === "it" || a === "information technology";
  const isCsB = b === "cs" || b === "computer science" || b === "computer" || b === "it" || b === "information technology";
  if (isCsA && isCsB) return true;

  return false;
}

/**
 * Filter centralized ClassNote items for a given student.
 * Must match:
 * 1. Active / Not deleted
 * 2. Student's ClassGrade (Class 1–12, UPSC, or explicitly shared)
 * 3. Specific note access rules (if selected student access is configured)
 * 4. Student's assigned/enrolled subjects, GS Paper, or broad enrollment
 */
export function filterClassNotesForStudent(
  classNotes: ClassNote[],
  student: Student
): ClassNote[] {
  if (!student || !Array.isArray(classNotes)) return [];

  const rawEnrolled = (student.enrolledSubjects || []).filter((s) => typeof s === "string" && s.trim());
  const enrolledSubjects = rawEnrolled.map((s) => s.trim().toLowerCase());
  const hasWildcardEnrollment = enrolledSubjects.length === 0 || enrolledSubjects.some((s) => s === "all" || s === "all subjects");

  const studentGrade = student.classGrade || "";
  const studentNormGrade = normalizeClassGrade(studentGrade).toLowerCase();

  return classNotes.filter((note) => {
    if (!note) return false;

    // 0. Check deleted / inactive status
    if (
      (note as any).isDeleted === true ||
      (note as any).status === "deleted" ||
      (note as any).hidden === true ||
      (note as any).visibility === "hidden" ||
      (note as any).active === false
    ) {
      return false;
    }

    if (!note.subject || !note.subject.trim()) return false;

    // 1. Check class grade access
    let classMatches = false;
    const isExplicitlyShared = Array.isArray(note.allowedClasses) && note.allowedClasses.length > 0;

    if (isExplicitlyShared) {
      const allowedNorm = note.allowedClasses!.map((c) => normalizeClassGrade(c).toLowerCase());
      classMatches = allowedNorm.includes(studentNormGrade) || allowedNorm.some((g) => isClassGradeMatching(g, studentGrade));
    } else if (note.accessType === "selected" && Array.isArray(note.allowedStudentIds) && note.allowedStudentIds.length > 0) {
      classMatches = note.allowedStudentIds.includes(student.id);
    } else {
      classMatches = isClassGradeMatching(note.classGrade, studentGrade);
    }

    if (!classMatches) return false;

    // 2. Check student explicit access restriction if specified
    if (note.accessType === "selected" && Array.isArray(note.allowedStudentIds)) {
      if (!note.allowedStudentIds.includes(student.id)) return false;
    }

    // 3. Check subject / GS Paper match
    if (hasWildcardEnrollment) {
      return true;
    }

    const noteSubj = (note.subject || "").trim();
    const noteGS = (note.generalStudiesPaper || (note as any).gs_paper || "").trim();
    const inferredGS = inferGSPaperFromSubject(noteSubj) || "";
    const moduleName = (note.moduleName || (note as any).module_name || "").trim();
    const chapterName = (note.chapterName || "").trim();

    return enrolledSubjects.some((enrolled) => {
      if (isSubjectMatching(enrolled, noteSubj)) return true;
      if (noteGS && isSubjectMatching(enrolled, noteGS)) return true;
      if (inferredGS && isSubjectMatching(enrolled, inferredGS)) return true;
      if (moduleName && isSubjectMatching(enrolled, moduleName)) return true;
      if (chapterName && isSubjectMatching(enrolled, chapterName)) return true;
      return false;
    });
  });
}

/**
 * Returns subjects assigned/enrolled to the student, expanding GS papers and falling back to class subjects if unassigned.
 * Queries live Admin Curriculum Hierarchy as the single source of truth.
 */
export function getStudentSubjects(student: Student, allClassNotes: ClassNote[] = []): string[] {
  if (!student) return [];

  const subjectsSet = new Set<string>();
  const rawEnrolled = (student.enrolledSubjects || []).filter((s) => typeof s === "string" && s.trim());
  const isUpsc = normalizeClassGrade(student.classGrade).toLowerCase().includes("upsc");

  if (isUpsc) {
    const upscHierarchy = getUpscHierarchy();

    if (rawEnrolled.length > 0) {
      rawEnrolled.forEach((sub) => {
        const clean = sub.trim();
        const norm = clean.toLowerCase();

        // Check if enrolled item is a GS Paper
        const isPaper = norm.includes("paper") || norm.includes("general studies") || norm.includes("gs") || norm === "essay" || norm === "csat";
        if (isPaper) {
          // Find matching paper in upscHierarchy
          const matchingPaper = upscHierarchy.papers.find(
            (p) => p.toLowerCase().trim() === norm || isSubjectMatching(p, clean)
          ) || clean;

          const removed = upscHierarchy.removedSubjects?.[matchingPaper] || [];
          const adminSubjs = (upscHierarchy.subjects?.[matchingPaper] || []).filter((s) => !removed.includes(s));
          adminSubjs.forEach((s) => subjectsSet.add(s));

          // Also check allClassNotes for subjects under this paper
          if (Array.isArray(allClassNotes)) {
            allClassNotes.forEach((cn) => {
              if (isClassGradeMatching(cn.classGrade, student.classGrade)) {
                const cnGS = cn.generalStudiesPaper || (cn as any).gs_paper || inferGSPaperFromSubject(cn.subject);
                if (cnGS && isSubjectMatching(cnGS, matchingPaper) && cn.subject) {
                  if (!removed.includes(cn.subject.trim())) {
                    subjectsSet.add(cn.subject.trim());
                  }
                }
              }
            });
          }
        } else {
          // It's a specific subject
          subjectsSet.add(clean);
        }
      });
    } else {
      // If student has no explicitly listed subjects, automatically include all subjects under all papers in upscHierarchy!
      (upscHierarchy.papers || []).forEach((paper) => {
        const removed = upscHierarchy.removedSubjects?.[paper] || [];
        const adminSubjs = (upscHierarchy.subjects?.[paper] || []).filter((s) => !removed.includes(s));
        adminSubjs.forEach((s) => subjectsSet.add(s));
      });

      if (Array.isArray(allClassNotes)) {
        allClassNotes.forEach((cn) => {
          if (cn.subject && cn.subject.trim() && isClassGradeMatching(cn.classGrade, student.classGrade)) {
            subjectsSet.add(cn.subject.trim());
          }
        });
      }
    }
  } else {
    // School student
    const schoolHierarchy = getSchoolHierarchy();
    const studentClass = student.classGrade ? normalizeClassGrade(student.classGrade) : "";

    const matchingClassKey = schoolHierarchy.classes.find(
      (c) => normalizeClassGrade(c).toLowerCase() === studentClass.toLowerCase()
    ) || student.classGrade || "";

    const removed = (matchingClassKey && schoolHierarchy.removedSubjects?.[matchingClassKey]) || [];
    const adminSubjs = (matchingClassKey && schoolHierarchy.subjects?.[matchingClassKey]) || [];

    if (rawEnrolled.length > 0) {
      rawEnrolled.forEach((sub) => {
        if (!removed.includes(sub.trim())) {
          subjectsSet.add(sub.trim());
        }
      });
    } else {
      // Automatically include all subjects under student's class from Admin hierarchy!
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
  }

  return Array.from(subjectsSet).sort((a, b) => a.localeCompare(b));
}

export interface GroupedChapterParts {
  chapterNo: number;
  chapterName: string;
  parts: ClassNote[];
}

export interface GroupedSubjectChapters {
  subject: string;
  chapters: GroupedChapterParts[];
}

export interface GroupedGSPaperSubjects {
  gsPaper: string;
  subjects: GroupedSubjectChapters[];
}

export interface GroupedClassNotes {
  classGrade: string;
  subjects: GroupedSubjectChapters[];
  gsPapers?: GroupedGSPaperSubjects[];
  upscHierarchy?: GroupedUPSCGSPaperItem<ClassNote>[];
}

/**
 * Standard UPSC General Studies Papers in canonical order.
 */
export const UPSC_GS_PAPERS_CANONICAL = [
  "General Studies Paper I",
  "General Studies Paper II",
  "General Studies Paper III",
  "General Studies Paper IV",
  "Essay",
  "CSAT"
];

export function getGSPaperSortIndex(paper: string): number {
  const norm = (paper || "").toLowerCase().trim();
  if (norm.includes("paper i") && !norm.includes("paper ii") && !norm.includes("paper iii") && !norm.includes("paper iv")) return 1;
  if (norm.includes("paper ii") && !norm.includes("paper iii")) return 2;
  if (norm.includes("paper iii")) return 3;
  if (norm.includes("paper iv")) return 4;
  if (norm.includes("essay")) return 5;
  if (norm.includes("csat")) return 6;
  return 99;
}

export function inferGSPaperFromSubject(subject?: string): string {
  if (!subject) return "General Studies Paper I";
  const s = subject.toLowerCase().trim();
  if (s.includes("ethics")) return "General Studies Paper IV";
  if (s.includes("polity") || s.includes("governance") || s.includes("international relations") || s.includes("ir") || s.includes("constitution")) return "General Studies Paper II";
  if (s.includes("economy") || s.includes("economics") || s.includes("environment") || s.includes("ecology") || s.includes("science") || s.includes("tech")) return "General Studies Paper III";
  if (s.includes("history") || s.includes("geography") || s.includes("heritage") || s.includes("culture") || s.includes("society")) return "General Studies Paper I";
  if (s.includes("essay")) return "Essay";
  if (s.includes("csat") || s.includes("aptitude") || s.includes("reasoning")) return "CSAT";
  return "General Studies Paper I";
}

/**
 * Sanitize folder and file names by replacing spaces with _ and removing invalid filesystem characters.
 */
export function sanitizeUPSCPathSegment(segment: string): string {
  if (!segment) return "";
  return segment
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Format GS Paper into a canonical storage folder name e.g. "GS_Paper_II".
 */
export function formatGSPaperFolderName(gsPaper: string): string {
  const clean = (gsPaper || "General Studies Paper I").trim();
  const romanMap: Record<string, string> = { "1": "I", "2": "II", "3": "III", "4": "IV" };
  const m = clean.match(/^(?:General\s+Studies\s+Paper|GS\s+Paper|Paper)\s*([IVXivx\d]+)/i);
  if (m) {
    const numOrRoman = m[1].toUpperCase();
    const roman = romanMap[numOrRoman] || numOrRoman;
    return `GS_Paper_${roman}`;
  }
  if (/^essay$/i.test(clean)) return "Essay";
  if (/^csat$/i.test(clean)) return "CSAT";
  return sanitizeUPSCPathSegment(clean.replace(/^General\s+Studies\s+Paper/i, "GS_Paper")) || "GS_Paper_I";
}

/**
 * Generate UPSC Supabase Storage Path adhering strictly to:
 * UPSC/{gs_paper}/{subject}/Module_{module_number}_{module_name}/Topic_{topic_number}_{topic_name}.{extension}
 */
export function generateUPSCStoragePath(
  gsPaper: string,
  subject: string,
  moduleNo: number | string,
  moduleName: string,
  topicNo?: number | string,
  topicName?: string,
  originalFileName?: string,
  extension?: string
): { storagePath: string; fileName: string } {
  const gsFolder = formatGSPaperFolderName(gsPaper);
  const subjFolder = sanitizeUPSCPathSegment(subject) || "General_Studies";
  
  const mNo = Number(moduleNo) || 1;
  const mName = sanitizeUPSCPathSegment(moduleName) || `Module_${mNo}`;
  const moduleFolder = `Module_${mNo}_${mName}`;

  let ext = (extension || "").replace(/^\./, "").toLowerCase();
  if (!ext && originalFileName && originalFileName.includes(".")) {
    ext = originalFileName.split(".").pop()!.toLowerCase();
  }
  if (!ext) ext = "pdf";

  const tNo = topicNo !== undefined && topicNo !== "" ? topicNo : 1;
  let tName = topicName ? sanitizeUPSCPathSegment(topicName) : "";
  if (!tName && originalFileName) {
    const nameWithoutExt = originalFileName.replace(/\.[^/.]+$/, "");
    tName = sanitizeUPSCPathSegment(nameWithoutExt);
  }
  if (!tName) {
    tName = mName;
  }

  const fileName = `Topic_${tNo}_${tName}.${ext}`;
  const storagePath = `UPSC/${gsFolder}/${subjFolder}/${moduleFolder}/${fileName}`.replace(/\/+/g, "/");

  return { storagePath, fileName };
}

/**
 * Group ClassNotes into Class -> Subject -> Chapter -> Parts hierarchy.
 * Normalizes subjects (including Teach Mode), chapters, and topics to prevent duplicate sections.
 * For UPSC: provides both unified deduplicated subjects and structured gsPapers groups.
 */
export function groupClassNotesHierarchy(notes: ClassNote[]): GroupedClassNotes[] {
  const classMap = new Map<string, ClassNote[]>();

  for (const note of notes) {
    if (!note || !note.subject || !note.subject.trim()) continue;
    const normalizedClass = normalizeClassGrade(note.classGrade) || "General";
    if (!classMap.has(normalizedClass)) {
      classMap.set(normalizedClass, []);
    }
    classMap.get(normalizedClass)!.push(note);
  }

  const result: GroupedClassNotes[] = [];

  // Sort classes numerical order e.g. Class 6, Class 7, Class 8, Class 9, Class 10... and UPSC
  const sortedClasses = Array.from(classMap.keys()).sort((a, b) => {
    if (a === "UPSC") return 1;
    if (b === "UPSC") return -1;
    const numA = parseInt(a.replace(/\D/g, ""), 10) || 999;
    const numB = parseInt(b.replace(/\D/g, ""), 10) || 999;
    if (numA !== numB) return numA - numB;
    return a.localeCompare(b);
  });

  for (const cls of sortedClasses) {
    const classNotes = classMap.get(cls) || [];

    // Helper to sort topics / parts inside chapter
    const sortParts = (parts: ClassNote[]) => {
      parts.sort((p1, p2) => {
        const t1No = p1.topicNo !== undefined && p1.topicNo !== "" ? Number(p1.topicNo) : undefined;
        const t2No = p2.topicNo !== undefined && p2.topicNo !== "" ? Number(p2.topicNo) : undefined;
        if (t1No !== undefined && t2No !== undefined && !isNaN(t1No) && !isNaN(t2No)) {
          if (t1No !== t2No) return t1No - t2No;
        } else if (t1No !== undefined && !isNaN(t1No)) {
          return -1;
        } else if (t2No !== undefined && !isNaN(t2No)) {
          return 1;
        }

        const l1 = (p1.partLabel || p1.topicName || p1.pdfFileName || "").toLowerCase();
        const l2 = (p2.partLabel || p2.topicName || p2.pdfFileName || "").toLowerCase();
        if (!l1 && !l2) return 0;
        if (!l1) return -1;
        if (!l2) return 1;
        return l1.localeCompare(l2, undefined, { numeric: true });
      });
    };

    // Helper to build sorted GroupedSubjectChapters[]
    const buildSubjectGroups = (
      sMap: Map<
        string,
        {
          displaySubject: string;
          chapterMap: Map<string, { chapterNo: number; chapterName: string; parts: ClassNote[] }>;
        }
      >
    ): GroupedSubjectChapters[] => {
      const subjectList: GroupedSubjectChapters[] = [];

      const sortedSubjKeys = Array.from(sMap.keys()).sort((a, b) => {
        const nameA = sMap.get(a)!.displaySubject;
        const nameB = sMap.get(b)!.displaySubject;
        return nameA.localeCompare(nameB);
      });

      for (const sKey of sortedSubjKeys) {
        const sEntry = sMap.get(sKey)!;
        const chapterGroups: GroupedChapterParts[] = [];

        const sortedChKeys = Array.from(sEntry.chapterMap.keys()).sort((a, b) => {
          const chA = sEntry.chapterMap.get(a)!;
          const chB = sEntry.chapterMap.get(b)!;
          if (chA.chapterNo !== chB.chapterNo) {
            return chA.chapterNo - chB.chapterNo;
          }
          return chA.chapterName.localeCompare(chB.chapterName);
        });

        for (const chKey of sortedChKeys) {
          const chEntry = sEntry.chapterMap.get(chKey)!;
          if (!chEntry.parts || chEntry.parts.length === 0) continue;

          sortParts(chEntry.parts);

          chapterGroups.push({
            chapterNo: chEntry.chapterNo,
            chapterName: chEntry.chapterName,
            parts: chEntry.parts,
          });
        }

        if (chapterGroups.length > 0) {
          subjectList.push({
            subject: sEntry.displaySubject,
            chapters: chapterGroups,
          });
        }
      }

      return subjectList;
    };

    // Unified Subject Map for this class: compositeSubjectKey -> { displaySubject, chapterMap }
    const subjectMap = new Map<
      string,
      {
        displaySubject: string;
        chapterMap: Map<string, { chapterNo: number; chapterName: string; parts: ClassNote[] }>;
      }
    >();

    // GS Paper Map for UPSC metadata
    const gsPaperMap = new Map<
      string,
      Map<
        string,
        {
          displaySubject: string;
          chapterMap: Map<string, { chapterNo: number; chapterName: string; parts: ClassNote[] }>;
        }
      >
    >();

    for (const note of classNotes) {
      const explicitTeach = (note as any).teachMode ?? (note as any).teach_mode ?? (note as any).isTeachMode;
      const subInfo = normalizeSubjectAndTeachMode(note.subject, explicitTeach);
      const chNoRaw = note.chapterNo ?? (note as any).moduleNo ?? (note as any).module_number ?? (note as any).chapter_number ?? 1;
      const chNameRaw = note.chapterName ?? (note as any).moduleName ?? (note as any).module_name ?? (note as any).chapter_name ?? `Chapter ${chNoRaw}`;
      const chInfo = normalizeChapterKey(chNoRaw, chNameRaw);

      // --- SUBJECT LEVEL ---
      if (!subjectMap.has(subInfo.compositeKey)) {
        subjectMap.set(subInfo.compositeKey, {
          displaySubject: subInfo.displaySubject,
          chapterMap: new Map(),
        });
      }
      const subjEntry = subjectMap.get(subInfo.compositeKey)!;

      // Keep most descriptive display subject if available
      if (
        subInfo.displaySubject &&
        (!subjEntry.displaySubject || subjEntry.displaySubject.length < subInfo.displaySubject.length)
      ) {
        subjEntry.displaySubject = subInfo.displaySubject;
      }

      // --- CHAPTER LEVEL ---
      if (!subjEntry.chapterMap.has(chInfo.normalizedChapterKey)) {
        subjEntry.chapterMap.set(chInfo.normalizedChapterKey, {
          chapterNo: chInfo.chapterNo,
          chapterName: chInfo.chapterName,
          parts: [],
        });
      }
      const chEntry = subjEntry.chapterMap.get(chInfo.normalizedChapterKey)!;

      // Prefer descriptive chapter title over generic "Chapter X" or "Module X"
      if (
        chInfo.chapterName &&
        !/^(?:chapter|module)\s*\d+$/i.test(chInfo.chapterName) &&
        /^(?:chapter|module)\s*\d+$/i.test(chEntry.chapterName)
      ) {
        chEntry.chapterName = chInfo.chapterName;
      }

      // Deduplicate note if already in parts (by id or storagePath)
      const isDuplicate = chEntry.parts.some((p) => {
        if (p.id && note.id && p.id === note.id) return true;
        if (p.storagePath && note.storagePath && p.storagePath === note.storagePath) return true;
        if (p.pdfUrl && note.pdfUrl && !note.pdfUrl.startsWith("data:") && p.pdfUrl === note.pdfUrl) return true;
        return false;
      });

      if (!isDuplicate) {
        chEntry.parts.push(note);
      }

      // --- UPSC GS PAPER MAPPING ---
      if (cls === "UPSC") {
        const gsPaper = (note.generalStudiesPaper || (note as any).gs_paper || inferGSPaperFromSubject(note.subject) || "General Studies Paper I").trim();
        if (!gsPaperMap.has(gsPaper)) {
          gsPaperMap.set(gsPaper, new Map());
        }
        const gsSubjMap = gsPaperMap.get(gsPaper)!;
        if (!gsSubjMap.has(subInfo.compositeKey)) {
          gsSubjMap.set(subInfo.compositeKey, {
            displaySubject: subInfo.displaySubject,
            chapterMap: new Map(),
          });
        }
        const gsSubjEntry = gsSubjMap.get(subInfo.compositeKey)!;
        if (!gsSubjEntry.chapterMap.has(chInfo.normalizedChapterKey)) {
          gsSubjEntry.chapterMap.set(chInfo.normalizedChapterKey, {
            chapterNo: chInfo.chapterNo,
            chapterName: chInfo.chapterName,
            parts: [],
          });
        }
        const gsChEntry = gsSubjEntry.chapterMap.get(chInfo.normalizedChapterKey)!;
        const isGsDup = gsChEntry.parts.some(
          (p) => p.id === note.id || (p.storagePath && p.storagePath === note.storagePath)
        );
        if (!isGsDup) {
          gsChEntry.parts.push(note);
        }
      }
    }

    const finalSubjects = buildSubjectGroups(subjectMap);

    if (cls === "UPSC") {
      const sortedGSPapers = Array.from(gsPaperMap.keys()).sort((a, b) => {
        const idxA = getGSPaperSortIndex(a);
        const idxB = getGSPaperSortIndex(b);
        if (idxA !== idxB) return idxA - idxB;
        return a.localeCompare(b);
      });

      const gsPaperGroups: GroupedGSPaperSubjects[] = [];
      for (const gsPaper of sortedGSPapers) {
        const gsSubjMap = gsPaperMap.get(gsPaper)!;
        const gsSubjects = buildSubjectGroups(gsSubjMap);
        if (gsSubjects.length > 0) {
          gsPaperGroups.push({
            gsPaper,
            subjects: gsSubjects,
          });
        }
      }

      const upscHierarchy = groupUPSCNotesHierarchy<ClassNote>(classNotes);

      if (finalSubjects.length > 0 || (upscHierarchy && upscHierarchy.length > 0)) {
        result.push({
          classGrade: "UPSC",
          subjects: finalSubjects,
          gsPapers: gsPaperGroups,
          upscHierarchy: upscHierarchy,
        });
      }
    } else {
      if (finalSubjects.length > 0) {
        result.push({
          classGrade: cls,
          subjects: finalSubjects,
        });
      }
    }
  }

  return result;
}

/**
 * Automatically migrates legacy notes stored in students[].notes into centralized ClassNote[].
 * Ensures no duplicate PDFs exist based on storagePath or pdfUrl or id.
 */
export function migrateLegacyNotesToClassNotes(
  students: Student[],
  existingClassNotes: ClassNote[]
): { migratedNotes: ClassNote[]; addedCount: number } {
  const resultNotes = [...existingClassNotes];
  const existingKeys = new Set<string>();

  for (const n of existingClassNotes) {
    if (n.storagePath) existingKeys.add(`path:${n.storagePath}`);
    if (n.pdfUrl && !n.pdfUrl.startsWith("data:")) existingKeys.add(`url:${n.pdfUrl}`);
    existingKeys.add(`id:${n.id}`);
  }

  let addedCount = 0;

  for (const student of students) {
    const studentClass = normalizeClassGrade(student.classGrade);
    if (!student.notes) continue;

    for (const [subject, chapterNotes] of Object.entries(student.notes)) {
      if (!Array.isArray(chapterNotes)) continue;

      for (const note of chapterNotes) {
        const pathKey = note.storagePath ? `path:${note.storagePath}` : "";
        const urlKey = note.pdfUrl && !note.pdfUrl.startsWith("data:") ? `url:${note.pdfUrl}` : "";
        const idKey = `id:${note.id}`;

        if (
          (pathKey && existingKeys.has(pathKey)) ||
          (urlKey && existingKeys.has(urlKey)) ||
          existingKeys.has(idKey)
        ) {
          continue; // Skip duplicate
        }

        const explicitTeach = (note as any).teachMode ?? (note as any).teach_mode ?? (note as any).isTeachMode;
        const subInfo = normalizeSubjectAndTeachMode(subject, explicitTeach);
        const chInfo = normalizeChapterKey(note.chapterNo, note.chapterName);

        const newClassNote: ClassNote = {
          id: note.id || `migrated-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          classGrade: studentClass,
          subject: subInfo.displaySubject,
          teachMode: subInfo.teachMode,
          chapterNo: chInfo.chapterNo || 1,
          chapterName: chInfo.chapterName || "General Chapter",
          moduleNo: (note as any).moduleNo || (note as any).module_number || chInfo.chapterNo || undefined,
          moduleName: (note as any).moduleName || (note as any).module_name || chInfo.chapterName || undefined,
          generalStudiesPaper: (note as any).generalStudiesPaper || (note as any).gs_paper || undefined,
          gs_paper: (note as any).generalStudiesPaper || (note as any).gs_paper || undefined,
          partLabel: (note as any).partLabel || (note as any).topicLabel || "",
          topicNo: (note as any).topicNo || (note as any).topic_number || undefined,
          topicName: (note as any).topicName || (note as any).topic_name || undefined,
          pdfUrl: note.pdfUrl || "",
          pdfFileName: note.pdfFileName || note.fileName || `Chapter_${chInfo.chapterNo || 1}.pdf`,
          storagePath: note.storagePath || "",
          bucket: note.bucket || "",
          createdAt: note.createdAt || new Date().toISOString(),
          uploadedBy: "Admin Migration",
        };

        resultNotes.push(newClassNote);
        if (pathKey) existingKeys.add(pathKey);
        if (urlKey) existingKeys.add(urlKey);
        existingKeys.add(idKey);
        addedCount++;
      }
    }
  }

  return { migratedNotes: resultNotes, addedCount };
}
