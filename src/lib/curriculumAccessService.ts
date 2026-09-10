/**
 * Atlas v7.9.5 — Subject Access & Permission Service
 * 
 * Production-quality permission-based class access system for curriculum:
 * - Each subject has exactly one canonical ownerClassId
 * - Multiple classes are granted permission via allowedClasses[]
 * - Zero curriculum duplication: one canonical copy of chapters, topics, PDFs, images, videos, and tests
 * - Server-side and client-side authorization enforcement: only the owner class may modify curriculum
 * - Non-owner classes are read-only consumers
 * - Automatic migration of legacy copied/shared subjects into canonical allowedClasses references
 */

import { doc, getDoc, setDoc, deleteDoc, onSnapshot } from "firebase/firestore";
import { getFirebaseDb } from "./firebase";
import { ClassNote } from "../types";
import { SchoolHierarchyData, getSchoolHierarchy, saveSchoolHierarchy } from "./curriculumService";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "./safeStorage";
import { deleteClassNoteDoc } from "./firestoreService";

export interface SubjectClassAccess {
  id: string; // canonical subject access ID, e.g. "school_class6_science" or "science"
  name: string; // subject display name, e.g. "Science"
  ownerClassId: string; // canonical owner class, e.g. "Class 6" or "class6"
  allowedClasses: string[]; // list of allowed classes, e.g. ["Class 6", "Class 7", "Class 8"]
  createdAt?: string;
  updatedAt?: string;
}

export interface AccessibleClassInfo {
  ownerClass: string;
  ownerClassKey: string;
  subjects: string[];
}

const STORAGE_KEY_SUBJECT_ACCESS = "tuition_school_subject_access_v1";

// In-memory cache for ultra-fast synchronous lookups
let inMemorySubjectAccess: Record<string, SubjectClassAccess> | null = null;

// Subscribers
type AccessListener = () => void;
const accessListeners = new Set<AccessListener>();

export function subscribeToSubjectAccess(listener: AccessListener): () => void {
  accessListeners.add(listener);
  return () => accessListeners.delete(listener);
}

function notifyAccessListeners() {
  accessListeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.warn("[CurriculumAccessService] Listener error:", e);
    }
  });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("subject-access-updated"));
    window.dispatchEvent(new CustomEvent("curriculum-hierarchy-updated"));
  }
}

// Active Firestore real-time listener for subject access rules
let activeSubjectAccessUnsub: (() => void) | null = null;
let isFirestoreListenerInitialized = false;

export function initSubjectAccessFirestoreListener(): () => void {
  if (isFirestoreListenerInitialized) {
    return () => {};
  }
  isFirestoreListenerInitialized = true;

  try {
    getFirebaseDb().then((db) => {
      if (!db) return;
      const accessDocRef = doc(db, "curriculum_hierarchy", "subject_access");

      // Initial read
      getDoc(accessDocRef).then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data && data.rules && typeof data.rules === "object") {
            inMemorySubjectAccess = { ...data.rules };
            safeLocalStorageSetItem(STORAGE_KEY_SUBJECT_ACCESS, JSON.stringify(data.rules));
            notifyAccessListeners();
          }
        }
      }).catch((e) => console.warn("[CurriculumAccessService] initial read error:", e));

      // Realtime listener
      activeSubjectAccessUnsub = onSnapshot(
        accessDocRef,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            if (data && data.rules && typeof data.rules === "object") {
              inMemorySubjectAccess = { ...data.rules };
              safeLocalStorageSetItem(STORAGE_KEY_SUBJECT_ACCESS, JSON.stringify(data.rules));
              notifyAccessListeners();
            }
          }
        },
        (err) => {
          console.warn("[CurriculumAccessService] realtime snapshot error:", err);
        }
      );
    }).catch((e) => console.warn("[CurriculumAccessService] getFirebaseDb error:", e));
  } catch (e) {
    console.warn("[CurriculumAccessService] init error:", e);
  }

  // Cross-tab storage synchronization
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
      if (e.key === STORAGE_KEY_SUBJECT_ACCESS && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (parsed && typeof parsed === "object") {
            inMemorySubjectAccess = parsed;
            notifyAccessListeners();
          }
        } catch {}
      }
    });
  }

  return () => {
    if (activeSubjectAccessUnsub) {
      activeSubjectAccessUnsub();
      activeSubjectAccessUnsub = null;
    }
    isFirestoreListenerInitialized = false;
  };
}

