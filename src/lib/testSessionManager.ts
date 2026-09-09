/**
 * Test Session Lifecycle, Autosave, & Crash Recovery Coordinator (v7.9.3)
 * 
 * Provides:
 * 1. Single authoritative state owner for the active test session.
 * 2. Deterministic, debounced, and idempotent autosave.
 * 3. Automatic crash recovery across browser reloads or Android "Aw, Snap!" terminations.
 * 4. Suspension of heavy background synchronization during active testing.
 * 5. Background / visibilitychange / resume coordination without timer duplication.
 */

import { TestLogger } from "./testDiagnostics";

export interface ActiveTestDraft {
  sessionId?: string;
  uid?: string | null;
  studentId: string;
  studentName?: string;
  testId: string;
  attemptNumber: number;
  testType?: "topic" | "full_chapter";
  currentQuestionIdx?: number;
  userAnswers?: Record<string, string>;
  elapsedSeconds?: number;
  startedAt?: number;
  lastActiveTimestamp?: number;
  isSubmitted?: boolean;
  totalQuestions?: number;
  [key: string]: any;
}

let currentActiveSessionId: string | null = null;
let activeSessionDraft: ActiveTestDraft | null = null;
let draftSaveTimeout: any = null;
let lastSavedDraftJson: string = "";

function buildDraftStorageKey(
  uid: string | null | undefined,
  studentId: string,
  testId: string,
  attemptNumber: number
): string {
  const normUid = (uid || "anon").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const normSid = (studentId || "student").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const normTid = (testId || "test").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return `tuition_test_draft__${normUid}__${normSid}__${normTid}__att${attemptNumber}`;
}

/**
 * Checks if a practice test is currently actively running.
 * Components use this to suspend heavy background preloads and Firestore snapshot floods.
 */
export function isPracticeTestActive(): boolean {
  return currentActiveSessionId !== null && activeSessionDraft !== null && !activeSessionDraft.isSubmitted;
}

export function getActiveTestSessionId(): string | null {
  return currentActiveSessionId;
}

/**
 * Registers an active test session with robust defaults.
 */
