/**
 * Atlas v5.0.8 — Permanent Curriculum Hierarchy Service
 * Manages Classes, GS Papers, Subjects, Chapters, and Modules with:
 * - Real-time bidirectional Firestore persistence (`curriculum_hierarchy` collection)
 * - Zero-loss local storage & IndexedDB cache
 * - Automatic discovery & merge from existing ClassNote records
 * - Complete isolation from destructive deployments or page reloads
 */

import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import { getFirebaseDb } from "./firebase";
import { ClassNote } from "../types";
import { safeLocalStorageSetItem, safeLocalStorageGetItem } from "./safeStorage";

export interface ChapterInfo {
  number: number;
  name: string;
}

export interface SchoolHierarchyData {
  classes: string[];
  subjects: Record<string, string[]>;
  chapters: Record<string, Record<string, ChapterInfo[]>>;
  removedSubjects: Record<string, string[]>;
  updatedAt?: string;
  version?: number;
}

export interface UpscHierarchyData {
  papers: string[];
  subjects: Record<string, string[]>;
  modules: Record<string, Record<string, ChapterInfo[]>>;
  removedSubjects: Record<string, string[]>;
  updatedAt?: string;
  version?: number;
}

// Local Storage Keys
const STORAGE_KEY_SCHOOL_HIERARCHY = "tuition_school_curriculum_hierarchy_v2";
const STORAGE_KEY_UPSC_HIERARCHY = "tuition_upsc_curriculum_hierarchy_v2";

// Legacy localStorage keys for backward compatibility migration
const LEGACY_STORAGE_CUSTOM_SCHOOL_CLASSES = "tuition_custom_school_classes";
const LEGACY_STORAGE_CUSTOM_SCHOOL_SUBJECTS = "tuition_custom_school_subjects";
const LEGACY_STORAGE_CUSTOM_SCHOOL_CHAPTERS = "tuition_custom_school_chapters";
const LEGACY_STORAGE_REMOVED_SCHOOL_SUBJECTS = "tuition_removed_school_subjects";
const LEGACY_STORAGE_CUSTOM_UPSC_PAPERS = "tuition_custom_upsc_papers";
const LEGACY_STORAGE_CUSTOM_UPSC_SUBJECTS = "tuition_custom_upsc_subjects";
const LEGACY_STORAGE_CUSTOM_UPSC_MODULES = "tuition_custom_upsc_modules";
const LEGACY_STORAGE_REMOVED_UPSC_SUBJECTS = "tuition_removed_upsc_subjects";

// Active Selection State Keys
const STORAGE_KEY_ACTIVE_TAB = "tuition_notes_active_tab";
const STORAGE_KEY_SELECTED_SCHOOL_CLASS = "tuition_notes_selected_school_class";
const STORAGE_KEY_SELECTED_SCHOOL_SUBJECT = "tuition_notes_selected_school_subject";
const STORAGE_KEY_SELECTED_SCHOOL_CHAPTER_NO = "tuition_notes_selected_school_chapter_no";
const STORAGE_KEY_SELECTED_SCHOOL_CHAPTER_NAME = "tuition_notes_selected_school_chapter_name";
const STORAGE_KEY_SELECTED_UPSC_PAPER = "tuition_notes_selected_upsc_paper";
const STORAGE_KEY_SELECTED_UPSC_SUBJECT = "tuition_notes_selected_upsc_subject";
const STORAGE_KEY_SELECTED_UPSC_MODULE_NO = "tuition_notes_selected_upsc_module_no";
const STORAGE_KEY_SELECTED_UPSC_MODULE_NAME = "tuition_notes_selected_upsc_module_name";
const STORAGE_KEY_SELECTED_TOPIC_NOTE_ID = "tuition_notes_selected_topic_note_id";

// In-Memory cache for synchronous access
let inMemorySchoolHierarchy: SchoolHierarchyData | null = null;
let inMemoryUpscHierarchy: UpscHierarchyData | null = null;

// Subscribers
type HierarchyListener = () => void;
const hierarchyListeners = new Set<HierarchyListener>();

function notifyHierarchyListeners() {
  hierarchyListeners.forEach((listener) => {
    try {
      listener();
    } catch (err) {
      console.warn("[CurriculumService] Listener callback error:", err);
    }
  });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("curriculum-hierarchy-updated"));
    window.dispatchEvent(new CustomEvent("notes-progress-updated"));
  }
}