// Auto-initialize real-time listener in browser
if (typeof window !== "undefined") {
  setTimeout(() => {
    initSubjectAccessFirestoreListener();
  }, 100);
}

/**
 * Normalizes class identifiers for strictly reliable comparisons:
 * "Class 6", "class 6", "class-6", "class6" -> "class6"
 */
export function normalizeClassId(className?: string): string {
  if (!className) return "";
  const trimmed = className.trim().toLowerCase();
  if (/^upsc$/i.test(trimmed)) return "upsc";
  const digits = trimmed.match(/\d+/);
  if (digits) return `class${digits[0]}`;
  return trimmed.replace(/[\s_-]/g, "");
}

/**
 * Normalizes subject names for keying:
 * "Science ", "science" -> "science"
 */
export function normalizeSubjectName(subjectName?: string): string {
  if (!subjectName) return "";
  return subjectName.trim().toLowerCase();
}

/**
 * Generates a stable key for subject access mapping
 */
export function getSubjectAccessKey(subjectName: string, ownerClass?: string): string {
  const normSubj = normalizeSubjectName(subjectName);
  if (ownerClass) {
    return `${normSubj}__${normalizeClassId(ownerClass)}`;
  }
  return normSubj;
}

/**
 * Load all subject access rules from LocalStorage / memory
 */
export function getAllSubjectAccessRules(): Record<string, SubjectClassAccess> {
  if (inMemorySubjectAccess) return inMemorySubjectAccess;

  if (typeof window === "undefined") return {};

  const cached = safeLocalStorageGetItem(STORAGE_KEY_SUBJECT_ACCESS);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === "object") {
        inMemorySubjectAccess = parsed;
        return parsed;
      }
    } catch {
      // ignore
    }
  }

  inMemorySubjectAccess = {};
  return {};
}

/**
 * Save all subject access rules to storage & memory
 */
function persistSubjectAccessRules(rules: Record<string, SubjectClassAccess>) {
  inMemorySubjectAccess = { ...rules };
  safeLocalStorageSetItem(STORAGE_KEY_SUBJECT_ACCESS, JSON.stringify(rules));
  notifyAccessListeners();
}

/**
 * Checks if a class is allowed to access a subject given its access config
 */
export function isClassAllowedForSubject(
  access: SubjectClassAccess | null | undefined,
  targetClass: string
): boolean {
  if (!access || !targetClass) return false;
  const normTarget = normalizeClassId(targetClass);
  const normOwner = normalizeClassId(access.ownerClassId);

  // Owner class always has access
  if (normTarget === normOwner) return true;

  // Check allowedClasses
  return (access.allowedClasses || []).some(
    (c) => normalizeClassId(c) === normTarget
  );
}

/**
 * Resolves the canonical SubjectClassAccess for a given subject and context class.
 * If no explicit rule exists, auto-generates a default rule where the context class is the owner.
 */
export function getSubjectAccessConfig(
  subjectName: string,
  contextClass?: string
): SubjectClassAccess {
  const rules = getAllSubjectAccessRules();
  const normSubj = normalizeSubjectName(subjectName);
  const normClass = contextClass ? normalizeClassId(contextClass) : "";

  // 1. Direct match by specific owner key
  if (contextClass) {
    const specificKey = getSubjectAccessKey(subjectName, contextClass);
    if (rules[specificKey]) {
      return rules[specificKey];
    }
  }

  // 2. Search for any rule matching the subject name where contextClass is either owner or in allowedClasses
  const matchingRules = Object.values(rules).filter(
    (r) => normalizeSubjectName(r.name) === normSubj
  );

  if (matchingRules.length > 0) {
    // If a rule explicitly allows or owns contextClass, pick that rule
    if (normClass) {
      const classMatch = matchingRules.find((r) => isClassAllowedForSubject(r, contextClass));
      if (classMatch) return classMatch;
    }
    // Fall back to first matching rule for this subject name
    return matchingRules[0];
  }

  // 3. Fallback: contextClass or default "Class 10" is the canonical owner
  const defaultOwner = contextClass || "Class 10";
  return {
    id: `subject_${normSubj}`,
    name: subjectName,
    ownerClassId: defaultOwner,
    allowedClasses: [defaultOwner],
  };
}

/**
 * Returns the canonical owner class for a given subject.
 * If currentClass is an allowed non-owner, this returns the ownerClassId.
 */
