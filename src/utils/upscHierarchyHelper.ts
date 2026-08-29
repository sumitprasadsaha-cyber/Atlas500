import { ClassNote, ChapterNote } from "../types";
import { 
  normalizeClassGrade, 
  normalizeSubjectAndTeachMode, 
  inferGSPaperFromSubject, 
  getGSPaperSortIndex,
  normalizeChapterKey 
} from "./classNoteHelper";
import { parseNotePartInfo, getCleanChapterTitle } from "./chapterNotesHelper";

export interface GroupedUPSCTopic<T = ClassNote | ChapterNote> {
  topicNo: number | string;
  topicName: string;
  topicLabel: string;
  note: T;
}

export interface GroupedUPSCChapterItem<T = ClassNote | ChapterNote> {
  chapterNo: number;
  chapterName: string;
  chapterTitle: string; // e.g. "Chapter 22 – Foundations of Indian Foreign Policy"
  chapterKey: string;
  topics: GroupedUPSCTopic<T>[];
  parts: T[]; // alias for compatibility
  notesCount: number;
}

export interface GroupedUPSCModuleItem<T = ClassNote | ChapterNote> {
  moduleNo: number;
  moduleName: string;
  moduleTitle: string; // e.g. "Module 1 – International Relations"
  moduleKey: string;
  chapters: GroupedUPSCChapterItem<T>[];
  notesCount: number;
}

export interface GroupedUPSCSubjectItem<T = ClassNote | ChapterNote> {
  subject: string;
  subjectKey: string;
  modules: GroupedUPSCModuleItem<T>[];
  notesCount: number;
}

export interface GroupedUPSCGSPaperItem<T = ClassNote | ChapterNote> {
  gsPaper: string;
  gsPaperKey: string;
  subjects: GroupedUPSCSubjectItem<T>[];
  notesCount: number;
}

/**
 * Check if the given classGrade is the UPSC class.
 */
export function isUPSCClass(classGrade?: string): boolean {
  if (!classGrade) return false;
  return normalizeClassGrade(classGrade) === "UPSC";
}

/**
 * Clean a name by stripping leading "Module X –", "Chapter X –", or "Topic X –"
 */
export function cleanEntityName(name?: string, prefixType?: "module" | "chapter" | "topic"): string {
  if (!name) return "";
  let clean = name.trim();
  if (prefixType === "module") {
    clean = clean.replace(/^(?:module|mod)\s*\.?\s*\d+\s*(?:[:–\-]|–|-)\s*/i, "").trim();
  } else if (prefixType === "chapter") {
    clean = clean.replace(/^(?:chapter|ch)\s*\.?\s*\d+\s*(?:[:–\-]|–|-)\s*/i, "").trim();
  } else if (prefixType === "topic") {
    clean = clean.replace(/^(?:topic|part|pt)\s*\.?\s*\d+\s*(?:[:–\-]|–|-)\s*/i, "").trim();
  }
  return clean || name.trim();
}

/**
 * Canonical format for GS Paper name.
 */
export function canonicalGSPaperName(rawPaper?: string, subject?: string): string {
  if (!rawPaper || !rawPaper.trim()) {
    return inferGSPaperFromSubject(subject);
  }
  const clean = rawPaper.trim();
  const romanMap: Record<string, string> = { "1": "I", "2": "II", "3": "III", "4": "IV" };
  const m = clean.match(/^(?:General\s+Studies\s+Paper|GS\s+Paper|Paper)\s*([IVXivx\d]+)/i);
  if (m) {
    const numOrRoman = m[1].toUpperCase();
    const roman = romanMap[numOrRoman] || numOrRoman;
    return `General Studies Paper ${roman}`;
  }
  if (/^essay$/i.test(clean)) return "Essay";
  if (/^csat$/i.test(clean)) return "CSAT";
  return clean;
}

/**
 * Extract complete normalized UPSC hierarchy metadata from any note.
 */