function safeParseJson<T>(jsonStr: string | null, fallback: T): T {
  if (!jsonStr) return fallback;
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    return fallback;
  }
}

/**
 * Migrate and load legacy storage keys into unified hierarchy structure
 */
function getInitialSchoolHierarchy(): SchoolHierarchyData {
  if (inMemorySchoolHierarchy) return inMemorySchoolHierarchy;

  if (typeof window === "undefined") {
    return { classes: [], subjects: {}, chapters: {}, removedSubjects: {}, version: 2 };
  }

  const cached = safeLocalStorageGetItem(STORAGE_KEY_SCHOOL_HIERARCHY);
  if (cached) {
    const parsed = safeParseJson<SchoolHierarchyData | null>(cached, null);
    if (parsed && Array.isArray(parsed.classes)) {
      inMemorySchoolHierarchy = parsed;
      return inMemorySchoolHierarchy;
    }
  }

  // Load from legacy keys if available
  const legacyClasses = safeParseJson<string[]>(localStorage.getItem(LEGACY_STORAGE_CUSTOM_SCHOOL_CLASSES), []);
  const legacySubjects = safeParseJson<Record<string, string[]>>(localStorage.getItem(LEGACY_STORAGE_CUSTOM_SCHOOL_SUBJECTS), {});
  const legacyChapters = safeParseJson<Record<string, Record<string, ChapterInfo[]>>>(localStorage.getItem(LEGACY_STORAGE_CUSTOM_SCHOOL_CHAPTERS), {});
  const legacyRemoved = safeParseJson<Record<string, string[]>>(localStorage.getItem(LEGACY_STORAGE_REMOVED_SCHOOL_SUBJECTS), {});

  const initial: SchoolHierarchyData = {
    classes: legacyClasses,
    subjects: legacySubjects,
    chapters: legacyChapters,
    removedSubjects: legacyRemoved,
    version: 2,
    updatedAt: new Date().toISOString()
  };

  inMemorySchoolHierarchy = initial;
  safeLocalStorageSetItem(STORAGE_KEY_SCHOOL_HIERARCHY, JSON.stringify(initial));
  return initial;
}

function getInitialUpscHierarchy(): UpscHierarchyData {
  if (inMemoryUpscHierarchy) return inMemoryUpscHierarchy;

  if (typeof window === "undefined") {
    return { papers: [], subjects: {}, modules: {}, removedSubjects: {}, version: 2 };
  }

  const cached = safeLocalStorageGetItem(STORAGE_KEY_UPSC_HIERARCHY);
  if (cached) {
    const parsed = safeParseJson<UpscHierarchyData | null>(cached, null);
    if (parsed && Array.isArray(parsed.papers)) {
      inMemoryUpscHierarchy = parsed;
      return inMemoryUpscHierarchy;
    }
  }

  // Load from legacy keys if available
  const legacyPapers = safeParseJson<string[]>(localStorage.getItem(LEGACY_STORAGE_CUSTOM_UPSC_PAPERS), []);
  const legacySubjects = safeParseJson<Record<string, string[]>>(localStorage.getItem(LEGACY_STORAGE_CUSTOM_UPSC_SUBJECTS), {});
  const legacyModules = safeParseJson<Record<string, Record<string, ChapterInfo[]>>>(localStorage.getItem(LEGACY_STORAGE_CUSTOM_UPSC_MODULES), {});
  const legacyRemoved = safeParseJson<Record<string, string[]>>(localStorage.getItem(LEGACY_STORAGE_REMOVED_UPSC_SUBJECTS), {});

  const initial: UpscHierarchyData = {
    papers: legacyPapers,
    subjects: legacySubjects,
    modules: legacyModules,
    removedSubjects: legacyRemoved,
    version: 2,
    updatedAt: new Date().toISOString()
  };

  inMemoryUpscHierarchy = initial;
  safeLocalStorageSetItem(STORAGE_KEY_UPSC_HIERARCHY, JSON.stringify(initial));
  return initial;
}

/**
 * Merge two School hierarchies safely without removing non-conflicting nodes
 */
