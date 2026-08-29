/**
 * Student Practice Test Score Persistence Service
 * 
 * Provides complete cross-device synchronization for student practice test scores using Firebase Firestore and Cloudflare R2.
 * Enforces per-student isolation, duplicate attempt prevention, and instant real-time UI updates.
 */

import { TestAttemptRecord } from "../types";
import { 
  getLocalTestAttempts, 
  saveLocalTestAttemptsCache, 
  saveTestAttemptDoc, 
  subscribeToTestAttempts
} from "./firestoreService";
import { getFirebaseDb } from "./firebase";
import {
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
  writeBatch
} from "firebase/firestore";
import {
  downloadFromR2,
  uploadToR2,
  deleteMultipleFromR2,
  listFromR2,
  getR2BucketName,
} from "./r2Client";

const PRACTICE_TESTS_BUCKET = getR2BucketName();
const TEST_SCORE_CACHE_KEY = "tuition_student_test_score_cache";

async function downloadJsonFromR2<T>(key: string): Promise<T | null> {
  try {
    const { blob } = await downloadFromR2({ bucket: PRACTICE_TESTS_BUCKET, key });
    if (blob) {
      const text = await blob.text();
      if (text) return JSON.parse(text) as T;
    }
  } catch (err) {
    // ignore
  }
  return null;
}

async function uploadJsonToR2(key: string, data: any): Promise<void> {
  try {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    await uploadToR2({ bucket: PRACTICE_TESTS_BUCKET, key, file: blob, mimeType: "application/json" });
  } catch (err) {
    console.warn(`[ScorePersistence] R2 upload error for ${key}:`, err);
  }
}

export async function syncTestAttemptsToR2Storage(attempts: TestAttemptRecord[]): Promise<boolean> {
  try {
    await uploadJsonToR2("practice_tests/test_attempts.json", attempts);
    return true;
  } catch {
    return false;
  }
}

export async function fetchTestAttemptsFromR2Storage(): Promise<TestAttemptRecord[] | null> {
  try {
    return await downloadJsonFromR2<TestAttemptRecord[]>("practice_tests/test_attempts.json");
  } catch {
    return null;
  }
}

// In-memory cache for fast, synchronous UI reads
let inMemoryAttempts: TestAttemptRecord[] = [];

// Session cache for student scores per topic & student to eliminate redundant network requests
const scoreSessionCache = new Map<string, TestAttemptRecord | null>();
const inFlightScoreRequests = new Map<string, Promise<TestAttemptRecord | null>>();

function cleanId(str?: string): string {
  if (!str) return "";
  return str.toLowerCase().trim().replace(/[^a-z0-9_]/g, "_");
}

function getStudentAttemptStoragePath(studentId: string): string {
  const cId = cleanId(studentId) || "unknown_student";
  return `practice_tests/student_attempts/student_${cId}.json`;
}

/**
 * Normalizes attempts and removes duplicates, keeping the latest / highest score attempt
 * per topic for a student.
 */