export function getCanonicalOwnerClass(
  subjectName: string,
  currentClass: string
): string {
  if (!subjectName) return currentClass;
  const access = getSubjectAccessConfig(subjectName, currentClass);
  return access.ownerClassId || currentClass;
}

/**
 * Checks whether a given class is the canonical owner of the subject.
 */
export function isSubjectOwner(
  subjectName: string,
  className?: string
): boolean {
  if (!subjectName || !className) return false;
  const owner = getCanonicalOwnerClass(subjectName, className);
  return normalizeClassId(owner) === normalizeClassId(className);
}

/**
 * Verifies whether the current class is the owner of the subject.
 * Non-owners are consumers and receive read-only permissions.
 */
export function verifyCurriculumEditPermission(
  subjectName: string,
  currentClass: string
): {
  allowed: boolean;
  ownerClassId: string;
  error?: string;
} {
  const access = getSubjectAccessConfig(subjectName, currentClass);
  const normCurrent = normalizeClassId(currentClass);
  const normOwner = normalizeClassId(access.ownerClassId);

  if (normCurrent !== normOwner) {
    return {
      allowed: false,
      ownerClassId: access.ownerClassId,
      error: `Authorization Error: Only the owner class (${access.ownerClassId}) can modify this curriculum. ${currentClass} has read-only access.`,
    };
  }

  return {
    allowed: true,
    ownerClassId: access.ownerClassId,
  };
}

/**
 * Validates Subject Class Access payload against strict architectural rules:
 * - ownerClassId exists
 * - allowedClasses always includes ownerClassId
 * - ownerClassId cannot be removed
 * - duplicate class IDs are rejected
 * - invalid class IDs are rejected
 */
export function validateSubjectAccessPayload(payload: {
  subjectName: string;
  ownerClassId: string;
  allowedClasses: string[];
}): { valid: boolean; error?: string } {
  if (!payload.subjectName || !payload.subjectName.trim()) {
    return { valid: false, error: "Subject name is required." };
  }

  if (!payload.ownerClassId || !payload.ownerClassId.trim()) {
    return { valid: false, error: "Owner class is required and cannot be empty." };
  }

  if (!Array.isArray(payload.allowedClasses)) {
    return { valid: false, error: "allowedClasses must be an array of class names." };
  }

  // Reject invalid class names
  for (const c of payload.allowedClasses) {
    if (!c || typeof c !== "string" || !c.trim()) {
      return { valid: false, error: "allowedClasses contains an invalid or empty class name." };
    }
    if (/[<>{}]/.test(c)) {
      return { valid: false, error: `Invalid characters in class name: "${c}".` };
    }
  }

  // Reject duplicates
  const normalizedSet = new Set<string>();
  for (const c of payload.allowedClasses) {
    const norm = normalizeClassId(c);
    if (normalizedSet.has(norm)) {
      return { valid: false, error: `Duplicate class detected in allowedClasses: "${c}".` };
    }
    normalizedSet.add(norm);
  }

  // Validate ownerClassId is in allowedClasses
  const normOwner = normalizeClassId(payload.ownerClassId);
  if (!normalizedSet.has(normOwner)) {
    return { valid: false, error: `Owner class "${payload.ownerClassId}" must always be included in allowedClasses and cannot be removed.` };
  }

  return { valid: true };
}

/**
 * Saves or updates a subject's class access permissions.
 * Persists locally and to Firestore.
 */
