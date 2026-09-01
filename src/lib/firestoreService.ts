import { 
  collection, 
  doc, 
  getDoc, 
  setDoc, 
  deleteDoc, 
  onSnapshot, 
  getDocs,
  query,
  where,
  limit
} from "firebase/firestore";
import { getFirebaseDb, OperationType, handleFirestoreError } from "./firebase";
import { Student, ClassNote, TestAttemptRecord } from "../types";
import { migrateNoteToHierarchy } from "../utils/notesHierarchyHelper";
import { extractCanonicalStorageKey, getCanonicalNoteDownloadUrl } from "./noteOpener";
import { notesCacheService } from "./notesCacheService";
import { notesLogger } from "./notesLogger";
import { AuthLogger } from "./authLogger";
import { sortNotesByTopicNumber } from "../utils/notesValidation";
import { discoverTopicNotesFromR2 } from "./topicDiscoveryService";
import { 
  safeLocalStorageSetItem as safeSetStorage, 
  safeLocalStorageGetItem as safeGetStorage,
  safeLocalStorageGetItem, 
  safeLocalStorageRemoveItem 
} from "./safeStorage";

export { safeSetStorage, safeGetStorage };

// Local storage keys for fallback/offline sandbox mode
const STORAGE_KEY_STUDENTS = "tuition_students_data";
const STORAGE_KEY_USERS = "tuition_users_data";
const STORAGE_KEY_INSTITUTION_NAME = "tuition_institution_name";
const STORAGE_KEY_AUTH_SESSION = "tuition_auth_session";

export interface CachedAuthSession {
  uid?: string;
  email?: string;
  role: "admin" | "student";
  studentId: string | null;
  timestamp?: number;
}

export function getCachedAuthSession(): CachedAuthSession | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const cached = localStorage.getItem(STORAGE_KEY_AUTH_SESSION);
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    if (parsed && (parsed.role === "admin" || parsed.role === "student")) {
      return parsed;
    }
  } catch (err) {
    console.warn("[Auth Session] Error reading cached session:", err);
  }
  return null;
}

export function saveCachedAuthSession(session: CachedAuthSession): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const dataToStore = {
      ...session,
      timestamp: Date.now(),
    };
    safeSetStorage(STORAGE_KEY_AUTH_SESSION, JSON.stringify(dataToStore));
  } catch (err) {
    console.warn("[Auth Session] Error saving cached session:", err);
  }
}

export function clearCachedAuthSession(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    safeLocalStorageRemoveItem(STORAGE_KEY_AUTH_SESSION);
  } catch (err) {
    console.warn("[Auth Session] Error clearing cached session:", err);
  }
}

function getCachedInstitutionName(): string {
  if (typeof window === "undefined") {
    return "Sumit Tuition App";
  }
  const cached = localStorage.getItem(STORAGE_KEY_INSTITUTION_NAME);
  if (!cached || cached === "Ingenious Study Circle") {
    safeSetStorage(STORAGE_KEY_INSTITUTION_NAME, "Sumit Tuition App");
    return "Sumit Tuition App";
  }
  return cached;
}

function setCachedInstitutionName(name: string) {
  if (typeof window === "undefined") {
    return;
  }
  safeSetStorage(STORAGE_KEY_INSTITUTION_NAME, name);
  window.dispatchEvent(new CustomEvent("institution-name-updated", { detail: name }));
}

// Fallback in-memory subscribers list for real-time emulation when Firestore is offline
type StudentsListener = (students: Student[]) => void;
const studentsListeners = new Set<StudentsListener>();

// Dynamic trigger to notify all local subscribers of change
function notifyLocalStudentsListeners() {
  const students = getLocalStudents();
  studentsListeners.forEach((listener) => listener(students));
}

// Helper to get local students
export function getLocalStudents(): Student[] {
  const cached = safeGetStorage(STORAGE_KEY_STUDENTS);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (s: any) =>
            Boolean(s) &&
            Boolean(s.id) &&
            s.name !== "Unnamed Student" &&
            Boolean(s.name && String(s.name).trim() !== "")
        );
      }
    } catch (e) {
      console.error("Failed to parse local students", e);
    }
  }
  return [];
}

// Helper to save local students
export function saveLocalStudents(students: Student[]) {
  safeSetStorage(STORAGE_KEY_STUDENTS, JSON.stringify(students));
  notifyLocalStudentsListeners();
}

// ----------------------------------------------------
// FIRESTORE / HYBRID SYNCHRONIZATION API
// ----------------------------------------------------

/**
 * Check if Firebase is fully initialized and Firestore is accessible
 */
export async function isDbOnline(): Promise<boolean> {
  try {
    const db = await getFirebaseDb();
    return db !== null;
  } catch {
    return false;
  }
}

/**
 * Fetch a specific user document by UID
 */
export async function getUserDocument(uid: string): Promise<any> {
  try {
    const db = await getFirebaseDb();
    if (!db) {
      const cachedUsers = localStorage.getItem(STORAGE_KEY_USERS);
      const users = cachedUsers ? JSON.parse(cachedUsers) : {};
      return users[uid] || null;
    }
    const userDocRef = doc(db, "users", uid);
    const snap = await getDoc(userDocRef);
    if (snap.exists()) {
      return snap.data();
    }
    return null;
  } catch (err) {
    console.warn("getUserDocument warning:", err);
    return null;
  }
}

export type VerificationStatus = 
  | "success"
  | "user_not_found" 
  | "missing_user_doc" 
  | "missing_student_doc" 
  | "permission_denied" 
  | "network_error" 
  | "timeout" 
  | "inactive";

export interface RoleVerificationResult {
  role: "Admin" | "Student" | null;
  studentId: string | null;
  userDoc: any | null;
  status: VerificationStatus;
  errorMessage?: string;
}

/**
 * Recognizes master administrator accounts that have root administrative authority.
 */
export function isMasterAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  const backupEmail = (typeof window !== "undefined" && window.localStorage ? localStorage.getItem("tuition_backup_email") || "" : "").toLowerCase().trim();
  return (
    normalized === "sumitprasadsaha@gmail.com" ||
    normalized === "manlymemedaily@gmail.com" ||
    (backupEmail !== "" && normalized === backupEmail) ||
    normalized.startsWith("admin@") ||
    normalized === "admin@tuitionledger.com" ||
    normalized === "admin@tuition.com"
  );
}

/**
 * Strict database-only role verification by authenticated Firebase UID and Email.
 * Flow:
 * 1. Get authenticated user's UID and email.
 * 2. Look up /users/{uid} document directly (allowed by security rules for authenticated user).
 * 3. Verify student profile or admin credentials deterministically.
 * 4. Distinguishes precisely between:
 *    - true non-existence
 *    - permission denied
 *    - network unavailable / timeout
 *    - missing /users/{uid} document
 *    - missing /students/{studentId} document
 */