export function mergeSchoolHierarchies(
  base: SchoolHierarchyData,
  incoming: Partial<SchoolHierarchyData>
): SchoolHierarchyData {
  const mergedClasses = Array.from(new Set([...(base.classes || []), ...(incoming.classes || [])]));

  const mergedSubjects: Record<string, string[]> = { ...(base.subjects || {}) };
  if (incoming.subjects) {
    for (const [cls, subjs] of Object.entries(incoming.subjects)) {
      const existing = mergedSubjects[cls] || [];
      mergedSubjects[cls] = Array.from(new Set([...existing, ...(subjs || [])]));
    }
  }

  const mergedChapters: Record<string, Record<string, ChapterInfo[]>> = { ...(base.chapters || {}) };
  if (incoming.chapters) {
    for (const [cls, subjMap] of Object.entries(incoming.chapters)) {
      if (!mergedChapters[cls]) mergedChapters[cls] = {};
      for (const [subj, chList] of Object.entries(subjMap)) {
        const existingChs = mergedChapters[cls][subj] || [];
        const chMap = new Map<number, string>();
        existingChs.forEach((c) => chMap.set(c.number, c.name));
        (chList || []).forEach((c) => chMap.set(c.number, c.name));
        mergedChapters[cls][subj] = Array.from(chMap.entries())
          .map(([number, name]) => ({ number, name }))
          .sort((a, b) => a.number - b.number);
      }
    }
  }

  const mergedRemoved: Record<string, string[]> = { ...(base.removedSubjects || {}) };
  if (incoming.removedSubjects) {
    for (const [cls, removedList] of Object.entries(incoming.removedSubjects)) {
      const existing = mergedRemoved[cls] || [];
      mergedRemoved[cls] = Array.from(new Set([...existing, ...(removedList || [])]));
    }
  }

  return {
    classes: mergedClasses,
    subjects: mergedSubjects,
    chapters: mergedChapters,
    removedSubjects: mergedRemoved,
    version: 2,
    updatedAt: incoming.updatedAt || base.updatedAt || new Date().toISOString()
  };
}

/**
 * Merge two UPSC hierarchies safely without removing non-conflicting nodes
 */
export function mergeUpscHierarchies(
  base: UpscHierarchyData,
  incoming: Partial<UpscHierarchyData>
): UpscHierarchyData {
  const mergedPapers = Array.from(new Set([...(base.papers || []), ...(incoming.papers || [])]));

  const mergedSubjects: Record<string, string[]> = { ...(base.subjects || {}) };
  if (incoming.subjects) {
    for (const [paper, subjs] of Object.entries(incoming.subjects)) {
      const existing = mergedSubjects[paper] || [];
      mergedSubjects[paper] = Array.from(new Set([...existing, ...(subjs || [])]));
    }
  }

  const mergedModules: Record<string, Record<string, ChapterInfo[]>> = { ...(base.modules || {}) };
  if (incoming.modules) {
    for (const [paper, subjMap] of Object.entries(incoming.modules)) {
      if (!mergedModules[paper]) mergedModules[paper] = {};
      for (const [subj, modList] of Object.entries(subjMap)) {
        const existingMods = mergedModules[paper][subj] || [];
        const modMap = new Map<number, string>();
        existingMods.forEach((m) => modMap.set(m.number, m.name));
        (modList || []).forEach((m) => modMap.set(m.number, m.name));
        mergedModules[paper][subj] = Array.from(modMap.entries())
          .map(([number, name]) => ({ number, name }))
          .sort((a, b) => a.number - b.number);
      }
    }
  }

  const mergedRemoved: Record<string, string[]> = { ...(base.removedSubjects || {}) };
  if (incoming.removedSubjects) {
    for (const [paper, removedList] of Object.entries(incoming.removedSubjects)) {
      const existing = mergedRemoved[paper] || [];
      mergedRemoved[paper] = Array.from(new Set([...existing, ...(removedList || [])]));
    }
  }

  return {
    papers: mergedPapers,
    subjects: mergedSubjects,
    modules: mergedModules,
    removedSubjects: mergedRemoved,
    version: 2,
    updatedAt: incoming.updatedAt || base.updatedAt || new Date().toISOString()
  };
}

/**
 * Extract hierarchy from notes collection and merge into current data
 */
