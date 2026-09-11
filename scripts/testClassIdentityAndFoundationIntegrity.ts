/**
 * Automated Verification Test Suite: Class Identity and Foundation Notes Integrity
 *
 * Validates:
 * 1. Class Creation: Creating "Foundation" preserves "Foundation" and does NOT create "Class Foundation".
 * 2. Note Upload / Path Generation: Generating paths for "Foundation" notes targets "class_notes/Foundation/...".
 * 3. Class Identity: Non-standard classes (e.g., "Foundation", "Prep") are preserved without forced "Class " prefix.
 * 4. Safe Reconciliation: Cleans up any duplicate classes ("Class Foundation", "Class Class") without data loss.
 * 5. Student Access: Students enrolled in "Foundation" receive Foundation notes and subjects properly.
 * 6. App Version: Version 7.9.10 is consistent across package.json, manifest.json, and constants.
 */

import { addClassPipeline, getSchoolHierarchy, saveSchoolHierarchy } from "../src/lib/curriculumService";
import { generateHierarchicalNotePaths } from "../api/_lib/utils";
import { buildCanonicalNoteMetadata, formatClassFolder } from "../src/domain/notes/types";
import { reconcileDuplicateClassesAndNotes } from "../src/lib/schemaMigrationService";
import { buildSingleSchoolSubject } from "../src/utils/studentSchoolHierarchyHelper";
import { APP_VERSION } from "../src/constants/version";
import { Student, ClassNote } from "../src/types";
import fs from "fs";
import path from "path";

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