export function deduplicateAttempts(attempts: TestAttemptRecord[]): TestAttemptRecord[] {
  if (!Array.isArray(attempts)) return [];
  const map = new Map<string, TestAttemptRecord>();

  attempts.forEach((a) => {
    if (!a) return;
    const studentKey = cleanId(a.studentId) || cleanId(a.studentName);
    const testType = a.testType || "topic";
    const topicNorm = (a.topicName || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");
    const key = `${studentKey}__${a.classGrade || ""}__${a.subject || ""}__${a.chapterNo || 0}__${topicNorm}__${testType}`;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, a);
    } else {
      const existingPct = existing.percentage ?? (existing.totalQuestions > 0 ? (existing.score / existing.totalQuestions) * 100 : 0);
      const newPct = a.percentage ?? (a.totalQuestions > 0 ? (a.score / a.totalQuestions) * 100 : 0);

      const existingTime = existing.timestamp || 0;
      const newTime = a.timestamp || 0;

      if (newTime > existingTime || (newTime === existingTime && newPct >= existingPct)) {
        map.set(key, {
          ...existing,
          ...a,
          attemptNumber: Math.max(existing.attemptNumber || 1, a.attemptNumber || 1)
        });
      }
    }
  });

  return Array.from(map.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

/**
 * Fetch a student's practice test attempts directly from Firestore & Cloudflare R2.
 * Synchronizes across devices seamlessly on login and screen load.
 */
export async function fetchStudentTestAttempts(
  studentId: string,
  studentName?: string
): Promise<TestAttemptRecord[]> {
  const cId = cleanId(studentId) || cleanId(studentName);
  if (!cId) return [];

  let remoteAttempts: TestAttemptRecord[] = [];

  // 1. Fetch from Firestore test_attempts AND student_test_attempts collections
  try {
    const db = await getFirebaseDb();
    if (db) {
      const collectionsToCheck = ["student_test_attempts", "test_attempts"];
      for (const colName of collectionsToCheck) {
        try {
          const colRef = collection(db, colName);
          const q = query(colRef, where("studentId", "==", studentId));
          const snap = await getDocs(q);
          snap.forEach((docSnap) => {
            const d = docSnap.data() as TestAttemptRecord;
            if (d && d.studentId) {
              remoteAttempts.push({ ...d, id: d.id || docSnap.id });
            }
          });
        } catch (colErr) {
          console.warn(`[ScorePersistence] Error querying ${colName} for ${studentId}:`, colErr);
        }
      }
    }
  } catch (err) {
    console.warn(`[ScorePersistence] Firestore test_attempts query error for ${studentId}:`, err);
  }

  // 2. Fetch student-specific JSON file from Cloudflare R2 bucket
  try {
    const filePath = getStudentAttemptStoragePath(studentId);
    const parsed = await downloadJsonFromR2<TestAttemptRecord[]>(filePath);
    if (Array.isArray(parsed) && parsed.length > 0) {
      remoteAttempts = [...remoteAttempts, ...parsed];
    }
  } catch (err) {
    console.warn(`[ScorePersistence] Error downloading per-student file for ${studentId} from R2:`, err);
  }

  // 3. Fallback: Download global test_attempts.json from Cloudflare R2
  if (remoteAttempts.length === 0) {
    try {
      const parsed = await downloadJsonFromR2<TestAttemptRecord[]>("practice_tests/test_attempts.json");
      if (Array.isArray(parsed)) {
        const studentMatches = parsed.filter((a) => {
          if (!a) return false;
          const aId = cleanId(a.studentId);
          const aName = cleanId(a.studentName);
          return (studentId && aId === cId) || (studentName && aName === cleanId(studentName));
        });
        remoteAttempts = [...remoteAttempts, ...studentMatches];
      }
    } catch (err) {
      console.warn("[ScorePersistence] Global file download fallback warning from R2:", err);
    }
  }

  // Deduplicate and merge into memory & local cache
  const cleanRemote = deduplicateAttempts(remoteAttempts);

  if (cleanRemote.length > 0) {
    mergeAttemptsIntoMemoryAndCache(cleanRemote);
    notifyScoreUpdate();
  }

  return cleanRemote;
}

/**
 * Saves or updates a practice test attempt in Cloudflare R2 and Firestore.
 * Prevents duplicates and ensures score synchronization across all devices.
 */
export async function savePracticeTestAttempt(
  attempt: TestAttemptRecord
): Promise<TestAttemptRecord> {
  if (!attempt || !attempt.studentId) {
    throw new Error("Invalid attempt record: missing studentId");
  }

  const studentId = attempt.studentId;
  const cId = cleanId(studentId) || cleanId(attempt.studentName);
  const topicNorm = (attempt.topicName || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");
  const testType = attempt.testType || "topic";
  const cacheKey = `${cId}__${(attempt.classGrade || "").toLowerCase().trim()}__${(attempt.subject || "").toLowerCase().trim()}__${attempt.chapterNo || 0}__${topicNorm}__${testType}`;

  // 1. INSTANT LOCAL UPDATE: Update session cache, memory cache, and local storage synchronously
  scoreSessionCache.set(cacheKey, attempt);
  mergeAttemptsIntoMemoryAndCache([attempt]);
  notifyScoreUpdate();

  // 2. ASYNCHRONOUS BACKGROUND SYNC: Save to Cloudflare R2 and Firestore without blocking UI
  (async () => {
    try {
      // 2a. Fetch existing student attempts to preserve attempt history and deduplicate
      let existingStudentAttempts = await fetchStudentTestAttempts(studentId, attempt.studentName);

      const existingIndex = existingStudentAttempts.findIndex((a) => {
        const aTopicNorm = (a.topicName || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");
        const aTestType = a.testType || "topic";
        return (
          (a.classGrade || "").toLowerCase().trim() === (attempt.classGrade || "").toLowerCase().trim() &&
          (a.subject || "").toLowerCase().trim() === (attempt.subject || "").toLowerCase().trim() &&
          Number(a.chapterNo) === Number(attempt.chapterNo) &&
          aTopicNorm === topicNorm &&
          aTestType === testType
        );
      });

      let updatedAttempt = { ...attempt };

      if (existingIndex > -1) {
        const prev = existingStudentAttempts[existingIndex];
        updatedAttempt = {
          ...prev,
          ...attempt,
          id: prev.id || attempt.id,
          attemptNumber: Math.max(attempt.attemptNumber || 1, (prev.attemptNumber || 0) + 1),
          timestamp: attempt.timestamp || Date.now()
        };
        existingStudentAttempts[existingIndex] = updatedAttempt;
      } else {
        existingStudentAttempts.push(updatedAttempt);
      }

      const finalStudentAttempts = deduplicateAttempts(existingStudentAttempts);

      // 2b. Save per-student JSON file to Cloudflare R2
      try {
        const filePath = getStudentAttemptStoragePath(studentId);
        await uploadJsonToR2(filePath, finalStudentAttempts);
      } catch (err) {
        console.warn(`[ScorePersistence] Storage upload error for student ${studentId}:`, err);
      }

      // 2c. Update global test_attempts.json in Cloudflare R2
      try {
        const globalList = (await downloadJsonFromR2<TestAttemptRecord[]>("practice_tests/test_attempts.json")) || [];
        const otherStudentsAttempts = globalList.filter((a) => {
          const aId = cleanId(a.studentId);
          const aName = cleanId(a.studentName);
          return aId !== cId && aName !== cleanId(attempt.studentName);
        });

        const mergedGlobal = deduplicateAttempts([...otherStudentsAttempts, ...finalStudentAttempts]);
        await uploadJsonToR2("practice_tests/test_attempts.json", mergedGlobal);
      } catch (err) {
        console.warn("[ScorePersistence] Global attempts upload error:", err);
      }

      // 2d. Save to Firestore document
      try {
        await saveTestAttemptDoc(updatedAttempt);
      } catch (err) {
        console.warn("[ScorePersistence] Firestore save error:", err);
      }

      // 2e. Synchronize in memory & session cache
      scoreSessionCache.set(cacheKey, updatedAttempt);
      mergeAttemptsIntoMemoryAndCache([updatedAttempt]);
    } catch (bgErr) {
      console.warn("[ScorePersistence] Background sync error:", bgErr);
    }
  })();

  return attempt;
}

/**
 * Merges new attempts into in-memory array and local storage cache
 */
export function mergeAttemptsIntoMemoryAndCache(newAttempts: TestAttemptRecord[]): void {
  const currentLocal = getLocalTestAttempts();
  const combined = deduplicateAttempts([...inMemoryAttempts, ...currentLocal, ...newAttempts]);
  inMemoryAttempts = combined;
  saveLocalTestAttemptsCache(combined);
}

/**
 * Dispatches window events to notify UI components to re-render with latest scores
 */
export function notifyScoreUpdate(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("test-attempts-updated"));
    window.dispatchEvent(new CustomEvent("practice-tests-updated"));
  }
}

/**
 * Synchronously retrieves cached attempts from memory and local storage
 */
export function getCachedAttemptsFromMemory(): TestAttemptRecord[] {
  const local = getLocalTestAttempts();
  return deduplicateAttempts([...inMemoryAttempts, ...local]);
}

/**
 * Load student test scores helper
 */
export async function loadStudentTestScores(studentId: string): Promise<TestAttemptRecord[]> {
  return fetchStudentTestAttempts(studentId);
}

function findMatchingAttempt(
  attempts: TestAttemptRecord[],
  normStudent: string,
  normClass: string,
  normSubj: string,
  chapterNo?: number,
  normTopic?: string,
  testType: string = "topic"
): TestAttemptRecord | null {
  if (!attempts || attempts.length === 0) return null;

  const matches = attempts.filter((a) => {
    if (!a) return false;
    if (a.testType && a.testType !== testType) return false;
    const aStudent = cleanId(a.studentId) || cleanId(a.studentName);
    if (normStudent && aStudent !== normStudent && a.studentId !== normStudent) return false;
    if (normClass && (a.classGrade || "").toLowerCase().trim() !== normClass) return false;
    if (normSubj && (a.subject || "").toLowerCase().trim() !== normSubj) return false;
    if (chapterNo !== undefined && Number(a.chapterNo) !== Number(chapterNo)) return false;
    if (normTopic && testType === "topic") {
      const aTopicNorm = (a.topicName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      return aTopicNorm === normTopic || aTopicNorm.includes(normTopic) || normTopic.includes(aTopicNorm);
    }
    return true;
  });

  if (matches.length === 0) return null;
  matches.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return matches[0];
}

/**
 * Optimized simultaneous score fetcher.
 * Queries Firestore and local caches for a specific topic score.
 * Uses session caching and promise deduplication to prevent redundant requests.
 */
export async function fetchStudentScore(
  studentId: string,
  classGradeOrTopicId?: string,
  subject?: string,
  chapterNo?: number,
  topicName?: string,
  testType: "topic" | "full_chapter" = "topic"
): Promise<TestAttemptRecord | null> {
  if (!studentId) return null;

  let classGrade = classGradeOrTopicId || "";
  if (classGradeOrTopicId && classGradeOrTopicId.includes("__") && !subject) {
    const parts = classGradeOrTopicId.split("__");
    classGrade = parts[0] || "";
    subject = parts[1] || "";
    chapterNo = parseInt((parts[2] || "").replace("ch", ""), 10) || 1;
    topicName = parts.slice(3).join("__");
  }

  const normStudent = cleanId(studentId);
  const normClass = (classGrade || "").toLowerCase().trim();
  const normSubj = (subject || "").toLowerCase().trim();
  const normTopic = (topicName || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");

  const cacheKey = `${normStudent}__${normClass}__${normSubj}__${chapterNo || 0}__${normTopic}__${testType}`;

  if (scoreSessionCache.has(cacheKey)) {
    return scoreSessionCache.get(cacheKey) || null;
  }

  if (inFlightScoreRequests.has(cacheKey)) {
    return inFlightScoreRequests.get(cacheKey)!;
  }

  const fetchPromise = (async () => {
    try {
      // 1. Check in-memory attempts
      const cachedAttempts = getCachedAttemptsFromMemory();
      const existing = findMatchingAttempt(cachedAttempts, normStudent, normClass, normSubj, chapterNo, normTopic, testType);
      if (existing) {
        scoreSessionCache.set(cacheKey, existing);
        return existing;
      }

      // 2. Query Firestore test_attempts collection
      try {
        const db = await getFirebaseDb();
        if (db) {
          const colRef = collection(db, "test_attempts");
          const q = query(colRef, where("studentId", "==", studentId));
          const snap = await getDocs(q);
          const docs: TestAttemptRecord[] = [];
          snap.forEach((d) => {
            const row = d.data() as TestAttemptRecord;
            if (row) docs.push({ ...row, id: row.id || d.id });
          });
          if (docs.length > 0) {
            mergeAttemptsIntoMemoryAndCache(docs);
            const match = findMatchingAttempt(docs, normStudent, normClass, normSubj, chapterNo, normTopic, testType);
            if (match) {
              scoreSessionCache.set(cacheKey, match);
              return match;
            }
          }
        }
      } catch (fsErr) {
        console.warn("[ScorePersistence] Firestore fetchStudentScore error:", fsErr);
      }

      // 3. Fallback to per-student R2 storage file
      const storageAttempts = await fetchStudentTestAttempts(studentId);
      const storageMatch = findMatchingAttempt(storageAttempts, normStudent, normClass, normSubj, chapterNo, normTopic, testType);
      if (storageMatch) {
        scoreSessionCache.set(cacheKey, storageMatch);
        return storageMatch;
      }
    } catch (e) {
      console.warn("[ScorePersistence] fetchStudentScore error:", e);
    } finally {
      inFlightScoreRequests.delete(cacheKey);
    }

    scoreSessionCache.set(cacheKey, null);
    return null;
  })();

  inFlightScoreRequests.set(cacheKey, fetchPromise);
  return fetchPromise;
}

/**
 * Clear test score cache
 */
export function clearTestScoreCache(): void {
  inMemoryAttempts = [];
  scoreSessionCache.clear();
  inFlightScoreRequests.clear();
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(TEST_SCORE_CACHE_KEY);
    localStorage.removeItem("tuition_student_test_score_cache");
    localStorage.removeItem("tuition_test_attempts_cache");
  } catch (err) {
    console.warn("[TestScoreService] Error clearing test score cache:", err);
  }
}

/**
 * Permanently deletes ALL student practice test attempts, scores, and marks from Firestore,
 * Cloudflare R2, and local/memory caches.
 */
export async function deleteAllAttemptsAndScoresFromPersistence(): Promise<{ success: boolean; deletedCount: number }> {
  console.log("[ScorePersistence] [START_DELETE_ALL] Initiating permanent deletion of ALL student practice test attempts and marks.");
  let deletedCount = 0;

  // 1. Delete all docs from Firestore collections `student_test_attempts`, `test_attempts`, `student_topic_test_scores`, and `student_scores`
  try {
    const db = await getFirebaseDb();
    if (db) {
      const collectionsToClear = ["student_test_attempts", "test_attempts", "student_topic_test_scores", "student_scores"];
      for (const colName of collectionsToClear) {
        try {
          const colRef = collection(db, colName);
          const snap = await getDocs(colRef);
          const batch = writeBatch(db);
          snap.forEach((d) => {
            batch.delete(d.ref);
            deletedCount++;
          });
          await batch.commit();
        } catch (colErr) {
          console.warn(`[ScorePersistence] Error wiping collection ${colName}:`, colErr);
        }
      }
    }
  } catch (err) {
    console.warn("[ScorePersistence] Error deleting all attempts from Firestore:", err);
  }

  // 2. Clear Cloudflare R2 `practice_tests/test_attempts.json` and student attempt files
  try {
    await uploadJsonToR2("practice_tests/test_attempts.json", []);

    // List and delete individual student attempt files
    const fileList = await listFromR2({ bucket: PRACTICE_TESTS_BUCKET, prefix: "practice_tests/student_attempts" });

    if (Array.isArray(fileList) && fileList.length > 0) {
      const pathsToDelete = fileList.map((f) => f.key);
      await deleteMultipleFromR2({ bucket: PRACTICE_TESTS_BUCKET, keys: pathsToDelete });
    }
  } catch (err) {
    console.warn("[ScorePersistence] Error wiping storage attempts:", err);
  }

  // 3. Clear in-memory and local storage caches
  inMemoryAttempts = [];
  scoreSessionCache.clear();
  inFlightScoreRequests.clear();
  saveLocalTestAttemptsCache([]);
  clearTestScoreCache();

  return { success: true, deletedCount };
}

/**
 * Permanently deletes all student attempts and scores for a specific topic from Firestore,
 * Cloudflare R2, memory cache, and local storage.
 */
export async function deleteTopicAttemptsFromPersistence(
  classGrade: string,
  subject: string,
  chapterNo: number,
  topicName: string
): Promise<{ success: boolean; deletedCount: number }> {
  const normClass = (classGrade || "").toLowerCase().trim();
  const normSubj = (subject || "").toLowerCase().trim();
  const normTopic = (topicName || "").toLowerCase().trim();
  const normTopicClean = normTopic.replace(/[^a-z0-9]/g, "");

  console.log(`[ScorePersistence] Deleting all student attempts for topic: [${classGrade}] ${subject} Ch${chapterNo}: ${topicName}`);

  let deletedCount = 0;

  // 1. Delete matching documents from Firestore `student_test_attempts`, `test_attempts`, `student_topic_test_scores`, and `student_scores`
  try {
    const db = await getFirebaseDb();
    if (db) {
      const collectionsToCheck = ["student_test_attempts", "test_attempts", "student_topic_test_scores", "student_scores"];
      for (const colName of collectionsToCheck) {
        try {
          const colRef = collection(db, colName);
          const snap = await getDocs(colRef);
          const batch = writeBatch(db);
          snap.forEach((d) => {
            const row = d.data() as any;
            if (!row) return;
            const rClass = (row.classGrade || "").toLowerCase().trim();
            const rSubj = (row.subject || "").toLowerCase().trim();
            const rTopic = (row.topicName || row.topicId || "").toLowerCase().trim();
            const rTopicClean = rTopic.replace(/[^a-z0-9]/g, "");
            const isChapterMatch = Number(row.chapterNo) === Number(chapterNo);
            const isMatch =
              (rClass === normClass && rSubj === normSubj && isChapterMatch && (rTopic === normTopic || rTopicClean === normTopicClean)) ||
              (isChapterMatch && (rTopic === normTopic || rTopicClean === normTopicClean));
            if (isMatch) {
              batch.delete(d.ref);
              deletedCount++;
            }
          });
          await batch.commit();
        } catch (colErr) {
          console.warn(`[ScorePersistence] Error deleting topic attempts from ${colName}:`, colErr);
        }
      }
    }
  } catch (err) {
    console.warn("[ScorePersistence] Error deleting attempts from Firestore:", err);
  }

  // 2. Delete/filter matching attempts in Cloudflare R2 `practice_tests/test_attempts.json`
  try {
    const parsed = await downloadJsonFromR2<TestAttemptRecord[]>("practice_tests/test_attempts.json");
    if (Array.isArray(parsed)) {
      const filtered = parsed.filter((a) => {
        const aClass = (a.classGrade || "").toLowerCase().trim();
        const aSubj = (a.subject || "").toLowerCase().trim();
        const aTopic = (a.topicName || "").toLowerCase().trim();
        const aTopicClean = aTopic.replace(/[^a-z0-9]/g, "");
        const isChapterMatch = Number(a.chapterNo) === Number(chapterNo);

        const isMatch =
          (aClass === normClass && aSubj === normSubj && isChapterMatch && (aTopic === normTopic || aTopicClean === normTopicClean)) ||
          (isChapterMatch && aTopicClean === normTopicClean);
        return !isMatch;
      });

      await uploadJsonToR2("practice_tests/test_attempts.json", filtered);
    }
  } catch (err) {
    console.warn("[ScorePersistence] Error updating global test_attempts.json in Storage:", err);
  }

  // 3. Clear from in-memory attempts and session cache
  inMemoryAttempts = inMemoryAttempts.filter((a) => {
    const aClass = (a.classGrade || "").toLowerCase().trim();
    const aSubj = (a.subject || "").toLowerCase().trim();
    const aTopic = (a.topicName || "").toLowerCase().trim();
    const aTopicClean = aTopic.replace(/[^a-z0-9]/g, "");
    const isChapterMatch = Number(a.chapterNo) === Number(chapterNo);

    const isMatch =
      (aClass === normClass && aSubj === normSubj && isChapterMatch && (aTopic === normTopic || aTopicClean === normTopicClean)) ||
      (isChapterMatch && aTopicClean === normTopicClean);
    return !isMatch;
  });

  scoreSessionCache.clear();
  inFlightScoreRequests.clear();

  // 4. Update local storage cache
  const localAttempts = getLocalTestAttempts().filter((a) => {
    const aClass = (a.classGrade || "").toLowerCase().trim();
    const aSubj = (a.subject || "").toLowerCase().trim();
    const aTopic = (a.topicName || "").toLowerCase().trim();
    const aTopicClean = aTopic.replace(/[^a-z0-9]/g, "");
    const isChapterMatch = Number(a.chapterNo) === Number(chapterNo);

    const isMatch =
      (aClass === normClass && aSubj === normSubj && isChapterMatch && (aTopic === normTopic || aTopicClean === normTopicClean)) ||
      (isChapterMatch && aTopicClean === normTopicClean);
    return !isMatch;
  });
  saveLocalTestAttemptsCache(localAttempts);

  try {
    localStorage.removeItem(TEST_SCORE_CACHE_KEY);
  } catch (e) {}

  notifyScoreUpdate();

  return { success: true, deletedCount };
}

/**
 * Get a specific topic's high score percentage for a student
 */
export function getStudentTopicHighScore(
  studentId: string,
  subject: string,
  chapterNo: number,
  topicName: string
): number | null {
  const attempts = getCachedAttemptsFromMemory();

  const topicAttempts = attempts.filter((a) => {
    const aId = cleanId(a.studentId);
    const targetId = cleanId(studentId);
    if (aId !== targetId && a.studentId !== studentId) return false;
    if (a.subject?.toLowerCase().trim() !== subject?.toLowerCase().trim()) return false;
    if (Number(a.chapterNo) !== Number(chapterNo)) return false;
    const normTopic = a.topicName?.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normTarget = topicName?.toLowerCase().replace(/[^a-z0-9]/g, "");
    return normTopic === normTarget;
  });

  if (topicAttempts.length === 0) return null;

  let highestScore = 0;
  topicAttempts.forEach((a) => {
    const pct = a.percentage ?? (a.totalQuestions > 0 ? Math.round((a.score / a.totalQuestions) * 100) : 0);
    if (pct > highestScore) highestScore = pct;
  });

  return highestScore;
}

/**
 * Get total attempt count for a topic
 */
export function getStudentTopicAttemptCount(
  studentId: string,
  subject: string,
  chapterNo: number,
  topicName: string
): number {
  const attempts = getCachedAttemptsFromMemory();

  return attempts.filter((a) => {
    const aId = cleanId(a.studentId);
    const targetId = cleanId(studentId);
    if (aId !== targetId && a.studentId !== studentId) return false;
    if (a.subject?.toLowerCase().trim() !== subject?.toLowerCase().trim()) return false;
    if (Number(a.chapterNo) !== Number(chapterNo)) return false;
    const normTopic = a.topicName?.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normTarget = topicName?.toLowerCase().replace(/[^a-z0-9]/g, "");
    return normTopic === normTarget;
  }).length;
}

/**
 * Get latest attempt for a topic
 */
export function getStudentTopicLatestScore(
  studentId: string,
  subject: string,
  chapterNo: number,
  topicName: string
): TestAttemptRecord | null {
  const attempts = getCachedAttemptsFromMemory();

  const topicAttempts = attempts.filter((a) => {
    const aId = cleanId(a.studentId);
    const targetId = cleanId(studentId);
    if (aId !== targetId && a.studentId !== studentId) return false;
    if (a.subject?.toLowerCase().trim() !== subject?.toLowerCase().trim()) return false;
    if (Number(a.chapterNo) !== Number(chapterNo)) return false;
    const normTopic = a.topicName?.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normTarget = topicName?.toLowerCase().replace(/[^a-z0-9]/g, "");
    return normTopic === normTarget;
  });

  if (topicAttempts.length === 0) return null;

  topicAttempts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return topicAttempts[0];
}

/**
 * Subscribe to student test scores
 */
export function subscribeToStudentTestScores(
  studentId: string,
  onUpdate: (scores: TestAttemptRecord[]) => void,
  onError?: (err: any) => void
): () => void {
  return subscribeToTestAttempts(
    (allAttempts) => {
      const studentScores = allAttempts.filter((a) => cleanId(a.studentId) === cleanId(studentId));
      onUpdate(studentScores);
    },
    onError
  );
}

export default {
  fetchStudentTestAttempts,
  savePracticeTestAttempt,
  getCachedAttemptsFromMemory,
  deduplicateAttempts,
  loadStudentTestScores,
  clearTestScoreCache,
  getStudentTopicHighScore,
  getStudentTopicAttemptCount,
  getStudentTopicLatestScore,
  subscribeToStudentTestScores
};