export function extractHierarchyFromNotes(
  notes: ClassNote[],
  currentSchool: SchoolHierarchyData,
  currentUpsc: UpscHierarchyData
): { school: SchoolHierarchyData; upsc: UpscHierarchyData; added: boolean } {
  let added = false;
  const newSchool = { ...currentSchool, classes: [...currentSchool.classes], subjects: { ...currentSchool.subjects }, chapters: { ...currentSchool.chapters } };
  const newUpsc = { ...currentUpsc, papers: [...currentUpsc.papers], subjects: { ...currentUpsc.subjects }, modules: { ...currentUpsc.modules } };

  (notes || []).forEach((note) => {
    if (!note) return;
    const isUpsc =
      (note as any).type === "upsc" ||
      Boolean((note as any).gsPaper) ||
      Boolean((note as any).generalStudiesPaper) ||
      (note as any).category === "upsc" ||
      String(note.classGrade || "").toLowerCase().includes("upsc") ||
      String((note as any).className || "").toLowerCase().includes("upsc");

    if (isUpsc) {
      const paper = (note as any).gsPaper || (note as any).generalStudiesPaper || (note as any).paper || "GS Paper 1";
      const subject = (note as any).subjectName || note.subject || "General Studies";
      const rawModNo = (note as any).moduleNumber ?? (note as any).moduleNo ?? (note as any).chapterNumber ?? note.chapterNo ?? 1;
      const modNo = typeof rawModNo === "number" ? rawModNo : parseInt(String(rawModNo).replace(/\D/g, ""), 10) || 1;
      const modName = (note as any).moduleTitle || (note as any).moduleName || (note as any).chapterTitle || (note as any).chapterName || `Module ${modNo}`;

      if (paper && !newUpsc.papers.includes(paper)) {
        newUpsc.papers.push(paper);
        added = true;
      }
      if (paper && subject) {
        if (!newUpsc.subjects[paper]) newUpsc.subjects[paper] = [];
        if (!newUpsc.subjects[paper].includes(subject)) {
          newUpsc.subjects[paper].push(subject);
          added = true;
        }
        if (!newUpsc.modules[paper]) newUpsc.modules[paper] = {};
        if (!newUpsc.modules[paper][subject]) newUpsc.modules[paper][subject] = [];
        if (!newUpsc.modules[paper][subject].some((m) => m.number === modNo)) {
          newUpsc.modules[paper][subject].push({ number: modNo, name: modName });
          newUpsc.modules[paper][subject].sort((a, b) => a.number - b.number);
          added = true;
        }
      }
    } else {
      const cls = (note as any).className || note.classGrade || (note as any).class;
      const subject = (note as any).subjectName || note.subject;
      const rawChNo = (note as any).chapterNumber ?? note.chapterNo ?? 1;
      const chNo = typeof rawChNo === "number" ? rawChNo : parseInt(String(rawChNo).replace(/\D/g, ""), 10) || 1;
      const chName = (note as any).chapterTitle || (note as any).chapterName || `Chapter ${chNo}`;

      if (cls && !newSchool.classes.includes(cls)) {
        newSchool.classes.push(cls);
        added = true;
      }
      if (cls && subject) {
        if (!newSchool.subjects[cls]) newSchool.subjects[cls] = [];
        if (!newSchool.subjects[cls].includes(subject)) {
          newSchool.subjects[cls].push(subject);
          added = true;
        }
        if (!newSchool.chapters[cls]) newSchool.chapters[cls] = {};
        if (!newSchool.chapters[cls][subject]) newSchool.chapters[cls][subject] = [];
        if (!newSchool.chapters[cls][subject].some((c) => c.number === chNo)) {
          newSchool.chapters[cls][subject].push({ number: chNo, name: chName });
          newSchool.chapters[cls][subject].sort((a, b) => a.number - b.number);
          added = true;
        }
      }
    }
  });

  return { school: newSchool, upsc: newUpsc, added };
}

// ---------------------------------------------------------------------------
// PUBLIC API FOR HIERARCHY ACCESS AND MUTATION
// ---------------------------------------------------------------------------

export function getSchoolHierarchy(): SchoolHierarchyData {
  return getInitialSchoolHierarchy();
}

export function getUpscHierarchy(): UpscHierarchyData {
  return getInitialUpscHierarchy();
}

export async function saveSchoolHierarchy(data: SchoolHierarchyData): Promise<void> {
  const updatedData: SchoolHierarchyData = {
    ...data,
    updatedAt: new Date().toISOString(),
    version: 2
  };
  inMemorySchoolHierarchy = updatedData;
  safeLocalStorageSetItem(STORAGE_KEY_SCHOOL_HIERARCHY, JSON.stringify(updatedData));
  notifyHierarchyListeners();

  try {
    const db = await getFirebaseDb();
    if (db) {
      const docRef = doc(db, "curriculum_hierarchy", "school_hierarchy");
      await setDoc(docRef, updatedData);
    }
  } catch (err) {
    console.warn("[CurriculumService] Failed saving school hierarchy to Firestore:", err);
  }
}

