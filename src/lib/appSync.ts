/**
 * App Initialization & Synchronization Service
 * 
 * Manages:
 * - Real-time listener initialization
 * - Offline sync queue processing
 * - Network connectivity handling
 * - Listener cleanup on logout
 * - Memory leak prevention
 */

import { 
  subscribeToStudents,
  subscribeToStudent,
  subscribeToClassNotes,
  subscribeToTestAttempts,
  subscribeToAnnouncements,
  cleanupAllFirestoreListeners
} from "./firestoreService";
import { initPracticeTestsRealtimeSync, fetchAllPracticeTests } from "./practiceTestService";
import { cleanupAllListeners } from "./realtimeSync";
import { subscribeToCurriculumHierarchy } from "./curriculumService";
import { runDatabaseMigrationsIfNeeded } from "./schemaMigrationService";
import { StructuredLogger } from "./authLogger";

type UnsubscribeFn = () => void;

interface AppSyncState {
  activeUid: string | null;
  activeRole: "admin" | "student" | null;
  activeStudentId: string | null;
  sessionId: string;
  unsubscribers: Set<UnsubscribeFn>;
  isOnline: boolean;
  syncInterval: NodeJS.Timeout | null;
}

const appState: AppSyncState = {
  activeUid: null,
  activeRole: null,
  activeStudentId: null,
  sessionId: "",
  unsubscribers: new Set(),
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  syncInterval: null
};

/**
 * Teardown current active listeners before re-initializing or on user change
 */
export function teardownCurrentSync(): void {
  StructuredLogger.sync("Teardown sync listeners", {
    uid: appState.activeUid,
    studentId: appState.activeStudentId,
    sessionId: appState.sessionId
  });

  try {
    appState.unsubscribers.forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (err) {
        StructuredLogger.warn("Sync", "Error unsubscribing listener", undefined, err);
      }
    });
    appState.unsubscribers.clear();

    cleanupAllFirestoreListeners();
    cleanupAllListeners();

    if (appState.syncInterval) {
      clearInterval(appState.syncInterval);
      appState.syncInterval = null;
    }

    appState.activeUid = null;
    appState.activeRole = null;
    appState.activeStudentId = null;
  } catch (err) {
    StructuredLogger.error("Sync", "Error during teardown", undefined, err);
  }
}

/**
 * Initialize all real-time listeners for admin dashboard
 */