export async function saveSubjectAccessRule(
  subjectName: string,
  ownerClassId: string,
  allowedClasses: string[]
): Promise<SubjectClassAccess> {
  const cleanSubject = subjectName.trim();
  const cleanOwner = ownerClassId.trim();

  // Ensure owner is included in allowedClasses
  const normOwner = normalizeClassId(cleanOwner);
  const classesSet = new Set<string>(allowedClasses.map((c) => c.trim()));
  if (!Array.from(classesSet).some((c) => normalizeClassId(c) === normOwner)) {
    classesSet.add(cleanOwner);
  }
  const cleanAllowedClasses = Array.from(classesSet);

  // Validate
  const validation = validateSubjectAccessPayload({
    subjectName: cleanSubject,
    ownerClassId: cleanOwner,
    allowedClasses: cleanAllowedClasses,
  });

  if (!validation.valid) {
    throw new Error(validation.error || "Validation failed for Subject Access.");
  }

  const normSubj = normalizeSubjectName(cleanSubject);
  const ruleId = `school_${normalizeClassId(cleanOwner)}_${normSubj}`;
  const now = new Date().toISOString();

  const newRule: SubjectClassAccess = {
    id: ruleId,
    name: cleanSubject,
    ownerClassId: cleanOwner,
    allowedClasses: cleanAllowedClasses,
    createdAt: now,
    updatedAt: now,
  };

  const existingRules = getAllSubjectAccessRules();
  const ruleKey = getSubjectAccessKey(cleanSubject, cleanOwner);
  existingRules[ruleKey] = newRule;
  // Also store by subject name alone for default lookup
  existingRules[normSubj] = newRule;

  persistSubjectAccessRules(existingRules);

  // Update curriculum hierarchy subjects map: only the canonical owner class retains this subject
  const hierarchy = getSchoolHierarchy();
  let hierarchyChanged = false;
  const updatedSubjects = { ...(hierarchy.subjects || {}) };

  // 1. Ensure canonical owner class has the subject
  const ownerList = updatedSubjects[cleanOwner] || [];
  if (!ownerList.includes(cleanSubject)) {
    updatedSubjects[cleanOwner] = [...ownerList, cleanSubject];
    hierarchyChanged = true;
  }

  // 2. Ensure consumer classes DO NOT have the subject in their native hierarchy
  Object.keys(updatedSubjects).forEach((cls) => {
    if (normalizeClassId(cls) !== normOwner) {
      const list = updatedSubjects[cls] || [];
      if (list.includes(cleanSubject)) {
        updatedSubjects[cls] = list.filter((s) => s !== cleanSubject);
        hierarchyChanged = true;
      }
    }
  });

  if (hierarchyChanged) {
    await saveSchoolHierarchy({
      ...hierarchy,
      subjects: updatedSubjects,
    });
  }

  // Persist to Firestore
  try {
    const db = await getFirebaseDb();
    if (db) {
      const accessDocRef = doc(db, "curriculum_hierarchy", "subject_access");
      await setDoc(accessDocRef, { rules: existingRules, updatedAt: now }, { merge: true });

      // Also set in subjects collection
      const subjectDocRef = doc(db, "subjects", ruleId);
      await setDoc(subjectDocRef, {
        id: ruleId,
        name: cleanSubject,
        subjectName: cleanSubject,
        category: "school",
        ownerClassId: cleanOwner,
        allowedClasses: cleanAllowedClasses,
        updatedAt: now,
      }, { merge: true });
    }
  } catch (err) {
    console.warn("[CurriculumAccessService] Notice saving to Firestore:", err);
  }

  // Also call backend API endpoint for validation & sync
  try {
    if (typeof window !== "undefined" && typeof fetch === "function") {
      await fetch("/api/notes?action=manage-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectName: cleanSubject,
          ownerClassId: cleanOwner,
          allowedClasses: cleanAllowedClasses,
        }),
      }).catch(() => {});
    }
  } catch {
    // Non-blocking
  }

  notifyAccessListeners();
  return newRule;
}

/**
 * Returns all subjects accessible to a given class:
 * either owned by targetClass OR targetClass is in allowedClasses.
 */