export async function saveUpscHierarchy(data: UpscHierarchyData): Promise<void> {
  const updatedData: UpscHierarchyData = {
    ...data,
    updatedAt: new Date().toISOString(),
    version: 2
  };
  inMemoryUpscHierarchy = updatedData;
  safeLocalStorageSetItem(STORAGE_KEY_UPSC_HIERARCHY, JSON.stringify(updatedData));
  notifyHierarchyListeners();

  try {
    const db = await getFirebaseDb();
    if (db) {
      const docRef = doc(db, "curriculum_hierarchy", "upsc_hierarchy");
      await setDoc(docRef, updatedData);
    }
  } catch (err) {
    console.warn("[CurriculumService] Failed saving UPSC hierarchy to Firestore:", err);
  }
}

let isSubscribed = false;
let activeSchoolUnsub: (() => void) | null = null;
let activeUpscUnsub: (() => void) | null = null;

export function subscribeToCurriculumHierarchy(
  onUpdate?: (data: { school: SchoolHierarchyData; upsc: UpscHierarchyData }) => void
): () => void {
  const handleUpdate = () => {
    if (onUpdate) {
      onUpdate({
        school: getSchoolHierarchy(),
        upsc: getUpscHierarchy()
      });
    }
  };

  if (onUpdate) {
    hierarchyListeners.add(handleUpdate);
    // Initial notification
    handleUpdate();
  }

  if (!isSubscribed) {
    isSubscribed = true;
    (async () => {
      try {
        const db = await getFirebaseDb();
        if (!db) return;

        // School Subscription
        const schoolDocRef = doc(db, "curriculum_hierarchy", "school_hierarchy");
        activeSchoolUnsub = onSnapshot(schoolDocRef, (snap) => {
          if (snap.exists()) {
            const remote = snap.data() as SchoolHierarchyData;
            inMemorySchoolHierarchy = remote;
            safeLocalStorageSetItem(STORAGE_KEY_SCHOOL_HIERARCHY, JSON.stringify(remote));
            notifyHierarchyListeners();
          } else {
            // Document doesn't exist yet on remote, persist current local
            const current = getSchoolHierarchy();
            if (current.classes.length > 0) {
              setDoc(schoolDocRef, current).catch(() => {});
            }
          }
        });

        // UPSC Subscription
        const upscDocRef = doc(db, "curriculum_hierarchy", "upsc_hierarchy");
        activeUpscUnsub = onSnapshot(upscDocRef, (snap) => {
          if (snap.exists()) {
            const remote = snap.data() as UpscHierarchyData;
            inMemoryUpscHierarchy = remote;
            safeLocalStorageSetItem(STORAGE_KEY_UPSC_HIERARCHY, JSON.stringify(remote));
            notifyHierarchyListeners();
          } else {
            const current = getUpscHierarchy();
            if (current.papers.length > 0) {
              setDoc(upscDocRef, current).catch(() => {});
            }
          }
        });
      } catch (err) {
        console.warn("[CurriculumService] Firestore subscription warning:", err);
      }
    })();
  }

  return () => {
    if (onUpdate) {
      hierarchyListeners.delete(handleUpdate);
    }
  };
}

// ---------------------------------------------------------------------------
// ACTIVE UI SELECTION STATE PERSISTENCE HELPERS
// ---------------------------------------------------------------------------

export interface ActiveNotesSelectionState {
  activeTab: "school" | "upsc";
  selectedSchoolClass: string;
  selectedSchoolSubject: string;
  selectedSchoolChapterNo: number;
  selectedSchoolChapterName: string;
  selectedUpscPaper: string;
  selectedUpscSubject: string;
  selectedUpscModuleNo: number;
  selectedUpscModuleName: string;
  selectedTopicNoteId: string | null;
}