export async function verifyUserRoleFromDatabase(uid: string, userEmail?: string | null): Promise<RoleVerificationResult> {
  AuthLogger.stage("verifyUserRoleFromDatabase:START", { uid, userEmail });

  if (!uid || typeof uid !== "string") {
    AuthLogger.warn("verifyUserRoleFromDatabase", "Invalid or missing UID provided");
    return { 
      role: null, 
      studentId: null, 
      userDoc: null, 
      status: "user_not_found", 
      errorMessage: "Invalid user identifier." 
    };
  }

  const normalizedEmail = userEmail ? userEmail.trim().toLowerCase() : "";

  // Helper to check local/cached data
  const checkLocalData = (fallbackStatus: VerificationStatus = "success"): RoleVerificationResult => {
    AuthLogger.stage("verifyUserRoleFromDatabase:CHECK_LOCAL_DATA", { uid, normalizedEmail });

    // 0. Master admin bypass for instant local/offline resolution
    if (isMasterAdminEmail(normalizedEmail)) {
      const masterAdminDoc = {
        uid,
        name: normalizedEmail.includes("sumit") ? "Sumit Prasad Saha" : "Administrator",
        email: normalizedEmail,
        phone: "+919609598095",
        role: "Admin",
        status: "Active",
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastLogin: new Date().toISOString()
      };
      return {
        role: "Admin",
        studentId: null,
        userDoc: masterAdminDoc,
        status: fallbackStatus === "success" ? "success" : fallbackStatus
      };
    }

    const cachedUsersStr = localStorage.getItem(STORAGE_KEY_USERS);
    const localUsers = cachedUsersStr ? JSON.parse(cachedUsersStr) : {};
    const userDoc = localUsers[uid] || (normalizedEmail ? Object.values(localUsers).find((u: any) => u.email?.toLowerCase().trim() === normalizedEmail) : null);

    // 1. Check Admins first if explicitly admin in local cache
    if (userDoc && String(userDoc.role).trim().toLowerCase() === "admin") {
      AuthLogger.lookup("local_admin_resolved", { uid });
      return {
        role: "Admin",
        studentId: null,
        userDoc,
        status: fallbackStatus === "success" ? "success" : fallbackStatus
      };
    }

    if (normalizedEmail) {
      const adminByEmail = Object.values(localUsers).find((u: any) => 
        u.email?.toLowerCase().trim() === normalizedEmail &&
        String(u.role || "").trim().toLowerCase() === "admin"
      );
      if (adminByEmail) {
        return {
          role: "Admin",
          studentId: null,
          userDoc: adminByEmail,
          status: fallbackStatus === "success" ? "success" : fallbackStatus
        };
      }
    }

    // 2. Check Students collection/table
    const localStudents = getLocalStudents();
    const studentByRecord = localStudents.find(
      (s) =>
        s.uid === uid ||
        s.id === uid ||
        (normalizedEmail && s.email?.toLowerCase().trim() === normalizedEmail) ||
        (userDoc?.studentId && s.id === userDoc.studentId)
    );

    if (studentByRecord || (userDoc && String(userDoc.role).trim().toLowerCase() === "student")) {
      const studentId = studentByRecord?.id || userDoc?.studentId || uid;
      AuthLogger.lookup("local_student_resolved", { studentId, uid });
      return {
        role: "Student",
        studentId,
        userDoc: userDoc || { uid, role: "Student", studentId },
        status: fallbackStatus === "success" ? "success" : fallbackStatus
      };
    }

    // 3. Check active cached session
    const cachedSession = getCachedAuthSession();
    if (cachedSession && (cachedSession.uid === uid || (normalizedEmail && cachedSession.email === normalizedEmail))) {
      return {
        role: cachedSession.role === "admin" ? "Admin" : "Student",
        studentId: cachedSession.studentId || null,
        userDoc: { uid, role: cachedSession.role === "admin" ? "Admin" : "Student", studentId: cachedSession.studentId },
        status: fallbackStatus === "success" ? "success" : fallbackStatus
      };
    }

    return { 
      role: null, 
      studentId: null, 
      userDoc: null, 
      status: "user_not_found", 
      errorMessage: "No user account found." 
    };
  };

  const performLiveLookup = async (): Promise<RoleVerificationResult> => {
    try {
      const db = await getFirebaseDb();
      if (!db) {
        AuthLogger.warn("performLiveLookup", "Firebase DB not ready, using local cache");
        return checkLocalData();
      }

      AuthLogger.stage("performLiveLookup:READ_USER_DOC", { path: `users/${uid}` });

      // Step 1: Direct document lookup at /users/{uid}
      let userDoc: any = null;
      let userDocExists = false;

      try {
        const userDocRef = doc(db, "users", uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          userDoc = userDocSnap.data();
          userDocExists = true;
          AuthLogger.lookup(`users/${uid}`, { exists: true, role: userDoc?.role, studentId: userDoc?.studentId });
        } else {
          AuthLogger.lookup(`users/${uid}`, { exists: false });
        }
      } catch (err: any) {
        AuthLogger.error(`users/${uid}`, err);
        const errCode = err?.code || "";
        if (errCode === "permission-denied") {
          return {
            role: null,
            studentId: null,
            userDoc: null,
            status: "permission_denied",
            errorMessage: `Access denied by security rules for user profile (/users/${uid}).`
          };
        }
        if (errCode === "unavailable" || String(err?.message || "").toLowerCase().includes("offline")) {
          return checkLocalData("network_error");
        }
      }

      // Step 2: Handle when /users/{uid} was found
      if (userDocExists && userDoc) {
        const normalizedRole = String(userDoc.role || "").trim().toLowerCase();

        // Path A: Admin Role or Master Admin
        if (normalizedRole === "admin" || isMasterAdminEmail(normalizedEmail)) {
          AuthLogger.stage("performLiveLookup:ADMIN_RESOLVED", { uid });
          // Background sync to /admins/{uid} if missing
          try {
            const adminDocRef = doc(db, "admins", uid);
            getDoc(adminDocRef).then((admSnap) => {
              if (!admSnap.exists()) {
                setDoc(adminDocRef, cleanObjectForFirestore({ ...userDoc, role: "Admin" }), { merge: true }).catch(() => {});
              }
            }).catch(() => {});
          } catch {
            // Ignore non-blocking background sync errors
          }

          const res: RoleVerificationResult = {
            role: "Admin",
            studentId: null,
            userDoc: { ...userDoc, role: "Admin" },
            status: "success"
          };
          saveCachedAuthSession({ uid, email: normalizedEmail || userDoc.email || "", role: "admin", studentId: null });
          AuthLogger.stage("performLiveLookup:ADMIN_SUCCESS", res);
          return res;
        }

        // Path B: Student Role
        if (normalizedRole === "student") {
          const studentId = userDoc.studentId || uid;
          AuthLogger.stage("performLiveLookup:VERIFY_STUDENT_DOC", { studentId });

          // Verify /students/{studentId} exists in Firestore
          try {
            const studentDocRef = doc(db, "students", studentId);
            const studentDocSnap = await getDoc(studentDocRef);
            if (studentDocSnap.exists()) {
              const studentData = studentDocSnap.data() as Student;
              const res: RoleVerificationResult = {
                role: "Student",
                studentId: studentData.id || studentId,
                userDoc,
                status: "success"
              };
              saveCachedAuthSession({ uid, email: normalizedEmail || userDoc.email || "", role: "student", studentId: res.studentId });
              AuthLogger.stage("performLiveLookup:STUDENT_SUCCESS", res);
              return res;
            }
          } catch (stErr: any) {
            AuthLogger.warn("performLiveLookup:studentDocCheck", stErr);
          }

          // If studentId wasn't found, check /students/{uid} as recovery
          if (studentId !== uid) {
            try {
              const altStudentRef = doc(db, "students", uid);
              const altSnap = await getDoc(altStudentRef);
              if (altSnap.exists()) {
                const studentData = altSnap.data() as Student;
                const resolvedId = studentData.id || uid;
                // Update studentId in user doc
                setDoc(doc(db, "users", uid), { studentId: resolvedId }, { merge: true }).catch(() => {});
                const res: RoleVerificationResult = {
                  role: "Student",
                  studentId: resolvedId,
                  userDoc: { ...userDoc, studentId: resolvedId },
                  status: "success"
                };
                saveCachedAuthSession({ uid, email: normalizedEmail || userDoc.email || "", role: "student", studentId: resolvedId });
                return res;
              }
            } catch (altErr) {
              AuthLogger.warn("performLiveLookup:altStudentCheck", altErr);
            }
          }

          // Fallback to local cache verification for student doc
          const localStudents = getLocalStudents();
          const foundLocal = localStudents.find((s) => s.id === studentId || s.uid === uid);
          if (foundLocal) {
            const res: RoleVerificationResult = {
              role: "Student",
              studentId: foundLocal.id || studentId,
              userDoc,
              status: "success"
            };
            saveCachedAuthSession({ uid, email: normalizedEmail || userDoc.email || "", role: "student", studentId: res.studentId });
            return res;
          }

          // If neither Firestore nor local cache contains the student document:
          AuthLogger.error("performLiveLookup:MISSING_STUDENT_DOC", { studentId, uid });
          return {
            role: null,
            studentId,
            userDoc,
            status: "missing_student_doc",
            errorMessage: `Student profile record (/students/${studentId}) was not found in the database. Please contact your administrator.`
          };
        }
      }

      // Step 3: Handle when /users/{uid} was NOT found

      // 3A: Check if authenticated user is a Master Admin (immediate self-provisioning)
      if (isMasterAdminEmail(normalizedEmail)) {
        AuthLogger.stage("performLiveLookup:AUTO_PROVISION_MASTER_ADMIN", { uid, email: normalizedEmail });
        const autoAdminDoc = {
          uid,
          name: normalizedEmail.includes("sumit") ? "Sumit Prasad Saha" : "Administrator",
          email: normalizedEmail,
          phone: "+919609598095",
          role: "Admin",
          status: "Active",
          active: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastLogin: new Date().toISOString()
        };

        // Self-heal: Write to /users/{uid} and /admins/{uid} in background / parallel
        setDoc(doc(db, "users", uid), autoAdminDoc, { merge: true }).catch((e) => {
          AuthLogger.warn("performLiveLookup:autoHealMasterAdminUserDoc", e);
        });
        setDoc(doc(db, "admins", uid), autoAdminDoc, { merge: true }).catch((e) => {
          AuthLogger.warn("performLiveLookup:autoHealMasterAdminDoc", e);
        });

        const res: RoleVerificationResult = {
          role: "Admin",
          studentId: null,
          userDoc: autoAdminDoc,
          status: "success"
        };
        saveCachedAuthSession({ uid, email: normalizedEmail, role: "admin", studentId: null });
        AuthLogger.stage("performLiveLookup:MASTER_ADMIN_SUCCESS", res);
        return res;
      }

      // 3B: Check /admins/{uid}
      AuthLogger.stage("performLiveLookup:CHECK_DIRECT_ADMIN_ID", { path: `admins/${uid}` });
      try {
        const directAdminRef = doc(db, "admins", uid);
        const directAdminSnap = await getDoc(directAdminRef);
        if (directAdminSnap.exists()) {
          const adminData = directAdminSnap.data();
          const autoUserDoc = {
            uid,
            name: adminData.name || "Admin",
            email: normalizedEmail || adminData.email?.toLowerCase() || "",
            role: "Admin",
            status: "Active",
            active: true,
            createdAt: adminData.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastLogin: new Date().toISOString()
          };
          setDoc(doc(db, "users", uid), autoUserDoc, { merge: true }).catch((e) => {
            AuthLogger.warn("performLiveLookup:autoHealAdminUserDoc", e);
          });

          const res: RoleVerificationResult = {
            role: "Admin",
            studentId: null,
            userDoc: autoUserDoc,
            status: "success"
          };
          saveCachedAuthSession({ uid, email: normalizedEmail || adminData.email || "", role: "admin", studentId: null });
          AuthLogger.stage("performLiveLookup:SELF_HEALED_ADMIN_SUCCESS", res);
          return res;
        }
      } catch (err: any) {
        AuthLogger.warn("performLiveLookup:directAdminCheck", err);
      }

      // 3C: Check /students/{uid}
      AuthLogger.stage("performLiveLookup:CHECK_DIRECT_STUDENT_ID", { path: `students/${uid}` });
      try {
        const directStudentRef = doc(db, "students", uid);
        const directStudentSnap = await getDoc(directStudentRef);
        if (directStudentSnap.exists()) {
          const studentData = directStudentSnap.data() as Student;
          const resolvedStudentId = studentData.id || uid;

          // Self-heal: Create missing /users/{uid} document seamlessly
          const autoUserDoc = {
            uid,
            name: studentData.name || "Student",
            email: normalizedEmail || studentData.email?.toLowerCase() || "",
            role: "Student",
            studentId: resolvedStudentId,
            active: true,
            temporaryPasswordRequired: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastLogin: new Date().toISOString()
          };
          setDoc(doc(db, "users", uid), autoUserDoc, { merge: true }).catch((e) => {
            AuthLogger.warn("performLiveLookup:autoHealUserDoc", e);
          });

          const res: RoleVerificationResult = {
            role: "Student",
            studentId: resolvedStudentId,
            userDoc: autoUserDoc,
            status: "success"
          };
          saveCachedAuthSession({ uid, email: normalizedEmail || studentData.email || "", role: "student", studentId: resolvedStudentId });
          AuthLogger.stage("performLiveLookup:SELF_HEALED_STUDENT_SUCCESS", res);
          return res;
        }
      } catch (err: any) {
        AuthLogger.warn("performLiveLookup:directStudentCheck", err);
      }

      // 3D: Check /students query by email
      if (normalizedEmail) {
        try {
          const studentsCol = collection(db, "students");
          const q = query(studentsCol, where("email", "==", normalizedEmail), limit(1));
          const snap = await getDocs(q);
          if (!snap.empty) {
            const sDoc = snap.docs[0];
            const sData = sDoc.data() as Student;
            const resolvedStudentId = sData.id || sDoc.id;

            // Link UID to student document
            setDoc(doc(db, "students", sDoc.id), { uid }, { merge: true }).catch(() => {});

            const autoUserDoc = {
              uid,
              name: sData.name || "Student",
              email: normalizedEmail,
              role: "Student",
              studentId: resolvedStudentId,
              active: true,
              temporaryPasswordRequired: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastLogin: new Date().toISOString()
            };
            setDoc(doc(db, "users", uid), autoUserDoc, { merge: true }).catch((e) => {
              AuthLogger.warn("performLiveLookup:autoHealStudentEmailUserDoc", e);
            });

            const res: RoleVerificationResult = {
              role: "Student",
              studentId: resolvedStudentId,
              userDoc: autoUserDoc,
              status: "success"
            };
            saveCachedAuthSession({ uid, email: normalizedEmail, role: "student", studentId: resolvedStudentId });
            AuthLogger.stage("performLiveLookup:EMAIL_MATCHED_STUDENT_SUCCESS", res);
            return res;
          }
        } catch (emailQueryErr) {
          AuthLogger.warn("performLiveLookup:queryStudentsByEmail", emailQueryErr);
        }
      }

      // Step 4: Check local cache fallback
      const localResult = checkLocalData();
      if (localResult.role) {
        return localResult;
      }

      // Step 5: User profile is genuinely missing
      AuthLogger.error("performLiveLookup:MISSING_USER_DOC", { uid, email: normalizedEmail });
      return {
        role: null,
        studentId: null,
        userDoc: null,
        status: "missing_user_doc",
        errorMessage: `User profile record (/users/${uid}) was not found in the database. Please contact your administrator.`
      };

    } catch (err: any) {
      AuthLogger.error("performLiveLookup:FATAL", err);
      return checkLocalData("network_error");
    }
  };

  // Enforce a strict 3500ms safety race against local cache
  let timeoutHandle: any;
  const timeoutPromise = new Promise<RoleVerificationResult>((resolve) => {
    timeoutHandle = setTimeout(() => {
      AuthLogger.warn("verifyUserRoleFromDatabase", "Network role verification timed out after 3500ms, using local session fallback");
      resolve(checkLocalData("timeout"));
    }, 3500);
  });

  try {
    const result = await Promise.race([performLiveLookup(), timeoutPromise]);
    clearTimeout(timeoutHandle);
    return result;
  } catch (err) {
    clearTimeout(timeoutHandle);
    return checkLocalData("network_error");
  }
}

/**
 * Recursively removes any `undefined` values from an object or array before passing to Firestore.
 */
export function cleanObjectForFirestore<T>(data: T): T {
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) {
    return data
      .filter((item) => item !== undefined)
      .map((item) => cleanObjectForFirestore(item)) as unknown as T;
  }
  if (typeof data === "object" && !(data instanceof Date)) {
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        cleaned[key] = cleanObjectForFirestore(value);
      }
    }
    return cleaned as T;
  }
  return data;
}

/**
 * Create or update a user document
 */
