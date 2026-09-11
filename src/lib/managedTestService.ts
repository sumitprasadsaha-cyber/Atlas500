import { ManagedTest, ManagedTestType, TopicPracticeTest, Student, TestAttemptRecord } from "../types";
import { doc, setDoc, deleteDoc, getDoc } from "firebase/firestore";
import { getFirebaseDb } from "./firebase";
import { toStableClassId, getClassDisplayName } from "./curriculumAccessService";
import { isClassAllowedForSubject, getSubjectAccessConfig } from "./curriculumAccessService";
import { 
  fetchAllPracticeTests, 
  notifyTestBankSubscribers, 
  subscribeToPracticeTests 
} from "./practiceTestService";
import { safeLocalStorageSetItem, safeLocalStorageGetItem, safeLocalStorageRemoveItem } from "./safeStorage";

export interface ManagedTestDraft {
  testId: string;
  studentId: string;
  studentName: string;
  startedAt: number; // Unix timestamp in ms
  durationMinutes: number;
  userAnswers: Record<string, string>;
  isSubmitted: boolean;
  submittedAt?: number;
}

const MANAGED_TESTS_CACHE_KEY = "tuition_managed_tests_list";
const DRAFT_PREFIX = "tuition_mtest_draft_";

/**
 * Generate a unique, collision-proof ID for a managed test
 */
export function generateManagedTestId(
  type: ManagedTestType,
  classGrade: string,
  subject: string
): string {
  const normType = type.toLowerCase().replace(/[^a-z0-9]/g, "_");
  const stableClass = toStableClassId(classGrade) || "general";
  const normSubj = (subject || "general").toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 15);
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  return `mtest_${normType}_${stableClass}_${normSubj}_${timestamp}_${randomSuffix}`;
}

/**
 * Save or update a Managed Test in Firestore and local caches.
 * Preserves all existing tests and curriculum data.
 */
export async function saveManagedTest(
  test: ManagedTest
): Promise<{ success: boolean; id: string; error?: string }> {
  try {
    const testId = test.id || generateManagedTestId(test.managedTestType, test.classGrade, test.subject);
    const now = new Date().toISOString();

    const marksPerQ = Number(test.marksPerQuestion) > 0 ? Number(test.marksPerQuestion) : 1;
    const questions = (test.questions || []).map((q, idx) => ({
      ...q,
      questionNumber: q.questionNumber || idx + 1,
      marks: q.marks !== undefined ? Number(q.marks) : marksPerQ,
    }));

    const calculatedTotalMarks = questions.reduce((sum, q) => sum + (q.marks || marksPerQ), 0);
    const totalMarks = test.totalMarks && test.totalMarks > 0 ? test.totalMarks : calculatedTotalMarks;

    const sanitizedTest: ManagedTest = {
      ...test,
      id: testId,
      hasTest: true,
      hasPracticeTest: true,
      testType: test.managedTestType,
      test_type: test.managedTestType,
      classStableId: toStableClassId(test.classGrade),
      chapterNo: test.chapterNo !== undefined ? Number(test.chapterNo) : 0,
      chapterName: test.chapterName || (test.managedTestType.includes("Subject") ? "All Chapters" : `Chapter ${test.chapterNo || 1}`),
      topicName: test.title,
      title: test.title,
      instructions: test.instructions || "Read each question carefully before selecting your answer.",
      durationMinutes: Number(test.durationMinutes) > 0 ? Number(test.durationMinutes) : 30,
      marksPerQuestion: marksPerQ,
      negativeMarking: test.negativeMarking !== undefined ? Number(test.negativeMarking) : 0,
      totalMarks,
      isPublished: test.isPublished !== false,
      questions,
      questionCount: questions.length,
      rawText: test.rawText || "",
      createdAt: test.createdAt || now,
      updatedAt: now,
      uploadedBy: test.uploadedBy || "Admin",
    };

    // 1. Save to Firestore topic_practice_tests collection
    const db = await getFirebaseDb();
    if (db) {
      const docRef = doc(db, "topic_practice_tests", testId);
      const aliasDocRef = doc(db, "practice_tests", testId);
      await setDoc(docRef, sanitizedTest, { merge: true });
      await setDoc(aliasDocRef, sanitizedTest, { merge: true }).catch(() => {});
    }

    // 2. Refresh practice test cache & notify subscribers
    await fetchAllPracticeTests();
    notifyTestBankSubscribers();

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("managed-tests-updated", { detail: { testId } }));
      if ("BroadcastChannel" in window) {
        try {
          const bc = new BroadcastChannel("tuition_practice_tests_channel");
          bc.postMessage({ type: "PRACTICE_TESTS_UPDATED", testId });
        } catch (e) {}
      }
    }

    return { success: true, id: testId };
  } catch (err: any) {
    console.error("[ManagedTestService] Error saving managed test:", err);
    return { success: false, id: test.id || "", error: err?.message || "Failed to save test" };
  }
}

