/**
 * Atlas Student Portal Navigation & History State Manager
 * 
 * Provides unified, persistent state preservation across:
 * - Browser Back/Forward navigation
 * - iPad swipe back gestures
 * - Standalone PWA / WebKit transitions
 * - BFCache (pageshow) and in-session page reloads
 */

export interface StudentPortalNavigationState {
  isStudentPortal: boolean;
  portal_active_tab: "Dashboard" | "LiveStudents" | "Notes" | "Tests" | "Students" | "My" | "Settings";
  studentId: string | null;
  selectedPaper: string | null;
  selectedSubject: string | null;
  selectedOwnerClass: string | null;
  selectedModuleKey: string | null;
  selectedModuleTitle?: string | null;
  expandedSubjects: Record<string, boolean>;
  expandedModules: Record<string, boolean>;
  scrollPositions: {
    windowY: number;
    mainScrollTop: number;
    treeScrollTop: number;
  };
  noteId?: string | null;
  timestamp: number;
}

const STORAGE_KEY_NAV_STATE = "student_portal_nav_state";

/**
 * Retrieve the current student portal state from window.history.state or sessionStorage
 */
export function getStudentPortalHistoryState(): StudentPortalNavigationState | null {
  if (typeof window === "undefined") return null;

  try {
    // 1. Check window.history.state
    const histState = window.history?.state;
    if (histState && (histState.isStudentPortal || histState.portal_active_tab)) {
      return {
        isStudentPortal: true,
        portal_active_tab: histState.portal_active_tab || "My",
        studentId: histState.studentId || null,
        selectedPaper: histState.selectedPaper || null,
        selectedSubject: histState.selectedSubject || null,
        selectedOwnerClass: histState.selectedOwnerClass || null,
        selectedModuleKey: histState.selectedModuleKey || null,
        selectedModuleTitle: histState.selectedModuleTitle || null,
        expandedSubjects: histState.expandedSubjects || {},
        expandedModules: histState.expandedModules || {},
        scrollPositions: histState.scrollPositions || {
          windowY: histState.scrollY || 0,
          mainScrollTop: histState.mainScrollTop || 0,
          treeScrollTop: histState.treeScrollTop || 0,
        },
        noteId: histState.noteId || null,
        timestamp: histState.timestamp || Date.now(),
      };
    }

    // 2. Fallback to sessionStorage
    const savedJson = sessionStorage.getItem(STORAGE_KEY_NAV_STATE);
    if (savedJson) {
      const parsed = JSON.parse(savedJson);
      if (parsed && typeof parsed === "object") {
        return parsed as StudentPortalNavigationState;
      }
    }
  } catch (err) {
    console.warn("[NavigationState] Error reading navigation state:", err);
  }

  return null;
}

/**
 * Persist the student portal navigation state to window.history and sessionStorage
 */
