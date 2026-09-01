/**
 * Safe LocalStorage Utilities & Storage Quota Protection
 */

export function getStorageMetrics(): { keys: Record<string, number>; totalKB: number } {
  if (typeof window === "undefined" || !window.localStorage) {
    return { keys: {}, totalKB: 0 };
  }
  const keys: Record<string, number> = {};
  let totalBytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) {
        const val = localStorage.getItem(k) || "";
        const bytes = (k.length + val.length) * 2;
        const kb = Math.round((bytes / 1024) * 100) / 100;
        keys[k] = kb;
        totalBytes += bytes;
      }
    }
  } catch (_) {}
  const totalKB = Math.round((totalBytes / 1024) * 100) / 100;
  return { keys, totalKB };
}

export function purgeObsoleteStorage(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    // Keys to always purge if storage pressure occurs or on startup
    const keysToRemove = [
      "tuition_topic_practice_tests_bank",
      "tuition_practice_tests_sync_queue",
      "uploaded_pdf_",
      "tuition_ai_report_",
      "mock_storage_meta_"
    ];

    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k) continue;

      // Purge match
      const shouldPurge = keysToRemove.some((prefix) => k.startsWith(prefix) || k.includes(prefix));
      if (shouldPurge) {
        localStorage.removeItem(k);
      }
    }
  } catch (err) {
    console.warn("[SafeStorage] Purge error:", err);
  }
}

export function autoCleanupStorageIfOverLimit(limitMB: number = 2): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const { totalKB } = getStorageMetrics();
    const limitKB = limitMB * 1024;
    
    // Check if any legacy heavy test cache exists
    const legacyTestsCache = localStorage.getItem("tuition_topic_practice_tests_bank");
    if (legacyTestsCache && (legacyTestsCache.includes('"questions"') || legacyTestsCache.includes('"rawText"'))) {
      console.warn("[SafeStorage] Legacy heavy practice test cache detected. Purging immediately.");
      localStorage.removeItem("tuition_topic_practice_tests_bank");
    }

    if (totalKB > limitKB) {
      console.warn(`[SafeStorage] Storage usage (${totalKB} KB) exceeds threshold (${limitKB} KB). Cleaning up non-essential caches.`);
      purgeObsoleteStorage();
    }
  } catch (_) {}
}

const MAX_LOCAL_STORAGE_ITEM_BYTES = 2 * 1024 * 1024; // 2 MB per item limit to comfortably allow class notes and student lists

function estimateBytes(value: string): number {
  return value.length * 2;
}

export function safeLocalStorageSetItem(key: string, value: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;

  const itemBytes = estimateBytes(value);
  if (itemBytes > MAX_LOCAL_STORAGE_ITEM_BYTES) {
    console.warn(
      `[SafeStorage] Refusing to store key "${key}" because size ${Math.round(itemBytes / 1024)} KB exceeds ${Math.round(
        MAX_LOCAL_STORAGE_ITEM_BYTES / 1024
      )} KB limit.`
    );
    return;
  }

  try {
    localStorage.setItem(key, value);
  } catch (err: any) {
    console.warn(`[SafeStorage] QuotaExceededError or write failure for key "${key}". Executing storage recovery.`, err);
    try {
      purgeObsoleteStorage();
      localStorage.setItem(key, value);
    } catch (retryErr) {
      console.error(`[SafeStorage] Retry failed for key "${key}". Swallowing error to prevent crash.`, retryErr);
      try {
        localStorage.removeItem(key);
      } catch (_) {}
    }
  }
}

export function safeLocalStorageGetItem(key: string): string | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.warn(`[SafeStorage] getItem failed for key "${key}":`, e);
    return null;
  }
}

export function safeLocalStorageRemoveItem(key: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.removeItem(key);
  } catch (e) {
    console.warn(`[SafeStorage] removeItem failed for key "${key}":`, e);
  }
}

/**
 * Generates a strictly isolated, user-scoped storage key
 */
export function getUserScopedKey(uid: string | null | undefined, keySuffix: string): string {
  if (!uid || typeof uid !== "string" || !uid.trim()) {
    return `tuition_${keySuffix}_unauthenticated`;
  }
  return `tuition_${keySuffix}_${uid.trim()}`;
}

/**
 * Reads user-scoped data securely with JSON parsing
 */
export function getUserScopedItem<T = any>(uid: string | null | undefined, keySuffix: string): T | null {
  if (!uid) return null;
  const key = getUserScopedKey(uid, keySuffix);
  const raw = safeLocalStorageGetItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn(`[SafeStorage] Failed parsing user-scoped key "${key}":`, e);
    return null;
  }
}

/**
 * Stores user-scoped data securely with JSON serialization
 */
export function setUserScopedItem(uid: string | null | undefined, keySuffix: string, value: any): void {
  if (!uid) {
    console.warn(`[SafeStorage] Attempted to set user-scoped key "${keySuffix}" without valid UID.`);
    return;
  }
  const key = getUserScopedKey(uid, keySuffix);
  try {
    safeLocalStorageSetItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`[SafeStorage] setUserScopedItem failed for key "${key}":`, e);
  }
}

/**
 * Removes user-scoped item
 */
export function removeUserScopedItem(uid: string | null | undefined, keySuffix: string): void {
  if (!uid) return;
  const key = getUserScopedKey(uid, keySuffix);
  safeLocalStorageRemoveItem(key);
}

/**
 * Completely purges all cached data owned by a specific UID on logout or session reset
 */
export function clearAllUserScopedData(uid?: string | null): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const targetSuffix = uid ? `_${uid.trim()}` : null;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k) continue;

      if (targetSuffix && k.endsWith(targetSuffix)) {
        localStorage.removeItem(k);
      } else if (!uid && (k.startsWith("tuition_students_data") || k.startsWith("tuition_user_data") || k.startsWith("tuition_session_"))) {
        localStorage.removeItem(k);
      }
    }
  } catch (e) {
    console.warn("[SafeStorage] clearAllUserScopedData error:", e);
  }
}

/**
 * Migrates legacy un-scoped global caches into UID-scoped keys and purges legacy keys
 */
export function migrateLegacyCachesToUserScope(uid: string): void {
  if (typeof window === "undefined" || !window.localStorage || !uid || !uid.trim()) return;
  try {
    // 1. Legacy global students cache
    const legacyStudents = localStorage.getItem("tuition_students_data");
    if (legacyStudents) {
      const scopedKey = getUserScopedKey(uid, "students_data");
      if (!localStorage.getItem(scopedKey)) {
        localStorage.setItem(scopedKey, legacyStudents);
      }
      localStorage.removeItem("tuition_students_data");
    }

    // 2. Legacy global users cache
    const legacyUsers = localStorage.getItem("tuition_users_data");
    if (legacyUsers) {
      const scopedKey = getUserScopedKey(uid, "user_data");
      if (!localStorage.getItem(scopedKey)) {
        localStorage.setItem(scopedKey, legacyUsers);
      }
      localStorage.removeItem("tuition_users_data");
    }
  } catch (err) {
    console.warn("[SafeStorage] Legacy cache migration notice:", err);
  }
}

// Automatically execute safety check on script load
if (typeof window !== "undefined") {
  autoCleanupStorageIfOverLimit(1.5);
}
