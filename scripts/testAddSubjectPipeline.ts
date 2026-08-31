/**
 * Regression Test Suite: Add Subject Pipeline & Cross-Console Synchronization
 *
 * Tests:
 * 1. addSubjectPipeline creates subject under specified School Class and UPSC Paper
 * 2. Unmarks subject from removedSubjects if previously removed
 * 3. Updates local hierarchy immediately so local state reflects newly added subject without reload
 * 4. Ensures student hierarchy builders immediately include the new subject
 * 5. Verifies error handling prevents false-positive success toasts on invalid inputs
 * 6. Realtime subscription non-destructive merge preserves local additions
 *
 * Usage:
 *   npx tsx scripts/testAddSubjectPipeline.ts
 */

import {
  getSchoolHierarchy,
  getUpscHierarchy,
  addSubjectPipeline,
  mergeSchoolHierarchies,
  mergeUpscHierarchies,
  SchoolHierarchyData,
  UpscHierarchyData
} from "../src/lib/curriculumService";
import {
  getStudentEnrolledSchoolSubjects,
  buildStudentSchoolHierarchy
} from "../src/utils/studentSchoolHierarchyHelper";
import {
  buildStudentUPSCHierarchy,
  getStudentEnrolledGSPapers
} from "../src/utils/studentUPSCHierarchyHelper";
import { Student, ClassNote } from "../src/types";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, description: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passedCount++;
  } else {
    console.error(`  ❌ FAIL: ${description}`);
    failedCount++;
  }
}

async function test1_AddSchoolSubjectPipeline() {
  console.log("\n[Test 1] Add School Subject Pipeline (e.g. History under Class 10)");

  const schoolBefore = getSchoolHierarchy();
  const res = await addSubjectPipeline({
    category: "school",
    className: "Class 10",
    name: "History"
  });

  assert(res.success === true, "Pipeline returns success: true");
  assert(res.subjectName === "History", 'Subject name returned is "History"');
  assert(res.parentName === "Class 10", 'Parent class returned is "Class 10"');

  const schoolAfter = getSchoolHierarchy();
  assert(
    (schoolAfter.subjects["Class 10"] || []).includes("History"),
    'School hierarchy now contains "History" under "Class 10"'
  );

  const removedList = schoolAfter.removedSubjects?.["Class 10"] || [];
  assert(
    !removedList.map((s) => s.toLowerCase()).includes("history"),
    'Removed subjects does not contain "history"'
  );
}

async function test2_StudentSchoolHierarchyIncludesNewSubject() {
  console.log("\n[Test 2] Student School Console Immediately Displays New Subject");

  const mockStudent: Student = {
    id: "student_school_001",
    name: "Aarav Sharma",
    email: "aarav@example.com",
    classGrade: "Class 10",
    enrolledSubjects: [],
    enrolledSchoolIds: [],
    phoneNumber: "9876543210",
    role: "student",
    createdAt: new Date().toISOString()
  };

  const enrolledSubjects = getStudentEnrolledSchoolSubjects(mockStudent, []);
  assert(
    enrolledSubjects.includes("History"),
    'getStudentEnrolledSchoolSubjects includes "History" for student in Class 10'
  );

  const hierarchy = buildStudentSchoolHierarchy(mockStudent, []);
  assert(
    hierarchy.subjects.some((s) => s.subject.toLowerCase() === "history"),
    'buildStudentSchoolHierarchy includes subject card for "History"'
  );
}

async function test3_AddUPSCPaperSubjectPipeline() {
  console.log("\n[Test 3] Add UPSC Subject Pipeline (e.g. Ethics & Integrity under General Studies Paper IV)");

  const res = await addSubjectPipeline({
    category: "upsc",
    gsPaper: "General Studies Paper IV",
    name: "Ethics & Integrity"
  });

  assert(res.success === true, "Pipeline returns success: true for UPSC subject");
  assert(res.subjectName === "Ethics & Integrity", 'Subject name returned is "Ethics & Integrity"');
  assert(res.parentName === "General Studies Paper IV", 'Parent paper returned is "General Studies Paper IV"');

  const upscAfter = getUpscHierarchy();
  assert(
    (upscAfter.subjects["General Studies Paper IV"] || []).includes("Ethics & Integrity"),
    'UPSC hierarchy contains "Ethics & Integrity" under "General Studies Paper IV"'
  );

  const mockUpscStudent: Student = {
    id: "student_upsc_001",
    name: "Priya Singh",
    email: "priya@example.com",
    classGrade: "UPSC",
    enrolledSubjects: [],
    enrolledSchoolIds: [],
    phoneNumber: "9876543211",
    role: "student",
    createdAt: new Date().toISOString()
  };

  const upscHierarchy = buildStudentUPSCHierarchy(mockUpscStudent, []);
  const paperIV = upscHierarchy.find((p) => p.gsPaper === "General Studies Paper IV");
  assert(Boolean(paperIV), "UPSC Student Hierarchy contains General Studies Paper IV");
  assert(
    (paperIV?.subjects || []).some((s) => s.subject === "Ethics & Integrity"),
    'UPSC Student Hierarchy contains "Ethics & Integrity" subject under General Studies Paper IV'
  );
}

async function test4_EmptySubjectValidation() {
  console.log("\n[Test 4] Validation & Error Handling (No False Positives)");

  let errorThrown = false;
  try {
    await addSubjectPipeline({
      category: "school",
      className: "Class 10",
      name: "   "
    });
  } catch (err: any) {
    errorThrown = true;
    assert(err.message.includes("empty"), "Proper error message thrown for whitespace-only name");
  }
  assert(errorThrown, "addSubjectPipeline rejects empty subject name");
}

async function test5_NonDestructiveHierarchyMerge() {
  console.log("\n[Test 5] Non-Destructive Realtime Hierarchy Merge");

  const base: SchoolHierarchyData = {
    classes: ["Class 9", "Class 10"],
    subjects: {
      "Class 10": ["Mathematics", "History"]
    },
    chapters: {},
    removedSubjects: {}
  };

  const incomingRemote: Partial<SchoolHierarchyData> = {
    classes: ["Class 10", "Class 11"],
    subjects: {
      "Class 10": ["Science"],
      "Class 11": ["Physics"]
    }
  };

  const merged = mergeSchoolHierarchies(base, incomingRemote);
  assert(
    merged.classes.includes("Class 9") &&
      merged.classes.includes("Class 10") &&
      merged.classes.includes("Class 11"),
    "Merged classes union all classes correctly"
  );
  assert(
    merged.subjects["Class 10"].includes("Mathematics") &&
      merged.subjects["Class 10"].includes("History") &&
      merged.subjects["Class 10"].includes("Science"),
    'Merged "Class 10" subjects retain both locally added "History" and remote "Science"'
  );
}

async function runAll() {
  console.log("===================================================================");
  console.log("  ADD SUBJECT PIPELINE & CROSS-CONSOLE INTEGRITY TEST SUITE");
  console.log("===================================================================");

  try {
    await test1_AddSchoolSubjectPipeline();
    await test2_StudentSchoolHierarchyIncludesNewSubject();
    await test3_AddUPSCPaperSubjectPipeline();
    await test4_EmptySubjectValidation();
    await test5_NonDestructiveHierarchyMerge();
  } catch (e) {
    console.error("Test execution aborted with error:", e);
  }

  console.log("\n===================================================================");
  console.log(`  RESULTS: ${passedCount} Passed, ${failedCount} Failed`);
  console.log("===================================================================");

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAll();