export function saveStudentPortalHistoryState(partial: Partial<StudentPortalNavigationState>): void {
  if (typeof window === "undefined") return;

  try {
    const existing = getStudentPortalHistoryState();

    const merged: StudentPortalNavigationState = {
      isStudentPortal: true,
      portal_active_tab: partial.portal_active_tab ?? existing?.portal_active_tab ?? "My",
      studentId: partial.studentId ?? existing?.studentId ?? null,
      selectedPaper: partial.selectedPaper !== undefined ? partial.selectedPaper : (existing?.selectedPaper ?? null),
      selectedSubject: partial.selectedSubject !== undefined ? partial.selectedSubject : (existing?.selectedSubject ?? null),
      selectedOwnerClass: partial.selectedOwnerClass !== undefined ? partial.selectedOwnerClass : (existing?.selectedOwnerClass ?? null),
      selectedModuleKey: partial.selectedModuleKey !== undefined ? partial.selectedModuleKey : (existing?.selectedModuleKey ?? null),
      selectedModuleTitle: partial.selectedModuleTitle !== undefined ? partial.selectedModuleTitle : (existing?.selectedModuleTitle ?? null),
      expandedSubjects: partial.expandedSubjects ? { ...(existing?.expandedSubjects || {}), ...partial.expandedSubjects } : (existing?.expandedSubjects || {}),
      expandedModules: partial.expandedModules ? { ...(existing?.expandedModules || {}), ...partial.expandedModules } : (existing?.expandedModules || {}),
      scrollPositions: {
        windowY: partial.scrollPositions?.windowY ?? existing?.scrollPositions?.windowY ?? window.scrollY ?? 0,
        mainScrollTop: partial.scrollPositions?.mainScrollTop ?? existing?.scrollPositions?.mainScrollTop ?? 0,
        treeScrollTop: partial.scrollPositions?.treeScrollTop ?? existing?.scrollPositions?.treeScrollTop ?? 0,
      },
      noteId: partial.noteId !== undefined ? partial.noteId : (existing?.noteId ?? null),
      timestamp: Date.now(),
    };

    // 1. Sync to sessionStorage
    sessionStorage.setItem(STORAGE_KEY_NAV_STATE, JSON.stringify(merged));
    sessionStorage.setItem("portal_active_tab", merged.portal_active_tab);

    if (merged.studentId) {
      if (merged.selectedPaper) {
        sessionStorage.setItem(`student_selected_paper_${merged.studentId}`, merged.selectedPaper);
      }
      if (merged.selectedSubject) {
        sessionStorage.setItem(`student_selected_subject_${merged.studentId}`, merged.selectedSubject);
      }
      if (merged.selectedOwnerClass) {
        sessionStorage.setItem(`student_selected_owner_class_${merged.studentId}`, merged.selectedOwnerClass);
      }
      if (merged.selectedModuleKey) {
        sessionStorage.setItem(`student_selected_module_${merged.studentId}`, merged.selectedModuleKey);
      }
    }

    sessionStorage.setItem("student_last_scroll_y", String(merged.scrollPositions.windowY));
    sessionStorage.setItem("student_main_scroll_top", String(merged.scrollPositions.mainScrollTop));
    sessionStorage.setItem("student_tree_scroll_top", String(merged.scrollPositions.treeScrollTop));

    // 2. Update window.history.replaceState (preserves state across back/forward navigation and reloads)
    const currentHistState = window.history.state || {};
    window.history.replaceState(
      {
        ...currentHistState,
        ...merged,
      },
      ""
    );
  } catch (err) {
    console.warn("[NavigationState] Error saving navigation state:", err);
  }
}

/**
 * Smoothly and robustly restores scroll position of a container element
 * using requestAnimationFrame and multi-frame retry for content rendered asynchronously.
 */
export function restoreScrollPositionWithRetry(
  elementId: string | null,
  targetScrollTop: number,
  maxAttempts: number = 15
): () => void {
  if (typeof window === "undefined" || !targetScrollTop || targetScrollTop <= 0) {
    return () => {};
  }

  let cancelled = false;
  let attempts = 0;

  const attemptRestore = () => {
    if (cancelled || attempts >= maxAttempts) return;
    attempts++;

    if (elementId === null || elementId === "window") {
      window.scrollTo({ top: targetScrollTop, behavior: "instant" as any });
      if (Math.abs(window.scrollY - targetScrollTop) > 10 && attempts < maxAttempts) {
        requestAnimationFrame(attemptRestore);
      }
      return;
    }

    const el = document.getElementById(elementId);
    if (el) {
      el.scrollTop = targetScrollTop;
      // If the element's scrollHeight is not yet large enough to reach target, retry next frame
      if (el.scrollHeight > el.clientHeight && Math.abs(el.scrollTop - targetScrollTop) <= 5) {
        // Success!
        return;
      }
    }

    if (attempts < maxAttempts) {
      setTimeout(attemptRestore, 50);
    }
  };

  requestAnimationFrame(attemptRestore);

  return () => {
    cancelled = true;
  };
}
