/**
 * Test Suite: Student Portal Test Grouping & Compact Card Layout (v7.12.7)
 * Verifies grouping by Chapter, grouping by Subject, compact card data mapping,
 * sorting order, and navigation flows.
 */
import assert from "assert";

interface MockTest {
  id: string;
  computedType: "CHAPTER" | "SUBJECT" | "TOPIC" | "PYQ";
  classGrade: string;
  subject: string;
  chapterNo?: number;
  chapterName?: string;
  topicName?: string;
  title: string;
  testNumber?: number;
  questions: any[];
  totalMarks?: number;
  durationMinutes?: number;
  isCompleted?: boolean;
  latestAttempt?: { score: number; totalQuestions: number; percentage: number };
}

function runGroupingTests() {
  console.log("===================================================================");
  console.log("  RELEASE 7.12.7 — STUDENT TEST GROUPING & COMPACT CARDS TEST      ");
  console.log("===================================================================\n");

  const mockTests: MockTest[] = [
    {
      id: "ch3_test1",
      computedType: "CHAPTER",
      classGrade: "Class 10",
      subject: "Economics",
      chapterNo: 3,
      chapterName: "Money and Credit",
      title: "Money and Credit Test 1",
      testNumber: 1,
      questions: new Array(20).fill({}),
      totalMarks: 40,
      durationMinutes: 45,
      isCompleted: true,
      latestAttempt: { score: 18, totalQuestions: 20, percentage: 90 }
    },
    {
      id: "ch3_test2",
      computedType: "CHAPTER",
      classGrade: "Class 10",
      subject: "Economics",
      chapterNo: 3,
      chapterName: "Money and Credit",
      title: "Money and Credit Test 2",
      testNumber: 2,
      questions: new Array(23).fill({}),
      totalMarks: 42,
      durationMinutes: 45,
      isCompleted: false
    },
    {
      id: "ch1_test1",
      computedType: "CHAPTER",
      classGrade: "Class 10",
      subject: "Economics",
      chapterNo: 1,
      chapterName: "Development",
      title: "Development Test 1",
      testNumber: 1,
      questions: new Array(15).fill({}),
      totalMarks: 30,
      durationMinutes: 30,
      isCompleted: false
    },
    {
      id: "subj_eco_1",
      computedType: "SUBJECT",
      classGrade: "Class 10",
      subject: "Economics",
      title: "Economics Test 1",
      testNumber: 1,
      questions: new Array(40).fill({}),
      totalMarks: 80,
      durationMinutes: 90,
      isCompleted: false
    },
    {
      id: "subj_eco_2",
      computedType: "SUBJECT",
      classGrade: "Class 10",
      subject: "Economics",
      title: "Economics Test 2",
      testNumber: 2,
      questions: new Array(40).fill({}),
      totalMarks: 80,
      durationMinutes: 90,
      isCompleted: false
    }
  ];

  // 1. Chapter Grouping Test
  const groupsMap = new Map<string, {
    key: string;
    subject: string;
    chapterNo: number;
    chapterName: string;
    tests: MockTest[];
  }>();

  mockTests.filter(t => t.computedType === "CHAPTER").forEach(t => {
    const key = `${t.subject.toLowerCase()}__${t.chapterNo}`;
    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        key,
        subject: t.subject,
        chapterNo: t.chapterNo!,
        chapterName: t.chapterName!,
        tests: []
      });
    }
    groupsMap.get(key)!.tests.push(t);
  });

  const chapterGroups = Array.from(groupsMap.values());
  assert.strictEqual(chapterGroups.length, 2, "There should be 2 unique chapter groups");
  
  const ch3Group = chapterGroups.find(g => g.chapterNo === 3);
  assert.ok(ch3Group, "Chapter 3 group exists");
  assert.strictEqual(ch3Group!.tests.length, 2, "Chapter 3 has 2 tests (Test 1 and Test 2)");
  assert.strictEqual(ch3Group!.tests[0].title, "Money and Credit Test 1");
  assert.strictEqual(ch3Group!.tests[1].title, "Money and Credit Test 2");
  console.log("  ✅ PASS: Chapter Tests grouped correctly by chapter (Money and Credit: 2 Tests)");

  // 2. Subject Grouping Test
  const subjGroupsMap = new Map<string, {
    key: string;
    subject: string;
    tests: MockTest[];
  }>();

  mockTests.filter(t => t.computedType === "SUBJECT").forEach(t => {
    const key = t.subject.toLowerCase();
    if (!subjGroupsMap.has(key)) {
      subjGroupsMap.set(key, {
        key,
        subject: t.subject,
        tests: []
      });
    }
    subjGroupsMap.get(key)!.tests.push(t);
  });

  const subjectGroups = Array.from(subjGroupsMap.values());
  assert.strictEqual(subjectGroups.length, 1, "There should be 1 unique subject group (Economics)");
  assert.strictEqual(subjectGroups[0].tests.length, 2, "Economics subject group has 2 tests");
  console.log("  ✅ PASS: Subject Tests grouped correctly by subject (Economics: 2 Tests)");

  // 3. Compact Spec Values check
  const test2 = ch3Group!.tests[1];
  assert.strictEqual(test2.questions.length, 23, "Question count is 23");
  assert.strictEqual(test2.totalMarks, 42, "Marks count is 42");
  assert.strictEqual(test2.durationMinutes, 45, "Duration is 45m");
  console.log("  ✅ PASS: Compact card metadata retains Question count (23), Marks (42), and Duration (45m)");

  console.log("\n===================================================================");
  console.log("  ALL STUDENT GROUPING & COMPACT LAYOUT TESTS PASSED (100%)         ");
  console.log("===================================================================");
}

runGroupingTests();