export function initializeAdminSync(adminUid?: string | null): void {
  const targetUid = adminUid || "admin";
  
  if (appState.activeUid === targetUid && appState.activeRole === "admin" && appState.unsubscribers.size > 0) {
    StructuredLogger.sync("Admin sync already active for this UID, skipping duplicate init", { uid: targetUid });
    return;
  }

  // Clean up any existing listeners from a previous session or role
  teardownCurrentSync();

  const newSessionId = `admin-sync-${Date.now()}`;
  appState.activeUid = targetUid;
  appState.activeRole = "admin";
  appState.activeStudentId = null;
  appState.sessionId = newSessionId;

  StructuredLogger.sync("Initializing Admin synchronization", { uid: targetUid, sessionId: newSessionId });

  try {
    // 1. Subscribe to all students
    const unsubStudents = subscribeToStudents(
      (students) => {
        StructuredLogger.sync("Admin students updated", { uid: targetUid }, { count: students.length });
      },
      (err) => {
        StructuredLogger.warn("Sync", "Students subscription error", { uid: targetUid }, err);
      },
      targetUid
    );
    appState.unsubscribers.add(unsubStudents);

    // 2. Subscribe to class notes
    const unsubClassNotes = subscribeToClassNotes(
      (notes) => {
        StructuredLogger.sync("Class notes updated", { uid: targetUid }, { count: notes.length });
      },
      (err) => {
        StructuredLogger.warn("Sync", "Class notes subscription error", { uid: targetUid }, err);
      }
    );
    appState.unsubscribers.add(unsubClassNotes);

    // 3. Subscribe to announcements
    const unsubAnnouncements = subscribeToAnnouncements(
      (announcements) => {
        StructuredLogger.sync("Announcements updated", { uid: targetUid }, { count: announcements.length });
      },
      (err) => {
        StructuredLogger.warn("Sync", "Announcements subscription error", { uid: targetUid }, err);
      }
    );
    appState.unsubscribers.add(unsubAnnouncements);

    // 4. Subscribe to test attempts (for admin reports)
    const unsubTestAttempts = subscribeToTestAttempts(
      (attempts) => {
        StructuredLogger.sync("Test attempts updated", { uid: targetUid }, { count: attempts.length });
      },
      (err) => {
        StructuredLogger.warn("Sync", "Test attempts subscription error", { uid: targetUid }, err);
      }
    );
    appState.unsubscribers.add(unsubTestAttempts);

    // 5. Initialize practice tests real-time sync
    initPracticeTestsRealtimeSync();
    fetchAllPracticeTests().catch((err) => {
      StructuredLogger.warn("Sync", "Admin practice tests fetch warning", { uid: targetUid }, err);
    });

    // 6. Subscribe to curriculum hierarchy (Classes, GS Papers, Subjects, Chapters, Modules)
    const unsubCurriculum = subscribeToCurriculumHierarchy();
    appState.unsubscribers.add(unsubCurriculum);

    // 7. Run safe non-destructive migrations if needed
    runDatabaseMigrationsIfNeeded().catch((err) => {
      StructuredLogger.warn("Sync", "Migration check warning", { uid: targetUid }, err);
    });

    // 8. Set up network connectivity monitoring
    setupNetworkMonitoring();

    StructuredLogger.sync("Admin synchronization initialized successfully", { uid: targetUid, sessionId: newSessionId });
  } catch (err) {
    StructuredLogger.error("Sync", "Failed to initialize admin sync", { uid: targetUid }, err);
  }
}

/**
 * Initialize real-time listeners for student dashboard
 */
export function initializeStudentSync(studentId: string, authUid?: string | null): void {
  if (!studentId || (authUid && studentId === authUid)) {
    StructuredLogger.error("Sync", "Refusing to initialize student sync with invalid student ID or matching UID", {
      uid: authUid,
      studentId
    });
    return;
  }

  const targetUid = authUid || studentId;

  if (appState.activeUid === targetUid && appState.activeStudentId === studentId && appState.unsubscribers.size > 0) {
    StructuredLogger.sync("Student sync already active for this session, skipping", {
      uid: targetUid,
      studentId
    });
    return;
  }

  // Clean up any existing listeners from previous session
  teardownCurrentSync();

  const newSessionId = `student-sync-${Date.now()}`;
  appState.activeUid = targetUid;
  appState.activeRole = "student";
  appState.activeStudentId = studentId;
  appState.sessionId = newSessionId;

  StructuredLogger.sync("Initializing Student synchronization", {
    uid: targetUid,
    studentId,
    sessionId: newSessionId
  });

  try {
    // 1. Subscribe to this student's data
    const unsubStudent = subscribeToStudent(
      studentId,
      (student) => {
        StructuredLogger.sync("Student data updated", { uid: targetUid, studentId }, { name: student.name });
      },
      (err) => {
        StructuredLogger.warn("Sync", "Student subscription error", { uid: targetUid, studentId }, err);
      },
      targetUid
    );
    appState.unsubscribers.add(unsubStudent);

    // 2. Subscribe to class notes (for study materials)
    const unsubClassNotes = subscribeToClassNotes(
      (notes) => {
        StructuredLogger.sync("Class notes updated for student", { uid: targetUid, studentId }, { count: notes.length });
      },
      (err) => {
        StructuredLogger.warn("Sync", "Class notes subscription error", { uid: targetUid, studentId }, err);
      }
    );
    appState.unsubscribers.add(unsubClassNotes);

    // 3. Subscribe to test attempts (for this student's test results)
    const unsubTestAttempts = subscribeToTestAttempts(
      (attempts) => {
        const studentAttempts = attempts.filter(a => a.studentId === studentId);
        StructuredLogger.sync("Test attempts updated for student", { uid: targetUid, studentId }, { count: studentAttempts.length });
      },
      (err) => {
        StructuredLogger.warn("Sync", "Test attempts subscription error", { uid: targetUid, studentId }, err);
      }
    );
    appState.unsubscribers.add(unsubTestAttempts);

    // 4. Subscribe to announcements (for notifications)
    const unsubAnnouncements = subscribeToAnnouncements(
      (announcements) => {
        StructuredLogger.sync("Announcements updated for student", { uid: targetUid, studentId }, { count: announcements.length });
      },
      (err) => {
        StructuredLogger.warn("Sync", "Announcements subscription error", { uid: targetUid, studentId }, err);
      }
    );
    appState.unsubscribers.add(unsubAnnouncements);

    // 5. Initialize practice tests real-time sync
    initPracticeTestsRealtimeSync();
    fetchAllPracticeTests().catch((err) => {
      StructuredLogger.warn("Sync", "Student practice tests fetch warning", { uid: targetUid, studentId }, err);
    });

    // 6. Subscribe to curriculum hierarchy
    const unsubCurriculum = subscribeToCurriculumHierarchy();
    appState.unsubscribers.add(unsubCurriculum);

    // 7. Set up network connectivity monitoring
    setupNetworkMonitoring();

    StructuredLogger.sync("Student synchronization initialized successfully", {
      uid: targetUid,
      studentId,
      sessionId: newSessionId
    });
  } catch (err) {
    StructuredLogger.error("Sync", "Failed to initialize student sync", { uid: targetUid, studentId }, err);
  }
}