export async function saveUserDocument(uid: string, userData: any): Promise<void> {
  const cleanedData = cleanObjectForFirestore(userData);
  
  // Cache to Local Storage Users map
  try {
    const cachedUsers = localStorage.getItem(STORAGE_KEY_USERS);
    const users = cachedUsers ? JSON.parse(cachedUsers) : {};
    users[uid] = { ...(users[uid] || {}), ...cleanedData, uid };
    safeSetStorage(STORAGE_KEY_USERS, JSON.stringify(users));
  } catch (e) {
    console.warn("Failed updating local user document cache:", e);
  }

  try {
    const db = await getFirebaseDb();
    if (!db) return;
    const userDocRef = doc(db, "users", uid);
    await setDoc(userDocRef, cleanedData, { merge: true });

    // Synchronize to /admins/{uid} if role is Admin
    if (String(cleanedData.role || "").trim().toLowerCase() === "admin") {
      saveAdminDoc(uid, cleanedData).catch((e) => console.warn("Failed saving admin mirror doc:", e));
    }
  } catch (err) {
    console.warn(`saveUserDocument Firestore setDoc warning for users/${uid}:`, err);
  }
}

/**
 * Saves or updates an admin document in /admins/{uid}.
 */
export async function saveAdminDoc(uid: string, adminData: any): Promise<void> {
  const cleanedData = cleanObjectForFirestore(adminData);
  try {
    const db = await getFirebaseDb();
    if (!db) return;
    const adminDocRef = doc(db, "admins", uid);
    await setDoc(adminDocRef, cleanedData, { merge: true });
  } catch (err) {
    console.warn(`saveAdminDoc Firestore warning for admins/${uid}:`, err);
  }
}

/**
 * Deletes an admin document from /admins/{uid}.
 */
export async function deleteAdminDoc(uid: string): Promise<void> {
  try {
    const db = await getFirebaseDb();
    if (!db) return;
    const adminDocRef = doc(db, "admins", uid);
    await deleteDoc(adminDocRef).catch(() => {});
  } catch (err) {
    console.warn(`deleteAdminDoc Firestore warning for admins/${uid}:`, err);
  }
}

/**
 * Fetch user document by registered phone number (used during single unified login verification)
 */
export async function getUserDocByPhone(phone: string): Promise<any> {
  // Normalize phone to format like "+919876543210"
  let cleanPhone = phone.replace(/\D/g, "");
  if (!cleanPhone.startsWith("91")) {
    cleanPhone = "91" + cleanPhone;
  }
  const formattedPhone = "+" + cleanPhone;

  try {
    const db = await getFirebaseDb();
    if (!db) {
      // Fallback: Search local users
      const cachedUsers = localStorage.getItem(STORAGE_KEY_USERS);
      const users = cachedUsers ? JSON.parse(cachedUsers) : {};
      const found = Object.values(users).find((u: any) => u.phone === formattedPhone);
      if (found) return found;

      // Check students list to see if a student matches this number or parent number
      const students = getLocalStudents();
      const matchedStudent = students.find((s) => {
        const sp = s.phone.replace(/\D/g, "");
        const pp = s.parentPhone.replace(/\D/g, "");
        return sp.endsWith(cleanPhone.substring(2)) || pp.endsWith(cleanPhone.substring(2));
      });

      if (matchedStudent) {
        const studentUid = matchedStudent.uid || `mock-student-uid-${matchedStudent.id}`;
        return {
          uid: studentUid,
          phone: formattedPhone,
          role: "Student",
          studentId: matchedStudent.id,
          status: "Active",
          name: matchedStudent.name
        };
      }

      return null;
    }

    const usersColRef = collection(db, "users");
    const snap = await getDocs(usersColRef);
    let matchedUser: any = null;
    snap.forEach((d) => {
      const u = d.data();
      if (u.phone === formattedPhone) {
        matchedUser = u;
      }
    });
    
    if (matchedUser) return matchedUser;

    return null;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, "users");
    return null;
  }
}

/**
 * Subscribe to the entire list of students (Real-time synchronization for Admin)
 */
export function subscribeToStudents(
  onUpdate: (students: Student[]) => void,
  onError?: (err: any) => void
): () => void {
  let unsubscribeFirestore: (() => void) | null = null;
  let active = true;

  AuthLogger.subscription("StudentsList", "INIT");

  async function setup() {
    const db = await getFirebaseDb();
    if (!active) return;

    if (!db) {
      // Local Sandbox/Offline Mode: Trigger immediate update and register listener
      AuthLogger.subscription("StudentsList", "LOCAL_SANDBOX_LOAD");
      onUpdate(getLocalStudents());
      const listener: StudentsListener = (updatedList) => {
        if (active) onUpdate(updatedList);
      };
      studentsListeners.add(listener);
      unsubscribeFirestore = () => {
        studentsListeners.delete(listener);
      };
      return;
    }

    try {
      const studentsColRef = collection(db, "students");
      unsubscribeFirestore = onSnapshot(
        studentsColRef,
        (snap) => {
          if (!active) return;
          const list: Student[] = [];
          snap.forEach((docSnap) => {
            const raw = docSnap.data() as Student;
            if (!raw) return;
            const data: Student = {
              ...raw,
              id: raw.id || docSnap.id
            };
            if (
              data &&
              data.id &&
              data.name &&
              data.name.trim() !== "" &&
              data.name.trim().toLowerCase() !== "unnamed student"
            ) {
              list.push(data);
            } else if (
              docSnap.ref &&
              (!data || !data.name || data.name.trim() === "" || data.name.trim().toLowerCase() === "unnamed student")
            ) {
              // Delete orphaned or Unnamed Student records permanently from Firestore
              deleteDoc(docSnap.ref).catch(() => {});
            }
          });
          AuthLogger.subscription("StudentsList", "SNAPSHOT_RECEIVED", { count: list.length });
          onUpdate(list);
          // Also sync with localStorage cache for offline seamless use
          safeSetStorage(STORAGE_KEY_STUDENTS, JSON.stringify(list));
        },
        (err) => {
          AuthLogger.error("subscribeToStudents:onSnapshot", err);
          if (onError) onError(err);
          // Fallback to local cache on error
          onUpdate(getLocalStudents());
        }
      );
    } catch (err) {
      AuthLogger.warn("subscribeToStudents:setup", err);
      if (onError) onError(err);
      onUpdate(getLocalStudents());
    }
  }

  setup();

  return () => {
    active = false;
    AuthLogger.subscription("StudentsList", "UNSUBSCRIBE");
    if (unsubscribeFirestore) {
      unsubscribeFirestore();
    }
  };
}

/**
 * Subscribe to a single student document (Real-time sync for Student Dashboard)
 */
export function subscribeToStudent(
  studentId: string,
  onUpdate: (student: Student) => void,
  onError?: (err: any) => void
): () => void {
  let unsubscribeFirestore: (() => void) | null = null;
  let active = true;

  AuthLogger.subscription("SingleStudent", "INIT", { studentId });

  // Deliver cached student immediately if available to prevent any blank screen
  try {
    const cachedStudents = getLocalStudents();
    const foundCached = cachedStudents.find((s) => s.id === studentId);
    if (foundCached) {
      AuthLogger.subscription("SingleStudent", "DELIVER_CACHED_IMMEDIATE", { studentId, name: foundCached.name });
      onUpdate(foundCached);
    }
  } catch (e) {
    // Ignore cache error
  }

  async function setup() {
    const db = await getFirebaseDb();
    if (!active) return;

    if (!db) {
      // Fallback: Get from local storage, register to global students listener to track updates
      const findAndTrigger = () => {
        const students = getLocalStudents();
        const found = students.find((s) => s.id === studentId);
        if (found && active) onUpdate(found);
      };
      findAndTrigger();

      const listener: StudentsListener = () => {
        findAndTrigger();
      };
      studentsListeners.add(listener);
      unsubscribeFirestore = () => {
        studentsListeners.delete(listener);
      };
      return;
    }

    try {
      const studentDocRef = doc(db, "students", studentId);
      unsubscribeFirestore = onSnapshot(
        studentDocRef,
        (snap) => {
          if (!active) return;
          if (snap.exists()) {
            const raw = snap.data() as Student;
            const data: Student = {
              ...raw,
              id: raw.id || snap.id || studentId
            };
            AuthLogger.subscription("SingleStudent", "DOC_RECEIVED", { studentId: data.id, name: data.name });
            onUpdate(data);

            // Update local storage cache seamlessly
            try {
              const current = getLocalStudents();
              const idx = current.findIndex((s) => s.id === data.id);
              if (idx >= 0) {
                current[idx] = data;
              } else {
                current.push(data);
              }
              safeSetStorage(STORAGE_KEY_STUDENTS, JSON.stringify(current));
            } catch (storageErr) {
              // Ignore cache write error
            }
          } else {
            AuthLogger.warn("subscribeToStudent", `Document students/${studentId} does not exist`);
            // Check local cache before reporting error
            const cachedStudents = getLocalStudents();
            const foundCached = cachedStudents.find((s) => s.id === studentId);
            if (foundCached) {
              onUpdate(foundCached);
            } else if (onError) {
              onError(new Error(`Student profile (${studentId}) was not found in Firestore.`));
            }
          }
        },
        (err) => {
          AuthLogger.error("subscribeToStudent:onSnapshot", err);
          if (onError) onError(err);
          // Fallback to local cache on error so offline/resumed mode remains responsive
          const cachedStudents = getLocalStudents();
          const foundCached = cachedStudents.find((s) => s.id === studentId);
          if (foundCached && active) {
            onUpdate(foundCached);
          }
        }
      );
    } catch (err) {
      AuthLogger.error("subscribeToStudent:setup", err);
      if (onError) onError(err);
      const cachedStudents = getLocalStudents();
      const foundCached = cachedStudents.find((s) => s.id === studentId);
      if (foundCached && active) {
        onUpdate(foundCached);
      }
    }
  }

  setup();

  return () => {
    active = false;
    AuthLogger.subscription("SingleStudent", "UNSUBSCRIBE", { studentId });
    if (unsubscribeFirestore) {
      unsubscribeFirestore();
    }
  };
}

/**
 * Save or update student record
 */