export function extractUPSCDetails(note: any): {
  gsPaper: string;
  subject: string;
  moduleNo: number;
  moduleName: string;
  moduleTitle: string;
  chapterNo: number;
  chapterName: string;
  chapterTitle: string;
  topicNo: number | string;
  topicName: string;
  topicLabel: string;
} {
  const explicitTeach = note.teachMode ?? note.teach_mode ?? note.isTeachMode;
  const subInfo = normalizeSubjectAndTeachMode(note.subject, explicitTeach);
  const subject = subInfo.displaySubject || "General Studies";

  // 1. GS Paper
  let rawGsPaper = note.gsPaper || note.generalStudiesPaper || note.gs_paper || note.paper || "";
  if (!rawGsPaper && note.storagePath) {
    const gsMatch = note.storagePath.match(/(?:GS_Paper_|GS|Paper_)?([1-4]|I{1,4})/i);
    if (gsMatch) {
      const rMap: Record<string, string> = { "1": "I", "2": "II", "3": "III", "4": "IV" };
      const val = gsMatch[1].toUpperCase();
      const roman = rMap[val] || val;
      rawGsPaper = `General Studies Paper ${roman}`;
    } else if (/essay/i.test(note.storagePath)) {
      rawGsPaper = "Essay";
    } else if (/csat/i.test(note.storagePath)) {
      rawGsPaper = "CSAT";
    }
  }
  const gsPaper = canonicalGSPaperName(rawGsPaper, subject);

  // 2. Module
  let moduleNo = 1;
  const rawModNo = note.moduleNo ?? note.module_number;
  if (rawModNo !== undefined && rawModNo !== null && rawModNo !== "") {
    const parsed = parseInt(String(rawModNo), 10);
    if (!isNaN(parsed) && parsed > 0) moduleNo = parsed;
  } else if (note.storagePath) {
    const modMatch = note.storagePath.match(/\/Module_(\d+)_/i);
    if (modMatch) {
      moduleNo = parseInt(modMatch[1], 10) || 1;
    }
  }

  let moduleName = note.moduleName || note.module_name || "";
  if (!moduleName && note.storagePath) {
    const modMatch = note.storagePath.match(/\/Module_\d+_([^/]+)/i);
    if (modMatch) {
      moduleName = modMatch[1].replace(/_/g, " ").trim();
    }
  }
  if (!moduleName) {
    moduleName = subInfo.baseSubject || "General";
  }
  moduleName = cleanEntityName(moduleName, "module");
  const moduleTitle = `Module ${moduleNo} – ${moduleName}`;

  // 3. Chapter
  let chapterNo = 1;
  const rawChNo = note.chapterNo ?? note.chapter_number ?? note.chapter_no;
  if (rawChNo !== undefined && rawChNo !== null && rawChNo !== "") {
    const parsed = parseInt(String(rawChNo), 10);
    if (!isNaN(parsed) && parsed > 0) chapterNo = parsed;
  } else if (note.storagePath) {
    const chMatch = note.storagePath.match(/\/(?:Chapter|Module)_(\d+)_/i);
    if (chMatch) {
      chapterNo = parseInt(chMatch[1], 10) || 1;
    }
  }

  let chapterName = note.chapterName || note.chapter_name || "";
  if (!chapterName && note.storagePath) {
    const chMatch = note.storagePath.match(/\/(?:Chapter|Module)_\d+_([^/]+)/i);
    if (chMatch) {
      chapterName = chMatch[1].replace(/_/g, " ").trim();
    }
  }
  chapterName = getCleanChapterTitle(cleanEntityName(chapterName, "chapter")) || `Chapter ${chapterNo}`;
  const chapterTitle = `Chapter ${chapterNo} – ${chapterName}`;

  // 4. Topic
  const partInfo = parseNotePartInfo(note, 0);
  const topicNo = partInfo.topicNo || 1;
  const topicName = cleanEntityName(partInfo.topicName, "topic");
  const topicLabel = topicName ? `Topic ${topicNo} – ${topicName}` : `Topic ${topicNo}`;

  return {
    gsPaper,
    subject,
    moduleNo,
    moduleName,
    moduleTitle,
    chapterNo,
    chapterName,
    chapterTitle,
    topicNo,
    topicName,
    topicLabel,
  };
}

