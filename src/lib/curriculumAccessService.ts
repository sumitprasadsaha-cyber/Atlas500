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
  id: string; // canonical subject access ID, e.g. "school_foundation_english" or "science"
  subjectId?: string; // e.g. "english"
  name: string; // subject display name, e.g. "English"
  ownerClassId: string; // canonical owner class, e.g. "Foundation" or "Class 6"
  ownerClassStableId?: string; // stable class ID, e.g. "foundation" or "class-6"
  allowedClasses: string[]; // list of allowed classes, e.g. ["Foundation", "Class 7", "Class 8"]
  allowedClassIds?: string[]; // stable class IDs, e.g. ["foundation", "class-7", "class-8"]
  enabled?: boolean; // whether curriculum access is active (defaults to true)
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
            const sanitizedRules: Record<string, SubjectClassAccess> = {};
            for (const [k, v] of Object.entries(data.rules)) {
              if (v && typeof v === "object") {
                sanitizedRules[k] = sanitizeAccessRule(v as SubjectClassAccess);
              }
            }
            inMemorySubjectAccess = sanitizedRules;
            safeLocalStorageSetItem(STORAGE_KEY_SUBJECT_ACCESS, JSON.stringify(sanitizedRules));
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
              const sanitizedRules: Record<string, SubjectClassAccess> = {};
              for (const [k, v] of Object.entries(data.rules)) {
                if (v && typeof v === "object") {
                  sanitizedRules[k] = sanitizeAccessRule(v as SubjectClassAccess);
                }
              }
              inMemorySubjectAccess = sanitizedRules;
              safeLocalStorageSetItem(STORAGE_KEY_SUBJECT_ACCESS, JSON.stringify(sanitizedRules));
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
            const sanitizedRules: Record<string, SubjectClassAccess> = {};
            for (const [k, v] of Object.entries(parsed)) {
              if (v && typeof v === "object") {
                sanitizedRules[k] = sanitizeAccessRule(v as SubjectClassAccess);
              }
            }
            inMemorySubjectAccess = sanitizedRules;
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
 * Resolves any class name, formatted name, or legacy identifier into a unique, stable class ID.
 * Requirements:
 * - "Foundation" -> "foundation" (Never prepend "Class ")
 * - "Class Foundation" -> "foundation" (Resolves legacy duplicate to canonical ID)
 * - "Prep" -> "prep" (Never prepend "Class ")
 * - "Class Prep" -> "prep" (Resolves legacy duplicate to canonical ID)
 * - "Class 7", "class 7", "class-7", "class7" -> "class-7"
 * - "Class 10", "class-10", "class10" -> "class-10"
 * - "UPSC", "upsc" -> "upsc"
 * - "Batch A", "batch-a" -> "batch-a"
 */