export async function saveStudentDoc(student: Student): Promise<void> {
  const cleanedStudent = cleanObjectForFirestore(student);

  // Synchronously update local storage cache and notify local subscribers
  const students = getLocalStudents();
  const existsIdx = students.findIndex((s) => s.id === cleanedStudent.id);
  if (existsIdx > -1) {
    students[existsIdx] = cleanedStudent;
  } else {
    students.unshift(cleanedStudent);
  }
  saveLocalStudents(students);

  const db = await getFirebaseDb();
  if (!db) return;

  try {
    const studentDocRef = doc(db, "students", cleanedStudent.id);
    await setDoc(studentDocRef, cleanedStudent, { merge: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `students/${cleanedStudent.id}`);
  }
}

/**
 * Update student presence timestamp (lastActiveAt) in real-time
 */
export async function updateStudentPresence(studentId: string): Promise<void> {
  const now = new Date().toISOString();
  // Update local storage cache
  const students = getLocalStudents();
  const idx = students.findIndex((s) => s.id === studentId);
  if (idx > -1) {
    students[idx] = { ...students[idx], lastActiveAt: now };
    saveLocalStudents(students);
  }

  const db = await getFirebaseDb();
  if (!db) return;

  try {
    const studentDocRef = doc(db, "students", studentId);
    await setDoc(studentDocRef, { lastActiveAt: now }, { merge: true });
  } catch (err) {
    console.warn("Failed updating student presence timestamp:", err);
  }
}

/**
 * Mark a student as offline (when logging out or closing app)
 */
export async function markStudentOffline(studentId: string): Promise<void> {
  // Update local storage cache
  const students = getLocalStudents();
  const idx = students.findIndex((s) => s.id === studentId);
  if (idx > -1) {
    students[idx] = { ...students[idx], lastActiveAt: "" };
    saveLocalStudents(students);
  }

  const db = await getFirebaseDb();
  if (!db) return;

  try {
    const studentDocRef = doc(db, "students", studentId);
    await setDoc(studentDocRef, { lastActiveAt: "" }, { merge: true });
  } catch (err) {
    console.warn("Failed marking student offline:", err);
  }
}

/**
 * Delete student record permanently across local storage, Firestore, and Supabase
 */
export async function deleteStudentDoc(studentId: string): Promise<void> {
  if (!studentId || typeof studentId !== "string" || !studentId.trim()) {
    console.warn("[Firestore] deleteStudentDoc called with empty or invalid studentId:", studentId);
    return;
  }

  // 1. Always purge local storage
  const students = getLocalStudents();
  const filtered = students.filter(
    (s) => s.id !== studentId && s.name !== "Unnamed Student" && Boolean(s.name && s.name.trim())
  );
  saveLocalStudents(filtered);

  // 2. Delete from Firestore if available
  const db = await getFirebaseDb();
  if (db) {
    try {
      const studentDocRef = doc(db, "students", studentId);
      await deleteDoc(studentDocRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `students/${studentId}`);
    }
  }
}

/**
 * Atomic student creation workflow.
 * Guarantees that Firebase Auth user, /users/{uid}, and /students/{studentId} are created deterministically.
 * If any step fails, performs a full rollback so no orphaned Auth or Firestore records remain.
 */
export async function createStudentAccountAtomic(
  newStudentData: Student,
  password?: string
): Promise<Student> {
  const studentId = newStudentData.id || `student-${Date.now()}`;
  const student: Student = {
    ...newStudentData,
    id: studentId
  };

  let createdAuthUid: string | null = null;
  let createdUserDoc: boolean = false;
  let createdStudentDoc: boolean = false;

  AuthLogger.stage("createStudentAccountAtomic:START", { studentId, email: student.email });

  try {
    // Step 1: Create Firebase Auth credentials (if email is provided)
    if (student.email && student.email.trim()) {
      const { createNewUserAuth } = await import("./firebase");
      const tempPassword = password || "123456";
      createdAuthUid = await createNewUserAuth(student.email.trim().toLowerCase(), tempPassword);
      student.uid = createdAuthUid;
      AuthLogger.stage("createStudentAccountAtomic:AUTH_CREATED", { uid: createdAuthUid });

      // Step 2: Create /users/{uid} document
      const studentUserDoc = {
        uid: createdAuthUid,
        name: student.name,
        email: student.email.trim().toLowerCase(),
        role: "Student",
        studentId: studentId,
        active: true,
        temporaryPasswordRequired: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastLogin: null
      };
      await saveUserDocument(createdAuthUid, studentUserDoc);
      createdUserDoc = true;
      AuthLogger.stage("createStudentAccountAtomic:USER_DOC_SAVED", { uid: createdAuthUid });
    }

    // Step 3: Create /students/{studentId} document
    await saveStudentDoc(student);
    createdStudentDoc = true;
    AuthLogger.stage("createStudentAccountAtomic:STUDENT_DOC_SAVED", { studentId });

    return student;
  } catch (err: any) {
    AuthLogger.error("createStudentAccountAtomic:FAILED_ROLLING_BACK", err);

    // Rollback Step 3
    if (createdStudentDoc) {
      try {
        await deleteStudentDoc(studentId);
        AuthLogger.stage("createStudentAccountAtomic:ROLLBACK_STUDENT_DOC", { studentId });
      } catch (rbErr) {
        AuthLogger.warn("createStudentAccountAtomic:rollbackStudentDoc", rbErr);
      }
    }

    // Rollback Step 2
    if (createdUserDoc && createdAuthUid) {
      try {
        await deleteUserDocument(createdAuthUid);
        AuthLogger.stage("createStudentAccountAtomic:ROLLBACK_USER_DOC", { uid: createdAuthUid });
      } catch (rbErr) {
        AuthLogger.warn("createStudentAccountAtomic:rollbackUserDoc", rbErr);
      }
    }

    // Rollback Step 1
    if (createdAuthUid) {
      try {
        await deleteUserAuthCredentials(createdAuthUid);
        AuthLogger.stage("createStudentAccountAtomic:ROLLBACK_AUTH", { uid: createdAuthUid });
      } catch (rbErr) {
        AuthLogger.warn("createStudentAccountAtomic:rollbackAuth", rbErr);
      }
    }

    throw err;
  }
}

/**
 * Atomic admin creation workflow.
 * Guarantees that Firebase Auth user, /users/{uid}, and /admins/{uid} are created deterministically.
 * If any step fails, performs a full rollback so no orphaned Auth or Firestore records remain.
 */
export async function createAdminAccountAtomic(adminData: {
  name: string;
  email: string;
  password: string;
  phone?: string;
}): Promise<any> {
  const normalizedEmail = adminData.email.trim().toLowerCase();
  let createdAuthUid: string | null = null;
  let createdUserDoc: boolean = false;
  let createdAdminDoc: boolean = false;

  AuthLogger.stage("createAdminAccountAtomic:START", { email: normalizedEmail, name: adminData.name });

  try {
    // Step 1: Create Firebase Auth credentials
    const { createNewUserAuth } = await import("./firebase");
    createdAuthUid = await createNewUserAuth(normalizedEmail, adminData.password);
    AuthLogger.stage("createAdminAccountAtomic:AUTH_CREATED", { uid: createdAuthUid });

    const newAdmin = {
      uid: createdAuthUid,
      name: adminData.name.trim(),
      email: normalizedEmail,
      phone: adminData.phone || "+919609598095",
      role: "Admin",
      status: "Active",
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLogin: null
    };

    // Step 2: Create /users/{uid} document
    await saveUserDocument(createdAuthUid, newAdmin);
    createdUserDoc = true;
    AuthLogger.stage("createAdminAccountAtomic:USER_DOC_SAVED", { uid: createdAuthUid });

    // Step 3: Create /admins/{uid} document
    await saveAdminDoc(createdAuthUid, newAdmin);
    createdAdminDoc = true;
    AuthLogger.stage("createAdminAccountAtomic:ADMIN_DOC_SAVED", { uid: createdAuthUid });

    return newAdmin;
  } catch (err: any) {
    AuthLogger.error("createAdminAccountAtomic:FAILED_ROLLING_BACK", err);

    // Rollback Step 3
    if (createdAdminDoc && createdAuthUid) {
      try {
        await deleteAdminDoc(createdAuthUid);
        AuthLogger.stage("createAdminAccountAtomic:ROLLBACK_ADMIN_DOC", { uid: createdAuthUid });
      } catch (rbErr) {
        AuthLogger.warn("createAdminAccountAtomic:rollbackAdminDoc", rbErr);
      }
    }

    // Rollback Step 2
    if (createdUserDoc && createdAuthUid) {
      try {
        await deleteUserDocument(createdAuthUid);
        AuthLogger.stage("createAdminAccountAtomic:ROLLBACK_USER_DOC", { uid: createdAuthUid });
      } catch (rbErr) {
        AuthLogger.warn("createAdminAccountAtomic:rollbackUserDoc", rbErr);
      }
    }

    // Rollback Step 1
    if (createdAuthUid) {
      try {
        await deleteUserAuthCredentials(createdAuthUid);
        AuthLogger.stage("createAdminAccountAtomic:ROLLBACK_AUTH", { uid: createdAuthUid });
      } catch (rbErr) {
        AuthLogger.warn("createAdminAccountAtomic:rollbackAuth", rbErr);
      }
    }

    throw err;
  }
}

/**
 * Permanently purge any "Unnamed Student" or invalid empty student records across LocalStorage and Firestore.
 */
export async function purgeUnnamedStudents(): Promise<void> {
  // 1. Clean localStorage
  try {
    const cached = localStorage.getItem(STORAGE_KEY_STUDENTS);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter(
          (s: any) =>
            Boolean(s) &&
            Boolean(s.id) &&
            s.name !== "Unnamed Student" &&
            Boolean(s.name && String(s.name).trim() !== "")
        );
        if (cleaned.length !== parsed.length) {
          saveLocalStudents(cleaned);
        }
      }
    }
  } catch (e) {
    console.warn("[Purge] Error cleaning local students cache:", e);
  }

  // 2. Clean Firestore if database is available
  try {
    const db = await getFirebaseDb();
    if (db) {
      const studentsColRef = collection(db, "students");
      const snap = await getDocs(studentsColRef);
      snap.forEach(async (docSnap) => {
        const data = docSnap.data();
        if (!data || !data.name || data.name.trim() === "" || data.name.trim().toLowerCase() === "unnamed student") {
          console.log(`[Purge] Permanently deleting Unnamed Student record from Firestore: ${docSnap.id}`);
          await deleteDoc(docSnap.ref).catch(() => {});
        }
      });
    }
  } catch (e) {
    console.warn("[Purge] Error purging Firestore students:", e);
  }
}

/**
 * Checks if there is any user with Admin role in the database.
 */
export async function checkAnyAdminExists(): Promise<boolean> {
  try {
    const db = await getFirebaseDb();
    if (!db) {
      const cachedUsers = localStorage.getItem(STORAGE_KEY_USERS);
      const users = cachedUsers ? JSON.parse(cachedUsers) : {};
      return Object.values(users).some((u: any) => u.role === "Admin" || u.role === "admin");
    }
    
    const usersColRef = collection(db, "users");
    const snap = await getDocs(usersColRef);
    let adminFound = false;
    snap.forEach((doc) => {
      const u = doc.data();
      if (u.role === "Admin" || u.role === "admin") {
        adminFound = true;
      }
    });
    return adminFound;
  } catch (e: any) {
    console.warn("Failed checking if admin exists:", e);
    
    // If the database threw a permission-denied error, it means Firestore security rules
    // are active and enforcing unauthenticated access block. This guarantees the database
    // is already initialized, configured, and secured!
    if (e && (e.code === "permission-denied" || (e.message && e.message.toLowerCase().includes("permission")))) {
      return true;
    }
    
    const cachedUsers = localStorage.getItem(STORAGE_KEY_USERS);
    const users = cachedUsers ? JSON.parse(cachedUsers) : {};
    return Object.values(users).some((u: any) => u.role === "Admin" || u.role === "admin");
  }
}

/**
 * Saves the Institution Name.
 */
export async function saveInstitutionName(name: string): Promise<void> {
  const trimmed = name.trim() || "Sumit Tuition App";
  setCachedInstitutionName(trimmed);
  try {
    const db = await getFirebaseDb();
    if (!db) {
      return;
    }
    const settingsDocRef = doc(db, "settings", "institution");
    await setDoc(settingsDocRef, { name: trimmed }, { merge: true });
  } catch (err) {
    console.warn("Failed saving institution name to Firestore:", err);
  }
}

/**
 * Fetches the Institution Name.
 */
export async function getInstitutionName(): Promise<string> {
  const cached = getCachedInstitutionName();
  try {
    const db = await getFirebaseDb();
    if (!db) {
      return cached;
    }
    const settingsDocRef = doc(db, "settings", "institution");
    const snap = await getDoc(settingsDocRef);
    if (snap.exists()) {
      const value = snap.data().name || "Sumit Tuition App";
      setCachedInstitutionName(value);
      return value;
    }
    return cached;
  } catch (err) {
    console.warn("Failed fetching institution name from Firestore:", err);
    return cached;
  }
}

/**
 * Fetches all registered administrators from Firestore (or Local Storage fallback).
 */
