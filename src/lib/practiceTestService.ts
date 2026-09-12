import { ParsedAssessmentQuestion, TopicPracticeTest, TestAttemptRecord, ClassNote, ChapterNote, ComprehensionPassage, CaseStudy, AssessmentTestType, AssessmentQuestionType } from "../types";
import { getResolvedViewUrl } from "./storageService";
import { uploadToR2, downloadFromR2, getR2BucketName } from "./r2Client";
import { doc, setDoc, onSnapshot, collection, deleteDoc, getDoc, getDocs, Unsubscribe } from "firebase/firestore";
import { getFirebaseDb } from "./firebase";
import { normalizeQuestionOptions } from "../utils/assessmentParser";

import { safeLocalStorageSetItem, safeLocalStorageGetItem, safeLocalStorageRemoveItem } from "./safeStorage";
import {
  deleteTopicAttemptsFromPersistence,
  deleteAllAttemptsAndScoresFromPersistence,
  clearTestScoreCache
} from "./testScorePersistence";
import { isPracticeTestActive } from "./testSessionManager";

const TESTS_CACHE_KEY = "tuition_topic_practice_tests_bank";
const SYNC_QUEUE_KEY = "tuition_practice_tests_sync_queue";
const PRACTICE_TESTS_BUCKET = "academy-connect-files";
const PRACTICE_TESTS_FILE_PATH = "practice_tests/test_bank.json";
const PRACTICE_TEST_ATTEMPTS_FILE_PATH = "practice_tests/test_attempts.json";

const IDB_DB_NAME = "tuition_practice_tests_db";
const IDB_DB_VERSION = 1;
const IDB_SYNC_QUEUE_STORE = "syncQueue";
const MAX_SYNC_RETRIES = 3;
const MAX_LOCAL_STORAGE_ITEM_BYTES = 50 * 1024;

let memoryTestBank: Record<string, TopicPracticeTest> = {};
let memoryQuestionsCache: Map<string, ParsedAssessmentQuestion[]> = new Map();
let inFlightTestFetches: Map<string, Promise<TopicPracticeTest | null>> = new Map();
let inFlightSubjectPreloads: Set<string> = new Set();
let preloadedImagesSet: Set<string> = new Set();
let memorySyncQueue: SyncQueueItem[] = [];
let activeFirestoreTestsUnsub: Unsubscribe | null = null;
let activeFirestoreSyncUnsub: Unsubscribe | null = null;

export interface TopicPracticeTestMetadata {
  id: string;
  classGrade: string;
  subject: string;
  chapterNo: number;
  chapterName: string;
  topicName: string;
  questionCount: number;
  lastUpdated: string;
}

export interface SaveTopicResult {
  success: boolean;
  count: number;
  message: string;
  error?: string;
  fromCache?: boolean;
}

export interface SyncQueueItem {
  id: string;
  action: "save_topic" | "delete_topic" | "delete_question" | "update_question";
  context?: {
    classGrade: string;
    subject: string;
    chapterNo: number;
    chapterName: string;
    topicName: string;
    rawText?: string;
  };
  data?: any;
  timestamp: number;
  retryCount?: number;
}

export interface ScoreButtonStyles {
  container: string;
  icon: string;
  scoreText: string;
  labelText: string;
}

/**
 * Normalizes test ID for topic practice tests
 */
export function buildTopicTestId(
  classGrade: string = "",
  subject: string = "",
  chapterNo: number = 0,
  topicName: string = ""
): string {
  const normClass = String(classGrade || "").toLowerCase().trim().replace(/\s+/g, "_");
  const normSubj = String(subject || "").toLowerCase().trim().replace(/\s+/g, "_");
  const normTopic = String(topicName || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "_");
  return `${normClass}__${normSubj}__ch${chapterNo}__${normTopic}`;
}

export function buildChapterTestId(
  classGrade: string = "",
  subject: string = "",
  chapterNo: number = 0
): string {
  const normClass = String(classGrade || "").toLowerCase().trim().replace(/\s+/g, "_");
  const normSubj = String(subject || "").toLowerCase().trim().replace(/\s+/g, "_");
  return `${normClass}__${normSubj}__ch${chapterNo}__chapter_test`;
}

export function buildSubjectTestId(
  classGrade: string = "",
  subject: string = ""
): string {
  const normClass = String(classGrade || "").toLowerCase().trim().replace(/\s+/g, "_");
  const normSubj = String(subject || "").toLowerCase().trim().replace(/\s+/g, "_");
  return `${normClass}__${normSubj}__subject_test`;
}

export function buildPyqTestId(
  classGrade: string = "",
  subject: string = "",
  yearOrPaper: string = ""
): string {
  const normClass = String(classGrade || "").toLowerCase().trim().replace(/\s+/g, "_");
  const normSubj = String(subject || "").toLowerCase().trim().replace(/\s+/g, "_");
  const normYear = String(yearOrPaper || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "_");
  return `${normClass}__${normSubj}__pyq_${normYear || "test"}`;
}

export function buildAssessmentTestId(
  classGrade: string = "",
  subject: string = "",
  chapterNo: number = 0,
  topicName: string = "",
  testType: AssessmentTestType = "TOPIC"
): string {
  const t = String(testType || "TOPIC").toUpperCase();
  if (t === "SUBJECT") return buildSubjectTestId(classGrade, subject);
  if (t === "CHAPTER" || t === "FULL_CHAPTER") return buildChapterTestId(classGrade, subject, chapterNo);
  if (t === "PYQ") return buildPyqTestId(classGrade, subject, topicName);
  return buildTopicTestId(classGrade, subject, chapterNo, topicName);
}

/**
 * Clear cached question images and in-memory queries
 */
export function clearAllQuestionCaches(): void {
  // Clear any internal maps if applicable
}

/**
 * Broadcasts a practice test change signal locally, via BroadcastChannel (same-origin tabs),
 * and via Firestore practice_tests_sync collection (cross-device real-time sync).
 */
export async function notifyPracticeTestRealtimeSync(details?: any): Promise<void> {
  clearAllQuestionCaches();

  // 1. Dispatch local event immediately
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("practice-tests-updated"));
  }

  // 2. BroadcastChannel for instant same-browser multi-tab synchronization
  try {
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      const bc = new BroadcastChannel("tuition_practice_tests_channel");
      bc.postMessage({ type: "PRACTICE_TESTS_UPDATED", timestamp: Date.now(), ...details });
      bc.close();
    }
  } catch (err) {}

  // 3. Firestore realtime signal for cross-device real-time synchronization
  try {
    const db = await getFirebaseDb();
    if (db) {
      const syncDocRef = doc(db, "practice_tests_sync", "latest");
      await setDoc(
        syncDocRef,
        {
          updatedAt: new Date().toISOString(),
          timestamp: Date.now(),
          ...details,
        },
        { merge: true }
      );
    }
  } catch (err) {
    console.warn("[PracticeTestService] Failed to send Firestore practice test sync signal:", err);
  }
}

async function openPracticeTestsDB(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !window.indexedDB) return null;
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_SYNC_QUEUE_STORE)) {
        db.createObjectStore(IDB_SYNC_QUEUE_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      console.warn("[PracticeTestService] IndexedDB open blocked by another tab.");
    };
  });
}

async function readSyncQueueFromIDB(): Promise<SyncQueueItem[]> {
  const db = await openPracticeTestsDB();
  if (!db) return memorySyncQueue;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_SYNC_QUEUE_STORE, "readonly");
    const store = tx.objectStore(IDB_SYNC_QUEUE_STORE);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result as SyncQueueItem[]);
    request.onerror = () => reject(request.error);
  });
}

async function writeSyncQueueToIDB(queue: SyncQueueItem[]): Promise<void> {
  const db = await openPracticeTestsDB();
  if (!db) {
    memorySyncQueue = queue;
    return;
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_SYNC_QUEUE_STORE, "readwrite");
    const store = tx.objectStore(IDB_SYNC_QUEUE_STORE);
    const clearRequest = store.clear();

    clearRequest.onsuccess = () => {
      for (const item of queue) {
        store.put(item);
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });
}

const testBankSubscribers = new Set<(bank: Record<string, TopicPracticeTest>) => void>();

export function notifyTestBankSubscribers(): void {
  testBankSubscribers.forEach((fn) => {
    try {
      fn(memoryTestBank);
    } catch (e) {
      console.warn("[PracticeTestService] Error notifying subscriber:", e);
    }
  });
}

export function subscribeToPracticeTests(
  callback: (bank: Record<string, TopicPracticeTest>) => void
): () => void {
  testBankSubscribers.add(callback);
  // Initial callback with current memory bank
  try {
    callback(memoryTestBank);
  } catch (e) {}

  return () => {
    testBankSubscribers.delete(callback);
  };
}

export function initPracticeTestsRealtimeSync(): void {
  if (typeof window === "undefined") return;

  // A. BroadcastChannel for same-origin multi-tab sync
  try {
    if ("BroadcastChannel" in window) {
      const bc = new BroadcastChannel("tuition_practice_tests_channel");
      bc.onmessage = async (event) => {
        if (event.data?.type === "PRACTICE_TESTS_UPDATED") {
          await fetchAllPracticeTests();
          notifyTestBankSubscribers();
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("practice-tests-updated"));
          }
        }
      };
    }
  } catch (err) {}

  // B. Firestore Realtime Listeners for instant cross-device sync
  getFirebaseDb().then((db) => {
    if (!db) return;

    // Clean up any previous dead or stale subscriptions
    if (activeFirestoreTestsUnsub) {
      try {
        activeFirestoreTestsUnsub();
      } catch {}
      activeFirestoreTestsUnsub = null;
    }
    if (activeFirestoreSyncUnsub) {
      try {
        activeFirestoreSyncUnsub();
      } catch {}
      activeFirestoreSyncUnsub = null;
    }

    try {
      // 1. Listen directly to topic_practice_tests collection for immediate real-time updates
      const testsColRef = collection(db, "topic_practice_tests");
      activeFirestoreTestsUnsub = onSnapshot(
        testsColRef,
        (snap) => {
          const freshBank: Record<string, TopicPracticeTest> = {};
          snap.docs.forEach((docSnap) => {
            const test = docSnap.data() as TopicPracticeTest;
            if (test) {
              const testId = test.id || docSnap.id;
              freshBank[testId] = { ...test, id: testId };
            }
          });

          // Handle document removals explicitly from snapshot changes
          snap.docChanges().forEach((change) => {
            if (change.type === "removed") {
              const removedDocId = change.doc.id;
              delete memoryTestBank[removedDocId];
              removeLocalTopicCache(removedDocId);
              Object.keys(memoryTestBank).forEach((k) => {
                if (k === removedDocId || memoryTestBank[k]?.id === removedDocId || (memoryTestBank[k] as any)?.testId === removedDocId) {
                  delete memoryTestBank[k];
                  removeLocalTopicCache(k);
                }
              });
            }
          });

          // The freshBank represents the authoritative documents currently in Firestore
          memoryTestBank = freshBank;

          saveLocalTestBank(memoryTestBank, { silent: true });
          notifyTestBankSubscribers();
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("practice-tests-updated"));
          }

          // Non-destructive backup to secondary R2 storage
          if (Object.keys(memoryTestBank).length > 0) {
            syncTestBankToStorage(memoryTestBank).catch(() => {});
          }
        },
        (err) => {
          console.warn("[PracticeTestService] topic_practice_tests subscription error:", err);
          // If Firestore is temporarily unavailable, fall back to R2 backup
          fetchTestBankFromStorage().then((backup) => {
            if (backup && Object.keys(backup).length > 0) {
              memoryTestBank = { ...backup, ...memoryTestBank };
              notifyTestBankSubscribers();
            }
          }).catch(() => {});
        }
      );

      // 2. Also listen to practice_tests_sync signal
      const syncDocRef = doc(db, "practice_tests_sync", "latest");
      let lastProcessedTs = 0;

      activeFirestoreSyncUnsub = onSnapshot(
        syncDocRef,
        async (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            const ts = Number(data?.timestamp) || 0;
            if (ts && ts > lastProcessedTs) {
              lastProcessedTs = ts;
              await fetchAllPracticeTests();
              notifyTestBankSubscribers();
              if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("practice-tests-updated"));
              }
            }
          }
        },
        (err) => {
          console.warn("[PracticeTestService] Firestore practice_tests_sync snapshot error:", err);
        }
      );
    } catch (err) {
      console.warn("[PracticeTestService] Failed setting up Firestore practice_tests listeners:", err);
    }
  });
}

