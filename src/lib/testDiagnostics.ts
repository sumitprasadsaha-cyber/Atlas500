/**
 * Structured Diagnostics & Runtime Validation Engine for Practice Testing (v7.9.2)
 * 
 * Provides unified, structured telemetry across all test engine layers:
 * [Test], [Attempt], [Timer], [React], [Firestore], [Cache], [Memory], [Render], [Autosave], [Network], [Resume], [Recovery]
 * 
 * Enforces development assertions against duplicate listeners, duplicate timers, and render storms.
 */

export type DiagnosticCategory =
  | "Test"
  | "Attempt"
  | "Timer"
  | "React"
  | "Firestore"
  | "Cache"
  | "Memory"
  | "Render"
  | "Autosave"
  | "Network"
  | "Resume"
  | "Recovery";

export interface DiagnosticContext {
  requestId?: string;
  sessionId?: string;
  uid?: string | null;
  studentId?: string | null;
  testId?: string | null;
  attemptId?: string | null;
  questionNumber?: number;
  renderCount?: number;
  listenerCount?: number;
  activeTimers?: number;
  heapEstimate?: string;
  [key: string]: any;
}

// Active listener and timer registries for leak detection
const activeListenersRegistry = new Map<string, number>();
const activeTimersRegistry = new Set<string>();
const recentRenderTimestamps: number[] = [];

function getHeapEstimate(): string {
  if (typeof window !== "undefined" && (window.performance as any)?.memory) {
    const mem = (window.performance as any).memory;
    const usedMB = Math.round(mem.usedJSHeapSize / (1024 * 1024));
    const totalMB = Math.round(mem.totalJSHeapSize / (1024 * 1024));
    return `${usedMB}MB / ${totalMB}MB`;
  }
  return "N/A";
}

export const TestLogger = {
  log(category: DiagnosticCategory, action: string, context?: DiagnosticContext) {
    const heap = context?.heapEstimate || getHeapEstimate();
    const payload = {
      timestamp: new Date().toISOString(),
      category,
      action,
      heapEstimate: heap,
      ...context
    };

    if (process.env.NODE_ENV !== "production") {
      console.log(`[${category}] ${action}`, payload);
    }
  },

  warn(category: DiagnosticCategory, message: string, context?: DiagnosticContext) {
    const heap = context?.heapEstimate || getHeapEstimate();
    console.warn(`[${category}] WARNING: ${message}`, {
      timestamp: new Date().toISOString(),
      heapEstimate: heap,
      ...context
    });
  },

  error(category: DiagnosticCategory, message: string, error?: any, context?: DiagnosticContext) {
    const heap = context?.heapEstimate || getHeapEstimate();
    console.error(`[${category}] ERROR: ${message}`, {
      timestamp: new Date().toISOString(),
      error: error?.message || error,
      stack: error?.stack,
      heapEstimate: heap,
      ...context
    });
  },

  // --- Runtime Validation Assertions ---

  registerListener(key: string) {
    const current = (activeListenersRegistry.get(key) || 0) + 1;
    activeListenersRegistry.set(key, current);
    if (current > 1 && process.env.NODE_ENV !== "production") {
      TestLogger.warn("Firestore", `Duplicate listener registered for key "${key}". Current count: ${current}`);
    }
    return () => {
      const remaining = (activeListenersRegistry.get(key) || 1) - 1;
      if (remaining <= 0) {
        activeListenersRegistry.delete(key);
      } else {
        activeListenersRegistry.set(key, remaining);
      }
    };
  },

  registerTimer(timerId: string) {
    if (activeTimersRegistry.has(timerId) && process.env.NODE_ENV !== "production") {
      TestLogger.warn("Timer", `Duplicate timer registered: "${timerId}"`);
    }
    activeTimersRegistry.add(timerId);
    return () => {
      activeTimersRegistry.delete(timerId);
    };
  },

  checkRenderStorm(componentName: string, renderCount: number) {
    if (process.env.NODE_ENV === "production") return;
    const now = Date.now();
    recentRenderTimestamps.push(now);
    // Keep only timestamps within last 5 seconds
    while (recentRenderTimestamps.length > 0 && recentRenderTimestamps[0] < now - 5000) {
      recentRenderTimestamps.shift();
    }
    if (recentRenderTimestamps.length > 35) {
      TestLogger.warn("Render", `Render storm detected in ${componentName}! (${recentRenderTimestamps.length} renders in last 5s, total renderCount=${renderCount})`);
    }
  },

  getActiveListenerCount(): number {
    let sum = 0;
    activeListenersRegistry.forEach((v) => { sum += v; });
    return sum;
  },

  getActiveTimerCount(): number {
    return activeTimersRegistry.size;
  },

  incrementTimerCount(name: string) {
    activeTimersRegistry.add(name);
  },

  decrementTimerCount(name: string) {
    activeTimersRegistry.delete(name);
  },

  recordCrashRecovery(details?: any) {
    TestLogger.log("Recovery", "Interrupted session draft recovered successfully", details);
  }
};

export const testDiagnostics = TestLogger;