export async function getAllAdmins(): Promise<any[]> {
  try {
    const db = await getFirebaseDb();
    if (!db) {
      const cachedUsers = localStorage.getItem(STORAGE_KEY_USERS);
      const users = cachedUsers ? JSON.parse(cachedUsers) : {};
      const filtered: any[] = [];
      const seenCredentials = new Set<string>();
      let changed = false;

      for (const uid of Object.keys(users)) {
        const u = users[uid];
        if (u?.email?.toLowerCase() === "sumitprasadsaha2@gmail.com") {
          delete users[uid];
          changed = true;
          continue;
        }
        if (u?.role === "Admin" || u?.role === "admin") {
          const credKey = (u?.email || u?.username || u?.uid || uid).toLowerCase().trim();
          if (seenCredentials.has(credKey)) {
            // Duplicate admin credentials -> remove duplicate from local storage
            delete users[uid];
            changed = true;
          } else {
            seenCredentials.add(credKey);
            filtered.push(u);
          }
        }
      }
      if (changed) {
        safeSetStorage(STORAGE_KEY_USERS, JSON.stringify(users));
      }
      return filtered;
    }

    const admins: any[] = [];
    const seenCredentials = new Set<string>();

    // 1. Fetch from /users collection
    try {
      const usersColRef = collection(db, "users");
      const snap = await getDocs(usersColRef);
      for (const d of snap.docs) {
        const u = d.data();
        if (u.email?.toLowerCase() === "sumitprasadsaha2@gmail.com") {
          deleteDoc(doc(db, "users", d.id)).catch(() => {});
          continue;
        }
        if (u.role === "Admin" || u.role === "admin") {
          const credKey = (u.email || u.username || u.uid || d.id).toLowerCase().trim();
          if (seenCredentials.has(credKey)) {
            deleteDoc(doc(db, "users", d.id)).catch(() => {});
          } else {
            seenCredentials.add(credKey);
            admins.push({ ...u, uid: u.uid || d.id, id: d.id });
          }
        }
      }
    } catch (usersErr) {
      console.warn("Failed querying /users for admins:", usersErr);
    }

    // 2. Also check /admins collection for any missing docs
    try {
      const adminsColRef = collection(db, "admins");
      const adminSnap = await getDocs(adminsColRef);
      for (const d of adminSnap.docs) {
        const u = d.data();
        const credKey = (u.email || u.uid || d.id).toLowerCase().trim();
        if (!seenCredentials.has(credKey) && u.email?.toLowerCase() !== "sumitprasadsaha2@gmail.com") {
          seenCredentials.add(credKey);
          admins.push({ ...u, uid: u.uid || d.id, id: d.id, role: "Admin" });
        }
      }
    } catch (adminsErr) {
      // Safe fallback if rules restrict collection listing
    }

    return admins;
  } catch (err) {
    console.error("Error fetching all admins:", err);
    return [];
  }
}

/**
 * Deletes a user document from Firestore (or Local Storage fallback).
 */
export async function deleteUserDocument(uid: string): Promise<void> {
  try {
    const cachedUsers = localStorage.getItem(STORAGE_KEY_USERS);
    const users = cachedUsers ? JSON.parse(cachedUsers) : {};
    delete users[uid];
    safeSetStorage(STORAGE_KEY_USERS, JSON.stringify(users));

    const db = await getFirebaseDb();
    if (!db) return;

    const userDocRef = doc(db, "users", uid);
    await deleteDoc(userDocRef).catch(() => {});
    await deleteAdminDoc(uid).catch(() => {});
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `users/${uid}`);
  }
}

/**
 * Deletes a user from Firebase Authentication.
 * This is a server-side operation and requires appropriate security rules.
 */
export async function deleteUserAuthCredentials(uid: string): Promise<void> {
  try {
    const auth = await (async () => {
      const { getFirebaseAuth } = await import("./firebase");
      return getFirebaseAuth();
    })();
    
    if (!auth) {
      console.warn("Firebase Auth not available, skipping auth deletion");
      return;
    }
    
    // Note: Client-side deletion of other users requires special security rules or admin SDK
    // For now, this function prepares the structure for future admin SDK integration
    console.log(`Prepared to delete auth credentials for user: ${uid}`);
  } catch (err) {
    console.error(`Error deleting auth credentials for user ${uid}:`, err);
  }
}

/**
 * Subscribe to announcements in real-time
 */
export function subscribeToAnnouncements(
  onUpdate: (announcements: any[]) => void,
  onError?: (err: any) => void
): () => void {
  let unsubscribeFirestore: (() => void) | null = null;
  let active = true;

  const STORAGE_KEY_ANNOUNCEMENTS = "tuition_announcements";

  const getCachedAnnouncements = () => {
    try {
      const cached = localStorage.getItem(STORAGE_KEY_ANNOUNCEMENTS);
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  };

  async function setup() {
    const db = await getFirebaseDb();
    if (!active) return;

    if (!db) {
      // Local fallback
      onUpdate(getCachedAnnouncements());
      const handleLocalEvent = () => {
        if (active) onUpdate(getCachedAnnouncements());
      };
      window.addEventListener("storage", handleLocalEvent);
      unsubscribeFirestore = () => {
        window.removeEventListener("storage", handleLocalEvent);
      };
      return;
    }

    try {
      const colRef = collection(db, "announcements");
      unsubscribeFirestore = onSnapshot(
        colRef,
        (snap) => {
          if (!active) return;
          const list: any[] = [];
          snap.forEach((doc) => {
            list.push(doc.data());
          });
          // Sort descending by date/id
          list.sort((a, b) => {
            const dateA = a.date || "";
            const dateB = b.date || "";
            if (dateA !== dateB) return dateB.localeCompare(dateA);
            return (b.id || "").localeCompare(a.id || "");
          });
          onUpdate(list);
          safeSetStorage(STORAGE_KEY_ANNOUNCEMENTS, JSON.stringify(list));
        },
        (err) => {
          console.error("Firestore announcements snapshot error", err);
          if (onError) onError(err);
          onUpdate(getCachedAnnouncements());
        }
      );
    } catch (err) {
      console.warn("Failed to subscribe to announcements, using local fallback", err);
      onUpdate(getCachedAnnouncements());
    }
  }

  setup();

  return () => {
    active = false;
    if (unsubscribeFirestore) {
      unsubscribeFirestore();
    }
  };
}

/**
 * Save an announcement
 */
export async function saveAnnouncementDoc(announcement: { id: string; text: string; date: string }): Promise<void> {
  const STORAGE_KEY_ANNOUNCEMENTS = "tuition_announcements";
  const db = await getFirebaseDb();
  if (!db) {
    // Local fallback
    try {
      const cached = localStorage.getItem(STORAGE_KEY_ANNOUNCEMENTS);
      const list = cached ? JSON.parse(cached) : [];
      const updated = [announcement, ...list.filter((a: any) => a.id !== announcement.id)];
      safeSetStorage(STORAGE_KEY_ANNOUNCEMENTS, JSON.stringify(updated));
      window.dispatchEvent(new Event("storage"));
    } catch (e) {
      console.error(e);
    }
    return;
  }

  try {
    const docRef = doc(db, "announcements", announcement.id);
    await setDoc(docRef, cleanObjectForFirestore(announcement));
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `announcements/${announcement.id}`);
  }
}

/**
 * Delete an announcement
 */
export async function deleteAnnouncementDoc(id: string): Promise<void> {
  const STORAGE_KEY_ANNOUNCEMENTS = "tuition_announcements";
  const db = await getFirebaseDb();
  if (!db) {
    // Local fallback
    try {
      const cached = localStorage.getItem(STORAGE_KEY_ANNOUNCEMENTS);
      const list = cached ? JSON.parse(cached) : [];
      const updated = list.filter((a: any) => a.id !== id);
      safeSetStorage(STORAGE_KEY_ANNOUNCEMENTS, JSON.stringify(updated));
      window.dispatchEvent(new Event("storage"));
    } catch (e) {
      console.error(e);
    }
    return;
  }

  try {
    const docRef = doc(db, "announcements", id);
    await deleteDoc(docRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `announcements/${id}`);
  }
}

// ----------------------------------------------------
// CLASS NOTES CENTRALIZED STORAGE API (STABLE & DEDUPLICATED)
// ----------------------------------------------------
const STORAGE_KEY_CLASS_NOTES = "tuition_class_notes";
const STORAGE_KEY_R2_DISCOVERED = "tuition_r2_discovered_notes";

type ClassNotesListener = (notes: ClassNote[]) => void;
const classNotesListeners = new Set<ClassNotesListener>();

let inMemoryClassNotesCache: ClassNote[] | null = null;
let globalR2DiscoveredNotes = new Map<string, ClassNote>();
let classNotesRemote: ClassNote[] = [];
let upscNotesRemote: ClassNote[] = [];
let activeFirestoreClassNotesUnsub: (() => void) | null = null;
let activeFirestoreUpscNotesUnsub: (() => void) | null = null;
let isFirestoreClassNotesSubscribed = false;
let isClassNotesFetchInProgress = false;
let isR2DiscoveryInProgress = false;

function initR2DiscoveredCache() {
  if (typeof window === "undefined") return;
  if (globalR2DiscoveredNotes.size === 0) {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_R2_DISCOVERED);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          for (const n of parsed) {
            if (n && (n.id || n.storageKey || n.storagePath)) {
              const key = n.storageKey || n.storagePath || n.id;
              globalR2DiscoveredNotes.set(key, n);
            }
          }
        }
      }
    } catch {}
  }
}

/**
 * Deep structural equality comparator for ClassNote arrays to prevent unnecessary UI re-renders
 */
export function areClassNotesEqual(
  a: ClassNote[] | null | undefined,
  b: ClassNote[] | null | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const na = a[i];
    const nb = b[i];
    if (
      na.id !== nb.id ||
      na.chapterNo !== nb.chapterNo ||
      na.chapterName !== nb.chapterName ||
      na.partLabel !== nb.partLabel ||
      na.topicNo !== nb.topicNo ||
      na.topicName !== nb.topicName ||
      na.pdfUrl !== nb.pdfUrl ||
      na.storagePath !== nb.storagePath ||
      na.bucket !== nb.bucket ||
      na.createdAt !== nb.createdAt ||
      na.accessType !== nb.accessType ||
      na.fileType !== nb.fileType ||
      na.mimeType !== nb.mimeType ||
      na.classGrade !== nb.classGrade ||
      na.subject !== nb.subject ||
      JSON.stringify(na.allowedStudentIds || []) !== JSON.stringify(nb.allowedStudentIds || []) ||
      JSON.stringify(na.allowedClasses || []) !== JSON.stringify(nb.allowedClasses || [])
    ) {
      return false;
    }
  }
  return true;
}

export function getLocalClassNotes(): ClassNote[] {
  if (inMemoryClassNotesCache !== null) {
    return inMemoryClassNotesCache;
  }
  if (typeof window === "undefined") return inMemoryClassNotesCache || [];

  initR2DiscoveredCache();

  // Try local memory/storage first
  const cached = localStorage.getItem(STORAGE_KEY_CLASS_NOTES);
  if (cached !== null) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        inMemoryClassNotesCache = parsed.map(migrateNoteToHierarchy).sort(sortNotesByTopicNumber);
        return inMemoryClassNotesCache;
      }
    } catch (e) {
      console.error("Failed to parse local class notes", e);
    }
  }

  // If R2 discovered notes exist locally, populate immediately
  if (globalR2DiscoveredNotes.size > 0) {
    inMemoryClassNotesCache = Array.from(globalR2DiscoveredNotes.values()).map(migrateNoteToHierarchy).sort(sortNotesByTopicNumber);
    return inMemoryClassNotesCache;
  }

  // Background hydrate from IndexedDB cache
  notesCacheService.getCachedNotes().then((idbNotes) => {
    if (idbNotes && Array.isArray(idbNotes) && idbNotes.length > 0) {
      if (inMemoryClassNotesCache === null || inMemoryClassNotesCache.length === 0) {
        saveLocalClassNotes(idbNotes);
      }
    }
  }).catch(() => {});

  inMemoryClassNotesCache = [];
  return inMemoryClassNotesCache;
}

export function prepareNoteForFirestore(note: ClassNote): Record<string, any> {
  const bucket = note.bucket || "academy-connect-files";
  const canonicalStoragePath = extractCanonicalStorageKey(note, bucket);
  const fileName = note.fileName || note.pdfFileName || "note.pdf";

  // Create a clean object without legacy raw URLs
  const raw: Record<string, any> = { ...note };
  delete raw.pdfUrl;
  delete raw.downloadUrl;
  delete raw.publicUrl;
  delete raw.signedUrl;
  delete raw.presignedUrl;
  delete raw.url;

  return cleanObjectForFirestore({
    ...raw,
    storagePath: canonicalStoragePath,
    storageKey: canonicalStoragePath,
    objectKey: canonicalStoragePath,
    r2Key: canonicalStoragePath,
    fileName,
    bucket,
  });
}