/**
 * Set up network connectivity monitoring for offline/online transitions
 */
function setupNetworkMonitoring(): void {
  if (typeof window === "undefined") return;

  const handleOnline = () => {
    StructuredLogger.sync("Network connectivity restored, processing sync queue");
    appState.isOnline = true;
    processSyncQueue();
  };

  const handleOffline = () => {
    StructuredLogger.sync("Network connectivity lost, offline mode enabled");
    appState.isOnline = false;
  };

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  // Set up periodic sync check (every 30 seconds while offline)
  if (appState.syncInterval) {
    clearInterval(appState.syncInterval);
  }
  
  appState.syncInterval = setInterval(() => {
    if (appState.isOnline && navigator.onLine) {
      processSyncQueue();
    }
  }, 30000);
}

/**
 * Process offline sync queue
 */
async function processSyncQueue(): Promise<void> {
  StructuredLogger.sync("Checking for pending sync operations");
  try {
    // Practice tests and notes use built-in offline synchronization
  } catch (err) {
    StructuredLogger.warn("Sync", "Error during sync queue processing", undefined, err);
  }
}

/**
 * Cleanup all listeners and resources on logout
 */
export function cleanupOnLogout(uid?: string | null): void {
  StructuredLogger.logout("Cleaning up all synchronization resources on logout", { uid: uid || appState.activeUid });
  teardownCurrentSync();
}

/**
 * Cleanup all resources on app unload
 */
export function cleanupOnUnload(): void {
  StructuredLogger.sync("App unloading, cleaning up all sync resources");
  cleanupOnLogout();
}

/**
 * Get current sync state
 */
export function getSyncState() {
  return {
    activeUid: appState.activeUid,
    activeRole: appState.activeRole,
    activeStudentId: appState.activeStudentId,
    sessionId: appState.sessionId,
    isOnline: appState.isOnline,
    listenerCount: appState.unsubscribers.size,
    hasSyncInterval: appState.syncInterval !== null
  };
}

// Set up cleanup on app unload
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", cleanupOnUnload);
}

export default {
  initializeAdminSync,
  initializeStudentSync,
  teardownCurrentSync,
  cleanupOnLogout,
  cleanupOnUnload,
  getSyncState
};
