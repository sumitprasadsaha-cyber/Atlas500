import { Student } from "../types";

/**
 * Helper to determine if a student is eligible for the Daily Attendance workflow (v7.9.4).
 * 
 * Rules:
 * - Active: Included in Daily Attendance.
 * - Paused: Included in Daily Attendance (preserves existing paused behaviour).
 * - Ended: EXCLUDED from Daily Attendance only.
 *   (Student account, profile, historical attendance, payments, tests, notes, and audits
 *    remain completely preserved in database and all other views).
 * 
 * @param student The student object or an object with serviceStatus / service_status
 * @returns boolean true if the student should appear in Daily Attendance, false if ended
 */
export function isEligibleForDailyAttendance(
  student: Student | { serviceStatus?: string; service_status?: string } | null | undefined
): boolean {
  if (!student) return false;
  const status = (student.serviceStatus || student.service_status || "active").toString().toLowerCase().trim();
  return status !== "ended";
}

/**
 * Filter a student list for Daily Attendance, excluding any student whose service status is "ended".
 */
export function filterDailyAttendanceStudents(students: Student[]): Student[] {
  if (!Array.isArray(students)) return [];
  return students.filter(isEligibleForDailyAttendance);
}