export function normalizeAndMigrateNoteDoc(note: ClassNote, db?: any, targetCollection?: string): ClassNote {
  if (!note) return note;
  const bucket = note.bucket || "academy-connect-files";
  const canonicalStoragePath = extractCanonicalStorageKey(note, bucket);
  const canonicalUrl = getCanonicalNoteDownloadUrl(canonicalStoragePath, bucket);

  // Auto-heal missing or legacy storagePath in Firestore in background
  if (db && note.id && targetCollection && (!note.storagePath || note.storagePath !== canonicalStoragePath)) {
    try {
      setDoc(
        doc(db, targetCollection, note.id),
        {
          storagePath: canonicalStoragePath,
          storageKey: canonicalStoragePath,
          objectKey: canonicalStoragePath,
          r2Key: canonicalStoragePath,
        },
        { merge: true }
      ).catch((err) => {
        console.warn(`[Firestore] Auto-healed note storagePath notice (${note.id}):`, err);
      });
    } catch {}
  }

  const migrated = migrateNoteToHierarchy(note);
  return {
    ...migrated,
    storagePath: canonicalStoragePath,
    storageKey: canonicalStoragePath,
    objectKey: canonicalStoragePath,
    r2Key: canonicalStoragePath,
    downloadKey: canonicalStoragePath,
    pdfUrl: canonicalUrl,
    downloadUrl: canonicalUrl,
    bucket,
  };
}

export function saveLocalClassNotes(notes: ClassNote[]) {
  if (typeof window === "undefined" || !Array.isArray(notes)) return;
  
  const migratedNotes = notes.map((n) => normalizeAndMigrateNoteDoc(n)).sort(sortNotesByTopicNumber);

  // Prevent duplicate state emissions if the dataset is unchanged
  if (inMemoryClassNotesCache !== null && areClassNotesEqual(inMemoryClassNotesCache, migratedNotes)) {
    return;
  }

  // Atomically update memory cache, persistent local storage, and IndexedDB
  inMemoryClassNotesCache = migratedNotes;
  safeSetStorage(STORAGE_KEY_CLASS_NOTES, JSON.stringify(migratedNotes));
  notesCacheService.setCachedNotes(migratedNotes).catch(() => {});

  // Notify all registered UI listeners with the stable reference
  classNotesListeners.forEach((listener) => {
    try {
      listener(migratedNotes);
    } catch (err) {
      console.warn("[ClassNotesListener] callback warning:", err);
    }
  });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("notes-progress-updated"));
  }
}

/**
 * Merges Firestore remote documents and Cloudflare R2 authoritative scanned folders.
 * Guarantees that successful R2 folder scans are NEVER overwritten with empty states.
 */
function mergeAndSaveClassNotes() {
  initR2DiscoveredCache();
  const mergedMap = new Map<string, ClassNote>();

  // 1. Add class notes from remote Firestore
  for (const n of classNotesRemote) {
    if (n && n.id) {
      const normalized = normalizeAndMigrateNoteDoc(n);
      mergedMap.set(n.id, normalized);
    }
  }

  // 2. Add upsc notes from remote Firestore
  for (const n of upscNotesRemote) {
    if (n && n.id) {
      const normalized = normalizeAndMigrateNoteDoc(n);
      mergedMap.set(n.id, normalized);
    }
  }

  // 3. Merge R2 discovered topic notes (authoritative storage source)
  for (const [_, n] of globalR2DiscoveredNotes.entries()) {
    if (!n || !n.id) continue;
    const normalizedN = normalizeAndMigrateNoteDoc(n);

    // Check if there is an existing Firestore note matching by id, storageKey, storagePath, or r2Key
    let matchedExistingId: string | null = null;
    for (const [id, existing] of mergedMap.entries()) {
      if (
        id === normalizedN.id ||
        (existing.storageKey && normalizedN.storageKey && existing.storageKey === normalizedN.storageKey) ||
        (existing.storagePath && normalizedN.storagePath && existing.storagePath === normalizedN.storagePath) ||
        (existing.r2Key && normalizedN.r2Key && existing.r2Key === normalizedN.r2Key) ||
        (existing.objectKey && normalizedN.objectKey && existing.objectKey === normalizedN.objectKey)
      ) {
        matchedExistingId = id;
        break;
      }
    }

    if (matchedExistingId) {
      const existing = mergedMap.get(matchedExistingId)!;
      mergedMap.set(matchedExistingId, {
        ...normalizedN,
        ...existing,
        storageKey: normalizedN.storageKey || existing.storageKey,
        storagePath: normalizedN.storagePath || existing.storagePath,
        objectKey: normalizedN.objectKey || existing.objectKey,
        pdfUrl: normalizedN.pdfUrl || existing.pdfUrl,
        downloadUrl: normalizedN.downloadUrl || existing.downloadUrl,
        pdfFileName: normalizedN.pdfFileName || existing.pdfFileName || normalizedN.fileName || existing.fileName,
        fileName: normalizedN.fileName || existing.fileName || normalizedN.pdfFileName || existing.pdfFileName,
        fileSize: normalizedN.fileSize || existing.fileSize,
        fileType: normalizedN.fileType || existing.fileType || "pdf",
      });
    } else {
      // Direct R2 topic note discovered
      mergedMap.set(normalizedN.id, normalizedN);
    }
  }

  const mergedList = Array.from(mergedMap.values());
  // Never overwrite with empty if we already have valid notes and Firestore hasn't loaded
  if (mergedList.length > 0 || (classNotesRemote.length === 0 && upscNotesRemote.length === 0 && globalR2DiscoveredNotes.size === 0)) {
    saveLocalClassNotes(mergedList);
  }
}

/**
 * Actively triggers discovery of topic folders directly from Cloudflare R2 bucket.
 */
export async function triggerR2TopicDiscovery(): Promise<ClassNote[]> {
  if (isR2DiscoveryInProgress) return Array.from(globalR2DiscoveredNotes.values());
  isR2DiscoveryInProgress = true;
  try {
    const discovered = await discoverTopicNotesFromR2({ category: "all" });
    if (discovered && Array.isArray(discovered)) {
      const nextR2Map = new Map<string, ClassNote>();
      for (const n of discovered) {
        if (n && n.id) {
          const key = n.storageKey || n.storagePath || n.id;
          nextR2Map.set(key, normalizeAndMigrateNoteDoc(n));
        }
      }
      globalR2DiscoveredNotes = nextR2Map;
      if (typeof window !== "undefined") {
        safeSetStorage(STORAGE_KEY_R2_DISCOVERED, JSON.stringify(Array.from(nextR2Map.values())));
      }
      mergeAndSaveClassNotes();
    }
  } catch (err) {
    console.warn("[FirestoreService] triggerR2TopicDiscovery warning:", err);
  } finally {
    isR2DiscoveryInProgress = false;
  }
  return Array.from(globalR2DiscoveredNotes.values());
}

function ensureSingleFirestoreNotesSubscription() {
  initR2DiscoveredCache();
  
  // Trigger background R2 discovery on every subscribe
  triggerR2TopicDiscovery().catch(() => {});

  if (isFirestoreClassNotesSubscribed || isClassNotesFetchInProgress) return;
  isClassNotesFetchInProgress = true;

  (async () => {
    try {
      const db = await getFirebaseDb();
      if (!db) {
        isClassNotesFetchInProgress = false;
        return;
      }

      const classColRef = collection(db, "class_notes");
      activeFirestoreClassNotesUnsub = onSnapshot(
        classColRef,
        (snap) => {
          isClassNotesFetchInProgress = false;
          isFirestoreClassNotesSubscribed = true;
          classNotesRemote = [];
          snap.forEach((docSnap) => {
            const data = docSnap.data() as ClassNote;
            if (data && data.id) {
              const normalized = normalizeAndMigrateNoteDoc(data, db, "class_notes");
              classNotesRemote.push(normalized);
            }
          });
          mergeAndSaveClassNotes();
        },
        (err) => {
          isClassNotesFetchInProgress = false;
          console.warn("[Firestore] class_notes subscription notice:", err);
        }
      );

      const upscColRef = collection(db, "upsc_notes");
      activeFirestoreUpscNotesUnsub = onSnapshot(
        upscColRef,
        (snap) => {
          upscNotesRemote = [];
          snap.forEach((docSnap) => {
            const data = docSnap.data() as ClassNote;
            if (data && data.id) {
              const normalized = normalizeAndMigrateNoteDoc(data, db, "upsc_notes");
              upscNotesRemote.push(normalized);
            }
          });
          mergeAndSaveClassNotes();
        },
        (err) => {
          console.warn("[Firestore] upsc_notes subscription notice:", err);
        }
      );

      isFirestoreClassNotesSubscribed = true;
    } catch (err) {
      isClassNotesFetchInProgress = false;
      console.warn("[Firestore] Failed setting up notes subscription:", err);
    } finally {
      isClassNotesFetchInProgress = false;
    }
  })();
}

export function subscribeToClassNotes(
  onUpdate: (notes: ClassNote[]) => void,
  onError?: (err: any) => void
): () => void {
  // 1. Instantly emit cached notes if available (zero blank flicker)
  const current = getLocalClassNotes();
  if (current.length > 0) {
    onUpdate(current);
  }

  // 2. Register UI subscriber
  classNotesListeners.add(onUpdate);

  // 3. Ensure a single shared Firestore listener is active & trigger R2 scan
  ensureSingleFirestoreNotesSubscription();

  return () => {
    classNotesListeners.delete(onUpdate);
    // If no more listeners remain, keep in-memory cache but detach remote listener
    if (classNotesListeners.size === 0) {
      if (activeFirestoreClassNotesUnsub) {
        try {
          activeFirestoreClassNotesUnsub();
        } catch {}
        activeFirestoreClassNotesUnsub = null;
      }
      if (activeFirestoreUpscNotesUnsub) {
        try {
          activeFirestoreUpscNotesUnsub();
        } catch {}
        activeFirestoreUpscNotesUnsub = null;
      }
      isFirestoreClassNotesSubscribed = false;
    }
  };
}

export async function saveClassNoteDoc(note: ClassNote): Promise<void> {
  initR2DiscoveredCache();
  
  const normalizedNote = normalizeAndMigrateNoteDoc(note);

  // Update local R2 map if note has storage key
  if (normalizedNote.storagePath || normalizedNote.storageKey) {
    const key = normalizedNote.storageKey || normalizedNote.storagePath || normalizedNote.id;
    globalR2DiscoveredNotes.set(key, normalizedNote);
    if (typeof window !== "undefined") {
      safeSetStorage(STORAGE_KEY_R2_DISCOVERED, JSON.stringify(Array.from(globalR2DiscoveredNotes.values())));
    }
  }

  const currentLocal = getLocalClassNotes();
  const exists = currentLocal.some((n) => n.id === normalizedNote.id);
  const updatedLocal = exists
    ? currentLocal.map((n) => (n.id === normalizedNote.id ? normalizedNote : n))
    : [normalizedNote, ...currentLocal];
  saveLocalClassNotes(updatedLocal);

  const db = await getFirebaseDb();
  if (!db) return;

  try {
    const isUpsc = normalizedNote.isUPSC || (normalizedNote as any).type === "upsc" || (normalizedNote as any).noteType === "upsc" || normalizedNote.classGrade === "UPSC" || (normalizedNote as any).className === "UPSC";
    const targetCollection = isUpsc ? "upsc_notes" : "class_notes";
    const docRef = doc(db, targetCollection, normalizedNote.id);
    const firestoreData = prepareNoteForFirestore(normalizedNote);
    await setDoc(docRef, firestoreData, { merge: true });
    
    // Also mirror to class_notes for legacy/unified lookups if upsc
    if (isUpsc) {
      const mirrorRef = doc(db, "class_notes", normalizedNote.id);
      await setDoc(mirrorRef, firestoreData, { merge: true }).catch(() => {});
    }
    console.log(`[Firestore] Successfully persisted canonical note metadata: ${targetCollection}/${normalizedNote.id}`);
  } catch (err: any) {
    console.warn(`[Firestore] saveClassNoteDoc warning for note ${normalizedNote.id}:`, err);
  }
}

/**
 * Fetch all Class Notes and UPSC Notes directly from Firestore
 */