/**
 * Delete a specific managed test by ID.
 * Only deletes the targeted test; preserves all other tests and curriculum.
 */
export async function deleteManagedTest(
  testId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!testId) {
      return { success: false, error: "Test ID is required" };
    }

    const db = await getFirebaseDb();
    if (db) {
      const docRef = doc(db, "topic_practice_tests", testId);
      const aliasDocRef = doc(db, "practice_tests", testId);
      await deleteDoc(docRef).catch(() => {});
      await deleteDoc(aliasDocRef).catch(() => {});
    }

    // Refresh memory bank & notify
    await fetchAllPracticeTests();
    notifyTestBankSubscribers();

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("managed-tests-updated", { detail: { testId, deleted: true } }));
      if ("BroadcastChannel" in window) {
        try {
          const bc = new BroadcastChannel("tuition_practice_tests_channel");
          bc.postMessage({ type: "PRACTICE_TESTS_UPDATED", testId, deleted: true });
        } catch (e) {}
      }
    }

    return { success: true };
  } catch (err: any) {
    console.error("[ManagedTestService] Error deleting managed test:", err);
    return { success: false, error: err?.message || "Failed to delete test" };
  }
}

/**
 * Toggle published status of a managed test
 */
export async function toggleManagedTestPublish(
  testId: string,
  isPublished: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getFirebaseDb();
    if (db) {
      const docRef = doc(db, "topic_practice_tests", testId);
      await setDoc(docRef, { isPublished, updatedAt: new Date().toISOString() }, { merge: true });
    }

    await fetchAllPracticeTests();
    notifyTestBankSubscribers();

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("managed-tests-updated", { detail: { testId, isPublished } }));
    }

    return { success: true };
  } catch (err: any) {
    console.error("[ManagedTestService] Error updating publish state:", err);
    return { success: false, error: err?.message || "Failed to update publish state" };
  }
}

/**
 * Retrieves all managed tests from the test bank.
 * Includes both newly created managed tests and converts legacy chapter/subject tests seamlessly.
 */
export function getAllManagedTests(
  testBank?: Record<string, TopicPracticeTest>
): ManagedTest[] {
  if (!testBank || typeof testBank !== "object") {
    return [];
  }

  const result: ManagedTest[] = [];

  for (const [id, test] of Object.entries(testBank)) {
    if (!test || !Array.isArray(test.questions) || test.questions.length === 0) {
      continue;
    }

    // Check if it's explicitly a ManagedTest
    const mTest = test as ManagedTest;
    if (mTest.managedTestType) {
      result.push({
        ...mTest,
        id: mTest.id || id,
        classStableId: mTest.classStableId || toStableClassId(mTest.classGrade),
        stream: mTest.stream || (mTest.classGrade?.toLowerCase().includes("upsc") ? "upsc" : "school"),
        durationMinutes: mTest.durationMinutes || mTest.duration_minutes || 30,
        marksPerQuestion: mTest.marksPerQuestion || 1,
        negativeMarking: mTest.negativeMarking || 0,
        isPublished: mTest.isPublished !== false,
      });
      continue;
    }

    // Adapt legacy Chapter / Subject tests so they are accessible in the new Tests tab
    const normType = String(test.testType || test.test_type || "").toUpperCase();
    if (normType === "CHAPTER" || normType === "FULL_CHAPTER") {
      result.push({
        ...test,
        id: test.id || id,
        managedTestType: "Chapter Test",
        stream: test.classGrade?.toLowerCase().includes("upsc") ? "upsc" : "school",
        classStableId: toStableClassId(test.classGrade),
        title: test.title || `${test.subject || "Subject"} - Chapter ${test.chapterNo || 1} Test`,
        durationMinutes: test.durationMinutes || test.duration_minutes || 30,
        marksPerQuestion: 1,
        negativeMarking: 0,
        isPublished: test.isPublished !== false,
        questions: test.questions,
      });
    } else if (normType === "SUBJECT") {
      result.push({
        ...test,
        id: test.id || id,
        managedTestType: "Subject Test",
        stream: test.classGrade?.toLowerCase().includes("upsc") ? "upsc" : "school",
        classStableId: toStableClassId(test.classGrade),
        title: test.title || `${test.subject || "Subject"} Full Test`,
        durationMinutes: test.durationMinutes || test.duration_minutes || 45,
        marksPerQuestion: 1,
        negativeMarking: 0,
        isPublished: test.isPublished !== false,
        questions: test.questions,
      });
    }
  }

  // Sort by updatedAt descending
  return result.sort((a, b) => {
    const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return timeB - timeA;
  });
}

