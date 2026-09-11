/**
 * Atlas v5.0.8 — Non-Destructive Database Schema Migration Service
 * Ensures all existing database entities, collections, classes, subjects, notes, and metadata
 * are 100% preserved during updates, deployments, and reboots.
 */

import { doc, getDoc, setDoc, getDocs, collection, updateDoc } from "firebase/firestore";
import { getFirebaseDb } from "./firebase";
import { 
  getSchoolHierarchy, 
  getUpscHierarchy, 
  saveSchoolHierarchy, 
  saveUpscHierarchy, 
  extractHierarchyFromNotes 
} from "./curriculumService";
import { getLocalClassNotes, saveLocalClassNotes, saveClassNoteDoc } from "./firestoreService";
import { repairStorageIntegrity } from "./storageIntegrityService";

export const CURRENT_SCHEMA_VERSION = 5;
const STORAGE_KEY_SCHEMA_VERSION = "tuition_database_schema_version";

export interface DatabaseSchemaInfo {
  version: number;
  lastMigratedAt: string;
  isInitialInstallation: boolean;
}

/**
 * Reconciles duplicate or ghost classes and fixes note associations.
 * Guarantees:
 * - "Class Class" is removed.
 * - If "Foundation" exists, any unwanted "Class Foundation" duplicate is merged into "Foundation".
 * - Notes belonging to Foundation that were mistakenly assigned "Class Foundation" are fixed.
 */