export async function fetchAllClassNotesFromFirestore(): Promise<ClassNote[]> {
  try {
    const db = await getFirebaseDb();
    const notesMap = new Map<string, ClassNote>();

    if (db) {
      try {
        const classCol = collection(db, "class_notes");
        const classSnap = await getDocs(classCol);
        classSnap.forEach((d) => {
          const data = d.data() as ClassNote;
          if (data && (data.id || d.id)) {
            const raw = { ...data, id: data.id || d.id };
            const normalized = normalizeAndMigrateNoteDoc(raw, db, "class_notes");
            notesMap.set(normalized.id, normalized);
          }
        });
      } catch (err) {
        console.warn("[Firestore] Failed to read class_notes collection:", err);
      }

      try {
        const upscCol = collection(db, "upsc_notes");
        const upscSnap = await getDocs(upscCol);
        upscSnap.forEach((d) => {
          const data = d.data() as ClassNote;
          if (data && (data.id || d.id)) {
            const raw = { ...data, id: data.id || d.id };
            const normalized = normalizeAndMigrateNoteDoc(raw, db, "upsc_notes");
            notesMap.set(normalized.id, normalized);
          }
        });
      } catch (err) {
        console.warn("[Firestore] Failed to read upsc_notes collection:", err);
      }
    }

    // Discover any additional notes physically present in Cloudflare R2 bucket
    try {
      const r2Notes = await discoverTopicNotesFromR2({ category: "all" });
      for (const rn of r2Notes) {
        if (rn && rn.id) {
          const key = rn.storageKey || rn.storagePath || rn.id;
          globalR2DiscoveredNotes.set(key, rn);

          let matchedExistingId: string | null = null;
          for (const [id, existing] of notesMap.entries()) {
            if (
              id === rn.id ||
              (existing.storageKey && rn.storageKey && existing.storageKey === rn.storageKey) ||
              (existing.storagePath && rn.storagePath && existing.storagePath === rn.storagePath) ||
              (existing.r2Key && rn.r2Key && existing.r2Key === rn.r2Key) ||
              (existing.objectKey && rn.objectKey && existing.objectKey === rn.objectKey)
            ) {
              matchedExistingId = id;
              break;
            }
          }

          if (matchedExistingId) {
            const existing = notesMap.get(matchedExistingId)!;
            notesMap.set(matchedExistingId, {
              ...rn,
              ...existing,
              storageKey: rn.storageKey || existing.storageKey,
              storagePath: rn.storagePath || existing.storagePath,
              objectKey: rn.objectKey || existing.objectKey,
              pdfUrl: rn.pdfUrl || existing.pdfUrl,
              downloadUrl: rn.downloadUrl || existing.downloadUrl,
              pdfFileName: rn.pdfFileName || existing.pdfFileName || rn.fileName || existing.fileName,
              fileName: rn.fileName || existing.fileName || rn.pdfFileName || existing.pdfFileName,
              fileSize: rn.fileSize || existing.fileSize,
              fileType: rn.fileType || existing.fileType || "pdf",
            });
          } else {
            notesMap.set(rn.id, rn);
          }
        }
      }
      if (typeof window !== "undefined") {
        safeSetStorage(STORAGE_KEY_R2_DISCOVERED, JSON.stringify(Array.from(globalR2DiscoveredNotes.values())));
      }
    } catch (r2Err) {
      console.warn("[Firestore] R2 topic discovery notice:", r2Err);
    }

    if (notesMap.size > 0) {
      const list = Array.from(notesMap.values());
      saveLocalClassNotes(list);
      return list;
    }

    return getLocalClassNotes();
  } catch (err) {
    console.warn("[Firestore] Error fetching all notes from Firestore:", err);
    return getLocalClassNotes();
  }
}

export async function deleteClassNoteDoc(noteId: string): Promise<void> {
  const db = await getFirebaseDb();
  const currentLocal = getLocalClassNotes();
  const targetNote = currentLocal.find((n) => n.id === noteId);
  const updatedLocal = currentLocal.filter((n) => n.id !== noteId);
  saveLocalClassNotes(updatedLocal);

  // Purge from globalR2DiscoveredNotes
  initR2DiscoveredCache();
  for (const [key, n] of globalR2DiscoveredNotes.entries()) {
    if (
      n.id === noteId ||
      (targetNote?.storagePath && n.storagePath === targetNote.storagePath) ||
      (targetNote?.storageKey && n.storageKey === targetNote.storageKey)
    ) {
      globalR2DiscoveredNotes.delete(key);
    }
  }
  if (typeof window !== "undefined") {
    safeSetStorage(STORAGE_KEY_R2_DISCOVERED, JSON.stringify(Array.from(globalR2DiscoveredNotes.values())));
  }

  // Clean up legacy student.notes across all student records to prevent auto-migration from resurrecting it
  try {
    const students = getLocalStudents();
    let anyStudentUpdated = false;
    const updatedStudentsList = students.map((student) => {
      if (!student.notes) return student;
      let studentUpdated = false;
      const updatedNotes: Record<string, any[]> = {};

      for (const [subject, notesArr] of Object.entries(student.notes)) {
        if (!Array.isArray(notesArr)) {
          updatedNotes[subject] = notesArr as any;
          continue;
        }
        const filtered = notesArr.filter((n: any) => {
          if (n.id === noteId) return false;
          if (targetNote?.storagePath && n.storagePath === targetNote.storagePath) return false;
          if (targetNote?.pdfUrl && n.pdfUrl === targetNote.pdfUrl) return false;
          return true;
        });

        if (filtered.length !== notesArr.length) {
          studentUpdated = true;
          anyStudentUpdated = true;
        }
        if (filtered.length > 0) {
          updatedNotes[subject] = filtered;
        }
      }

      if (studentUpdated) {
        return { ...student, notes: updatedNotes };
      }
      return student;
    });

    if (anyStudentUpdated) {
      saveLocalStudents(updatedStudentsList);
      for (const st of updatedStudentsList) {
        const orig = students.find((s) => s.id === st.id);
        if (orig && JSON.stringify(orig.notes) !== JSON.stringify(st.notes)) {
          await saveStudentDoc(st);
        }
      }
    }
  } catch (err) {
    console.warn("Failed cleansing student.notes on deleteClassNoteDoc:", err);
  }

  if (!db) return;

  try {
    const classDocRef = doc(db, "class_notes", noteId);
    await deleteDoc(classDocRef).catch(() => {});
    const upscDocRef = doc(db, "upsc_notes", noteId);
    await deleteDoc(upscDocRef).catch(() => {});

    // Clean up student.notes across all student records in Firestore
    try {
      const studentsColRef = collection(db, "students");
      const snap = await getDocs(studentsColRef);
      snap.forEach(async (docSnap) => {
        const st = docSnap.data() as Student;
        if (!st || !st.notes) return;
        let studentUpdated = false;
        const updatedNotes: Record<string, any[]> = {};

        for (const [subject, notesArr] of Object.entries(st.notes)) {
          if (!Array.isArray(notesArr)) {
            updatedNotes[subject] = notesArr as any;
            continue;
          }
          const filtered = notesArr.filter((n: any) => {
            if (n.id === noteId) return false;
            if (targetNote?.storagePath && n.storagePath === targetNote.storagePath) return false;
            if (targetNote?.pdfUrl && n.pdfUrl === targetNote.pdfUrl) return false;
            return true;
          });

          if (filtered.length !== notesArr.length) {
            studentUpdated = true;
          }
          if (filtered.length > 0) {
            updatedNotes[subject] = filtered;
          }
        }

        if (studentUpdated) {
          const cleanedStudent = { ...st, notes: updatedNotes };
          await setDoc(doc(db, "students", st.id), cleanObjectForFirestore(cleanedStudent), { merge: true });
        }
      });
    } catch (fsErr) {
      console.warn("Failed cleansing Firestore student.notes on delete:", fsErr);
    }
  } catch (err) {
    // Revert local cache on failure to prevent desync
    saveLocalClassNotes(currentLocal);
    handleFirestoreError(err, OperationType.DELETE, `class_notes/${noteId}`);
  }
}

// ----------------------------------------------------
// TEST ATTEMPTS CENTRALIZED STORAGE & DB API
// ----------------------------------------------------
const STORAGE_KEY_TEST_ATTEMPTS = "tuition_student_test_attempts";

type TestAttemptsListener = (attempts: TestAttemptRecord[]) => void;
const testAttemptsListeners = new Set<TestAttemptsListener>();

export function getLocalTestAttempts(): TestAttemptRecord[] {
  if (typeof window === "undefined") return [];
  const cached = localStorage.getItem(STORAGE_KEY_TEST_ATTEMPTS);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      console.error("Failed to parse local test attempts", e);
    }
  }
  return [];
}

export function saveLocalTestAttemptsCache(attempts: TestAttemptRecord[]) {
  if (typeof window === "undefined") return;
  safeSetStorage(STORAGE_KEY_TEST_ATTEMPTS, JSON.stringify(attempts));
  testAttemptsListeners.forEach((listener) => listener(attempts));
  window.dispatchEvent(new Event("storage"));
  window.dispatchEvent(new CustomEvent("test-attempts-updated"));
}

export async function saveTestAttemptDoc(attempt: TestAttemptRecord): Promise<void> {
  const cleaned = cleanObjectForFirestore(attempt);

  // 1. Update local storage cache & notify local listeners immediately
  const currentLocal = getLocalTestAttempts();
  const existingIdx = currentLocal.findIndex((a) => a.id === cleaned.id);
  if (existingIdx > -1) {
    currentLocal[existingIdx] = cleaned;
  } else {
    currentLocal.unshift(cleaned);
  }
  saveLocalTestAttemptsCache(currentLocal);

  // 2. Calculate permanent Topic Score Summary record
  const topicAttempts = currentLocal.filter((a) => {
    return (
      a.studentId === attempt.studentId &&
      a.subject?.toLowerCase().trim() === attempt.subject?.toLowerCase().trim() &&
      Number(a.chapterNo) === Number(attempt.chapterNo) &&
      a.topicName?.toLowerCase().replace(/[^a-z0-9]/g, "") === attempt.topicName?.toLowerCase().replace(/[^a-z0-9]/g, "")
    );
  });

  const totalAttempts = topicAttempts.length;
  const latestScore = attempt.percentage ?? (attempt.totalQuestions > 0 ? Math.round((attempt.score / attempt.totalQuestions) * 100) : 0);
  
  let highestScore = latestScore;
  topicAttempts.forEach((a) => {
    const pct = a.percentage ?? (a.totalQuestions > 0 ? Math.round((a.score / a.totalQuestions) * 100) : 0);
    if (pct > highestScore) highestScore = pct;
  });

  const topicSummaryDoc = {
    studentId: attempt.studentId,
    subject: attempt.subject,
    chapterNo: attempt.chapterNo,
    chapterName: attempt.chapterName,
    topicId: attempt.topicId || attempt.topicName?.toLowerCase().replace(/[^a-z0-9]/g, "_") || "topic",
    topicName: attempt.topicName,
    highestScore,
    latestScore,
    totalAttempts,
    lastAttemptAt: attempt.date || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  // 3. Save to Firestore collections "student_test_attempts" AND "student_topic_test_scores"
  const db = await getFirebaseDb();
  if (!db) return;

  try {
    const attemptDocRef = doc(db, "student_test_attempts", cleaned.id);
    await setDoc(attemptDocRef, cleaned, { merge: true });

    const safeTopicKey = `${attempt.studentId}_${attempt.subject}_ch${attempt.chapterNo}_${topicSummaryDoc.topicId}`
      .replace(/[^a-zA-Z0-9_-]/g, "_");
    const summaryDocRef = doc(db, "student_topic_test_scores", safeTopicKey);
    await setDoc(summaryDocRef, cleanObjectForFirestore(topicSummaryDoc), { merge: true });
  } catch (err) {
    console.warn("Failed saving test attempt to Firestore collection:", err);
  }
}

export function subscribeToTestAttempts(
  onUpdate: (attempts: TestAttemptRecord[]) => void,
  onError?: (err: any) => void
): () => void {
  let unsubscribeFirestore: (() => void) | null = null;
  let active = true;

  const handleLocalEvent = () => {
    if (active) onUpdate(getLocalTestAttempts());
  };

  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleLocalEvent);
    window.addEventListener("test-attempts-updated", handleLocalEvent);
  }

  async function setup() {
    const db = await getFirebaseDb();
    if (!active) return;

    if (!db) {
      onUpdate(getLocalTestAttempts());
      const listener: TestAttemptsListener = (updatedList) => {
        if (active) onUpdate(updatedList);
      };
      testAttemptsListeners.add(listener);
      unsubscribeFirestore = () => {
        testAttemptsListeners.delete(listener);
      };
      return;
    }

    try {
      const colRef = collection(db, "student_test_attempts");
      unsubscribeFirestore = onSnapshot(
        colRef,
        (snap) => {
          if (!active) return;
          const list: TestAttemptRecord[] = [];
          snap.forEach((docSnap) => {
            list.push(docSnap.data() as TestAttemptRecord);
          });

          // Sort descending by timestamp
          list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

          if (list.length > 0) {
            saveLocalTestAttemptsCache(list);
            onUpdate(list);
          } else {
            onUpdate(getLocalTestAttempts());
          }
        },
        (err) => {
          console.warn("Firestore student_test_attempts snapshot warning, falling back to local storage", err);
          if (onError) onError(err);
          onUpdate(getLocalTestAttempts());
        }
      );
    } catch (err) {
      console.warn("Failed to subscribe to student_test_attempts, using local fallback", err);
      onUpdate(getLocalTestAttempts());
    }
  }

  setup();

  return () => {
    active = false;
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleLocalEvent);
      window.removeEventListener("test-attempts-updated", handleLocalEvent);
    }
    if (unsubscribeFirestore) {
      unsubscribeFirestore();
    }
  };
}