export function toStableClassId(classNameOrId?: string): string {
  if (!classNameOrId) return "";
  const trimmed = String(classNameOrId).trim().toLowerCase();

  if (/^upsc$/i.test(trimmed) || /^class\s+upsc$/i.test(trimmed)) {
    return "upsc";
  }

  // Foundation batch (always stable "foundation", never "class-foundation")
  if (
    trimmed === "foundation" ||
    trimmed === "class foundation" ||
    trimmed === "class-foundation" ||
    trimmed === "foundation-class-id" ||
    trimmed === "foundation-id"
  ) {
    return "foundation";
  }

  // Prep batch (always stable "prep", never "class-prep")
  if (
    trimmed === "prep" ||
    trimmed === "class prep" ||
    trimmed === "class-prep" ||
    trimmed === "prep-class-id" ||
    trimmed === "prep-id"
  ) {
    return "prep";
  }

  // Standard numeric classes: "Class 7", "class-7", "class7", "class-7-id", "Grade 7" -> "class-7"
  const digitMatch = trimmed.match(/(?:class|grade)?[\s_-]*(\d+)/i);
  if (digitMatch) {
    return `class-${digitMatch[1]}`;
  }

  // Generic non-numeric: strip redundant "class " prefix if non-numeric
  const stripped = trimmed.replace(/^class[\s_-]+/i, "");
  return (stripped || trimmed).replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Backward compatibility alias for toStableClassId.
 */
export function normalizeClassId(className?: string): string {
  return toStableClassId(className);
}

/**
 * Maps a stable class ID or class string to its canonical human-readable display name.
 * Respects availableClasses from school hierarchy if provided.
 */
export function getClassDisplayName(
  classIdOrName?: string,
  availableClasses?: string[]
): string {
  if (!classIdOrName) return "";
  const stableId = toStableClassId(classIdOrName);
  if (!stableId) return "";

  // 1. If availableClasses has a matching class, use its exact casing/name
  if (Array.isArray(availableClasses) && availableClasses.length > 0) {
    const match = availableClasses.find((c) => toStableClassId(c) === stableId);
    if (match) {
      const trimmedMatch = match.trim();
      // Ensure "Class Foundation" in availableClasses is displayed as "Foundation"
      if (stableId === "foundation") return "Foundation";
      if (stableId === "prep") return "Prep";
      return trimmedMatch;
    }
  }

  // 2. Known well-defined names
  if (stableId === "foundation") return "Foundation";
  if (stableId === "prep") return "Prep";
  if (stableId === "upsc") return "UPSC";

  // 3. Numeric classes "class-7" -> "Class 7"
  const digitMatch = stableId.match(/^class-(\d+)$/);
  if (digitMatch) {
    return `Class ${digitMatch[1]}`;
  }

  // 4. If input was already a nicely formatted title string without hyphens, use it
  const raw = String(classIdOrName).trim();
  if (raw && !raw.includes("-") && !raw.includes("_") && /[A-Z]/.test(raw)) {
    if (/^class\s+foundation$/i.test(raw)) return "Foundation";
    if (/^class\s+prep$/i.test(raw)) return "Prep";
    return raw;
  }

  // 5. Fallback: Title case hyphenated words
  return stableId
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Sanitizes and normalizes an access rule:
 * - Deduplicates allowedClasses strictly by stable class ID
 * - Removes legacy duplicates like "Class Foundation" when "Foundation" is present
 * - Guarantees ownerClassId is in allowedClasses
 * - Populates both allowedClasses and allowedClassIds
 */
export function sanitizeAccessRule(
  rule: SubjectClassAccess,
  availableClasses?: string[]
): SubjectClassAccess {
  if (!rule) return rule;

  const ownerStableId = toStableClassId(rule.ownerClassStableId || rule.ownerClassId);
  const canonicalOwnerName = getClassDisplayName(ownerStableId, availableClasses) || rule.ownerClassId || "Foundation";

  const classMap = new Map<string, string>(); // stableId -> canonicalName
  if (ownerStableId) {
    classMap.set(ownerStableId, canonicalOwnerName);
  }

  // Process allowedClassIds
  if (Array.isArray(rule.allowedClassIds)) {
    rule.allowedClassIds.forEach((id) => {
      const sid = toStableClassId(id);
      if (sid && !classMap.has(sid)) {
        classMap.set(sid, getClassDisplayName(sid, availableClasses));
      }
    });
  }

  // Process allowedClasses (resolves legacy names like "Class Foundation" to "Foundation")
  if (Array.isArray(rule.allowedClasses)) {
    rule.allowedClasses.forEach((cls) => {
      const sid = toStableClassId(cls);
      if (sid && !classMap.has(sid)) {
        classMap.set(sid, getClassDisplayName(sid, availableClasses));
      }
    });
  }

  const cleanAllowedClassIds = Array.from(classMap.keys());
  const cleanAllowedClasses = Array.from(classMap.values());

  return {
    ...rule,
    name: rule.name || "General",
    subjectId: rule.subjectId || normalizeSubjectName(rule.name),
    ownerClassId: canonicalOwnerName,
    ownerClassStableId: ownerStableId,
    allowedClasses: cleanAllowedClasses,
    allowedClassIds: cleanAllowedClassIds,
    enabled: rule.enabled !== false,
  };
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
    return `${normSubj}__${toStableClassId(ownerClass)}`;
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
        const sanitized: Record<string, SubjectClassAccess> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (v && typeof v === "object") {
            sanitized[k] = sanitizeAccessRule(v as SubjectClassAccess);
          }
        }
        inMemorySubjectAccess = sanitized;
        return sanitized;
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

  // Non-owner classes require subject_access.enabled == true (or enabled !== false)
  if (access.enabled === false) return false;

  const targetStableId = toStableClassId(targetClass);
  const ownerStableId = toStableClassId(access.ownerClassStableId || access.ownerClassId);

  // Owner class always has access
  if (targetStableId === ownerStableId) return true;

  // Check allowedClassIds
  if (Array.isArray(access.allowedClassIds)) {
    if (access.allowedClassIds.some((id) => toStableClassId(id) === targetStableId)) {
      return true;
    }
  }

  // Check allowedClasses (for backward compatibility)
  if (Array.isArray(access.allowedClasses)) {
    return access.allowedClasses.some(
      (c) => toStableClassId(c) === targetStableId
    );
  }

  return false;
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
  const contextStableId = contextClass ? toStableClassId(contextClass) : "";

  // 1. Direct match by specific owner key
  if (contextClass) {
    const specificKey = getSubjectAccessKey(subjectName, contextClass);
    if (rules[specificKey]) {
      return sanitizeAccessRule(rules[specificKey]);
    }
  }

  // 2. Search for any rule matching the subject name where contextClass is either owner or in allowedClasses
  const matchingRules = Object.values(rules)
    .filter((r) => r && normalizeSubjectName(r.name) === normSubj)
    .map((r) => sanitizeAccessRule(r));

  if (matchingRules.length > 0) {
    // If a rule explicitly allows or owns contextClass, pick that rule
    if (contextStableId) {
      const classMatch = matchingRules.find((r) => isClassAllowedForSubject(r, contextClass!));
      if (classMatch) return classMatch;
    }
    // Fall back to first matching rule for this subject name
    return matchingRules[0];
  }

  // 3. Fallback: contextClass or default "Foundation" is the canonical owner
  const defaultOwner = contextClass || "Foundation";
  const defaultOwnerStableId = toStableClassId(defaultOwner);
  const defaultOwnerName = getClassDisplayName(defaultOwnerStableId);

  return {
    id: `subject_${normSubj}`,
    subjectId: normSubj,
    name: subjectName,
    ownerClassId: defaultOwnerName,
    ownerClassStableId: defaultOwnerStableId,
    allowedClasses: [defaultOwnerName],
    allowedClassIds: [defaultOwnerStableId],
    enabled: true,
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
  return toStableClassId(owner) === toStableClassId(className);
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
  const normCurrent = toStableClassId(currentClass);
  const normOwner = toStableClassId(access.ownerClassStableId || access.ownerClassId);

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
 * - allowedClasses or allowedClassIds exists as an array
 * - rejects empty or malicious strings
 * - ensures idempotence by deduplicating stable class IDs
 */
export function validateSubjectAccessPayload(payload: {
  subjectName: string;
  ownerClassId: string;
  allowedClasses?: string[];
  allowedClassIds?: string[];
}): {
  valid: boolean;
  error?: string;
  cleanAllowedClasses?: string[];
  cleanAllowedClassIds?: string[];
} {
  if (!payload.subjectName || !payload.subjectName.trim()) {
    return { valid: false, error: "Subject name is required." };
  }

  if (!payload.ownerClassId || !payload.ownerClassId.trim()) {
    return { valid: false, error: "Owner class is required and cannot be empty." };
  }

  const ownerStableId = toStableClassId(payload.ownerClassId);
  if (!ownerStableId) {
    return { valid: false, error: "Invalid owner class ID." };
  }

  if (!Array.isArray(payload.allowedClasses) && !Array.isArray(payload.allowedClassIds)) {
    return { valid: false, error: "allowedClasses or allowedClassIds must be an array of class identifiers." };
  }

  // Reject invalid class names (empty strings or illegal characters)
  const allEntries = [
    ...(payload.allowedClasses || []),
    ...(payload.allowedClassIds || []),
  ];

  for (const c of allEntries) {
    if (!c || typeof c !== "string" || !c.trim()) {
      return { valid: false, error: "Allowed classes contains an invalid or empty class name." };
    }
    if (/[<>{}]/.test(c)) {
      return { valid: false, error: `Invalid characters in class name: "${c}".` };
    }
  }

  // Check that owner is present
  const hasOwner = allEntries.some((c) => toStableClassId(c) === ownerStableId);
  if (!hasOwner) {
    return {
      valid: false,
      error: `Owner class "${payload.ownerClassId}" must always be included in allowedClasses and cannot be removed.`,
    };
  }

  // Build clean deduplicated maps
  const classMap = new Map<string, string>();
  classMap.set(ownerStableId, getClassDisplayName(ownerStableId));
  for (const c of allEntries) {
    const sid = toStableClassId(c);
    if (sid && !classMap.has(sid)) {
      classMap.set(sid, getClassDisplayName(sid));
    }
  }

  return {
    valid: true,
    cleanAllowedClasses: Array.from(classMap.values()),
    cleanAllowedClassIds: Array.from(classMap.keys()),
  };
}

/**
 * Saves or updates a subject's class access permissions.
 * Persists locally and to Firestore.
 * Supports passing both allowedClasses (display names) and allowedClassIds (stable IDs).
 * Strictly deduplicates classes by stable class ID so no false duplicate class error is thrown.
 */
export async function saveSubjectAccessRule(
  subjectName: string,
  ownerClassId: string,
  allowedClasses: string[],
  allowedClassIds?: string[]
): Promise<SubjectClassAccess> {
  const cleanSubject = subjectName.trim();
  const rawOwner = ownerClassId.trim();
  const ownerStableId = toStableClassId(rawOwner);

  if (!ownerStableId) {
    throw new Error("Invalid owner class ID.");
  }

  const hierarchy = getSchoolHierarchy();
  const availableClasses = hierarchy?.classes || [];
  const canonicalOwner = getClassDisplayName(ownerStableId, availableClasses) || rawOwner;

  // Build clean deduplicated list of allowed classes strictly by stable ID
  const classMap = new Map<string, string>(); // stableId -> canonicalName
  // Owner is ALWAYS authorized
  classMap.set(ownerStableId, canonicalOwner);

  // Add from allowedClasses (resolving any formatted or legacy names like "Class Foundation" -> "Foundation")
  (allowedClasses || []).forEach((c) => {
    if (!c || typeof c !== "string") return;
    const sid = toStableClassId(c);
    if (sid && !classMap.has(sid)) {
      classMap.set(sid, getClassDisplayName(sid, availableClasses));
    }
  });

  // Add from allowedClassIds
  (allowedClassIds || []).forEach((id) => {
    if (!id || typeof id !== "string") return;
    const sid = toStableClassId(id);
    if (sid && !classMap.has(sid)) {
      classMap.set(sid, getClassDisplayName(sid, availableClasses));
    }
  });

  const cleanAllowedClassIds = Array.from(classMap.keys());
  const cleanAllowedClasses = Array.from(classMap.values());

  // Validate
  const validation = validateSubjectAccessPayload({
    subjectName: cleanSubject,
    ownerClassId: canonicalOwner,
    allowedClasses: cleanAllowedClasses,
    allowedClassIds: cleanAllowedClassIds,
  });

  if (!validation.valid) {
    throw new Error(validation.error || "Validation failed for Subject Access.");
  }

  const normSubj = normalizeSubjectName(cleanSubject);
  const ruleId = `school_${ownerStableId}_${normSubj}`;
  const now = new Date().toISOString();

  const existingRules = getAllSubjectAccessRules();
  const ruleKey = getSubjectAccessKey(cleanSubject, canonicalOwner);
  const prevRule = existingRules[ruleKey] || existingRules[normSubj];

  const newRule: SubjectClassAccess = {
    id: prevRule?.id || ruleId,
    subjectId: normSubj,
    name: cleanSubject,
    ownerClassId: canonicalOwner,
    ownerClassStableId: ownerStableId,
    allowedClasses: cleanAllowedClasses,
    allowedClassIds: cleanAllowedClassIds,
    enabled: true,
    createdAt: prevRule?.createdAt || now,
    updatedAt: now,
  };

  // Persist in memory map
  existingRules[ruleKey] = newRule;
  existingRules[normSubj] = newRule;

  // Clean up any stale legacy keys like `${normSubj}__classfoundation`
  const staleKey = `${normSubj}__classfoundation`;
  if (existingRules[staleKey]) {
    delete existingRules[staleKey];
  }

  persistSubjectAccessRules(existingRules);

  // Update curriculum hierarchy subjects map: only the canonical owner class retains this subject
  let hierarchyChanged = false;
  const updatedSubjects = { ...(hierarchy.subjects || {}) };

  // 1. Ensure canonical owner class has the subject
  const ownerList = updatedSubjects[canonicalOwner] || [];
  if (!ownerList.includes(cleanSubject)) {
    updatedSubjects[canonicalOwner] = [...ownerList, cleanSubject];
    hierarchyChanged = true;
  }

  // 2. Ensure consumer classes DO NOT have the subject in their native hierarchy
  Object.keys(updatedSubjects).forEach((cls) => {
    if (toStableClassId(cls) !== ownerStableId) {
      const list = updatedSubjects[cls] || [];
      if (list.includes(cleanSubject)) {
        updatedSubjects[cls] = list.filter((s) => s !== cleanSubject);
        hierarchyChanged = true;
      }
    }
  });

  // Remove any legacy "Class Foundation" key from hierarchy subjects if present
  if (updatedSubjects["Class Foundation"]) {
    delete updatedSubjects["Class Foundation"];
    hierarchyChanged = true;
  }

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
      const subjectDocRef = doc(db, "subjects", newRule.id);
      await setDoc(subjectDocRef, {
        id: newRule.id,
        name: cleanSubject,
        subjectName: cleanSubject,
        category: "school",
        ownerClassId: canonicalOwner,
        ownerClassStableId: ownerStableId,
        allowedClasses: cleanAllowedClasses,
        allowedClassIds: cleanAllowedClassIds,
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
          ownerClassId: canonicalOwner,
          ownerClassStableId: ownerStableId,
          allowedClasses: cleanAllowedClasses,
          allowedClassIds: cleanAllowedClassIds,
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
  const targetStableId = toStableClassId(targetClass);
  const rules = getAllSubjectAccessRules();

  // Map: ownerStableId -> { ownerClass, subjects: Set<string> }
  const classMap = new Map<string, { ownerClass: string; subjects: Set<string> }>();

  Object.values(rules).forEach((rule) => {
    if (!rule || !rule.name) return;
    const ownerStableId = toStableClassId(rule.ownerClassStableId || rule.ownerClassId);
    if (!ownerStableId) return;

    // Skip if owner is the target class itself (that belongs to student's own class)
    if (ownerStableId === targetStableId) return;

    // Check if targetClass is granted permission
    if (isClassAllowedForSubject(rule, targetClass)) {
      const cleanSubj = rule.name.trim();
      if (!cleanSubj) return;

      if (!classMap.has(ownerStableId)) {
        const canonicalOwner = getClassDisplayName(ownerStableId) || (rule.ownerClassId ? rule.ownerClassId.trim() : "Foundation");
        classMap.set(ownerStableId, {
          ownerClass: canonicalOwner,
          subjects: new Set<string>(),
        });
      }
      classMap.get(ownerStableId)!.subjects.add(cleanSubj);
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