/**
 * Group UPSC notes into:
 * UPSC -> GS Paper -> Subject -> Module -> Chapter -> Topics (Notes)
 * Ensures 0 duplicates, sorts numerically and canonically at every level.
 */
export function groupUPSCNotesHierarchy<T extends { id?: string; storagePath?: string; pdfUrl?: string }>(
  notes: T[]
): GroupedUPSCGSPaperItem<T>[] {
  // Map: GS Paper -> Subject -> Module -> Chapter -> Topics
  const gsPaperMap = new Map<
    string,
    Map<
      string,
      Map<
        string,
        Map<
          string,
          {
            chapterNo: number;
            chapterName: string;
            chapterTitle: string;
            chapterKey: string;
            topics: GroupedUPSCTopic<T>[];
          }
        >
      >
    >
  >();

  // Helper maps for display names
  const subjectDisplayMap = new Map<string, string>();
  const moduleInfoMap = new Map<string, { moduleNo: number; moduleName: string; moduleTitle: string }>();

  for (const note of notes) {
    if (!note) continue;
    const details = extractUPSCDetails(note);

    const gsPaper = details.gsPaper;
    const subjKey = details.subject.toLowerCase().trim();
    const modKey = `mod_${details.moduleNo}`;
    const chKey = `ch_${details.chapterNo}`;

    subjectDisplayMap.set(subjKey, details.subject);
    moduleInfoMap.set(`${subjKey}__${modKey}`, {
      moduleNo: details.moduleNo,
      moduleName: details.moduleName,
      moduleTitle: details.moduleTitle,
    });

    if (!gsPaperMap.has(gsPaper)) {
      gsPaperMap.set(gsPaper, new Map());
    }
    const subjMap = gsPaperMap.get(gsPaper)!;

    if (!subjMap.has(subjKey)) {
      subjMap.set(subjKey, new Map());
    }
    const modMap = subjMap.get(subjKey)!;

    if (!modMap.has(modKey)) {
      modMap.set(modKey, new Map());
    }
    const chMap = modMap.get(modKey)!;

    if (!chMap.has(chKey)) {
      chMap.set(chKey, {
        chapterNo: details.chapterNo,
        chapterName: details.chapterName,
        chapterTitle: details.chapterTitle,
        chapterKey: chKey,
        topics: [],
      });
    }
    const chEntry = chMap.get(chKey)!;

    // Prefer more descriptive chapter title if currently generic
    if (
      details.chapterName &&
      !/^(?:chapter|module)\s*\d+$/i.test(details.chapterName) &&
      /^(?:chapter|module)\s*\d+$/i.test(chEntry.chapterName)
    ) {
      chEntry.chapterName = details.chapterName;
      chEntry.chapterTitle = details.chapterTitle;
    }

    // Deduplicate topic note inside chapter
    const isDup = chEntry.topics.some((t) => {
      const n = t.note;
      if (n.id && note.id && n.id === note.id) return true;
      if (n.storagePath && note.storagePath && n.storagePath === note.storagePath) return true;
      if (n.pdfUrl && note.pdfUrl && !note.pdfUrl.startsWith("data:") && n.pdfUrl === note.pdfUrl) return true;
      return false;
    });

    if (!isDup) {
      chEntry.topics.push({
        topicNo: details.topicNo,
        topicName: details.topicName,
        topicLabel: details.topicLabel,
        note,
      });
    }
  }

  // Sort and build final result
  const sortedGSPapers = Array.from(gsPaperMap.keys()).sort((a, b) => {
    const idxA = getGSPaperSortIndex(a);
    const idxB = getGSPaperSortIndex(b);
    if (idxA !== idxB) return idxA - idxB;
    return a.localeCompare(b);
  });

  const result: GroupedUPSCGSPaperItem<T>[] = [];

  for (const gsPaper of sortedGSPapers) {
    const subjMap = gsPaperMap.get(gsPaper)!;
    const sortedSubjKeys = Array.from(subjMap.keys()).sort((a, b) => {
      const nameA = subjectDisplayMap.get(a) || a;
      const nameB = subjectDisplayMap.get(b) || b;
      return nameA.localeCompare(nameB);
    });

    const subjects: GroupedUPSCSubjectItem<T>[] = [];
    let gsPaperTotalNotes = 0;

    for (const subjKey of sortedSubjKeys) {
      const modMap = subjMap.get(subjKey)!;
      const sortedModKeys = Array.from(modMap.keys()).sort((a, b) => {
        const modA = moduleInfoMap.get(`${subjKey}__${a}`)?.moduleNo || 0;
        const modB = moduleInfoMap.get(`${subjKey}__${b}`)?.moduleNo || 0;
        return modA - modB;
      });

      const modules: GroupedUPSCModuleItem<T>[] = [];
      let subjTotalNotes = 0;

      for (const modKey of sortedModKeys) {
        const chMap = modMap.get(modKey)!;
        const modInfo = moduleInfoMap.get(`${subjKey}__${modKey}`) || {
          moduleNo: 1,
          moduleName: subjectDisplayMap.get(subjKey) || "Module 1",
          moduleTitle: `Module 1 – ${subjectDisplayMap.get(subjKey) || "General"}`,
        };

        const sortedChKeys = Array.from(chMap.keys()).sort((a, b) => {
          const chA = chMap.get(a)!;
          const chB = chMap.get(b)!;
          if (chA.chapterNo !== chB.chapterNo) return chA.chapterNo - chB.chapterNo;
          return chA.chapterName.localeCompare(chB.chapterName);
        });

        const chapters: GroupedUPSCChapterItem<T>[] = [];
        let modTotalNotes = 0;

        for (const chKey of sortedChKeys) {
          const chEntry = chMap.get(chKey)!;
          if (chEntry.topics.length === 0) continue;

          // Sort topics numerically
          chEntry.topics.sort((t1, t2) => {
            const num1 = typeof t1.topicNo === "number" ? t1.topicNo : parseInt(String(t1.topicNo), 10);
            const num2 = typeof t2.topicNo === "number" ? t2.topicNo : parseInt(String(t2.topicNo), 10);
            if (!isNaN(num1) && !isNaN(num2) && num1 !== num2) return num1 - num2;
            return t1.topicLabel.localeCompare(t2.topicLabel, undefined, { numeric: true });
          });

          const notesCount = chEntry.topics.length;
          modTotalNotes += notesCount;

          chapters.push({
            chapterNo: chEntry.chapterNo,
            chapterName: chEntry.chapterName,
            chapterTitle: chEntry.chapterTitle,
            chapterKey: chEntry.chapterKey,
            topics: chEntry.topics,
            parts: chEntry.topics.map((t) => t.note),
            notesCount,
          });
        }

        if (chapters.length > 0) {
          subjTotalNotes += modTotalNotes;
          modules.push({
            moduleNo: modInfo.moduleNo,
            moduleName: modInfo.moduleName,
            moduleTitle: modInfo.moduleTitle,
            moduleKey: modKey,
            chapters,
            notesCount: modTotalNotes,
          });
        }
      }

      if (modules.length > 0) {
        gsPaperTotalNotes += subjTotalNotes;
        subjects.push({
          subject: subjectDisplayMap.get(subjKey) || subjKey,
          subjectKey: subjKey,
          modules,
          notesCount: subjTotalNotes,
        });
      }
    }

    if (subjects.length > 0) {
      result.push({
        gsPaper,
        gsPaperKey: gsPaper.toLowerCase().replace(/\s+/g, "_"),
        subjects,
        notesCount: gsPaperTotalNotes,
      });
    }
  }

  return result;
}