/**
 * Filter only tests that the student is permitted to access and that are published.
 */
export function getStudentAccessibleManagedTests(
  student: Student,
  allTests: ManagedTest[]
): ManagedTest[] {
  if (!student || !Array.isArray(allTests)) return [];

  const studentClassStableId = toStableClassId(student.classGrade);
  const isStudentUpsc = studentClassStableId === "upsc" || (student.classGrade || "").toLowerCase().includes("upsc");

  return allTests.filter((test) => {
    // 1. Must be published
    if (test.isPublished === false) return false;

    // 2. Stream matching
    if (test.stream === "upsc") {
      return isStudentUpsc;
    }

    // 3. School stream matching:
    // If student is enrolled in the exact owner/target class
    if (test.classStableId === studentClassStableId) {
      return true;
    }

    // Check if the subject is shared with the student's class via curriculum sharing rules
    if (test.subject && student.classGrade) {
      const accessConfig = getSubjectAccessConfig(test.subject, test.classGrade);
      if (isClassAllowedForSubject(accessConfig, student.classGrade)) {
        return true;
      }
    }

    return false;
  });
}

/**
 * Calculate test scores with individual question marks & negative marking
 */
export function calculateManagedTestScore(
  test: ManagedTest,
  userAnswers: Record<string, string>
): {
  score: number;
  totalMarks: number;
  correctCount: number;
  wrongCount: number;
  unattemptedCount: number;
  percentage: number;
} {
  const marksPerQ = Number(test.marksPerQuestion) > 0 ? Number(test.marksPerQuestion) : 1;
  const negativeMark = Number(test.negativeMarking) >= 0 ? Number(test.negativeMarking) : 0;

  let correctCount = 0;
  let wrongCount = 0;
  let unattemptedCount = 0;
  let rawScore = 0;
  let totalPossible = 0;

  (test.questions || []).forEach((q) => {
    const qMarks = q.marks !== undefined && Number(q.marks) > 0 ? Number(q.marks) : marksPerQ;
    totalPossible += qMarks;

    const answerKey = String(q.id ?? q.questionNumber);
    const selected = userAnswers[answerKey]?.trim().toUpperCase();
    const correct = (q.correctAnswer || "").trim().toUpperCase();

    if (!selected) {
      unattemptedCount++;
    } else if (selected === correct) {
      correctCount++;
      rawScore += qMarks;
    } else {
      wrongCount++;
      rawScore -= negativeMark;
    }
  });

  const totalMarks = test.totalMarks && test.totalMarks > 0 ? test.totalMarks : totalPossible;
  const score = Math.max(0, Math.round(rawScore * 100) / 100);
  const percentage = totalMarks > 0 ? Math.round((score / totalMarks) * 100) : 0;

  return {
    score,
    totalMarks,
    correctCount,
    wrongCount,
    unattemptedCount,
    percentage,
  };
}

/**
 * Managed Test Draft Helpers
 */
export function getManagedTestDraftKey(studentId: string, testId: string): string {
  return `${DRAFT_PREFIX}${studentId}_${testId}`;
}

export function saveManagedTestDraft(draft: ManagedTestDraft): void {
  const key = getManagedTestDraftKey(draft.studentId, draft.testId);
  safeLocalStorageSetItem(key, JSON.stringify(draft));
}

export function loadManagedTestDraft(studentId: string, testId: string): ManagedTestDraft | null {
  const key = getManagedTestDraftKey(studentId, testId);
  const raw = safeLocalStorageGetItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function clearManagedTestDraft(studentId: string, testId: string): void {
  const key = getManagedTestDraftKey(studentId, testId);
  safeLocalStorageRemoveItem(key);
}