if (typeof window !== "undefined") {
  initPracticeTestsRealtimeSync();
}

export function isSubjectCompatible(subj1: string, subj2: string): boolean {
  const s1 = String(subj1 || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const s2 = String(subj2 || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!s1 || !s2) return true;
  if (s1 === s2) return true;
  if (s1.includes(s2) || s2.includes(s1)) return true;

  const sstAliases = [
    "socialscience", "sst", "socialstudies", "social",
    "geography", "history", "politicalscience", "civics",
    "economics", "indianheritageandculture", "contemporaryindia",
    "democraticpolitics", "understandingeconomicdevelopment", "indiaandthecontemporaryworld"
  ];
  if (sstAliases.includes(s1) && sstAliases.includes(s2)) return true;

  const scienceAliases = [
    "science", "sci", "physics", "chemistry", "biology",
    "lifescience", "physicalscience", "generalscience", "natsci", "naturalscience"
  ];
  if (scienceAliases.includes(s1) && scienceAliases.includes(s2)) return true;

  const mathAliases = [
    "math", "maths", "mathematics", "appliedmaths", "basicmaths",
    "standardmaths", "highermaths", "generalmaths", "algebra", "geometry"
  ];
  if (mathAliases.includes(s1) && mathAliases.includes(s2)) return true;

  const engAliases = ["english", "englishlanguage", "englishliterature", "eng", "firstlanguageenglish", "secondlanguageenglish", "englishcommunicative"];
  if (engAliases.includes(s1) && engAliases.includes(s2)) return true;

  const hindiAliases = ["hindi", "hindicoursea", "hindicourseb", "hindilit", "hindilang"];
  if (hindiAliases.includes(s1) && hindiAliases.includes(s2)) return true;

  const bengaliAliases = ["bengali", "bangla", "bengaliliterature", "bengalilanguage"];
  if (bengaliAliases.includes(s1) && bengaliAliases.includes(s2)) return true;

  return false;
}

function normalizeGradeNumber(gradeStr: string): number | null {
  const s = String(gradeStr || "").toLowerCase().trim();
  if (!s) return null;
  const numMatch = s.match(/(\d+)/);
  if (numMatch) return parseInt(numMatch[1], 10);
  const romanMatch = s.match(/\b(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)\b/i);
  if (romanMatch) {
    const romanMap: Record<string, number> = {
      i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12
    };
    const r = romanMatch[1].toLowerCase();
    if (romanMap[r]) return romanMap[r];
  }
  return null;
}

function cleanTopicText(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\+/g, "and")
    .replace(/^[\(\[\{-]?\s*(?:topic|part|pt|ch|chapter|unit)\b\.?[\s_]*\d+[\)\]\}]?[\s_.:–\-]*\s*/i, "")
    .replace(/^[\(\[\{-]?\s*(?:topic|part|pt|ch|chapter|unit)\b\.?[\)\]\}]?[\s_]*[:–\-]\s*/i, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export function isExactTopicMatch(
  classGrade1: string,
  subject1: string,
  chapterNo1: number | string,
  topicName1: string,
  classGrade2: string,
  subject2: string,
  chapterNo2: number | string,
  topicName2: string
): boolean {
  const ch1 = typeof chapterNo1 === "number" ? chapterNo1 : (parseInt(String(chapterNo1 || "").replace(/\D/g, ""), 10) || Number(chapterNo1) || 0);
  const ch2 = typeof chapterNo2 === "number" ? chapterNo2 : (parseInt(String(chapterNo2 || "").replace(/\D/g, ""), 10) || Number(chapterNo2) || 0);
  if (ch1 > 0 && ch2 > 0 && ch1 !== ch2) return false;

  const g1 = normalizeGradeNumber(classGrade1);
  const g2 = normalizeGradeNumber(classGrade2);
  if (g1 !== null && g2 !== null) {
    if (g1 !== g2) return false;
  } else {
    const c1 = String(classGrade1 || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const c2 = String(classGrade2 || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (c1 && c2 && c1 !== c2 && !c1.includes(c2) && !c2.includes(c1)) return false;
  }

  if (!isSubjectCompatible(subject1, subject2)) return false;

  const clean1 = cleanTopicText(topicName1);
  const clean2 = cleanTopicText(topicName2);
  if (clean1 && clean2) {
    if (clean1 === clean2 || clean1.includes(clean2) || clean2.includes(clean1)) return true;
  }

  const raw1 = String(topicName1 || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const raw2 = String(topicName2 || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return raw1 === raw2 || raw1.includes(raw2) || raw2.includes(raw1);
}

export function getScoreButtonStyles(isAttempted: boolean, percentage?: number | null): ScoreButtonStyles {
  if (!isAttempted || percentage === undefined || percentage === null || isNaN(percentage)) {
    return {
      container: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200/80 dark:border-emerald-800/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200",
      icon: "text-emerald-600 dark:text-emerald-400",
      scoreText: "text-emerald-800 dark:text-emerald-200",
      labelText: "text-emerald-600 dark:text-emerald-400",
    };
  }

  const pct = Math.round(percentage);

  if (pct >= 90) {
    return {
      container: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200",
      icon: "text-emerald-600 dark:text-emerald-400",
      scoreText: "text-emerald-800 dark:text-emerald-200",
      labelText: "text-emerald-600 dark:text-emerald-400",
    };
  } else if (pct >= 75) {
    return {
      container: "bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-800 dark:text-blue-200",
      icon: "text-blue-600 dark:text-blue-400",
      scoreText: "text-blue-800 dark:text-blue-200",
      labelText: "text-blue-600 dark:text-blue-400",
    };
  } else if (pct >= 50) {
    return {
      container: "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-200",
      icon: "text-amber-600 dark:text-amber-400",
      scoreText: "text-amber-800 dark:text-amber-200",
      labelText: "text-amber-600 dark:text-amber-400",
    };
  } else {
    return {
      container: "bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-800 dark:text-rose-200",
      icon: "text-rose-600 dark:text-rose-400",
      scoreText: "text-rose-800 dark:text-rose-200",
      labelText: "text-rose-600 dark:text-rose-400",
    };
  }
}

export async function syncTestBankToStorage(
  bank: Record<string, TopicPracticeTest>,
  options?: { allowEmpty?: boolean }
): Promise<boolean> {
  try {
    // CRITICAL DATA PROTECTION:
    // Never overwrite the R2 secondary backup with an empty object on startup or unhydrated memory bank!
    // Only allow empty upload if explicitly confirmed (e.g. from deleteAllPracticeTestsFromDatabase).
    if ((!bank || Object.keys(bank).length === 0) && !options?.allowEmpty) {
      return false;
    }

    const jsonString = JSON.stringify(bank, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    await uploadToR2({
      bucket: PRACTICE_TESTS_BUCKET,
      key: PRACTICE_TESTS_FILE_PATH,
      file: blob,
      mimeType: "application/json",
    });
    return true;
  } catch (err) {
    console.warn("[PracticeTestService] Storage sync exception:", err);
    return false;
  }
}

export async function fetchTestBankFromStorage(): Promise<Record<string, TopicPracticeTest> | null> {
  try {
    const { blob } = await downloadFromR2({
      bucket: PRACTICE_TESTS_BUCKET,
      key: PRACTICE_TESTS_FILE_PATH,
    });
    if (blob) {
      const text = await blob.text();
      if (text) {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object") {
          return parsed;
        }
      }
    }
  } catch (err) {
    console.warn("[PracticeTestService] Storage fetch error:", err);
  }
  return null;
}

export function getLocalTestBank(): Record<string, TopicPracticeTest> {
  return memoryTestBank;
}

export function getLocalTopicMetadata(): Record<string, TopicPracticeTestMetadata> {
  if (typeof window === "undefined") return {};
  try {
    const raw = safeLocalStorageGetItem(TESTS_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    return {};
  }
}

export function saveLocalTestBank(bank: Record<string, TopicPracticeTest>, options?: { silent?: boolean }): void {
  memoryTestBank = { ...bank };

  if (typeof window === "undefined") return;
  try {
    const metadataMap: Record<string, TopicPracticeTestMetadata> = {};
    for (const key of Object.keys(bank)) {
      const test = bank[key];
      if (!test) continue;
      metadataMap[key] = {
        id: test.id,
        classGrade: test.classGrade || "",
        subject: test.subject || "",
        chapterNo: Number(test.chapterNo) || 1,
        chapterName: test.chapterName || "",
        topicName: test.topicName || "",
        questionCount: Array.isArray(test.questions) ? test.questions.length : 0,
        lastUpdated: test.updatedAt || new Date().toISOString(),
      };
    }

    const entries = Object.entries(metadataMap).sort(([, a], [, b]) =>
      new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
    );
    let trimmedMap: Record<string, TopicPracticeTestMetadata> = {};
    let json = "";

    for (const [key, metadata] of entries) {
      trimmedMap[key] = metadata;
      json = JSON.stringify(trimmedMap);
      if (json.length * 2 > MAX_LOCAL_STORAGE_ITEM_BYTES) {
        delete trimmedMap[key];
        break;
      }
    }

    safeLocalStorageSetItem(TESTS_CACHE_KEY, JSON.stringify(trimmedMap));
  } catch (err: any) {
    console.warn("[PracticeTestService] Error saving metadata:", err);
  } finally {
    if (!options?.silent) {
      window.dispatchEvent(new CustomEvent("practice-tests-updated"));
    }
  }
}

export function updateLocalTopicCache(test: TopicPracticeTest): void {
  memoryTestBank[test.id] = test;
  saveLocalTestBank(memoryTestBank);
  syncTestBankToStorage(memoryTestBank).catch(() => {});
}

export function removeLocalTopicCache(testId: string): void {
  delete memoryTestBank[testId];

  const parts = testId.split("__");
  if (parts.length >= 4) {
    const classGrade = parts[0];
    const subject = parts[1];
    const chapterNoStr = parts[2];
    const normTopic = parts.slice(3).join("__").toLowerCase().replace(/[^a-z0-9]/g, "");

    Object.keys(memoryTestBank).forEach((key) => {
      const t = memoryTestBank[key];
      if (
        t &&
        (t.classGrade || "").toLowerCase().replace(/\s+/g, "_") === classGrade &&
        (t.subject || "").toLowerCase().replace(/\s+/g, "_") === subject &&
        String(t.chapterNo) === chapterNoStr.replace("ch", "") &&
        (t.topicName || "").toLowerCase().replace(/[^a-z0-9]/g, "_") === normTopic
      ) {
        delete memoryTestBank[key];
      }
    });
  }

  saveLocalTestBank(memoryTestBank);
}

export async function resolveQuestionImageUrls(
  questions: ParsedAssessmentQuestion[]
): Promise<ParsedAssessmentQuestion[]> {
  if (!questions || !Array.isArray(questions)) return [];

  return Promise.all(
    questions.map(async (q) => {
      if (!q.imageUrl) return q;

      if (q.imageUrl.startsWith("http://") || q.imageUrl.startsWith("https://")) {
        return q;
      }

      try {
        const resolvedUrl = await getResolvedViewUrl(q.imageUrl);
        return {
          ...q,
          imageUrl: resolvedUrl || q.imageUrl,
        };
      } catch (err) {
        console.warn(`[PracticeTestService] Failed to resolve URL for image path: ${q.imageUrl}`, err);
        return q;
      }
    })
  );
}

/**
 * Preload question diagram/formula images into browser cache lazily (capped to prevent OOM).
 */
export function preloadQuestionImages(questions: ParsedAssessmentQuestion[], limit: number = 2): void {
  if (typeof window === "undefined" || !Array.isArray(questions) || questions.length === 0) return;
  
  // Only preload up to 'limit' upcoming questions to prevent memory saturation
  const targetQuestions = questions.slice(0, limit);

  targetQuestions.forEach((q) => {
    if (q.imageUrl && !preloadedImagesSet.has(q.imageUrl)) {
      if (preloadedImagesSet.size > 30) {
        const firstKey = preloadedImagesSet.values().next().value;
        if (firstKey) preloadedImagesSet.delete(firstKey);
      }
      preloadedImagesSet.add(q.imageUrl);
      try {
        const img = new Image();
        img.onload = () => { img.onload = null; img.onerror = null; };
        img.onerror = () => { img.onload = null; img.onerror = null; };
        img.src = q.imageUrl;
      } catch {}
    }
  });
}

/**
 * Warms the in-memory cache with all practice tests and preloads question images.
 * Logs precise timing and statistics.
 */
export async function warmPracticeTestCache(): Promise<Record<string, TopicPracticeTest>> {
  console.log("[PracticeTest] Cache Warm Started");
  const startTime = performance.now();

  try {
    const bank = await fetchAllPracticeTests();
    const tests = Object.values(bank);
    let totalQuestions = 0;

    for (const test of tests) {
      if (Array.isArray(test.questions) && test.questions.length > 0) {
        totalQuestions += test.questions.length;
        console.log(`[PracticeTest] Practice Test Cached: { id: "${test.id}", questionCount: ${test.questions.length} }`);
      }
    }

    const durationMs = Math.round(performance.now() - startTime);
    console.log(`[PracticeTest] Cache Warm Finished: { count: ${tests.length}, questions: ${totalQuestions}, durationMs: ${durationMs} }`);
    return bank;
  } catch (err) {
    const durationMs = Math.round(performance.now() - startTime);
    console.warn(`[PracticeTest] Cache Warm Warning after ${durationMs}ms:`, err);
    return memoryTestBank;
  }
}

/**
 * Preloads all practice tests for a specific subject in the background.
 * Automatically suspended while an active practice test is taking place.
 */
export async function preloadSubjectPracticeTests(
  classGrade: string,
  subject: string,
  notes?: (ClassNote | ChapterNote)[]
): Promise<void> {
  // If a student is currently taking a test, suspend background preloading to eliminate memory pressure
  if (isPracticeTestActive()) {
    return;
  }

  const normClass = String(classGrade || "").toLowerCase().trim();
  const normSubj = String(subject || "").toLowerCase().trim();
  const preloadKey = `${normClass}__${normSubj}`;

  if (inFlightSubjectPreloads.has(preloadKey)) {
    return;
  }
  inFlightSubjectPreloads.add(preloadKey);

  try {
    // 1. Ensure test bank is loaded in memory
    const bank = Object.keys(memoryTestBank).length > 0 ? memoryTestBank : await fetchAllPracticeTests();

    // 2. Cache questions matching this subject
    const matchingTests = Object.values(bank).filter((test) => {
      const matchClass = !normClass || (test.classGrade || "").toLowerCase().includes(normClass) || normClass.includes((test.classGrade || "").toLowerCase());
      const matchSubj = isSubjectCompatible(subject, test.subject);
      return matchClass && matchSubj;
    });

    for (const test of matchingTests) {
      if (Array.isArray(test.questions) && test.questions.length > 0) {
        memoryQuestionsCache.set(test.id, test.questions);
      }
    }
  } catch (err) {
    console.warn(`[PracticeTest] Background preload warning for subject ${subject}:`, err);
  } finally {
    inFlightSubjectPreloads.delete(preloadKey);
  }
}

/**
 * Preloads topic tests for a specific chapter in the background.
 */
export async function preloadChapterPracticeTests(
  classGrade: string,
  subject: string,
  chapterNo: number
): Promise<void> {
  try {
    const bank = Object.keys(memoryTestBank).length > 0 ? memoryTestBank : await fetchAllPracticeTests();
    const ch = Number(chapterNo) || 1;

    const matchingTests = Object.values(bank).filter((test) => {
      const tCh = typeof test.chapterNo === "number" ? test.chapterNo : (parseInt(String(test.chapterNo || "").replace(/\D/g, ""), 10) || 1);
      return tCh === ch && isSubjectCompatible(subject, test.subject);
    });

    for (const test of matchingTests) {
      if (Array.isArray(test.questions) && test.questions.length > 0) {
        const resolved = await resolveQuestionImageUrls(test.questions);
        test.questions = resolved;
        memoryQuestionsCache.set(test.id, resolved);
        preloadQuestionImages(resolved);
      }
    }
  } catch (err) {
    console.warn(`[PracticeTest] Background preload warning for chapter ${chapterNo}:`, err);
  }
}

/**
 * Synchronously retrieves parsed assessment questions from in-memory cache without any network delay.
 * Returns null if not in cache (calling code can then fallback to async fetch).
 */
export function getQuestionsSync(
  classGradeOrTopicId: string,
  subject?: string,
  chapterNo?: number,
  topicName?: string,
  testType: AssessmentTestType = "topic",
  options?: { publishedOnly?: boolean }
): ParsedAssessmentQuestion[] | null {
  let classGrade = classGradeOrTopicId;
  if (classGradeOrTopicId && classGradeOrTopicId.includes("__") && !subject) {
    const parts = classGradeOrTopicId.split("__");
    classGrade = parts[0] || "";
    subject = parts[1] || "";
    chapterNo = parseInt((parts[2] || "").replace("ch", ""), 10) || 1;
    topicName = parts.slice(3).join("__");
  }

  const normType = String(testType || "topic").toLowerCase();

  // 1. Dedicated Subject Test
  if (normType === "subject") {
    const subjTest = getSubjectPracticeTestSync(classGrade, subject || "");
    if (subjTest && Array.isArray(subjTest.questions) && subjTest.questions.length > 0) {
      let list = subjTest.questions;
      if (options?.publishedOnly) {
        list = list.filter((q) => q.published !== false);
      }
      return list;
    }
    return null;
  }

  // 2. Chapter Test (Dedicated Chapter Test preferred, fallback to aggregated topic questions)
  if (normType === "chapter" || normType === "full_chapter") {
    const chTest = getChapterPracticeTestSync(classGrade, subject || "", chapterNo || 1);
    if (chTest && Array.isArray(chTest.questions) && chTest.questions.length > 0) {
      let list = chTest.questions;
      if (options?.publishedOnly) {
        list = list.filter((q) => q.published !== false);
      }
      return list;
    }

    const questions = getFullChapterQuestionsSync(classGrade, subject || "", chapterNo || 1, options);
    if (questions && questions.length > 0) {
      let list = questions;
      if (options?.publishedOnly) {
        list = list.filter((q) => q.published !== false);
      }
      return list;
    }
    return null;
  }

  // Topic practice test
  const testId = buildTopicTestId(classGrade, subject || "", chapterNo || 1, topicName || "");
  const cachedFromMap = memoryQuestionsCache.get(testId);
  if (cachedFromMap && cachedFromMap.length > 0) {
    let list = cachedFromMap;
    if (options?.publishedOnly) {
      list = list.filter((q) => q.published !== false);
    }
    return list;
  }

  const topicTest = getTopicPracticeTestSync(
    classGrade,
    subject || "",
    chapterNo || 1,
    topicName || "",
    options
  );

  if (topicTest && Array.isArray(topicTest.questions) && topicTest.questions.length > 0) {
    let list = topicTest.questions;
    if (options?.publishedOnly) {
      list = list.filter((q) => q.published !== false);
    }
    memoryQuestionsCache.set(testId, list);
    preloadQuestionImages(list);
    return list;
  }

  return null;
}

/**
 * Fetches all topic practice tests directly from Firestore (single source of truth)
 * and populates the local test bank.
 */
let activeFetchPromise: Promise<Record<string, TopicPracticeTest>> | null = null;

export async function fetchAllPracticeTests(): Promise<Record<string, TopicPracticeTest>> {
  if (activeFetchPromise) {
    return activeFetchPromise;
  }

  activeFetchPromise = (async () => {
    try {
      // 1. Primary Source of Truth: Firestore topic_practice_tests collection (and practice_tests alias)
      const db = await getFirebaseDb();
      if (db) {
        const testsColRef = collection(db, "topic_practice_tests");
        const snap = await getDocs(testsColRef);
        const firestoreBank: Record<string, TopicPracticeTest> = {};
        snap.docs.forEach((docSnap) => {
          const test = docSnap.data() as TopicPracticeTest;
          if (test) {
            const testId = test.id || docSnap.id;
            firestoreBank[testId] = { ...test, id: testId };
          }
        });

        // Also query alias collection if topic_practice_tests was empty
        if (Object.keys(firestoreBank).length === 0) {
          try {
            const aliasColRef = collection(db, "practice_tests");
            const aliasSnap = await getDocs(aliasColRef);
            aliasSnap.docs.forEach((docSnap) => {
              const test = docSnap.data() as TopicPracticeTest;
              if (test) {
                const testId = test.id || docSnap.id;
                firestoreBank[testId] = { ...test, id: testId };
              }
            });
          } catch {}
        }

        if (Object.keys(firestoreBank).length > 0) {
          // Authoritative Firestore data replaces memory bank (preventing zombie deleted tests)
          memoryTestBank = { ...firestoreBank };
          saveLocalTestBank(memoryTestBank, { silent: true });
          notifyTestBankSubscribers();
          
          // Non-destructive backup to secondary storage
          syncTestBankToStorage(memoryTestBank).catch(() => {});
          return memoryTestBank;
        } else if (snap.empty) {
          // If Firestore collection returned 0 docs, empty the memory bank
          memoryTestBank = {};
          saveLocalTestBank(memoryTestBank, { silent: true });
          notifyTestBankSubscribers();
          return memoryTestBank;
        }
      }
    } catch (err) {
      console.warn("[PracticeTestService] Error fetching tests from Firestore topic_practice_tests:", err);
    }

    // 2. Secondary fallback and self-heal if Firestore was empty or offline
    try {
      const storageBank = await fetchTestBankFromStorage();
      if (storageBank && typeof storageBank === "object" && Object.keys(storageBank).length > 0) {
        memoryTestBank = { ...storageBank, ...memoryTestBank };
        saveLocalTestBank(memoryTestBank, { silent: true });
        notifyTestBankSubscribers();

        // Self-heal: restore tests to Firestore if accessible
        try {
          const db = await getFirebaseDb();
          if (db) {
            for (const [testId, testDocData] of Object.entries(storageBank)) {
              if (testDocData && Array.isArray(testDocData.questions) && testDocData.questions.length > 0) {
                const docRef = doc(db, "topic_practice_tests", testId);
                await setDoc(docRef, testDocData, { merge: true }).catch(() => {});
              }
            }
          }
        } catch (healErr) {
          console.warn("[PracticeTestService] Firestore self-heal restore warning:", healErr);
        }

        return memoryTestBank;
      }
    } catch (err) {
      console.warn("[PracticeTestService] Error fetching tests bank from fallback storage:", err);
    } finally {
      activeFetchPromise = null;
    }

    return memoryTestBank;
  })();

  return activeFetchPromise;
}

export async function getTopicPracticeTest(
  classGrade: string,
  subject: string,
  chapterNo: number,
  topicName: string,
  options?: { publishedOnly?: boolean; forceFresh?: boolean }
): Promise<TopicPracticeTest | null> {
  const testId = buildTopicTestId(classGrade, subject, chapterNo, topicName);
  
  if (!options?.forceFresh && memoryTestBank[testId]) {
    const cached = memoryTestBank[testId];
    if (Array.isArray(cached.questions)) {
      preloadQuestionImages(cached.questions);
    }
    return cached;
  }

  // Request deduplication for single test fetch
  if (inFlightTestFetches.has(testId)) {
    return inFlightTestFetches.get(testId)!;
  }

  const fetchPromise = (async () => {
    let test: TopicPracticeTest | null = null;

    // Direct single-document Firestore fetch if not in memory or forceFresh requested
    try {
      const db = await getFirebaseDb();
      if (db) {
        const testDocRef = doc(db, "topic_practice_tests", testId);
        let docSnap = await getDoc(testDocRef);
        if (!docSnap.exists()) {
          const aliasDocRef = doc(db, "practice_tests", testId);
          docSnap = await getDoc(aliasDocRef);
        }
        if (docSnap.exists()) {
          const data = docSnap.data() as TopicPracticeTest;
          if (data) {
            test = { ...data, id: testId };
            memoryTestBank[testId] = test;
            notifyTestBankSubscribers();
          }
        }
      }
    } catch (err) {
      console.warn("[PracticeTestService] Error fetching single test doc from Firestore:", err);
    }

    if (!test) {
      const bank = await fetchAllPracticeTests();
      test = bank[testId] || null;

      if (!test) {
        const allTests = Object.values(bank);
        test =
          allTests.find((t) =>
            isExactTopicMatch(
              classGrade,
              subject,
              chapterNo,
              topicName,
              t.classGrade,
              t.subject,
              t.chapterNo,
              t.topicName
            )
          ) || null;
      }
    }

    if (!test) return null;

    if (Array.isArray(test.questions)) {
      test.questions = await resolveQuestionImageUrls(test.questions);
      memoryQuestionsCache.set(test.id, test.questions);
      preloadQuestionImages(test.questions);
    }

    return test;
  })();

  inFlightTestFetches.set(testId, fetchPromise);
  try {
    const result = await fetchPromise;
    return result;
  } finally {
    inFlightTestFetches.delete(testId);
  }
}

export function getTopicPracticeTestSync(
  classGrade: string,
  subject: string,
  chapterNo: number,
  topicName: string,
  _options?: { publishedOnly?: boolean }
): TopicPracticeTest | null {
  const testId = buildTopicTestId(classGrade, subject, chapterNo, topicName);
  let test = memoryTestBank[testId] || null;

  if (!test) {
    const allBankTests = Object.values(memoryTestBank);
    test =
      allBankTests.find((t) =>
        isExactTopicMatch(
          classGrade,
          subject,
          chapterNo,
          topicName,
          t.classGrade,
          t.subject,
          t.chapterNo,
          t.topicName
        )
      ) || null;
  }

  if (test && Array.isArray(test.questions)) {
    preloadQuestionImages(test.questions);
  }

  return test;
}

export function getChapterPracticeTestSync(
  classGrade: string,
  subject: string,
  chapterNo: number
): TopicPracticeTest | null {
  const testId = buildChapterTestId(classGrade, subject, chapterNo);
  let test = memoryTestBank[testId] || null;

  if (!test) {
    const allBankTests = Object.values(memoryTestBank);
    const normClass = String(classGrade || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const ch = Number(chapterNo) || 1;
    test = allBankTests.find((t) => {
      const tType = String(t.testType || t.test_type || "").toUpperCase();
      if (tType !== "CHAPTER" && tType !== "FULL_CHAPTER" && !t.id?.endsWith("__chapter_test")) return false;
      const tCh = Number(t.chapterNo) || 1;
      if (tCh !== ch) return false;
      if (!isSubjectCompatible(subject, t.subject)) return false;
      const tClass = String(t.classGrade || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      return !normClass || !tClass || normClass === tClass || normClass.includes(tClass) || tClass.includes(normClass);
    }) || null;
  }

  if (test && Array.isArray(test.questions)) {
    preloadQuestionImages(test.questions);
  }

  return test;
}

export function getSubjectPracticeTestSync(
  classGrade: string,
  subject: string
): TopicPracticeTest | null {
  const testId = buildSubjectTestId(classGrade, subject);
  let test = memoryTestBank[testId] || null;

  if (!test) {
    const allBankTests = Object.values(memoryTestBank);
    const normClass = String(classGrade || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    test = allBankTests.find((t) => {
      const tType = String(t.testType || t.test_type || "").toUpperCase();
      if (tType !== "SUBJECT" && !t.id?.endsWith("__subject_test")) return false;
      if (!isSubjectCompatible(subject, t.subject)) return false;
      const tClass = String(t.classGrade || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      return !normClass || !tClass || normClass === tClass || normClass.includes(tClass) || tClass.includes(normClass);
    }) || null;
  }

  if (test && Array.isArray(test.questions)) {
    preloadQuestionImages(test.questions);
  }

  return test;
}

export function getAssessmentPracticeTestSync(
  classGrade: string,
  subject: string,
  chapterNo: number,
  topicName: string,
  testType: AssessmentTestType = "TOPIC"
): TopicPracticeTest | null {
  const tType = String(testType || "TOPIC").toUpperCase();
  if (tType === "SUBJECT") {
    return getSubjectPracticeTestSync(classGrade, subject);
  }
  if (tType === "CHAPTER" || tType === "FULL_CHAPTER") {
    return getChapterPracticeTestSync(classGrade, subject, chapterNo);
  }
  return getTopicPracticeTestSync(classGrade, subject, chapterNo, topicName);
}

export async function getChapterPracticeTest(
  classGrade: string,
  subject: string,
  chapterNo: number,
  options?: { publishedOnly?: boolean; forceFresh?: boolean }
): Promise<TopicPracticeTest | null> {
  if (!options?.forceFresh) {
    const sync = getChapterPracticeTestSync(classGrade, subject, chapterNo);
    if (sync) return sync;
  }
  await fetchAllPracticeTests();
  return getChapterPracticeTestSync(classGrade, subject, chapterNo);
}

export async function getSubjectPracticeTest(
  classGrade: string,
  subject: string,
  options?: { publishedOnly?: boolean; forceFresh?: boolean }
): Promise<TopicPracticeTest | null> {
  if (!options?.forceFresh) {
    const sync = getSubjectPracticeTestSync(classGrade, subject);
    if (sync) return sync;
  }
  await fetchAllPracticeTests();
  return getSubjectPracticeTestSync(classGrade, subject);
}

export async function getAssessmentPracticeTest(
  classGrade: string,
  subject: string,
  chapterNo: number,
  topicName: string,
  testType: AssessmentTestType = "TOPIC",
  options?: { publishedOnly?: boolean; forceFresh?: boolean }
): Promise<TopicPracticeTest | null> {
  const tType = String(testType || "TOPIC").toUpperCase();
  if (tType === "SUBJECT") {
    return getSubjectPracticeTest(classGrade, subject, options);
  }
  if (tType === "CHAPTER" || tType === "FULL_CHAPTER") {
    return getChapterPracticeTest(classGrade, subject, chapterNo, options);
  }
  return getTopicPracticeTest(classGrade, subject, chapterNo, topicName, options);
}

export async function getFullChapterQuestions(
  classGrade: string,
  subject: string,
  chapterNo: number,
  options: { publishedOnly?: boolean } = { publishedOnly: true }
): Promise<ParsedAssessmentQuestion[]> {
  const bank = Object.keys(memoryTestBank).length > 0 ? memoryTestBank : await fetchAllPracticeTests();
  const aggregated: ParsedAssessmentQuestion[] = [];
  const normClass = (classGrade || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const cleanNormClass = normClass.replace(/class/g, "");
  const normSubj = (subject || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  Object.values(bank).forEach((test) => {
    const tCh = typeof test.chapterNo === "number" ? test.chapterNo : (parseInt(String(test.chapterNo || "").replace(/\D/g, ""), 10) || Number(test.chapterNo) || 0);
    if (tCh > 0 && tCh !== Number(chapterNo)) return;

    const tSubj = (test.subject || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const subjMatch =
      !normSubj ||
      !tSubj ||
      normSubj === tSubj ||
      normSubj.includes(tSubj) ||
      tSubj.includes(normSubj) ||
      isSubjectCompatible(subject, test.subject);
    if (!subjMatch) return;

    const tClass = (test.classGrade || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const cleanTClass = tClass.replace(/class/g, "");
    const classMatch =
      !normClass ||
      !tClass ||
      normClass === tClass ||
      cleanNormClass === cleanTClass ||
      normClass.includes(tClass) ||
      tClass.includes(normClass);
    if (!classMatch) return;

    if (Array.isArray(test.questions)) {
      test.questions.forEach((q) => {
        if (!options.publishedOnly || q.published !== false) {
          aggregated.push(q);
        }
      });
    }
  });

  const resolved = await resolveQuestionImageUrls(aggregated);
  preloadQuestionImages(resolved);
  return resolved;
}

export function getFullChapterQuestionsSync(
  classGrade: string,
  subject: string,
  chapterNo: number,
  _options: { publishedOnly?: boolean } = { publishedOnly: true }
): ParsedAssessmentQuestion[] {
  const bank = getLocalTestBank();
  const aggregated: ParsedAssessmentQuestion[] = [];
  const normClass = (classGrade || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const cleanNormClass = normClass.replace(/class/g, "");
  const normSubj = (subject || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  Object.values(bank).forEach((test) => {
    const tCh = typeof test.chapterNo === "number" ? test.chapterNo : (parseInt(String(test.chapterNo || "").replace(/\D/g, ""), 10) || Number(test.chapterNo) || 0);
    if (tCh > 0 && tCh !== Number(chapterNo)) return;

    const tSubj = (test.subject || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const subjMatch =
      !normSubj ||
      !tSubj ||
      normSubj === tSubj ||
      normSubj.includes(tSubj) ||
      tSubj.includes(normSubj) ||
      isSubjectCompatible(subject, test.subject);
    if (!subjMatch) return;

    const tClass = (test.classGrade || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const cleanTClass = tClass.replace(/class/g, "");
    const classMatch =
      !normClass ||
      !tClass ||
      normClass === tClass ||
      cleanNormClass === cleanTClass ||
      normClass.includes(tClass) ||
      tClass.includes(normClass);
    if (!classMatch) return;

    if (Array.isArray(test.questions)) {
      test.questions.forEach((q) => {
        aggregated.push(q);
      });
    }
  });

  return aggregated;
}

export async function fetchQuestions(
  classGradeOrTopicId: string,
  subject?: string,
  chapterNo?: number,
  topicName?: string,
  testType: AssessmentTestType = "topic",
  options?: { publishedOnly?: boolean }
): Promise<ParsedAssessmentQuestion[]> {
  // First check synchronous in-memory cache
  const cachedSync = getQuestionsSync(classGradeOrTopicId, subject, chapterNo, topicName, testType, options);
  if (cachedSync && cachedSync.length > 0) {
    return cachedSync;
  }

  let classGrade = classGradeOrTopicId;
  if (classGradeOrTopicId && classGradeOrTopicId.includes("__") && !subject) {
    const parts = classGradeOrTopicId.split("__");
    classGrade = parts[0] || "";
    subject = parts[1] || "";
    chapterNo = parseInt((parts[2] || "").replace("ch", ""), 10) || 1;
    topicName = parts.slice(3).join("__");
  }

  const normType = String(testType || "topic").toLowerCase();

  if (normType === "subject") {
    const subjTest = await getSubjectPracticeTest(classGrade, subject || "", options);
    let list = subjTest?.questions || [];
    if (options?.publishedOnly) {
      list = list.filter((q) => q.published !== false);
    }
    return list;
  }

  if (normType === "chapter" || normType === "full_chapter") {
    const chTest = await getChapterPracticeTest(classGrade, subject || "", chapterNo || 1, options);
    if (chTest && Array.isArray(chTest.questions) && chTest.questions.length > 0) {
      let list = chTest.questions;
      if (options?.publishedOnly) {
        list = list.filter((q) => q.published !== false);
      }
      return list;
    }
    return await getFullChapterQuestions(classGrade, subject || "", chapterNo || 1, options);
  }

  const topicTest = await getTopicPracticeTest(
    classGrade,
    subject || "",
    chapterNo || 1,
    topicName || "",
    options
  );

  let list = topicTest?.questions || [];
  if (options?.publishedOnly) {
    list = list.filter((q) => q.published !== false);
  }

  const testId = buildTopicTestId(classGrade, subject || "", chapterNo || 1, topicName || "");
  memoryQuestionsCache.set(testId, list);
  preloadQuestionImages(list);

  return list;
}

/**
 * Recursively removes undefined fields and cleans properties for safe Firestore persistence.
 * Guarantees that zero undefined values are sent to Firestore.
 */
export function sanitizeFirestoreData<T>(data: T): T {
  if (data === null || data === undefined) {
    return null as unknown as T;
  }

  // Preserve Date instances
  if (data instanceof Date) {
    return data;
  }

  // Preserve Firestore Timestamp, DocumentReference, GeoPoint, FieldValue objects
  if (
    typeof data === "object" &&
    data !== null &&
    (
      (data as any)._methodName ||
      typeof (data as any).toDate === "function" ||
      (data as any).firestore ||
      typeof (data as any).isEqual === "function" ||
      (data as any).constructor?.name === "Timestamp" ||
      (data as any).constructor?.name === "DocumentReference" ||
      (data as any).constructor?.name === "GeoPoint" ||
      (data as any).constructor?.name === "FieldValue"
    )
  ) {
    return data;
  }

  // Arrays: recursively sanitize elements, filtering out undefined
  if (Array.isArray(data)) {
    return data
      .filter((item) => item !== undefined)
      .map((item) => sanitizeFirestoreData(item)) as unknown as T;
  }

  // Objects: recursively sanitize entries, completely omitting undefined keys
  if (typeof data === "object" && data !== null) {
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        sanitized[key] = sanitizeFirestoreData(value);
      }
    }
    return sanitized as T;
  }

  // Primitives
  return data;
}

/**
 * Validates all required fields of a TopicPracticeTest document prior to Firestore persistence.
 */
export function validatePracticeTestDocument(docData: TopicPracticeTest): { valid: boolean; error?: string } {
  if (!docData.id || typeof docData.id !== "string" || !docData.id.trim()) {
    return { valid: false, error: "Missing required field: id" };
  }
  if (!docData.classGrade || typeof docData.classGrade !== "string" || !docData.classGrade.trim()) {
    return { valid: false, error: "Missing required field: classGrade" };
  }
  if (!docData.subject || typeof docData.subject !== "string" || !docData.subject.trim()) {
    return { valid: false, error: "Missing required field: subject" };
  }
  const normType = String(docData.testType || docData.test_type || "TOPIC").toUpperCase();
  if (normType !== "SUBJECT") {
    if (docData.chapterNo === undefined || docData.chapterNo === null || isNaN(Number(docData.chapterNo))) {
      return { valid: false, error: "Missing required field: chapterNo" };
    }
    if (!docData.chapterName || typeof docData.chapterName !== "string" || !docData.chapterName.trim()) {
      return { valid: false, error: "Missing required field: chapterName" };
    }
  }
  if (normType === "TOPIC") {
    if (!docData.topicName || typeof docData.topicName !== "string" || !docData.topicName.trim()) {
      return { valid: false, error: "Missing required field: topicName" };
    }
  }
  if (!Array.isArray(docData.questions) || docData.questions.length === 0) {
    return { valid: false, error: "Missing required field: questions (questions array is empty)" };
  }
  if (typeof docData.questionCount !== "number" || docData.questionCount <= 0 || docData.questionCount !== docData.questions.length) {
    return { valid: false, error: `Invalid questionCount: expected ${docData.questions.length}, received ${docData.questionCount}` };
  }
  if (docData.rawText === undefined || docData.rawText === null) {
    return { valid: false, error: "Missing required field: rawText" };
  }
  if (docData.hasTest !== true && docData.hasPracticeTest !== true) {
    return { valid: false, error: "Missing required field: hasTest / hasPracticeTest must be true" };
  }
  if (!docData.createdAt || typeof docData.createdAt !== "string") {
    return { valid: false, error: "Missing required field: createdAt" };
  }
  if (!docData.updatedAt || typeof docData.updatedAt !== "string") {
    return { valid: false, error: "Missing required field: updatedAt" };
  }
  return { valid: true };
}

/**
 * Creates and formats a sanitized single question object for Practice Test storage.
 */
export function createPracticeTestQuestion(
  q: Partial<ParsedAssessmentQuestion>,
  context: {
    classGrade: string;
    subject: string;
    chapterNo: number;
    chapterName: string;
    topicName: string;
    rawText: string;
  },
  idx: number
): ParsedAssessmentQuestion {
  const qId = q.id && String(q.id).trim() !== ""
    ? String(q.id).trim()
    : typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `q_${Date.now()}_${idx + 1}_${Math.random().toString(36).substring(2, 7)}`;

  const cleanOptions = Array.isArray(q.options)
    ? q.options.filter((o) => typeof o === "string" && o.trim() !== "").map((o) => o.trim())
    : [];

  // Normalize and preserve exact question type; never default to comprehension
  let resolvedType: AssessmentQuestionType = "unknown";
  if (q.type) {
    const rawT = String(q.type).toLowerCase();
    if (rawT === "mcq") resolvedType = "mcq";
    else if (rawT === "assertion_reason" || rawT === "assertion_reasoning") resolvedType = "assertion_reason";
    else if (rawT === "true_false") resolvedType = "true_false";
    else if (rawT === "very_short_answer") resolvedType = "very_short_answer";
    else if (rawT === "short_answer") resolvedType = "short_answer";
    else if (rawT === "long_answer") resolvedType = "long_answer";
    else if (rawT === "case_based") resolvedType = "case_based";
    else if (rawT === "comprehension") resolvedType = "comprehension";
    else if (rawT === "msq" || rawT === "multiple_select") resolvedType = "multiple_select";
    else if (rawT === "fill_blank") resolvedType = "fill_blank";
    else if (rawT === "match_following") resolvedType = "match_following";
    else resolvedType = "unknown";
  } else if (cleanOptions.length > 0) {
    resolvedType = "mcq";
  }

  const parsedMarks = q.marks !== undefined && q.marks !== null && !isNaN(Number(q.marks)) ? Number(q.marks) : 1;

  return {
    id: qId,
    classGrade: String(context.classGrade || "").trim(),
    subject: String(context.subject || "").trim(),
    chapterNo: Number(context.chapterNo) || 1,
    chapterName: String(context.chapterName || `Chapter ${context.chapterNo || 1}`).trim(),
    topicName: String(context.topicName || "").trim(),
    type: resolvedType,
    question: String(q.question || "").trim(),
    options: cleanOptions,
    parsedOptions: Array.isArray(q.parsedOptions) ? q.parsedOptions : undefined,
    correctAnswer: String(q.correctAnswer ?? "").trim(),
    modelAnswer: typeof q.modelAnswer === "string" ? q.modelAnswer.trim() : undefined,
    isSubjective: q.isSubjective === true || resolvedType === "very_short_answer" || resolvedType === "short_answer" || resolvedType === "long_answer",
    keyPoints: Array.isArray(q.keyPoints) ? q.keyPoints : undefined,
    rubric: typeof q.rubric === "string" ? q.rubric.trim() : undefined,
    assertion: typeof q.assertion === "string" ? q.assertion.trim() : (typeof q.assertionText === "string" ? q.assertionText.trim() : undefined),
    reason: typeof q.reason === "string" ? q.reason.trim() : (typeof q.reasonText === "string" ? q.reasonText.trim() : undefined),
    assertionText: typeof q.assertionText === "string" ? q.assertionText.trim() : (typeof q.assertion === "string" ? q.assertion.trim() : undefined),
    reasonText: typeof q.reasonText === "string" ? q.reasonText.trim() : (typeof q.reason === "string" ? q.reason.trim() : undefined),
    explanation: typeof q.explanation === "string" ? q.explanation.trim() : "",
    imageUrl: typeof q.imageUrl === "string" ? q.imageUrl.trim() : "",
    imageLabel: typeof q.imageLabel === "string" ? q.imageLabel.trim() : "",
    imagePosition: q.imagePosition === "above" || q.imagePosition === "below" ? q.imagePosition : "below",
    sectionId: q.sectionId ? String(q.sectionId).trim() : undefined,
    sectionTitle: q.sectionTitle ? String(q.sectionTitle).trim() : undefined,
    sectionType: q.sectionType ? String(q.sectionType).trim() : undefined,
    section: q.section ? String(q.section).trim() : undefined,
    displayNumber: q.displayNumber ? String(q.displayNumber).trim() : undefined,
    declaredSectionMarks: q.declaredSectionMarks !== undefined ? Number(q.declaredSectionMarks) : undefined,
    calculatedSectionMarks: q.calculatedSectionMarks !== undefined ? Number(q.calculatedSectionMarks) : undefined,
    groupId: q.groupId ? String(q.groupId).trim() : undefined,
    groupType: q.groupType ? String(q.groupType).trim() : undefined,
    groupTitle: q.groupTitle ? String(q.groupTitle).trim() : undefined,
    passageId: q.passageId ? String(q.passageId).trim() : undefined,
    parentPassageId: q.passageId ? String(q.passageId).trim() : (q.parentPassageId ? String(q.parentPassageId).trim() : undefined),
    caseId: q.caseId ? String(q.caseId).trim() : undefined,
    parentCaseId: q.caseId ? String(q.caseId).trim() : (q.parentCaseId ? String(q.parentCaseId).trim() : undefined),
    marks: parsedMarks,
    negativeMarks: q.negativeMarks !== undefined && q.negativeMarks !== null && !isNaN(Number(q.negativeMarks)) ? Number(q.negativeMarks) : undefined,
    marksSource: q.marksSource ? String(q.marksSource) : undefined,
    marksConfidence: q.marksConfidence !== undefined ? Number(q.marksConfidence) : undefined,
    marksPending: q.marksPending === true,
    rawText: String(q.rawText || context.rawText || "").trim(),
    published: q.published !== false,
    orderIndex: Number(q.orderIndex) || idx + 1,
    createdAt: q.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Returns any comprehension passages associated with a topic practice test synchronously from cache.
 */
export function getPassagesForTopicSync(
  classGrade: string,
  subject: string,
  chapterNo: number,
  topicName: string
): Record<string, ComprehensionPassage> {
  const test = getTopicPracticeTestSync(classGrade, subject, chapterNo, topicName);
  return test?.passages || {};
}

export async function saveTopicPracticeTest(
  context: {
    classGrade: string;
    subject: string;
    chapterNo: number;
    chapterName: string;
    topicName: string;
    rawText: string;
    noteId?: string;
    topicNoteId?: string;
    testType?: AssessmentTestType;
    title?: string;
    totalMarks?: number;
    passingMarks?: number;
    durationMinutes?: number;
    instructions?: string;
    maxAttempts?: number;
    passages?: Record<string, ComprehensionPassage>;
    cases?: Record<string, CaseStudy>;
    groups?: Record<string, { id: string; type: string; title: string; content?: string; text?: string; marks?: number }>;
    sections?: Array<{
      id: string;
      sectionLetter?: string;
      title: string;
      sectionType: string;
      declaredMarks?: number;
      calculatedMarks?: number;
      instructions?: string[];
    }>;
    declaredTotalMarks?: number;
    calculatedTotalMarks?: number;
  },
  questions: ParsedAssessmentQuestion[]
): Promise<SaveTopicResult> {
  if (!questions || questions.length === 0) {
    return {
      success: false,
      count: 0,
      message: "Cannot save empty practice test. Please enter valid questions.",
      error: "No valid questions found.",
    };
  }

  const rawTestType = String(context.testType || "TOPIC").toUpperCase();
  const testType: AssessmentTestType = (rawTestType === "SUBJECT" ? "SUBJECT" : rawTestType === "CHAPTER" || rawTestType === "FULL_CHAPTER" ? "CHAPTER" : "TOPIC");

  const assessmentTestId = buildAssessmentTestId(
    context.classGrade,
    context.subject,
    context.chapterNo,
    context.topicName,
    testType
  );

  const fallbackTitle = testType === "SUBJECT"
    ? `${context.subject} Subject Test`
    : testType === "CHAPTER"
      ? `${context.chapterName || `Chapter ${context.chapterNo}`} Chapter Test`
      : context.topicName;

  const canonicalNoteId = String(context.noteId || context.topicNoteId || assessmentTestId).trim();
  const canonicalTopicNoteId = String(context.topicNoteId || context.noteId || assessmentTestId).trim();

  // Clear previous attempts for topic if topic test
  if (testType === "TOPIC") {
    await deleteTopicAttemptsFromPersistence(
      context.classGrade,
      context.subject,
      context.chapterNo,
      context.topicName
    ).catch(() => {});
  }

  const formattedQuestions: ParsedAssessmentQuestion[] = questions.map((q, idx) => {
    return createPracticeTestQuestion(q, context, idx);
  });

  const sumOfQuestionMarks = formattedQuestions.reduce((sum, q) => sum + (q.marks ?? 1), 0);
  const effectiveTotalMarks = context.totalMarks !== undefined && context.totalMarks !== null && !isNaN(Number(context.totalMarks)) && Number(context.totalMarks) > 0
    ? Number(context.totalMarks)
    : (context.declaredTotalMarks && context.declaredTotalMarks > 0 ? context.declaredTotalMarks : sumOfQuestionMarks);

  const topicTest: TopicPracticeTest = {
    id: assessmentTestId,
    testId: assessmentTestId,
    noteId: canonicalNoteId,
    topicNoteId: canonicalTopicNoteId,
    hasTest: true,
    hasPracticeTest: true,
    testType: testType,
    test_type: testType,
    title: context.title ? String(context.title).trim() : fallbackTitle,
    totalMarks: effectiveTotalMarks,
    passingMarks: context.passingMarks !== undefined && context.passingMarks !== null && !isNaN(Number(context.passingMarks)) ? Number(context.passingMarks) : undefined,
    durationMinutes: context.durationMinutes !== undefined && context.durationMinutes !== null && !isNaN(Number(context.durationMinutes)) ? Number(context.durationMinutes) : undefined,
    duration_minutes: context.durationMinutes !== undefined && context.durationMinutes !== null && !isNaN(Number(context.durationMinutes)) ? Number(context.durationMinutes) : undefined,
    instructions: context.instructions ? String(context.instructions).trim() : undefined,
    maxAttempts: context.maxAttempts !== undefined && context.maxAttempts !== null && !isNaN(Number(context.maxAttempts)) ? Number(context.maxAttempts) : undefined,
    classGrade: String(context.classGrade || "").trim(),
    subject: String(context.subject || "").trim(),
    chapterNo: Number(context.chapterNo) || 0,
    chapterName: String(context.chapterName || (testType === "SUBJECT" ? "All Chapters" : `Chapter ${context.chapterNo || 1}`)).trim(),
    topicName: String(context.topicName || fallbackTitle).trim(),
    rawText: String(context.rawText || "").trim(),
    questions: formattedQuestions,
    questionCount: formattedQuestions.length,
    passages: context.passages && Object.keys(context.passages).length > 0 ? context.passages : undefined,
    cases: context.cases && Object.keys(context.cases).length > 0 ? context.cases : undefined,
    groups: context.groups && Object.keys(context.groups).length > 0 ? context.groups : undefined,
    sections: context.sections && context.sections.length > 0 ? context.sections : undefined,
    declaredTotalMarks: context.declaredTotalMarks !== undefined ? Number(context.declaredTotalMarks) : undefined,
    calculatedTotalMarks: sumOfQuestionMarks,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    uploadedBy: "Admin",
  };

  // Step 4: Validate required fields before proceeding to write
  const validationResult = validatePracticeTestDocument(topicTest);
  if (!validationResult.valid) {
    console.error("[PracticeTestService] Validation failed before Firestore save:", validationResult.error);
    return {
      success: false,
      count: 0,
      message: "Practice Test validation failed.",
      error: validationResult.error || "Document failed required field validation."
    };
  }

  // Step 3: Sanitize data - recursively remove all undefined properties
  const sanitizedTopicTest = sanitizeFirestoreData(topicTest);

  // Step 2: Log complete sanitized document before Firestore write
  console.log(
    "Practice Test Document",
    JSON.stringify(sanitizedTopicTest, null, 2)
  );

  updateLocalTopicCache(sanitizedTopicTest);
  clearAllQuestionCaches();
  notifyTestBankSubscribers();

  // Step 5 & 6: Write to Firestore topic_practice_tests & immediately verify persistence
  try {
    const db = await getFirebaseDb();
    if (!db) {
      throw new Error("Database connection is currently unavailable. Please check your network or Firebase configuration.");
    }

    const testDocRef = doc(db, "topic_practice_tests", assessmentTestId);
    const aliasDocRef = doc(db, "practice_tests", assessmentTestId);

    // Primary write to topic_practice_tests and mirror write to practice_tests
    await setDoc(testDocRef, sanitizedTopicTest, { merge: true });
    await setDoc(aliasDocRef, sanitizedTopicTest, { merge: true }).catch(() => {});

    // Step 6: Read back the document immediately to verify persistence
    const verifySnap = await getDoc(testDocRef);
    if (!verifySnap.exists()) {
      throw new Error(`Firestore persistence verification failed: Document ${assessmentTestId} was not found after save.`);
    }

    const savedData = verifySnap.data() as TopicPracticeTest;
    if (!savedData.questions || !Array.isArray(savedData.questions) || savedData.questions.length === 0) {
      throw new Error(`Firestore persistence verification failed: Questions array in ${assessmentTestId} is empty.`);
    }

    if (savedData.questionCount !== savedData.questions.length) {
      throw new Error(`Firestore persistence verification failed: questionCount (${savedData.questionCount}) does not match questions length (${savedData.questions.length}).`);
    }

    if (!savedData.hasTest && !savedData.hasPracticeTest) {
      throw new Error(`Firestore persistence verification failed: hasTest/hasPracticeTest flag is false in ${assessmentTestId}.`);
    }

    console.log(`[PracticeTestService] Firestore write verified successfully for ${assessmentTestId}: ${savedData.questions.length} questions.`);

    // Also mirror/link hasPracticeTest to class_notes & upsc_notes documents
    if (testType === "TOPIC") {
      try {
        const collectionsToCheck = ["class_notes", "upsc_notes"];
        for (const colName of collectionsToCheck) {
          const notesCol = collection(db, colName);
          const snap = await getDocs(notesCol);
          for (const docSnap of snap.docs) {
            const n = docSnap.data() as ClassNote;
            const nClass = (n as any).className || n.classGrade || "";
            const nSubj = (n as any).subjectName || n.subject || "";
            const nCh = (n as any).chapterNumber ?? n.chapterNo ?? 1;
            const nTopic = (n as any).topicTitle || (n as any).topicName || n.partLabel || "";
            if (isExactTopicMatch(context.classGrade, context.subject, context.chapterNo, context.topicName, nClass, nSubj, nCh, nTopic)) {
              await setDoc(docSnap.ref, { hasPracticeTest: true, hasTest: true, practiceTestId: assessmentTestId }, { merge: true }).catch(() => {});
            }
          }
        }
      } catch (linkErr) {
        console.warn("[PracticeTestService] Note link update notice:", linkErr);
      }
    }
  } catch (err: any) {
    console.error("[PracticeTestService] Direct Firestore write/verification failed:", err);
    return {
      success: false,
      count: 0,
      message: "Failed to persist Practice Test to database.",
      error: err?.message || "Firestore write or verification failed."
    };
  }

  // Sync to secondary R2 backup and send realtime broadcast
  await syncTestBankToStorage(getLocalTestBank()).catch(() => false);
  await notifyPracticeTestRealtimeSync({ testId: assessmentTestId, action: "save_assessment_test" });

  return {
    success: true,
    count: formattedQuestions.length,
    message: `Successfully saved test with ${formattedQuestions.length} questions.`
  };
}

export const saveAssessmentPracticeTest = saveTopicPracticeTest;

export interface DeleteTestTarget {
  id?: string;
  testId?: string;
  classGrade?: string;
  subject?: string;
  chapterNo?: number;
  chapterName?: string;
  topicName?: string;
  testType?: AssessmentTestType | string;
  computedType?: string;
  title?: string;
}

/**
 * Robust, unified deletion for any practice test (Subject, Chapter, PYQ, Topic).
 * Performs safe, targeted deletion across Firestore, local caches, and secondary backups.
 */
export async function deletePracticeTest(
  target: DeleteTestTarget | string,
  maybeSubject?: string,
  maybeChapterNo?: number,
  maybeTopicName?: string,
  maybeType?: string
): Promise<{ success: boolean; message: string; error?: string }> {
  // 1. Normalize target input parameters
  let testObj: DeleteTestTarget = {};
  if (typeof target === "object" && target !== null) {
    testObj = { ...target };
  } else if (typeof target === "string") {
    if (maybeSubject) {
      testObj = {
        classGrade: target,
        subject: maybeSubject,
        chapterNo: maybeChapterNo,
        topicName: maybeTopicName,
        testType: maybeType as any,
        computedType: maybeType,
      };
    } else {
      testObj = { id: target, testId: target };
    }
  }

  const primaryId = testObj.id || testObj.testId || "";
  const classGrade = (testObj.classGrade || "").trim();
  const subject = (testObj.subject || "").trim();
  const chapterNo = Number(testObj.chapterNo) || 0;
  const chapterName = (testObj.chapterName || "").trim();
  const topicName = (testObj.topicName || "").trim();
  const rawType = String(testObj.computedType || testObj.testType || "").toUpperCase();

  // 2. Identify all possible candidate document IDs for this specific test
  const candidateIds = new Set<string>();
  if (primaryId) {
    candidateIds.add(primaryId);
  }

  if (classGrade && subject) {
    if (rawType) {
      candidateIds.add(buildAssessmentTestId(classGrade, subject, chapterNo, topicName, rawType as any));
    }
    candidateIds.add(buildSubjectTestId(classGrade, subject));
    candidateIds.add(buildTopicTestId(classGrade, subject, 0, `__subject_${subject}_test__`));

    if (chapterNo > 0) {
      candidateIds.add(buildChapterTestId(classGrade, subject, chapterNo));
      candidateIds.add(buildTopicTestId(classGrade, subject, chapterNo, `__chapter_${chapterNo}_test__`));
    }

    if (topicName) {
      candidateIds.add(buildTopicTestId(classGrade, subject, chapterNo, topicName));
      candidateIds.add(buildPyqTestId(classGrade, subject, topicName));
    }
  }

  // 3. Scan the local bank to find any matching keys and associate their IDs
  const bank = getLocalTestBank();
  const keysToRemove: string[] = [];

  Object.entries(bank).forEach(([key, t]) => {
    if (!t) return;
    if (
      candidateIds.has(key) ||
      (t.id && candidateIds.has(t.id)) ||
      ((t as any).testId && candidateIds.has((t as any).testId))
    ) {
      keysToRemove.push(key);
      candidateIds.add(key);
      if (t.id) candidateIds.add(t.id);
      if ((t as any).testId) candidateIds.add((t as any).testId);
      return;
    }

    if (classGrade && subject) {
      const matchClass = (t.classGrade || "").toLowerCase().trim() === classGrade.toLowerCase();
      const matchSubj = (t.subject || "").toLowerCase().trim() === subject.toLowerCase();

      if (matchClass && matchSubj) {
        const tType = String((t as any).computedType || t.testType || (t as any).test_type || "").toUpperCase();

        if (rawType === "SUBJECT" && (tType === "SUBJECT" || Number(t.chapterNo) === 0)) {
          keysToRemove.push(key);
          candidateIds.add(key);
          if (t.id) candidateIds.add(t.id);
        } else if (
          rawType === "CHAPTER" &&
          Number(t.chapterNo) === chapterNo &&
          (tType === "CHAPTER" || tType === "FULL_CHAPTER" || (t.topicName || "").toLowerCase().includes("chapter test"))
        ) {
          keysToRemove.push(key);
          candidateIds.add(key);
          if (t.id) candidateIds.add(t.id);
        } else if (
          rawType === "PYQ" &&
          (tType === "PYQ" || (t.topicName || "").toLowerCase().includes("pyq")) &&
          (t.topicName || "").toLowerCase().trim() === topicName.toLowerCase()
        ) {
          keysToRemove.push(key);
          candidateIds.add(key);
          if (t.id) candidateIds.add(t.id);
        } else if (
          topicName &&
          Number(t.chapterNo) === chapterNo &&
          isExactTopicMatch(classGrade, subject, chapterNo, topicName, t.classGrade, t.subject, t.chapterNo, t.topicName)
        ) {
          keysToRemove.push(key);
          candidateIds.add(key);
          if (t.id) candidateIds.add(t.id);
        }
      }
    }
  });

  // 4. Delete the document(s) from Firestore topic_practice_tests and practice_tests
  let firestoreError: any = null;
  try {
    const db = await getFirebaseDb();
    if (db) {
      for (const docId of Array.from(candidateIds)) {
        if (!docId) continue;
        const testDocRef = doc(db, "topic_practice_tests", docId);
        const aliasDocRef = doc(db, "practice_tests", docId);

        try {
          await deleteDoc(testDocRef);
        } catch (delErr: any) {
          console.warn(`[PracticeTestService] Firestore delete topic_practice_tests/${docId} error:`, delErr);
          if (delErr?.code === "permission-denied" || delErr?.code === "unauthenticated") {
            firestoreError = delErr;
          }
        }

        try {
          await deleteDoc(aliasDocRef);
        } catch (aliasErr: any) {
          if (aliasErr?.code === "permission-denied" || aliasErr?.code === "unauthenticated") {
            firestoreError = aliasErr;
          }
        }
      }

      // Safe note unlinking (clearing practice test reference without deleting notes)
      try {
        const collectionsToCheck = ["class_notes", "upsc_notes"];
        for (const colName of collectionsToCheck) {
          const notesCol = collection(db, colName);
          const snap = await getDocs(notesCol);
          for (const docSnap of snap.docs) {
            const n = docSnap.data() as ClassNote;
            const pId = n.practiceTestId;
            if (pId && candidateIds.has(pId)) {
              await setDoc(
                docSnap.ref,
                { hasPracticeTest: false, hasTest: false, practiceTestId: null },
                { merge: true }
              ).catch(() => {});
            }
          }
        }
      } catch (unlinkErr) {
        console.warn("[PracticeTestService] Note unlinking warning:", unlinkErr);
      }
    }
  } catch (dbErr: any) {
    console.error("[PracticeTestService] Firestore connection error during deletion:", dbErr);
    firestoreError = dbErr;
  }

  // If backend explicitly rejected due to permissions, return failure
  if (firestoreError) {
    return {
      success: false,
      message: firestoreError?.message || "Permission denied or failed to communicate with Firestore.",
      error: firestoreError?.message,
    };
  }

  // 5. Clean up from memory and local storage
  for (const docId of Array.from(candidateIds)) {
    delete bank[docId];
    delete memoryTestBank[docId];
    removeLocalTopicCache(docId);
  }
  for (const key of keysToRemove) {
    delete bank[key];
    delete memoryTestBank[key];
    removeLocalTopicCache(key);
  }

  saveLocalTestBank(memoryTestBank);
  clearAllQuestionCaches();
  notifyTestBankSubscribers();

  // 6. Synchronize clean state to secondary R2 storage & trigger events
  await syncTestBankToStorage(memoryTestBank, { allowEmpty: true }).catch(() => {});
  await notifyPracticeTestRealtimeSync({
    testId: primaryId || Array.from(candidateIds)[0] || "test",
    action: "delete_topic",
  });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("practice-tests-updated"));
  }

  return {
    success: true,
    message: "Test deleted successfully.",
  };
}

export async function deleteChapterPracticeTest(
  classGrade: string,
  subject: string,
  chapterNo: number
): Promise<{ success: boolean; message: string; error?: string }> {
  return deletePracticeTest({
    classGrade,
    subject,
    chapterNo,
    testType: "CHAPTER",
    computedType: "CHAPTER",
  });
}

export async function deleteSubjectPracticeTest(
  classGrade: string,
  subject: string
): Promise<{ success: boolean; message: string; error?: string }> {
  return deletePracticeTest({
    classGrade,
    subject,
    chapterNo: 0,
    testType: "SUBJECT",
    computedType: "SUBJECT",
  });
}

export const saveTopicPracticeTestDirect = saveTopicPracticeTest;

export async function deleteTopicPracticeTest(
  classGrade: string,
  subject: string,
  chapterNo: number,
  topicName: string
): Promise<{ success: boolean; message: string; error?: string }> {
  return deletePracticeTest({
    classGrade,
    subject,
    chapterNo,
    topicName,
    testType: "TOPIC",
    computedType: "TOPIC",
  });
}

export async function syncPracticeTestOnNoteRename(params: {
  noteId: string;
  oldClassGrade?: string;
  oldSubject?: string;
  oldChapterNo?: number;
  oldTopicName?: string;
  newClassGrade?: string;
  newSubject?: string;
  newChapterNo?: number;
  newChapterName?: string;
  newTopicName?: string;
  practiceTestId?: string;
}): Promise<void> {
  const {
    noteId,
    oldClassGrade = "",
    oldSubject = "",
    oldChapterNo = 1,
    oldTopicName = "",
    newClassGrade,
    newSubject,
    newChapterNo,
    newChapterName,
    newTopicName,
    practiceTestId,
  } = params;

  try {
    const bank = await fetchAllPracticeTests();
    const oldTestId = practiceTestId || buildTopicTestId(oldClassGrade, oldSubject, oldChapterNo, oldTopicName);

    let existingTest: TopicPracticeTest | null = bank[oldTestId] || null;
    let foundKey = oldTestId;

    if (!existingTest) {
      for (const [k, t] of Object.entries(bank)) {
        if (
          t.noteId === noteId ||
          t.id === practiceTestId ||
          isExactTopicMatch(oldClassGrade, oldSubject, oldChapterNo, oldTopicName, t.classGrade, t.subject, t.chapterNo, t.topicName)
        ) {
          existingTest = t;
          foundKey = k;
          break;
        }
      }
    }

    if (!existingTest) return;

    const targetClass = newClassGrade !== undefined ? newClassGrade : existingTest.classGrade;
    const targetSubj = newSubject !== undefined ? newSubject : existingTest.subject;
    const targetCh = newChapterNo !== undefined ? newChapterNo : existingTest.chapterNo;
    const targetChName = newChapterName !== undefined ? newChapterName : existingTest.chapterName;
    const targetTopic = newTopicName !== undefined ? newTopicName : existingTest.topicName;
    const newTestId = buildTopicTestId(targetClass, targetSubj, targetCh, targetTopic);

    const updatedQuestions = Array.isArray(existingTest.questions)
      ? existingTest.questions.map((q) => ({
          ...q,
          classGrade: targetClass,
          subject: targetSubj,
          chapterNo: targetCh,
          chapterName: targetChName,
          topicName: targetTopic,
        }))
      : [];

    const updatedTest: TopicPracticeTest = {
      ...existingTest,
      id: newTestId,
      noteId,
      topicNoteId: noteId,
      classGrade: targetClass,
      subject: targetSubj,
      chapterNo: targetCh,
      chapterName: targetChName,
      topicName: targetTopic,
      questions: updatedQuestions,
      updatedAt: new Date().toISOString(),
    };

    delete bank[foundKey];
    bank[newTestId] = updatedTest;
    memoryTestBank = { ...bank };
    saveLocalTestBank(memoryTestBank);

    const db = await getFirebaseDb();
    if (db) {
      if (foundKey !== newTestId) {
        await deleteDoc(doc(db, "topic_practice_tests", foundKey)).catch(() => {});
      }
      await setDoc(doc(db, "topic_practice_tests", newTestId), updatedTest, { merge: true });
    }

    await syncTestBankToStorage(bank).catch(() => {});
    await notifyPracticeTestRealtimeSync({ testId: newTestId, action: "save_topic" });
  } catch (err) {
    console.warn("[PracticeTestService] syncPracticeTestOnNoteRename error:", err);
  }
}

export const deleteTopicPracticeTestDirect = deleteTopicPracticeTest;

export async function deleteClassPracticeTests(classGrade: string): Promise<void> {
  const normClass = String(classGrade || "").toLowerCase().trim();
  if (!normClass) return;

  const bank = getLocalTestBank();
  let changed = false;
  const deletedKeys: string[] = [];

  Object.keys(bank).forEach((k) => {
    const t = bank[k];
    if (t && String(t.classGrade || "").toLowerCase().trim() === normClass) {
      delete bank[k];
      deletedKeys.push(k);
      removeLocalTopicCache(k);
      changed = true;
    }
  });

  try {
    const db = await getFirebaseDb();
    if (db) {
      for (const k of deletedKeys) {
        await deleteDoc(doc(db, "topic_practice_tests", k)).catch(() => {});
      }
    }
  } catch (err) {
    console.warn("[PracticeTestService] Error deleting class tests from Firestore:", err);
  }

  if (changed) {
    saveLocalTestBank(bank);
    clearAllQuestionCaches();
    await syncTestBankToStorage(bank).catch(() => {});
    await notifyPracticeTestRealtimeSync({ classGrade, action: "delete_class" });
  }
}

export async function deleteAllPracticeTestsFromDatabase(): Promise<{
  success: boolean;
  message?: string;
  error?: string;
  deletedCounts?: {
    practiceTests: number;
    questions: number;
    studentMarks: number;
    options: number;
  };
}> {
  const bank = getLocalTestBank();
  const testCount = Object.keys(bank).length;
  let questionCount = 0;
  Object.values(bank).forEach((t) => {
    questionCount += Array.isArray(t.questions) ? t.questions.length : 0;
  });

  memoryTestBank = {};
  saveLocalTestBank({});
  clearAllQuestionCaches();
  clearTestScoreCache();

  try {
    safeLocalStorageRemoveItem(TESTS_CACHE_KEY);
    safeLocalStorageRemoveItem("tuition_practice_tests_cache");
    safeLocalStorageRemoveItem("tuition_student_test_score_cache");
    safeLocalStorageRemoveItem("tuition_test_attempts_cache");
  } catch (e) {}

  try {
    const db = await getFirebaseDb();
    if (db) {
      const snap = await getDocs(collection(db, "topic_practice_tests"));
      for (const docSnap of snap.docs) {
        await deleteDoc(docSnap.ref).catch(() => {});
      }
    }
  } catch (err) {
    console.warn("[PracticeTestService] Firestore delete all warning:", err);
  }

  await deleteAllAttemptsAndScoresFromPersistence().catch(() => {});
  await syncTestBankToStorage({}, { allowEmpty: true }).catch(() => {});
  await notifyPracticeTestRealtimeSync({ action: "delete_all" });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("practice-tests-cleared-all"));
    window.dispatchEvent(new CustomEvent("practice-tests-updated"));
    window.dispatchEvent(new CustomEvent("test-attempts-updated"));
  }

  return {
    success: true,
    message: "All Practice Tests, Questions, and Student Test Marks have been permanently deleted.",
    deletedCounts: {
      practiceTests: testCount,
      questions: questionCount,
      studentMarks: 0,
      options: questionCount * 4,
    },
  };
}

export const deleteAllPracticeTests = deleteAllPracticeTestsFromDatabase;

export async function performOneTimePracticeTestCleanup(): Promise<{ success: boolean; message: string }> {
  const res = await deleteAllPracticeTestsFromDatabase();
  return {
    success: res.success,
    message: res.message || "Cleanup completed successfully.",
  };
}

export async function updateAssessmentQuestion(
  questionId: string,
  updates: Partial<ParsedAssessmentQuestion>
): Promise<{ success: boolean; message: string }> {
  const bank = getLocalTestBank();
  let foundTest: TopicPracticeTest | null = null;
  let questionIndex = -1;

  for (const t of Object.values(bank)) {
    const idx = (t.questions || []).findIndex((q) => q.id === questionId);
    if (idx !== -1) {
      foundTest = t;
      questionIndex = idx;
      break;
    }
  }

  if (foundTest && questionIndex !== -1) {
    foundTest.questions[questionIndex] = {
      ...foundTest.questions[questionIndex],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    updateLocalTopicCache(foundTest);
    saveLocalTestBank(bank, { silent: true });
    await syncTestBankToStorage(bank).catch(() => {});
    await notifyPracticeTestRealtimeSync({ questionId, action: "update_question" });
    return { success: true, message: "Question updated successfully." };
  }

  return { success: false, message: "Question not found." };
}

export async function deleteAssessmentQuestion(
  questionId: string
): Promise<{ success: boolean; message: string }> {
  const bank = getLocalTestBank();
  let modified = false;

  for (const k of Object.keys(bank)) {
    const t = bank[k];
    if (t && Array.isArray(t.questions)) {
      const filtered = t.questions.filter((q) => q.id !== questionId);
      if (filtered.length !== t.questions.length) {
        modified = true;
        if (filtered.length === 0) {
          delete bank[k];
          removeLocalTopicCache(k);
        } else {
          t.questions = filtered;
          updateLocalTopicCache(t);
        }
      }
    }
  }

  if (modified) {
    saveLocalTestBank(bank);
    await syncTestBankToStorage(bank).catch(() => {});
    await notifyPracticeTestRealtimeSync({ questionId, action: "delete_question" });
    return { success: true, message: "Question deleted successfully." };
  }

  return { success: false, message: "Question not found." };
}

export async function reorderAssessmentQuestions(
  classGrade: string,
  subject: string,
  chapterNo: number,
  topicName: string,
  reorderedQuestions: ParsedAssessmentQuestion[]
): Promise<{ success: boolean }> {
  const testId = buildTopicTestId(classGrade, subject, chapterNo, topicName);
  const bank = getLocalTestBank();
  const test = bank[testId];

  if (test) {
    test.questions = reorderedQuestions.map((q, idx) => ({
      ...q,
      orderIndex: idx + 1,
    }));
    updateLocalTopicCache(test);
    await syncTestBankToStorage(bank).catch(() => {});
    await notifyPracticeTestRealtimeSync({ testId, action: "reorder_questions" });
  }

  return { success: true };
}