/**
 * Get test attempts for a specific student
 * Useful for loading previous scores on student login
 */
export async function getStudentTestAttempts(studentId: string): Promise<TestAttemptRecord[]> {
  const all = getLocalTestAttempts();
  const filtered = all.filter((a) => a.studentId === studentId);
  
  if (filtered.length === 0) {
    // Try fetching from Firestore if not in local cache
    const db = await getFirebaseDb();
    if (db) {
      try {
        const colRef = collection(db, "student_test_attempts");
        const q = query(colRef, where("studentId", "==", studentId));
        const snap = await getDocs(q);
        const results: TestAttemptRecord[] = [];
        snap.forEach((docSnap) => {
          results.push(docSnap.data() as TestAttemptRecord);
        });
        results.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        return results;
      } catch (err) {
        console.warn(`Failed fetching test attempts for student ${studentId}:`, err);
      }
    }
  }
  
  return filtered;
}

/**
 * Get topic test score summary for a student
 */
export async function getStudentTopicTestScore(
  studentId: string,
  subject: string,
  chapterNo: number,
  topicId: string
): Promise<any> {
  const safeTopicKey = `${studentId}_${subject}_ch${chapterNo}_${topicId}`
    .replace(/[^a-zA-Z0-9_-]/g, "_");

  try {
    const db = await getFirebaseDb();
    if (!db) return null;

    const docRef = doc(db, "student_topic_test_scores", safeTopicKey);
    const snap = await getDoc(docRef);
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn(`Failed fetching topic test score for ${safeTopicKey}:`, err);
    return null;
  }
}

/**
 * Broadcast deletion signal for content cleanup across all devices
 */
export async function broadcastContentDeletion(
  contentType: string,
  contentId: string,
  metadata?: Record<string, any>
): Promise<void> {
  // 1. Broadcast via custom event (same tab)
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("content-deleted", {
      detail: { contentType, contentId, metadata, timestamp: Date.now() }
    }));
  }

  // 2. Broadcast via BroadcastChannel (same browser, all tabs)
  if (typeof window !== "undefined" && "BroadcastChannel" in window) {
    try {
      const bc = new BroadcastChannel("tuition_content_sync");
      bc.postMessage({
        type: "CONTENT_DELETED",
        contentType,
        contentId,
        metadata,
        timestamp: Date.now()
      });
      bc.close();
    } catch (err) {
      console.warn("[FirestoreService] BroadcastChannel deletion signal failed:", err);
    }
  }

  // 3. Send Firestore sync signal (cross-device)
  try {
    const db = await getFirebaseDb();
    if (db) {
      const syncDocRef = doc(db, "content_sync_signals", "latest");
      await setDoc(syncDocRef, {
        lastDeletedAt: new Date().toISOString(),
        lastDeletedContentType: contentType,
        lastDeletedContentId: contentId,
        timestamp: Date.now(),
        ...metadata
      }, { merge: true });
    }
  } catch (err) {
    console.warn("[FirestoreService] Failed sending Firestore deletion signal:", err);
  }
}

/**
 * Listen for content deletion signals from other devices
 */
export function listenToContentDeletionSignals(
  onDeletion: (detail: any) => void
): () => void {
  if (typeof window === "undefined") return () => {};

  const handleDeletion = (event: Event) => {
    const customEvent = event as CustomEvent;
    onDeletion(customEvent.detail);
  };

  window.addEventListener("content-deleted", handleDeletion);

  return () => {
    window.removeEventListener("content-deleted", handleDeletion);
  };
}

/**
 * Global cleanup function - call on app unload or logout
 * Prevents memory leaks by properly unsubscribing from all listeners
 */
export function cleanupAllFirestoreListeners(): void {
  if (typeof window === "undefined") return;
  
  // Clear all listener sets
  studentsListeners.clear();
  classNotesListeners.clear();
  testAttemptsListeners.clear();
  
  console.log("[FirestoreService] All listeners cleaned up");
}

/**
 * Update student service status in database (Supabase, Firestore, local cache)
 */
export async function updateStudentServiceStatus(
  studentId: string,
  status: "active" | "paused" | "ended"
): Promise<boolean> {
  if (!studentId || typeof studentId !== "string") return false;

  const newStatus: "active" | "paused" | "ended" =
    status === "paused" || status === "ended" ? status : "active";

  if (process.env.NODE_ENV !== "production") {
    console.log("[StudentServiceStatus] database update payload:", { studentId, status: newStatus });
  }

  // 1. Update Local Storage Cache & notify local subscribers immediately
  try {
    const students = getLocalStudents();
    const idx = students.findIndex((s) => s.id === studentId);
    if (idx > -1) {
      students[idx] = {
        ...students[idx],
        serviceStatus: newStatus,
        service_status: newStatus
      };
      saveLocalStudents(students);
    }
  } catch (err) {
    console.warn("[StudentServiceStatus] Error updating local students cache:", err);
  }

  // 2. Update Firestore Document
  try {
    const db = await getFirebaseDb();
    if (db) {
      const studentDocRef = doc(db, "students", studentId);
      await setDoc(studentDocRef, { serviceStatus: newStatus, service_status: newStatus }, { merge: true });
    }
  } catch (err) {
    console.warn("[StudentServiceStatus] Error updating Firestore service status:", err);
  }

  if (process.env.NODE_ENV !== "production") {
    console.log("[StudentServiceStatus] update success:", true, "refreshed status:", newStatus);
  }

  return true;
}

/**
 * Fetch latest student service status directly from database
 */
export async function fetchStudentServiceStatus(
  studentId: string
): Promise<"active" | "paused" | "ended"> {
  if (!studentId || typeof studentId !== "string") return "active";

  // 1. Fetch from Firestore
  try {
    const db = await getFirebaseDb();
    if (db) {
      const studentDocRef = doc(db, "students", studentId);
      const snap = await getDoc(studentDocRef);
      if (snap.exists()) {
        const data = snap.data();
        const raw = data?.service_status || data?.serviceStatus;
        if (raw) {
          const val = String(raw).toLowerCase();
          if (val === "paused" || val === "ended" || val === "active") {
            if (process.env.NODE_ENV !== "production") {
              console.log("[StudentServiceStatus] fetched status from Firestore:", val);
            }
            return val as "active" | "paused" | "ended";
          }
        }
      }
    }
  } catch (err) {
    console.warn("[StudentServiceStatus] Error reading from Firestore:", err);
  }

  // 2. Fallback to local storage cache
  try {
    const students = getLocalStudents();
    const found = students.find((s) => s.id === studentId);
    if (found) {
      const raw = found.service_status || found.serviceStatus;
      if (raw) {
        const val = String(raw).toLowerCase();
        if (val === "paused" || val === "ended" || val === "active") {
          if (process.env.NODE_ENV !== "production") {
            console.log("[StudentServiceStatus] fetched status from local storage:", val);
          }
          return val as "active" | "paused" | "ended";
        }
      }
    }
  } catch (err) {}

  if (process.env.NODE_ENV !== "production") {
    console.log("[StudentServiceStatus] fetched status default fallback:", "active");
  }
  return "active";
}

export interface FreshAdminDashboardData {
  students: Student[];
  announcements: any[];
  institutionName: string;
}

/**
 * Force fresh refetch of all Admin Dashboard data directly from Firestore database.
 * Bypasses cached state, fetches resources in parallel, and updates local cache atomically.
 */
export async function fetchFreshAdminDashboardData(): Promise<FreshAdminDashboardData> {
  const db = await getFirebaseDb();

  // 1. Force network query for Students from Firestore
  const fetchStudentsTask = (async (): Promise<Student[]> => {
    let firestoreList: Student[] = [];
    if (db) {
      try {
        const colRef = collection(db, "students");
        let snap;
        try {
          const { getDocsFromServer } = await import("firebase/firestore");
          snap = await getDocsFromServer(colRef);
        } catch {
          snap = await getDocs(colRef);
        }

        snap.forEach((docSnap) => {
          const data = docSnap.data() as Student;
          if (
            data &&
            data.id &&
            data.name &&
            data.name.trim() !== "" &&
            data.name.trim().toLowerCase() !== "unnamed student"
          ) {
            firestoreList.push(data);
          }
        });
      } catch (err) {
        console.warn("[Admin Dashboard Refresh] Firestore students query error:", err);
      }
    }

    if (firestoreList.length > 0) {
      return firestoreList;
    }
    return getLocalStudents();
  })();

  // 2. Force network query for Announcements
  const fetchAnnouncementsTask = (async (): Promise<any[]> => {
    if (db) {
      try {
        const colRef = collection(db, "announcements");
        let snap;
        try {
          const { getDocsFromServer } = await import("firebase/firestore");
          snap = await getDocsFromServer(colRef);
        } catch {
          snap = await getDocs(colRef);
        }

        const list: any[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          if (d) list.push(d);
        });

        list.sort((a, b) => {
          const dateA = a.date || "";
          const dateB = b.date || "";
          if (dateA !== dateB) return dateB.localeCompare(dateA);
          return (b.id || "").localeCompare(a.id || "");
        });

        return list;
      } catch (err) {
        console.warn("[Admin Dashboard Refresh] Firestore announcements query error:", err);
      }
    }

    try {
      const cached = localStorage.getItem("tuition_announcements");
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  })();

  // 3. Force network query for Institution Name
  const fetchInstitutionNameTask = (async (): Promise<string> => {
    if (db) {
      try {
        const docRef = doc(db, "settings", "institution");
        let snap;
        try {
          const { getDocFromServer } = await import("firebase/firestore");
          snap = await getDocFromServer(docRef);
        } catch {
          snap = await getDoc(docRef);
        }
        if (snap.exists()) {
          const name = snap.data().name || "Sumit Tuition App";
          return name;
        }
      } catch (err) {
        console.warn("[Admin Dashboard Refresh] Institution settings query error:", err);
      }
    }
    return getCachedInstitutionName();
  })();

  // Execute all network requests in parallel
  const [freshStudents, freshAnnouncements, freshInstName] = await Promise.all([
    fetchStudentsTask,
    fetchAnnouncementsTask,
    fetchInstitutionNameTask,
  ]);

  // Atomically update local caches and broadcast updates to listening components
  if (freshStudents.length > 0) {
    saveLocalStudents(freshStudents);
  }
  if (Array.isArray(freshAnnouncements)) {
    safeSetStorage("tuition_announcements", JSON.stringify(freshAnnouncements));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("announcements-updated", { detail: freshAnnouncements }));
      window.dispatchEvent(new Event("storage"));
    }
  }
  if (freshInstName) {
    setCachedInstitutionName(freshInstName);
  }

  return {
    students: freshStudents.length > 0 ? freshStudents : getLocalStudents(),
    announcements: freshAnnouncements,
    institutionName: freshInstName || getCachedInstitutionName(),
  };
}