export function startTestSession(draft: ActiveTestDraft): void {
  const fullDraft: ActiveTestDraft = {
    sessionId: draft.sessionId || `sess_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    testType: draft.testType || "topic",
    currentQuestionIdx: draft.currentQuestionIdx || 0,
    userAnswers: draft.userAnswers || {},
    elapsedSeconds: draft.elapsedSeconds || 0,
    startedAt: draft.startedAt || Date.now(),
    lastActiveTimestamp: Date.now(),
    ...draft
  };

  currentActiveSessionId = fullDraft.sessionId!;
  activeSessionDraft = fullDraft;
  lastSavedDraftJson = "";

  TestLogger.log("Test", "Test session started", {
    sessionId: fullDraft.sessionId,
    studentId: fullDraft.studentId,
    testId: fullDraft.testId,
    attemptId: String(fullDraft.attemptNumber)
  });

  // Write immediate initial draft synchronously
  saveTestDraftSync(fullDraft);
}

/**
 * Ends active test session and clears active flags.
 */
export function endTestSession(): void {
  if (activeSessionDraft) {
    saveTestDraftSync(activeSessionDraft);
  }
  currentActiveSessionId = null;
  activeSessionDraft = null;
  lastSavedDraftJson = "";
  TestLogger.log("Test", "Test session ended");
}

/**
 * Updates in-memory draft state and triggers debounced autosave.
 */
export function updateTestDraft(partial: Partial<ActiveTestDraft>): void {
  if (!activeSessionDraft) return;

  activeSessionDraft = {
    ...activeSessionDraft,
    ...partial,
    lastActiveTimestamp: Date.now()
  };

  // Debounce storage writes by 300ms to avoid I/O choking on rapid answer selection
  if (draftSaveTimeout) clearTimeout(draftSaveTimeout);
  draftSaveTimeout = setTimeout(() => {
    if (activeSessionDraft) {
      saveTestDraftSync(activeSessionDraft);
    }
  }, 300);
}

/**
 * Flushes active draft to both sessionStorage and localStorage synchronously.
 * Idempotent: Skips write if JSON serialized state is identical to last write.
 */
export function saveTestDraftSync(draftToSave?: ActiveTestDraft): void {
  const draft = draftToSave || activeSessionDraft;
  if (!draft) return;

  try {
    const key = buildDraftStorageKey(draft.uid, draft.studentId, draft.testId, draft.attemptNumber);
    const serialized = JSON.stringify(draft);

    if (serialized === lastSavedDraftJson) {
      return; // Idempotent: No change
    }

    if (typeof window !== "undefined") {
      sessionStorage.setItem(key, serialized);
      localStorage.setItem(key, serialized);
      lastSavedDraftJson = serialized;

      TestLogger.log("Autosave", "Draft persisted successfully", {
        sessionId: draft.sessionId,
        studentId: draft.studentId,
        testId: draft.testId,
        attemptId: String(draft.attemptNumber),
        questionNumber: (draft.currentQuestionIdx ?? 0) + 1,
        answeredCount: Object.keys(draft.userAnswers || {}).length,
        elapsedSeconds: draft.elapsedSeconds
      });
    }
  } catch (err: any) {
    TestLogger.warn("Autosave", `Failed to save test draft: ${err?.message || err}`);
  }
}

/**
 * Loads existing draft for crash recovery.
 * Checks sessionStorage first, then falls back to localStorage.
 */
export function loadTestDraft(
  uid: string | null | undefined,
  studentId: string,
  testId: string,
  attemptNumber: number
): ActiveTestDraft | null {
  if (typeof window === "undefined") return null;

  const key = buildDraftStorageKey(uid, studentId, testId, attemptNumber);
  try {
    let raw = sessionStorage.getItem(key);
    if (!raw) {
      raw = localStorage.getItem(key);
    }

    if (!raw) return null;

    const parsed: ActiveTestDraft = JSON.parse(raw);
    if (
      parsed &&
      parsed.studentId === studentId &&
      parsed.testId === testId &&
      parsed.attemptNumber === attemptNumber &&
      !parsed.isSubmitted
    ) {
      // Validate age of draft: ignore if older than 24 hours
      const ageMs = Date.now() - (parsed.lastActiveTimestamp || parsed.startedAt || 0);
      if (ageMs > 24 * 60 * 60 * 1000) {
        clearTestDraft(uid, studentId, testId, attemptNumber);
        return null;
      }

      TestLogger.log("Recovery", "Recovered active test draft from storage", {
        sessionId: parsed.sessionId,
        studentId: parsed.studentId,
        testId: parsed.testId,
        attemptId: String(parsed.attemptNumber),
        questionNumber: parsed.currentQuestionIdx + 1,
        answeredCount: Object.keys(parsed.userAnswers || {}).length,
        elapsedSeconds: parsed.elapsedSeconds
      });

      return parsed;
    }
  } catch (err: any) {
    TestLogger.warn("Recovery", `Failed to load test draft: ${err?.message || err}`);
  }

  return null;
}

/**
 * Clears test draft upon submission or explicit discard.
 */
export function clearTestDraft(
  uid: string | null | undefined,
  studentId: string,
  testId: string,
  attemptNumber: number
): void {
  if (typeof window === "undefined") return;

  const key = buildDraftStorageKey(uid, studentId, testId, attemptNumber);
  try {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  } catch {}

  if (activeSessionDraft && activeSessionDraft.testId === testId && activeSessionDraft.attemptNumber === attemptNumber) {
    currentActiveSessionId = null;
    activeSessionDraft = null;
    lastSavedDraftJson = "";
  }

  TestLogger.log("Test", "Test draft cleared", {
    studentId,
    testId,
    attemptId: String(attemptNumber)
  });
}

/**
 * Immediately flushes any pending draft on mobile visibility changes or page unload.
 */
if (typeof window !== "undefined") {
  const handlePageUnloadOrHide = () => {
    if (activeSessionDraft && !activeSessionDraft.isSubmitted) {
      saveTestDraftSync(activeSessionDraft);
      TestLogger.log("Resume", "Page hidden: Synchronously flushed draft to disk");
    }
  };

  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      handlePageUnloadOrHide();
    }
  });
  window.addEventListener("pagehide", handlePageUnloadOrHide);
  window.addEventListener("beforeunload", handlePageUnloadOrHide);
}