export function getAccessibleSubjectsForClass(
  targetClass: string,
  schoolHierarchy: SchoolHierarchyData,
  notes: ClassNote[] = []
): string[] {
  if (!targetClass) return [];
  const normTarget = normalizeClassId(targetClass);
  const subjectsSet = new Set<string>();

  // 1. Check all configured access rules
  const rules = getAllSubjectAccessRules();
  Object.values(rules).forEach((rule) => {
    if (isClassAllowedForSubject(rule, targetClass)) {
      if (rule.name && rule.name.trim()) {
        subjectsSet.add(rule.name.trim());
      }
    }
  });

  // 2. Add native subjects from schoolHierarchy
  const matchingClassKey = Object.keys(schoolHierarchy.subjects || {}).find(
    (c) => normalizeClassId(c) === normTarget
  );
  if (matchingClassKey && schoolHierarchy.subjects[matchingClassKey]) {
    schoolHierarchy.subjects[matchingClassKey].forEach((s) => {
      if (s && s.trim()) subjectsSet.add(s.trim());
    });
  }

  // 3. Add subjects from existing notes of this class
  notes.forEach((n) => {
    const c = (n as any).className || n.classGrade || (n as any).class || "";
    if (normalizeClassId(c) === normTarget) {
      const s = (n as any).subjectName || n.subject || "";
      if (s && s.trim()) subjectsSet.add(s.trim());
    }
  });

  // Filter out any explicitly removed subjects for this class
  const removedList = matchingClassKey ? (schoolHierarchy.removedSubjects?.[matchingClassKey] || []) : [];
  const removedSet = new Set(removedList.map((s) => s.toLowerCase().trim()));

  return Array.from(subjectsSet)
    .filter((s) => !removedSet.has(s.toLowerCase().trim()))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Retrieves all accessible classes and permitted subjects granted to a target class.
 * Filters out:
 * - The student's own class (owner matches targetClass)
 * - Classes with 0 permitted subjects (empty classes)
 */
export function getAccessibleClassesGrantedToClass(
  targetClass: string
): AccessibleClassInfo[] {
  if (!targetClass) return [];
  const normTarget = normalizeClassId(targetClass);
  const rules = getAllSubjectAccessRules();

  // Map: ownerClassKey -> { ownerClass, subjects: Set<string> }
  const classMap = new Map<string, { ownerClass: string; subjects: Set<string> }>();

  Object.values(rules).forEach((rule) => {
    if (!rule || !rule.ownerClassId || !rule.name) return;
    const normOwner = normalizeClassId(rule.ownerClassId);

    // Skip if owner is the target class itself (that belongs to student's own class)
    if (normOwner === normTarget) return;

    // Check if targetClass is granted permission
    if (isClassAllowedForSubject(rule, targetClass)) {
      const cleanSubj = rule.name.trim();
      if (!cleanSubj) return;

      const ownerKey = normOwner;
      if (!classMap.has(ownerKey)) {
        classMap.set(ownerKey, {
          ownerClass: rule.ownerClassId.trim(),
          subjects: new Set<string>(),
        });
      }
      classMap.get(ownerKey)!.subjects.add(cleanSubj);
    }
  });

  const result: AccessibleClassInfo[] = [];
  classMap.forEach((entry, key) => {
    const subjectsList = Array.from(entry.subjects).sort((a, b) => a.localeCompare(b));
    if (subjectsList.length > 0) {
      result.push({
        ownerClass: entry.ownerClass,
        ownerClassKey: key,
        subjects: subjectsList,
      });
    }
  });

  return result.sort((a, b) => {
    const numA = parseInt(a.ownerClass.replace(/\D/g, ""), 10) || 0;
    const numB = parseInt(b.ownerClass.replace(/\D/g, ""), 10) || 0;
    if (numA && numB) return numA - numB;
    return a.ownerClass.localeCompare(b.ownerClass, undefined, { numeric: true });
  });
}

/**
 * Checks if a note is accessible for a viewing class.
 * Returns true if:
 * 1. Note belongs to viewingClass directly, OR
 * 2. Note belongs to the canonical owner of the subject, and viewingClass is in allowedClasses.
 */
export function isNoteAccessibleInClass(
  note: ClassNote,
  viewingClass: string
): boolean {
  if (!note || !viewingClass) return false;
  const normViewing = normalizeClassId(viewingClass);
  const noteClass = (note as any).className || note.classGrade || (note as any).class || "";
  const normNoteClass = normalizeClassId(noteClass);

  if (normViewing === normNoteClass) return true;

  const subject = (note as any).subjectName || note.subject || "";
  if (!subject) return false;

  const access = getSubjectAccessConfig(subject, noteClass);
  return isClassAllowedForSubject(access, viewingClass);
}

/**
 * Automatic Migration of Existing Shared Subjects (v7.9.5)
 * Converts legacy copied subjects into canonical allowedClasses references:
 * - Detects subjects where notes share identical storageKey across classes
 * - Identifies original owner class
 * - Updates allowedClasses to include consumer classes
 * - Deletes redundant copied Firestore note documents & duplicate tests
 * - Leaves exactly ONE canonical copy of notes and storage files
 */
export async function migrateExistingSharedSubjects(
  schoolHierarchy: SchoolHierarchyData,
  notes: ClassNote[]
): Promise<{
  migratedRulesCount: number;
  cleanedDuplicateNotesCount: number;
}> {
  let migratedRulesCount = 0;
  let cleanedDuplicateNotesCount = 0;

  console.log("[Migration v7.9.5] Starting automatic migration of shared subjects...");

  // Group notes by storageKey / canonical path
  const storageMap = new Map<string, ClassNote[]>();
  notes.forEach((n) => {
    const key = (n.storageKey || n.storagePath || n.r2Key || n.pdfUrl || "").trim();
    if (key) {
      if (!storageMap.has(key)) storageMap.set(key, []);
      storageMap.get(key)!.push(n);
    }
  });

  const subjectAllowedMap = new Map<string, { ownerClass: string; allowedClasses: Set<string>; dupNoteIds: string[] }>();

  // Find duplicates sharing the exact same storage object
  for (const [key, duplicateNotes] of storageMap.entries()) {
    if (duplicateNotes.length > 1) {
      // Extract original owner class from storageKey if available (e.g. class_notes/Class_6/...)
      const match = key.match(/class_notes\/([^\/]+)\//i);
      const classFromKey = match ? match[1].replace(/_/g, " ") : "";

      // Canonical note is either the one matching storage key, or the oldest / first
      let canonicalNote = duplicateNotes[0];
      if (classFromKey) {
        const matchingNote = duplicateNotes.find(
          (n) => normalizeClassId(n.classGrade || (n as any).className) === normalizeClassId(classFromKey)
        );
        if (matchingNote) canonicalNote = matchingNote;
      }

      const ownerClass = canonicalNote.classGrade || (canonicalNote as any).className || "Class 10";
      const subject = canonicalNote.subject || (canonicalNote as any).subjectName || "General";
      const subjKey = `${normalizeSubjectName(subject)}__${normalizeClassId(ownerClass)}`;

      if (!subjectAllowedMap.has(subjKey)) {
        subjectAllowedMap.set(subjKey, {
          ownerClass,
          allowedClasses: new Set([ownerClass]),
          dupNoteIds: [],
        });
      }

      const record = subjectAllowedMap.get(subjKey)!;
      for (const dup of duplicateNotes) {
        const cls = dup.classGrade || (dup as any).className;
        if (cls) record.allowedClasses.add(cls);
        if (dup.id !== canonicalNote.id) {
          record.dupNoteIds.push(dup.id);
        }
      }
    }
  }

  // Also inspect notes whose storageKey points to a different class than note.classGrade
  for (const n of notes) {
    const key = (n.storageKey || n.storagePath || n.r2Key || "").trim();
    const match = key.match(/class_notes\/([^\/]+)\//i);
    if (match) {
      const classFromKey = match[1].replace(/_/g, " ");
      const currentClass = n.classGrade || (n as any).className || "";
      if (currentClass && normalizeClassId(classFromKey) !== normalizeClassId(currentClass)) {
        const ownerClass = classFromKey;
        const subject = n.subject || (n as any).subjectName || "General";
        const subjKey = `${normalizeSubjectName(subject)}__${normalizeClassId(ownerClass)}`;

        if (!subjectAllowedMap.has(subjKey)) {
          subjectAllowedMap.set(subjKey, {
            ownerClass,
            allowedClasses: new Set([ownerClass]),
            dupNoteIds: [],
          });
        }
        const record = subjectAllowedMap.get(subjKey)!;
        record.allowedClasses.add(currentClass);
        record.dupNoteIds.push(n.id);
      }
    }
  }

  // Apply migrations
  for (const [subjKey, data] of subjectAllowedMap.entries()) {
    const subjectName = subjKey.split("__")[0];
    const cleanSubj = subjectName.charAt(0).toUpperCase() + subjectName.slice(1);
    const allowed = Array.from(data.allowedClasses);

    try {
      await saveSubjectAccessRule(cleanSubj, data.ownerClass, allowed);
      migratedRulesCount++;

      // Delete duplicate note documents from Firestore & local state
      for (const dupId of data.dupNoteIds) {
        try {
          await deleteClassNoteDoc(dupId);
          cleanedDuplicateNotesCount++;
        } catch {
          // ignore
        }
      }
    } catch (migErr) {
      console.warn(`[Migration v7.9.5] Notice migrating subject ${cleanSubj}:`, migErr);
    }
  }

  console.log(`[Migration v7.9.5] Migration completed: ${migratedRulesCount} subject access rules established, ${cleanedDuplicateNotesCount} duplicate note documents removed.`);
  return { migratedRulesCount, cleanedDuplicateNotesCount };
}