async function runTests() {
  console.log("=================================================================");
  console.log("🧪 Running Class Identity & Foundation Notes Integrity Test Suite");
  console.log("=================================================================");

  // -------------------------------------------------------------------------
  // Test 1: Class Creation & Identity
  // -------------------------------------------------------------------------
  console.log("\n[Test 1] Class Creation & Identity Integrity");

  const initialSchool = getSchoolHierarchy();
  // Ensure starting state
  await addClassPipeline({ name: "Foundation", category: "school" });
  const hierarchyAfterFoundation = getSchoolHierarchy();

  assert(
    hierarchyAfterFoundation.classes.includes("Foundation"),
    `"Foundation" class exists in school hierarchy`
  );
  assert(
    !hierarchyAfterFoundation.classes.includes("Class Foundation"),
    `"Class Foundation" was NOT automatically created`
  );
  assert(
    !hierarchyAfterFoundation.classes.includes("Class Class"),
    `"Class Class" is NOT in school hierarchy`
  );

  // Test custom class name "Prep"
  await addClassPipeline({ name: "Prep", category: "school" });
  const hierarchyAfterPrep = getSchoolHierarchy();
  assert(
    hierarchyAfterPrep.classes.includes("Prep"),
    `"Prep" class preserved as "Prep"`
  );
  assert(
    !hierarchyAfterPrep.classes.includes("Class Prep"),
    `"Class Prep" was NOT automatically created`
  );

  // -------------------------------------------------------------------------
  // Test 2: Note Path Generation for Foundation
  // -------------------------------------------------------------------------
  console.log("\n[Test 2] Note Path Generation for Foundation");

  const notePaths = generateHierarchicalNotePaths({
    classGrade: "Foundation",
    subject: "English",
    chapterNo: 1,
    chapterName: "English Grammar",
    topicNo: 1,
    topicName: "Determiners",
  });

  assert(
    notePaths.className === "Foundation",
    `generateHierarchicalNotePaths preserves className as "Foundation"`
  );
  assert(
    notePaths.classSlug === "foundation",
    `generateHierarchicalNotePaths sets classSlug to "foundation"`
  );
  assert(
    notePaths.pdfKey.startsWith("notes/foundation/english/"),
    `pdfKey starts with "notes/foundation/english/": ${notePaths.pdfKey}`
  );
  assert(
    !notePaths.pdfKey.includes("class_foundation"),
    `pdfKey does not contain "class_foundation"`
  );

  // -------------------------------------------------------------------------
  // Test 3: Canonical Note Metadata Integrity
  // -------------------------------------------------------------------------
  console.log("\n[Test 3] Canonical Note Metadata Integrity");

  const canonicalMetadata = buildCanonicalNoteMetadata({
    className: "Foundation",
    subject: "English",
    chapterNumber: 1,
    chapterName: "English Grammar",
    topicNumber: 1,
    topicName: "Determiners",
    title: "Determiners",
    fileName: "determiners.pdf",
    fileSize: 1024,
    mimeType: "application/pdf",
    uploadedBy: "admin",
  });

  assert(
    canonicalMetadata.className === "Foundation",
    `Canonical note metadata has className = "Foundation"`
  );
  assert(
    canonicalMetadata.classGrade === "Foundation",
    `Canonical note metadata has classGrade = "Foundation"`
  );
  assert(
    formatClassFolder("Foundation").className === "Foundation",
    `formatClassFolder("Foundation").className returns "Foundation"`
  );
  assert(
    formatClassFolder("Foundation").classFolder === "Foundation",
    `formatClassFolder("Foundation").classFolder returns "Foundation"`
  );
  assert(
    formatClassFolder("Class 10").classFolder === "Class_10",
    `formatClassFolder("Class 10").classFolder returns "Class_10"`
  );

  // -------------------------------------------------------------------------
  // Test 4: Safe Duplicate Reconciliation
  // -------------------------------------------------------------------------
  console.log("\n[Test 4] Safe Duplicate Reconciliation");

  // Temporarily inject duplicate class to simulate legacy bad state
  const testSchool = getSchoolHierarchy();
  testSchool.classes.push("Class Foundation");
  testSchool.classes.push("Class Class");
  testSchool.subjects["Class Foundation"] = ["English Grammar Legacy"];
  await saveSchoolHierarchy(testSchool);

  const reconcileResult = await reconcileDuplicateClassesAndNotes();
  const schoolAfterReconcile = getSchoolHierarchy();

  assert(
    !schoolAfterReconcile.classes.includes("Class Foundation"),
    `Reconciliation merged and removed "Class Foundation"`
  );
  assert(
    !schoolAfterReconcile.classes.includes("Class Class"),
    `Reconciliation removed "Class Class"`
  );
  assert(
    schoolAfterReconcile.classes.includes("Foundation"),
    `"Foundation" remains intact after reconciliation`
  );
  assert(
    (schoolAfterReconcile.subjects["Foundation"] || []).includes("English Grammar Legacy"),
    `Legacy subjects from "Class Foundation" were safely preserved under "Foundation"`
  );

  // -------------------------------------------------------------------------
  // Test 5: Student Access for Foundation Class
  // -------------------------------------------------------------------------
  console.log("\n[Test 5] Student Access for Foundation Class");

  const mockStudent: Student = {
    id: "student_foundation_1",
    name: "Test Student",
    classGrade: "Foundation",
    enrolledSubjects: ["English"],
    role: "student",
  } as any;

  const mockNote: ClassNote = {
    id: "note_found_test_1",
    className: "Foundation",
    classGrade: "Foundation",
    subject: "English",
    chapterNo: 1,
    chapterName: "English Grammar",
    topicNo: 1,
    topicName: "Determiners",
    storagePath: "class_notes/Foundation/English/Chapter_01/Topic_01/determiners.pdf",
    r2Key: "class_notes/Foundation/English/Chapter_01/Topic_01/determiners.pdf",
  } as any;

  const subjectHierarchy = buildSingleSchoolSubject(
    "English",
    "Foundation",
    mockStudent,
    [mockNote]
  );

  assert(
    subjectHierarchy.modules.length > 0,
    `Student hierarchy built modules for Foundation English`
  );
  const totalTopics = subjectHierarchy.modules.reduce((sum, m) => sum + m.topics.length, 0);
  assert(
    totalTopics >= 1,
    `Student hierarchy includes Foundation topic note (found: ${totalTopics})`
  );

  // -------------------------------------------------------------------------
  // Test 6: App Version Consistency
  // -------------------------------------------------------------------------
  console.log("\n[Test 6] App Version Consistency");

  const pkgJson = JSON.parse(fs.readFileSync(path.resolve("./package.json"), "utf8"));
  const manifestJson = JSON.parse(fs.readFileSync(path.resolve("./public/manifest.json"), "utf8"));

  assert(
    APP_VERSION === "7.12.0",
    `APP_VERSION constant is "7.12.0" (actual: ${APP_VERSION})`
  );
  assert(
    pkgJson.version === "7.12.0",
    `package.json version is "7.12.0" (actual: ${pkgJson.version})`
  );
  assert(
    manifestJson.version === "7.12.0",
    `manifest.json version is "7.12.0" (actual: ${manifestJson.version})`
  );

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log("\n=================================================================");
  console.log(`Test Results: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("=================================================================");

  if (failedCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