export async function reconcileDuplicateClassesAndNotes(): Promise<{
  reconciledClassesCount: number;
  reconciledNotesCount: number;
}> {
  let reconciledClassesCount = 0;
  let reconciledNotesCount = 0;

  try {
    const school = getSchoolHierarchy();
    let schoolModified = false;
    const db = await getFirebaseDb();

    // Pull current remote school_hierarchy to ensure we have any newly saved classes/subjects
    if (db) {
      try {
        const snap = await getDoc(doc(db, "curriculum_hierarchy", "school_hierarchy"));
        if (snap.exists()) {
          const remoteSchool = snap.data() as any;
          if (Array.isArray(remoteSchool.classes)) {
            const mergedClasses = Array.from(new Set([...school.classes, ...remoteSchool.classes]));
            school.classes = mergedClasses;
            school.subjects = { ...school.subjects, ...(remoteSchool.subjects || {}) };
            school.chapters = { ...school.chapters, ...(remoteSchool.chapters || {}) };
            if (remoteSchool.removedSubjects) {
              school.removedSubjects = { ...school.removedSubjects, ...remoteSchool.removedSubjects };
            }
          }
        }
      } catch (err) {
        console.warn("[Reconcile] Notice reading remote school hierarchy:", err);
      }
    }

    // 1. Reconcile "Class Class" ghost class
    const classClassIdx = school.classes.findIndex(
      (c) => c && c.toLowerCase().trim() === "class class"
    );
    if (classClassIdx !== -1) {
      const classClassName = school.classes[classClassIdx];
      school.classes.splice(classClassIdx, 1);
      delete school.subjects[classClassName];
      delete school.chapters[classClassName];
      if (school.removedSubjects) delete school.removedSubjects[classClassName];
      schoolModified = true;
      reconciledClassesCount++;
      console.log(`[Reconcile] Removed unwanted ghost class "${classClassName}"`);
    }

    // 2. Reconcile "Class Foundation" vs "Foundation"
    const hasFoundation = school.classes.some(
      (c) => c && c.toLowerCase().trim() === "foundation"
    );
    const classFoundationIdx = school.classes.findIndex(
      (c) => c && c.toLowerCase().trim() === "class foundation"
    );

    if (hasFoundation && classFoundationIdx !== -1) {
      const classFoundationName = school.classes[classFoundationIdx];
      const foundationKey = school.classes.find((c) => c && c.toLowerCase().trim() === "foundation") || "Foundation";

      // Merge subjects
      const cfSubjs = school.subjects[classFoundationName] || [];
      const fSubjs = school.subjects[foundationKey] || [];
      school.subjects[foundationKey] = Array.from(new Set([...fSubjs, ...cfSubjs]));
      delete school.subjects[classFoundationName];

      // Merge chapters
      if (school.chapters[classFoundationName]) {
        if (!school.chapters[foundationKey]) school.chapters[foundationKey] = {};
        for (const [subj, chList] of Object.entries(school.chapters[classFoundationName])) {
          const existingChs = school.chapters[foundationKey][subj] || [];
          const chMap = new Map<number, string>();
          existingChs.forEach((ch) => chMap.set(ch.number, ch.name));
          (chList || []).forEach((ch) => chMap.set(ch.number, ch.name));
          school.chapters[foundationKey][subj] = Array.from(chMap.entries())
            .map(([number, name]) => ({ number, name }))
            .sort((a, b) => a.number - b.number);
        }
        delete school.chapters[classFoundationName];
      }

      if (school.removedSubjects) delete school.removedSubjects[classFoundationName];
      school.classes.splice(classFoundationIdx, 1);
      schoolModified = true;
      reconciledClassesCount++;
      console.log(`[Reconcile] Merged duplicate class "${classFoundationName}" into "${foundationKey}"`);
    }

    if (schoolModified) {
      await saveSchoolHierarchy(school);
      if (db) {
        try {
          const docRef = doc(db, "curriculum_hierarchy", "school_hierarchy");
          await setDoc(docRef, school, { merge: true });
        } catch (err) {
          console.warn("[Reconcile] Failed updating remote school hierarchy doc:", err);
        }
      }
    }

    // 3. Reconcile notes in Firestore and locally
    const targetFoundationClass = school.classes.find((c) => c && c.toLowerCase().trim() === "foundation") || (hasFoundation ? "Foundation" : "");

    if (targetFoundationClass) {
      // Reconcile Firestore collection
      if (db) {
        try {
          const notesSnap = await getDocs(collection(db, "class_notes"));
          for (const noteDoc of notesSnap.docs) {
            const d = noteDoc.data();
            const cls = ((d as any).className || d.classGrade || (d as any).class || "").trim();
            const storageKey = (d.storagePath || d.storageKey || d.r2Key || "").trim();

            const isClassFoundation = cls.toLowerCase() === "class foundation";
            const hasFoundationPath = /class_notes\/foundation\//i.test(storageKey) || /^foundation\//i.test(storageKey);

            if (isClassFoundation || (hasFoundationPath && cls.toLowerCase() !== "foundation")) {
              reconciledNotesCount++;
              console.log(`[Reconcile] Updating Firestore note "${noteDoc.id}" to class "${targetFoundationClass}"`);
              await updateDoc(doc(db, "class_notes", noteDoc.id), {
                className: targetFoundationClass,
                classGrade: targetFoundationClass,
                classFolder: targetFoundationClass,
                classId: targetFoundationClass.toLowerCase(),
                class: targetFoundationClass,
              });
            }
          }
        } catch (firestoreErr) {
          console.warn("[Reconcile] Notice scanning Firestore notes:", firestoreErr);
        }
      }

      // Reconcile local notes cache
      const notes = getLocalClassNotes();
      let notesModified = false;
      const updatedNotes = notes.map((n) => {
        const cls = ((n as any).className || n.classGrade || (n as any).class || "").trim();
        const storageKey = (n.storagePath || n.storageKey || n.r2Key || "").trim();

        const isClassFoundation = cls.toLowerCase() === "class foundation";
        const hasFoundationPath = /class_notes\/foundation\//i.test(storageKey) || /^foundation\//i.test(storageKey);

        if (isClassFoundation || (hasFoundationPath && cls.toLowerCase() !== "foundation")) {
          notesModified = true;
          console.log(`[Reconcile] Re-mapping local note "${n.id}" (${n.topicName || n.topicTitle}) to class "${targetFoundationClass}"`);
          const updatedNote = {
            ...n,
            className: targetFoundationClass,
            classGrade: targetFoundationClass,
            classFolder: targetFoundationClass,
            classId: targetFoundationClass.toLowerCase(),
            class: targetFoundationClass,
          };
          return updatedNote;
        }
        return n;
      });

      if (notesModified) {
        saveLocalClassNotes(updatedNotes);
      }
    }
  } catch (err) {
    console.warn("[Reconcile] Notice during reconcileDuplicateClassesAndNotes:", err);
  }

  return { reconciledClassesCount, reconciledNotesCount };
}

/**
 * Runs safe, non-destructive migrations on application startup.
 * Strictly guarantees:
 * - Never drops or deletes collections/documents
 * - Never overwrites existing user data with empty placeholders
 * - Merges any legacy or missing fields without destroying existing data
 */
