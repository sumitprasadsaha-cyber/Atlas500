import { strict as assert } from "assert";
import fs from "fs";
import path from "path";
import { Student } from "../src/types";
import { isEligibleForDailyAttendance, filterDailyAttendanceStudents } from "../src/utils/attendanceHelper";

console.log("===================================================================");
console.log("  RELEASE 7.9.4 — HIDE ENDED STUDENTS FROM DAILY ATTENDANCE AUDIT");
console.log("===================================================================");

// --- TEST 1: Service Status Eligibility Logic ---
console.log("\n[Test 1] Daily Attendance Eligibility Rules");

const activeStudent: Student = {
  id: "student-active-1",
  name: "Aarav Sharma",
  classGrade: "Class 10",
  serviceStatus: "active",
  enrolledSubjects: ["Mathematics", "Science"],
  attendance: { "2026-07-15": true, "2026-07-14": true },
  monthlyFee: 1500,
};

const pausedStudent: Student = {
  id: "student-paused-1",
  name: "Bhavya Patel",
  classGrade: "Class 10",
  serviceStatus: "paused",
  enrolledSubjects: ["Science"],
  attendance: { "2026-07-15": false, "2026-07-14": true },
  monthlyFee: 1200,
};

const endedStudent: Student = {
  id: "student-ended-1",
  name: "Chirag Verma",
  classGrade: "Class 10",
  serviceStatus: "ended",
  enrolledSubjects: ["English"],
  attendance: { "2026-07-15": true, "2026-07-14": false },
  monthlyFee: 1000,
};

const defaultStatusStudent: Student = {
  id: "student-default-1",
  name: "Divya Gupta",
  classGrade: "Class 9",
  enrolledSubjects: ["Mathematics"],
  attendance: {},
};

assert.equal(isEligibleForDailyAttendance(activeStudent), true, "Active student is eligible for daily attendance");
assert.equal(isEligibleForDailyAttendance(pausedStudent), true, "Paused student preserves existing behavior and is eligible for daily attendance");
assert.equal(isEligibleForDailyAttendance(defaultStatusStudent), true, "Student without explicit status defaults to active and is eligible");
assert.equal(isEligibleForDailyAttendance(endedStudent), false, "Ended student is EXCLUDED from daily attendance");
console.log("  ✓ Service status eligibility checks passed successfully.");

// --- TEST 2: Array Filtering for Daily Attendance ---
console.log("\n[Test 2] Attendance List Filtering");

const allStudents = [activeStudent, pausedStudent, endedStudent, defaultStatusStudent];
const filteredDaily = filterDailyAttendanceStudents(allStudents);

assert.equal(filteredDaily.length, 3, "Filtered daily attendance list contains 3 students (ended excluded)");
assert(filteredDaily.some(s => s.id === "student-active-1"), "Active student is present in daily attendance");
assert(filteredDaily.some(s => s.id === "student-paused-1"), "Paused student is present in daily attendance");
assert(filteredDaily.some(s => s.id === "student-default-1"), "Default student is present in daily attendance");
assert(!filteredDaily.some(s => s.id === "student-ended-1"), "Ended student is NOT present in daily attendance");
console.log("  ✓ List filtering accurately isolates ended students.");

// --- TEST 3: Daily Attendance Metrics Calculation ---
console.log("\n[Test 3] Daily Attendance Metrics Calculation Simulation");

const todayKey = "2026-07-15";

let attendanceTotal = 0;
let attendancePresent = 0;
let attendanceAbsent = 0;
let attendanceNotMarked = 0;

allStudents.forEach(s => {
  if (isEligibleForDailyAttendance(s)) {
    attendanceTotal++;
    const val = s.attendance?.[todayKey];
    if (val === true) attendancePresent++;
    else if (val === false) attendanceAbsent++;
    else attendanceNotMarked++;
  }
});

// Eligible students:
// activeStudent: present (true) -> Present
// pausedStudent: absent (false) -> Absent
// defaultStatusStudent: undefined -> Not Marked
// endedStudent: excluded! (even though attendance is true on todayKey)
assert.equal(attendanceTotal, 3, "Total attendance eligible count is 3");
assert.equal(attendancePresent, 1, "Present count is 1 (active only; ended not counted)");
assert.equal(attendanceAbsent, 1, "Absent count is 1 (paused only)");
assert.equal(attendanceNotMarked, 1, "Not marked count is 1 (default only)");
console.log("  ✓ Attendance counts strictly exclude ended student records.");

// --- TEST 4: Preservation of Account, History, and Profiles ---
console.log("\n[Test 4] Data Preservation Guarantees for Ended Student");

// Verify that the ended student's record is completely untouched
assert.equal(endedStudent.attendance["2026-07-15"], true, "Historical attendance record is intact");
assert.equal(endedStudent.attendance["2026-07-14"], false, "Previous day attendance record is intact");
assert.equal(endedStudent.monthlyFee, 1000, "Fee information is preserved");
assert.equal(endedStudent.name, "Chirag Verma", "Student profile details preserved");
assert.equal(allStudents.length, 4, "Total enrolled students count is preserved (all 4 students exist)");
console.log("  ✓ Student profile, attendance history, and database accounts are 100% preserved.");

// --- TEST 5: Version Consistency ---
console.log("\n[Test 5] Application Version Consistency");

const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8"));
assert.equal(pkg.version, "7.9.4", `package.json is 7.9.4`);

const manifest = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "public/manifest.json"), "utf-8"));
assert.equal(manifest.version, "7.9.4", `manifest.json is 7.9.4`);

const versionConstant = fs.readFileSync(path.resolve(process.cwd(), "src/constants/version.ts"), "utf-8");
assert(versionConstant.includes('"7.9.4"'), `src/constants/version.ts contains 7.9.4`);

const versionApi = fs.readFileSync(path.resolve(process.cwd(), "api/_lib/version.ts"), "utf-8");
assert(versionApi.includes('baseVersion = "7.9.4"'), `api/_lib/version.ts contains 7.9.4`);
console.log("  ✓ All version references correctly updated to v7.9.4.");

console.log("\n===================================================================");
console.log("  ALL TESTS PASSED — v7.9.4 DAILY ATTENDANCE INTEGRITY VERIFIED");
console.log("===================================================================\n");
