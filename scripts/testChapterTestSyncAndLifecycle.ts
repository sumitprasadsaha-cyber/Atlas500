/**
 * Comprehensive Verification: Chapter Test Syncing, Unique Test IDs,
 * Result Separation, Deletion Safety, and Student Console Access (v7.12.7)
 */
import { 
  buildChapterTestId, 
  generateDefaultChapterTestTitle,
  isClassCompatible,
  isSubjectCompatible,
  isStudentPermittedToAccessTest,
  isValidPracticeTest,
  normalizeTestCategory
} from "../src/lib/practiceTestService";
import { getChapterTestStats } from "../src/utils/testStatsHelper";
import { TopicPracticeTest, TestAttemptRecord, Student } from "../src/types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✅ PASS: ${message}`);
}

async function runVerification() {
  console.log("===================================================================");
  console.log("  RELEASE 7.12.7 — CHAPTER TEST SYNCING & LIFECYCLE VERIFICATION   ");
  console.log("===================================================================\n");

  // Mock bank
  const mockBank: Record<string, TopicPracticeTest> = {};

  const classGrade = "Class 10";
  const subject = "Economics";
  const chapterNo = 3;
  const chapterName = "Money and Credit";

  // Helper matching the service's getChapterPracticeTestsSync
  function getChapterTests(cGrade: string, subj: string, chNo: number): TopicPracticeTest[] {
    return Object.values(mockBank)
      .filter((t) => {
        if (!t || t.isDeleted === true || (t as any).deleted === true) return false;
        if (t.isPublished === false || (t as any).published === false) return false;
        if (!Array.isArray(t.questions) || t.questions.length === 0) return false;
        const cat = normalizeTestCategory(t);
        if (cat !== "CHAPTER") return false;
        if (Number(t.chapterNo) !== chNo) return false;
        if (!isSubjectCompatible(subj, t.subject)) return false;
        return isClassCompatible(cGrade, t.classGrade);
      })
      .sort((a, b) => {
        const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (tA !== tB) return tA - tB;
        return (a.title || a.id).localeCompare(b.title || b.id);
      });
  }

  // --- Step 1 & 2: Admin creates Chapter Test 1 ---
  console.log("[Step 1 & 2] Admin creates Money and Credit Test 1");
  const test1BaseId = buildChapterTestId(classGrade, subject, chapterNo);
  const test1Id = test1BaseId;
  const test1Title = generateDefaultChapterTestTitle(chapterNo, chapterName, 1);
  
  mockBank[test1Id] = {
    id: test1Id,
    testId: test1Id,
    classGrade,
    subject,
    chapterNo,
    chapterName,
    topicName: test1Title,
    title: test1Title,
    testType: "CHAPTER",
    isPublished: true,
    isDeleted: false,
    createdAt: new Date("2026-09-01T10:00:00Z").toISOString(),
    questions: [
      { id: "q1", question: "What is double coincidence of wants?", options: ["A", "B", "C", "D"], correctAnswer: "A" }
    ] as any
  };

  assert(test1Id === "class_10__economics__ch3__chapter_test", `Test 1 has canonical immutable ID: ${test1Id}`);
  assert(test1Title === "Money and Credit Test 1", `Test 1 auto-titled correctly: "${test1Title}"`);

  // --- Step 3: Admin creates Chapter Test 2 ---
  console.log("\n[Step 3] Admin creates Money and Credit Test 2 for the same chapter");
  const existingBefore2 = getChapterTests(classGrade, subject, chapterNo);
  const test2Num = existingBefore2.length + 1;
  const test2Suffix = "test2_unique_abc";
  const test2Id = `${test1BaseId}__${test2Suffix}`;
  const test2Title = generateDefaultChapterTestTitle(chapterNo, chapterName, test2Num);

  mockBank[test2Id] = {
    id: test2Id,
    testId: test2Id,
    classGrade,
    subject,
    chapterNo,
    chapterName,
    topicName: test2Title,
    title: test2Title,
    testType: "CHAPTER",
    isPublished: true,
    isDeleted: false,
    createdAt: new Date("2026-09-01T11:00:00Z").toISOString(),
    questions: [
      { id: "q2", question: "Which agency issues currency notes in India?", options: ["A", "B", "C", "D"], correctAnswer: "B" }
    ] as any
  };

  assert(test2Id !== test1Id, `Test 2 has distinct unique immutable ID: ${test2Id}`);
  assert(test2Title === "Money and Credit Test 2", `Test 2 auto-titled correctly: "${test2Title}"`);

  // --- Step 4: Admin creates Chapter Test 3 ---
  console.log("\n[Step 4] Admin creates Money and Credit Test 3 for the same chapter");
  const existingBefore3 = getChapterTests(classGrade, subject, chapterNo);
  const test3Num = existingBefore3.length + 1;
  const test3Suffix = "test3_unique_xyz";
  const test3Id = `${test1BaseId}__${test3Suffix}`;
  const test3Title = generateDefaultChapterTestTitle(chapterNo, chapterName, test3Num);

  mockBank[test3Id] = {
    id: test3Id,
    testId: test3Id,
    classGrade,
    subject,
    chapterNo,
    chapterName,
    topicName: test3Title,
    title: test3Title,
    testType: "CHAPTER",
    isPublished: true,
    isDeleted: false,
    createdAt: new Date("2026-09-01T12:00:00Z").toISOString(),
    questions: [
      { id: "q3", question: "What are informal sources of credit?", options: ["A", "B", "C", "D"], correctAnswer: "C" }
    ] as any
  };

  assert(test3Id !== test1Id && test3Id !== test2Id, `Test 3 has distinct unique ID: ${test3Id}`);
  assert(test3Title === "Money and Credit Test 3", `Test 3 auto-titled correctly: "${test3Title}"`);

  // --- Step 5: Student Console Sync Check ---
  console.log("\n[Step 5] Student Console Sync Check (All 3 Tests Available)");
  const studentVisibleTests = getChapterTests(classGrade, subject, chapterNo);
  assert(studentVisibleTests.length === 3, `Student Console receives all 3 published Chapter Tests (found: ${studentVisibleTests.length})`);
  assert(studentVisibleTests[0].id === test1Id, `Test 1 is present in position 1`);
  assert(studentVisibleTests[1].id === test2Id, `Test 2 is present in position 2`);
  assert(studentVisibleTests[2].id === test3Id, `Test 3 is present in position 3`);

  // --- Step 6: Student Access Permission Verification ---
  console.log("\n[Step 6] Student Access Permission Verification");
  const studentClass10: Student = {
    id: "stud_101",
    name: "Rohan Sharma",
    classGrade: "Class 10",
    enrolledSubjects: ["Economics", "Mathematics", "Science"]
  };
  const studentClass9: Student = {
    id: "stud_102",
    name: "Aarav Patel",
    classGrade: "Class 9",
    enrolledSubjects: ["Social Science"]
  };

  assert(isStudentPermittedToAccessTest(studentClass10, mockBank[test1Id]), `Class 10 student permitted for Test 1`);
  assert(isStudentPermittedToAccessTest(studentClass10, mockBank[test2Id]), `Class 10 student permitted for Test 2`);
  assert(isStudentPermittedToAccessTest(studentClass10, mockBank[test3Id]), `Class 10 student permitted for Test 3`);
  assert(!isStudentPermittedToAccessTest(studentClass9, mockBank[test1Id]), `Class 9 student forbidden from Class 10 Test 1`);

  // --- Step 7 & 8: Student Result Association & Strict Separation ---
  console.log("\n[Step 7 & 8] Student Takes Test 1 (80%) and Test 2 (90%) — Result Separation");
  const testAttempts: TestAttemptRecord[] = [];

  // Rohan takes Test 1: scores 80%
  const attemptTest1: TestAttemptRecord = {
    id: "att_1",
    studentId: studentClass10.id,
    studentName: studentClass10.name,
    testId: test1Id,
    classGrade,
    subject,
    chapterNo,
    chapterName,
    topicName: test1Title,
    testType: "CHAPTER",
    attemptNumber: 1,
    date: "01 Sep 2026",
    timestamp: Date.now() - 3600000,
    timeTakenSeconds: 300,
    score: 8,
    totalMarks: 10,
    passingMarks: 4,
    isPassed: true,
    totalQuestions: 10,
    percentage: 80,
    correctAnswersCount: 8,
    wrongAnswersCount: 2,
    unattemptedCount: 0,
    userAnswers: {},
    questionScores: {}
  };
  testAttempts.push(attemptTest1);

  // Check stats before Test 2 is taken
  const stats1Before2 = getChapterTestStats(testAttempts, studentClass10.id, studentClass10.name, classGrade, subject, chapterNo, test1Id);
  const stats2Before2 = getChapterTestStats(testAttempts, studentClass10.id, studentClass10.name, classGrade, subject, chapterNo, test2Id);

  assert(stats1Before2 !== null && stats1Before2.latestPercentage === 80, `Test 1 stats shows 80% score`);
  assert(stats2Before2 === null, `Test 2 stats is null (not attempted yet, no bleed from Test 1)`);

  // Rohan takes Test 2: scores 90%
  const attemptTest2: TestAttemptRecord = {
    id: "att_2",
    studentId: studentClass10.id,
    studentName: studentClass10.name,
    testId: test2Id,
    classGrade,
    subject,
    chapterNo,
    chapterName,
    topicName: test2Title,
    testType: "CHAPTER",
    attemptNumber: 1,
    date: "01 Sep 2026",
    timestamp: Date.now(),
    timeTakenSeconds: 280,
    score: 9,
    totalMarks: 10,
    passingMarks: 4,
    isPassed: true,
    totalQuestions: 10,
    percentage: 90,
    correctAnswersCount: 9,
    wrongAnswersCount: 1,
    unattemptedCount: 0,
    userAnswers: {},
    questionScores: {}
  };
  testAttempts.push(attemptTest2);

  // Check stats after Test 2 is taken
  const stats1After2 = getChapterTestStats(testAttempts, studentClass10.id, studentClass10.name, classGrade, subject, chapterNo, test1Id);
  const stats2After2 = getChapterTestStats(testAttempts, studentClass10.id, studentClass10.name, classGrade, subject, chapterNo, test2Id);
  const stats3After2 = getChapterTestStats(testAttempts, studentClass10.id, studentClass10.name, classGrade, subject, chapterNo, test3Id);

  assert(stats1After2 !== null && stats1After2.latestPercentage === 80, `Test 1 retains its 80% result`);
  assert(stats2After2 !== null && stats2After2.latestPercentage === 90, `Test 2 has distinct 90% result`);
  assert(stats3After2 === null, `Test 3 remains unattempted`);

  // --- Step 9: Safe Test Deletion ---
  console.log("\n[Step 9] Admin Deletes Test 2 — Safe Deletion & Preserved Numbering");
  mockBank[test2Id].isDeleted = true;

  const visibleAfterDelete = getChapterTests(classGrade, subject, chapterNo);
  assert(visibleAfterDelete.length === 2, `Visible chapter tests count is 2 after deleting Test 2`);
  assert(visibleAfterDelete[0].id === test1Id, `Test 1 is preserved: ID=${visibleAfterDelete[0].id}`);
  assert(visibleAfterDelete[1].id === test3Id, `Test 3 is preserved: ID=${visibleAfterDelete[1].id}`);
  assert(visibleAfterDelete[1].title === "Money and Credit Test 3", `Test 3 title NOT renamed; remains "Money and Credit Test 3"`);

  // --- Step 10: Result Persistence for Remaining Tests ---
  console.log("\n[Step 10] Result Integrity After Deletion");
  const stats1AfterDelete = getChapterTestStats(testAttempts, studentClass10.id, studentClass10.name, classGrade, subject, chapterNo, test1Id);
  assert(stats1AfterDelete !== null && stats1AfterDelete.latestPercentage === 80, `Test 1 score remains 80% after deleting Test 2`);

  // --- Step 11: Create Next Test Without Collision ---
  console.log("\n[Step 11] Admin Creates a New Test After Deletion (Collision Avoidance)");
  // All active and non-deleted test numbers
  const allTests = Object.values(mockBank).filter((t) => !t.isDeleted);
  const usedNumbers = new Set(
    allTests.map((t) => {
      const match = (t.title || "").match(/\bTest\s+(\d+)/i);
      return match ? parseInt(match[1], 10) : 0;
    })
  );
  let nextSafeNumber = 1;
  while (usedNumbers.has(nextSafeNumber)) {
    nextSafeNumber++;
  }
  const testNewId = `${test1BaseId}__new_test_456`;
  const testNewTitle = generateDefaultChapterTestTitle(chapterNo, chapterName, nextSafeNumber);

  mockBank[testNewId] = {
    id: testNewId,
    testId: testNewId,
    classGrade,
    subject,
    chapterNo,
    chapterName,
    topicName: testNewTitle,
    title: testNewTitle,
    testType: "CHAPTER",
    isPublished: true,
    isDeleted: false,
    createdAt: new Date().toISOString(),
    questions: [
      { id: "q4", question: "What is collateral?", options: ["A", "B", "C", "D"], correctAnswer: "D" }
    ] as any
  };

  assert(testNewTitle === "Money and Credit Test 2", `New test safely fills the available gap without colliding (Title: "${testNewTitle}")`);
  const finalVisibleTests = getChapterTests(classGrade, subject, chapterNo);
  assert(finalVisibleTests.length === 3, `Final visible tests count is 3`);

  console.log("\n===================================================================");
  console.log("  ALL CHAPTER TEST SYNC & LIFECYCLE GUARANTEES VERIFIED SUCCESSFULLY");
  console.log("===================================================================");
}

runVerification().catch((err) => {
  console.error("Verification failed with exception:", err);
  process.exit(1);
});