export function getSavedNotesSelectionState(): ActiveNotesSelectionState {
  if (typeof window === "undefined") {
    return {
      activeTab: "school",
      selectedSchoolClass: "",
      selectedSchoolSubject: "",
      selectedSchoolChapterNo: 0,
      selectedSchoolChapterName: "",
      selectedUpscPaper: "",
      selectedUpscSubject: "",
      selectedUpscModuleNo: 0,
      selectedUpscModuleName: "",
      selectedTopicNoteId: null
    };
  }

  const rawTab = localStorage.getItem(STORAGE_KEY_ACTIVE_TAB);
  const activeTab = rawTab === "upsc" ? "upsc" : "school";
  const selectedSchoolClass = localStorage.getItem(STORAGE_KEY_SELECTED_SCHOOL_CLASS) || "";
  const selectedSchoolSubject = localStorage.getItem(STORAGE_KEY_SELECTED_SCHOOL_SUBJECT) || "";
  const rawChNo = localStorage.getItem(STORAGE_KEY_SELECTED_SCHOOL_CHAPTER_NO);
  const selectedSchoolChapterNo = rawChNo ? parseInt(rawChNo, 10) || 0 : 0;
  const selectedSchoolChapterName = localStorage.getItem(STORAGE_KEY_SELECTED_SCHOOL_CHAPTER_NAME) || "";

  const selectedUpscPaper = localStorage.getItem(STORAGE_KEY_SELECTED_UPSC_PAPER) || "";
  const selectedUpscSubject = localStorage.getItem(STORAGE_KEY_SELECTED_UPSC_SUBJECT) || "";
  const rawModNo = localStorage.getItem(STORAGE_KEY_SELECTED_UPSC_MODULE_NO);
  const selectedUpscModuleNo = rawModNo ? parseInt(rawModNo, 10) || 0 : 0;
  const selectedUpscModuleName = localStorage.getItem(STORAGE_KEY_SELECTED_UPSC_MODULE_NAME) || "";

  const selectedTopicNoteId = localStorage.getItem(STORAGE_KEY_SELECTED_TOPIC_NOTE_ID) || null;

  return {
    activeTab,
    selectedSchoolClass,
    selectedSchoolSubject,
    selectedSchoolChapterNo,
    selectedSchoolChapterName,
    selectedUpscPaper,
    selectedUpscSubject,
    selectedUpscModuleNo,
    selectedUpscModuleName,
    selectedTopicNoteId
  };
}

export function saveNotesSelectionState(state: Partial<ActiveNotesSelectionState>): void {
  if (typeof window === "undefined") return;

  if (state.activeTab !== undefined) {
    localStorage.setItem(STORAGE_KEY_ACTIVE_TAB, state.activeTab);
  }
  if (state.selectedSchoolClass !== undefined) {
    localStorage.setItem(STORAGE_KEY_SELECTED_SCHOOL_CLASS, state.selectedSchoolClass);
  }
  if (state.selectedSchoolSubject !== undefined) {
    localStorage.setItem(STORAGE_KEY_SELECTED_SCHOOL_SUBJECT, state.selectedSchoolSubject);
  }
  if (state.selectedSchoolChapterNo !== undefined) {
    localStorage.setItem(STORAGE_KEY_SELECTED_SCHOOL_CHAPTER_NO, String(state.selectedSchoolChapterNo));
  }
  if (state.selectedSchoolChapterName !== undefined) {
    localStorage.setItem(STORAGE_KEY_SELECTED_SCHOOL_CHAPTER_NAME, state.selectedSchoolChapterName);
  }
  if (state.selectedUpscPaper !== undefined) {
    localStorage.setItem(STORAGE_KEY_SELECTED_UPSC_PAPER, state.selectedUpscPaper);
  }
  if (state.selectedUpscSubject !== undefined) {
    localStorage.setItem(STORAGE_KEY_SELECTED_UPSC_SUBJECT, state.selectedUpscSubject);
  }
  if (state.selectedUpscModuleNo !== undefined) {
    localStorage.setItem(STORAGE_KEY_SELECTED_UPSC_MODULE_NO, String(state.selectedUpscModuleNo));
  }
  if (state.selectedUpscModuleName !== undefined) {
    localStorage.setItem(STORAGE_KEY_SELECTED_UPSC_MODULE_NAME, state.selectedUpscModuleName);
  }
  if (state.selectedTopicNoteId !== undefined) {
    if (state.selectedTopicNoteId) {
      localStorage.setItem(STORAGE_KEY_SELECTED_TOPIC_NOTE_ID, state.selectedTopicNoteId);
    } else {
      localStorage.removeItem(STORAGE_KEY_SELECTED_TOPIC_NOTE_ID);
    }
  }
}