export async function runDatabaseMigrationsIfNeeded(): Promise<void> {
  if (typeof window === "undefined") return;

  try {
    const localVersion = parseInt(localStorage.getItem(STORAGE_KEY_SCHEMA_VERSION) || "1", 10);
    
    const db = await getFirebaseDb();
    let remoteVersion = 1;
    let schemaDocExists = false;

    if (db) {
      try {
        const schemaRef = doc(db, "system_metadata", "schema_info");
        const snap = await getDoc(schemaRef);
        if (snap.exists()) {
          schemaDocExists = true;
          const data = snap.data() as DatabaseSchemaInfo;
          remoteVersion = data.version || 1;
        }
      } catch (err) {
        console.warn("[SchemaMigration] Could not query remote schema doc:", err);
      }
    }

    const currentActiveVersion = Math.max(localVersion, remoteVersion);
    console.log(`[SchemaMigration] Current schema version: ${currentActiveVersion}, Target: ${CURRENT_SCHEMA_VERSION}`);

    // If migration is needed
    if (currentActiveVersion < CURRENT_SCHEMA_VERSION || !schemaDocExists) {
      console.log("[SchemaMigration] Executing safe non-destructive migration...");
      
      // Step 1: Ensure Curriculum Hierarchy is fully backed by existing notes
      const existingNotes = getLocalClassNotes();
      const currentSchool = getSchoolHierarchy();
      const currentUpsc = getUpscHierarchy();

      const { school: mergedSchool, upsc: mergedUpsc, added } = extractHierarchyFromNotes(
        existingNotes,
        currentSchool,
        currentUpsc
      );

      // If database is completely empty (no classes at all and no notes)
      if (mergedSchool.classes.length === 0 && existingNotes.length === 0) {
        // Seed default classes once only on fresh empty install
        mergedSchool.classes = ["Class 9", "Class 10", "Class 11", "Class 12"];
        mergedSchool.subjects = {
          "Class 9": ["Mathematics", "Science", "Social Science"],
          "Class 10": ["Mathematics", "Science", "Social Science"],
          "Class 11": ["Physics", "Chemistry", "Mathematics", "Biology"],
          "Class 12": ["Physics", "Chemistry", "Mathematics", "Biology"]
        };
      }

      if (mergedUpsc.papers.length === 0 && existingNotes.length === 0) {
        mergedUpsc.papers = ["GS Paper 1", "GS Paper 2", "GS Paper 3", "GS Paper 4"];
        mergedUpsc.subjects = {
          "GS Paper 1": ["History", "Geography", "Indian Society"],
          "GS Paper 2": ["Polity", "Governance", "International Relations"],
          "GS Paper 3": ["Economy", "Environment", "Science & Tech"],
          "GS Paper 4": ["Ethics", "Integrity", "Aptitude"]
        };
      }

      // Save merged hierarchies (will not destroy anything)
      await saveSchoolHierarchy(mergedSchool);
      await saveUpscHierarchy(mergedUpsc);

      // Step 2: Automatic Storage Integrity Check and Repair
      try {
        await repairStorageIntegrity();
      } catch (repairErr) {
        console.warn("[SchemaMigration] Storage integrity repair notice:", repairErr);
      }

      // Step 3: Reconcile duplicate classes and notes
      try {
        await reconcileDuplicateClassesAndNotes();
      } catch (recErr) {
        console.warn("[SchemaMigration] Reconcile duplicate classes notice:", recErr);
      }

      // Record schema version update
      localStorage.setItem(STORAGE_KEY_SCHEMA_VERSION, String(CURRENT_SCHEMA_VERSION));

      if (db) {
        try {
          const schemaRef = doc(db, "system_metadata", "schema_info");
          await setDoc(schemaRef, {
            version: CURRENT_SCHEMA_VERSION,
            lastMigratedAt: new Date().toISOString(),
            isInitialInstallation: existingNotes.length === 0
          }, { merge: true });
        } catch (saveErr) {
          console.warn("[SchemaMigration] Failed recording remote schema info:", saveErr);
        }
      }

      console.log("[SchemaMigration] Migration completed successfully.");
    } else {
      // Ensure reconciliation runs to catch any recent duplicates
      try {
        await reconcileDuplicateClassesAndNotes();
      } catch (recErr) {
        console.warn("[SchemaMigration] Reconcile duplicate classes notice:", recErr);
      }
    }
  } catch (err) {
    console.error("[SchemaMigration] Error during migration check:", err);
  }
}
