import {
  isExactOrCanonicalSubjectMatch,
  isSubjectCompatible,
  isStudentPermittedToAccessTest
} from "../src/lib/practiceTestService";
import { isSubjectMatching, getStudentSubjects } from "../src/utils/classNoteHelper";
import { Student, TopicPracticeTest } from "../src/types";

console.log("===================================================================");
console.log("  VERIFYING STRICT SUBJECT FILTERING & ENROLLMENT RULES           ");
console.log("===================================================================");

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

// -----------------------------------------------------------------------------
// TEST SUITE 1: STRICT SUBJECT / CHAPTER FILTERING FOR CHAPTER TESTS
// -----------------------------------------------------------------------------
console.log("\n[TEST SUITE 1] Strict Subject/Chapter Match & Cross-Subject Isolation");

const economicsChapterTest: TopicPracticeTest = {
  id: "class_10__economics__ch3__chapter_test",
  classGrade: "Class 10",
  subject: "Economics",
  chapterNo: 3,
  chapterName: "Money and Credit",
  topicName: "Chapter 3: Money and Credit Test 1",
  title: "Money and Credit Test 1",
  rawText: "",
  questions: [
    {
      id: "q1",
      questionText: "What is money?",
      options: ["A medium of exchange", "Barter item", "Coin only", "Paper only"],
      correctAnswer: 0
    }
  ],
  isPublished: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

// Test 1.1: Economics test must match Economics
assert(
  isExactOrCanonicalSubjectMatch("Economics", economicsChapterTest.subject),
  "Economics test matches selected subject 'Economics'"
);
assert(
  isSubjectCompatible("Economics", economicsChapterTest.subject),
  "isSubjectCompatible matches 'Economics' with 'Economics'"
);

// Test 1.2: Economics test must NEVER match Geography
assert(
  !isExactOrCanonicalSubjectMatch("Geography", economicsChapterTest.subject),
  "Economics test does NOT match selected subject 'Geography'"
);
assert(
  !isSubjectCompatible("Geography", economicsChapterTest.subject),
  "isSubjectCompatible('Geography', 'Economics') returns false"
);
assert(
  !isSubjectMatching("Geography", economicsChapterTest.subject),
  "isSubjectMatching('Geography', 'Economics') returns false"
);

// Test 1.3: Economics test must NEVER match History
assert(
  !isExactOrCanonicalSubjectMatch("History", economicsChapterTest.subject),
  "Economics test does NOT match selected subject 'History'"
);
assert(
  !isSubjectCompatible("History", economicsChapterTest.subject),
  "isSubjectCompatible('History', 'Economics') returns false"
);

// Test 1.4: Economics test must NEVER match Mathematics
assert(
  !isExactOrCanonicalSubjectMatch("Mathematics", economicsChapterTest.subject),
  "Economics test does NOT match selected subject 'Mathematics'"
);
assert(
  !isSubjectCompatible("Mathematics", economicsChapterTest.subject),
  "isSubjectCompatible('Mathematics', 'Economics') returns false"
);

// Test 1.5: Economics test must NEVER match Science or English
assert(
  !isExactOrCanonicalSubjectMatch("Science", economicsChapterTest.subject),
  "Economics test does NOT match selected subject 'Science'"
);
assert(
  !isExactOrCanonicalSubjectMatch("English", economicsChapterTest.subject),
  "Economics test does NOT match selected subject 'English'"
);

// Test 1.6: NCERT book title matching within the same subject
assert(
  isExactOrCanonicalSubjectMatch("Economics", "Understanding Economic Development"),
  "Economics matches NCERT title 'Understanding Economic Development'"
);
assert(
  !isExactOrCanonicalSubjectMatch("Geography", "Understanding Economic Development"),
  "Geography does NOT match NCERT title 'Understanding Economic Development'"
);
assert(
  isExactOrCanonicalSubjectMatch("Geography", "Contemporary India"),
  "Geography matches NCERT title 'Contemporary India'"
);
assert(
  !isExactOrCanonicalSubjectMatch("Economics", "Contemporary India"),
  "Economics does NOT match NCERT title 'Contemporary India'"
);

// -----------------------------------------------------------------------------
// TEST SUITE 2: SUBJECT SELECTOR & ENROLLMENT RULES
// -----------------------------------------------------------------------------
console.log("\n[TEST SUITE 2] Subject Selector — Dynamic Enrolled Subjects Only");

const studentA: Student = {
  id: "student_101",
  name: "Rahul Sharma",
  email: "rahul@example.com",
  role: "student",
  classGrade: "Class 10",
  enrolledSubjects: ["Geography", "History", "Mathematics", "Economics"]
};

// Simulate StudentTestsView studentSubjects computation
const rawEnrolled = (studentA.enrolledSubjects || []).filter(
  (s) => typeof s === "string" && s.trim().length > 0
);
const seen = new Set<string>();
const computedStudentSubjects: string[] = [];
rawEnrolled.forEach((s) => {
  const clean = s.trim();
  const normKey = clean.toLowerCase();
  if (!seen.has(normKey)) {
    seen.add(normKey);
    computedStudentSubjects.push(clean);
  }
});
computedStudentSubjects.sort((a, b) => a.localeCompare(b));

assert(
  computedStudentSubjects.length === 4,
  `Student selector contains exactly 4 subjects (got ${computedStudentSubjects.length})`
);
assert(
  computedStudentSubjects.includes("Geography") &&
  computedStudentSubjects.includes("History") &&
  computedStudentSubjects.includes("Mathematics") &&
  computedStudentSubjects.includes("Economics"),
  "Student selector contains: Geography, History, Mathematics, Economics"
);
assert(
  !computedStudentSubjects.includes("English"),
  "Student selector does NOT contain non-enrolled 'English'"
);
assert(
  !computedStudentSubjects.includes("English Grammer"),
  "Student selector does NOT contain non-enrolled 'English Grammer'"
);
assert(
  !computedStudentSubjects.includes("Science"),
  "Student selector does NOT contain non-enrolled 'Science'"
);
assert(
  !computedStudentSubjects.includes("NIOS Economics"),
  "Student selector does NOT contain non-enrolled 'NIOS Economics'"
);
assert(
  !computedStudentSubjects.includes("NIOS Indian Culture and Heritage"),
  "Student selector does NOT contain non-enrolled 'NIOS Indian Culture and Heritage'"
);
assert(
  !computedStudentSubjects.includes("Entrance"),
  "Student selector does NOT contain non-enrolled 'Entrance'"
);

// Check getStudentSubjects helper as well
const classNoteSubjects = getStudentSubjects(studentA, []);
assert(
  classNoteSubjects.length === 4,
  `getStudentSubjects contains exactly 4 subjects for studentA (got ${classNoteSubjects.length})`
);
assert(
  !classNoteSubjects.includes("English") && !classNoteSubjects.includes("Science"),
  "getStudentSubjects excludes non-enrolled English and Science"
);

// -----------------------------------------------------------------------------
// TEST SUITE 3: TEST VISIBILITY STRICTLY BOUND TO ENROLLMENT
// -----------------------------------------------------------------------------
console.log("\n[TEST SUITE 3] Test Visibility Governed by Student Enrollment");

const geographyChapterTest: TopicPracticeTest = {
  id: "class_10__geography__ch1__chapter_test",
  classGrade: "Class 10",
  subject: "Geography",
  chapterNo: 1,
  chapterName: "Resources and Development",
  topicName: "Chapter 1: Resources Test 1",
  title: "Resources and Development Test 1",
  rawText: "",
  questions: [{ id: "g1", questionText: "Resource type?", options: ["A", "B"], correctAnswer: 0 }],
  isPublished: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const englishChapterTest: TopicPracticeTest = {
  id: "class_10__english__ch1__chapter_test",
  classGrade: "Class 10",
  subject: "English",
  chapterNo: 1,
  chapterName: "A Letter to God",
  topicName: "Chapter 1: A Letter to God Test 1",
  title: "A Letter to God Test 1",
  rawText: "",
  questions: [{ id: "e1", questionText: "Who wrote the letter?", options: ["Lencho", "Postmaster"], correctAnswer: 0 }],
  isPublished: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const scienceChapterTest: TopicPracticeTest = {
  id: "class_10__science__ch1__chapter_test",
  classGrade: "Class 10",
  subject: "Science",
  chapterNo: 1,
  chapterName: "Chemical Reactions",
  topicName: "Chapter 1: Chemical Reactions Test 1",
  title: "Chemical Reactions Test 1",
  rawText: "",
  questions: [{ id: "s1", questionText: "Exothermic reaction?", options: ["Yes", "No"], correctAnswer: 0 }],
  isPublished: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

// Student A is enrolled in Economics, Geography, History, Mathematics
assert(
  isStudentPermittedToAccessTest(studentA, economicsChapterTest),
  "Student A is permitted to access Economics test (enrolled)"
);
assert(
  isStudentPermittedToAccessTest(studentA, geographyChapterTest),
  "Student A is permitted to access Geography test (enrolled)"
);
assert(
  !isStudentPermittedToAccessTest(studentA, englishChapterTest),
  "Student A is FORBIDDEN from English test (not enrolled)"
);
assert(
  !isStudentPermittedToAccessTest(studentA, scienceChapterTest),
  "Student A is FORBIDDEN from Science test (not enrolled)"
);

// -----------------------------------------------------------------------------
// TEST SUITE 4: FILTERED TESTS SIMULATION (AS IN STUDENT CONSOLE)
// -----------------------------------------------------------------------------
console.log("\n[TEST SUITE 4] FilteredTests Flow Under Different Selected Subject Filters");

const allTests = [
  economicsChapterTest,
  geographyChapterTest,
  englishChapterTest,
  scienceChapterTest
];

function simulateFilter(student: Student, selectedSubj: string) {
  return allTests.filter((t) => {
    if (!isStudentPermittedToAccessTest(student, t)) return false;

    // Enrolled subjects rule
    const studentEnrolled = (student.enrolledSubjects || []).filter((s) => typeof s === "string" && s.trim().length > 0);
    if (studentEnrolled.length > 0) {
      const match = studentEnrolled.some((enrolled) =>
        isExactOrCanonicalSubjectMatch(enrolled, t.subject) || isSubjectMatching(enrolled, t.subject)
      );
      if (!match) return false;
    }

    // Selected subject filter
    if (selectedSubj !== "All") {
      if (
        !isExactOrCanonicalSubjectMatch(selectedSubj, t.subject) &&
        !isSubjectMatching(selectedSubj, t.subject)
      ) {
        return false;
      }
    }

    return true;
  });
}

// Case 1: Student selects "All Subjects"
const visibleAll = simulateFilter(studentA, "All");
assert(
  visibleAll.length === 2,
  `Under 'All Subjects', student sees exactly 2 enrolled tests (got ${visibleAll.length})`
);
assert(
  visibleAll.some((t) => t.subject === "Economics") && visibleAll.some((t) => t.subject === "Geography"),
  "Under 'All Subjects', Economics and Geography tests appear"
);
assert(
  !visibleAll.some((t) => t.subject === "English") && !visibleAll.some((t) => t.subject === "Science"),
  "Under 'All Subjects', English and Science tests NEVER appear"
);

// Case 2: Student selects "Economics"
const visibleEco = simulateFilter(studentA, "Economics");
assert(
  visibleEco.length === 1 && visibleEco[0].id === economicsChapterTest.id,
  "When 'Economics' is selected, ONLY Economics Chapter 3 test appears"
);

// Case 3: Student selects "Geography"
const visibleGeo = simulateFilter(studentA, "Geography");
assert(
  visibleGeo.length === 1 && visibleGeo[0].id === geographyChapterTest.id,
  "When 'Geography' is selected, ONLY Geography Chapter 1 test appears (NO Economics test)"
);

// Case 4: Student selects "History"
const visibleHist = simulateFilter(studentA, "History");
assert(
  visibleHist.length === 0,
  "When 'History' is selected, 0 tests appear because no History tests uploaded (NO Economics test)"
);

// Case 5: Student selects "Mathematics"
const visibleMath = simulateFilter(studentA, "Mathematics");
assert(
  visibleMath.length === 0,
  "When 'Mathematics' is selected, 0 tests appear because no Math tests uploaded (NO Economics test)"
);

console.log("\n===================================================================");
console.log(`  SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log("===================================================================");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("  ALL SUBJECT AND ENROLLMENT FILTERING VERIFICATIONS PASSED! 🎉");
}
