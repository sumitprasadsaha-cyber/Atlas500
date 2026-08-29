/**
 * Atlas v5.0.8 — Non-Destructive Database Schema Migration Service
 * Ensures all existing database entities, collections, classes, subjects, notes, and metadata
 * are 100% preserved during updates, deployments, and reboots.
 */

import { doc, getDoc, setDoc, getDocs, collection } from "firebase/firestore";
import { getFirebaseDb } from "./firebase";
import { 
  getSchoolHierarchy, 
  getUpscHierarchy, 
  saveSchoolHierarchy, 
  saveUpscHierarchy, 
  extractHierarchyFromNotes 
} from "./curriculumService";
import { getLocalClassNotes } from "./firestoreService";

export const CURRENT_SCHEMA_VERSION = 2;
const STORAGE_KEY_SCHEMA_VERSION = "tuition_database_schema_version";

export interface DatabaseSchemaInfo {
  version: number;
  lastMigratedAt: string;
  isInitialInstallation: boolean;
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
    }
  } catch (err) {
    console.error("[SchemaMigration] Error during migration check:", err);
  }
}
