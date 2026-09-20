import React, { useState, useEffect, useMemo } from "react";
import { 
  Trophy, 
  Search, 
  BookOpen, 
  Clock, 
  ListChecks, 
  Award, 
  Sparkles, 
  RotateCcw, 
  Play, 
  CheckCircle2, 
  FileText, 
  BarChart3, 
  Calendar, 
  ChevronRight, 
  RefreshCw, 
  Filter,
  X,
  FileCheck2,
  HelpCircle,
  AlertCircle,
  ArrowLeft
} from "lucide-react";
import { TopicPracticeTest, TestAttemptRecord, AssessmentTestType, Student, ClassNote } from "../../types";
import { 
  fetchAllPracticeTests, 
  subscribeToPracticeTests,
  normalizeTestCategory,
  buildTopicTestId, 
  buildChapterTestId, 
  buildSubjectTestId,
  buildAssessmentTestId,
  isStudentPermittedToAccessTest,
  isClassCompatible,
  isSubjectCompatible,
  isExactOrCanonicalSubjectMatch,
  isSubjectMatching
} from "../../lib/practiceTestService";
import { getAllTestAttempts, subscribeToTestAttempts } from "../../utils/assessmentParser";
import { toStableClassId, getAccessibleClassesGrantedToClass } from "../../lib/curriculumAccessService";
import { loadTestDraft } from "../../lib/testSessionManager";
import StudentPracticeTestModal from "../StudentPracticeTestModal";

interface StudentTestsViewProps {
  student: Student;
  notes?: ClassNote[];
}

const formatCorrectAnswerForDisplay = (val: unknown): string => {
  if (val === null || val === undefined) return "";
  let str = String(val);

  if (/<(?:br|p|div|li)\b[^>]*>/i.test(str)) {
    str = str
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, "");
  }

  str = str.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return str.trim();
};

export const StudentTestsView: React.FC<StudentTestsViewProps> = ({
  student,
  notes = []
}) => {
  const [testsBank, setTestsBank] = useState<Record<string, TopicPracticeTest>>({});
  const [attempts, setAttempts] = useState<TestAttemptRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedSubject, setSelectedSubject] = useState<string>("All");
  const [selectedCategory, setSelectedCategory] = useState<"ALL" | "SUBJECT" | "CHAPTER" | "PYQ">("ALL");
  const [selectedStatus, setSelectedStatus] = useState<"ALL" | "COMPLETED" | "PENDING">("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Drill-down group states for Chapter and Subject tests
  const [selectedChapterGroup, setSelectedChapterGroup] = useState<{
    subject: string;
    chapterNo: number;
    chapterName: string;
  } | null>(null);

  const [selectedSubjectGroup, setSelectedSubjectGroup] = useState<{
    subject: string;
  } | null>(null);

  // Test Taking Modal state
  const [activeTestTarget, setActiveTestTarget] = useState<{
    testId?: string;
    classGrade: string;
    subject: string;
    chapterNo?: number;
    chapterName?: string;
    topicName?: string;
    testType: AssessmentTestType;
    title?: string;
  } | null>(null);

  // Scorecard modal state
  const [activeScorecard, setActiveScorecard] = useState<{
    testTitle: string;
    attempt: TestAttemptRecord;
    questions?: any[];
  } | null>(null);

  const studentIdentifier = student.id || student.name;
  const studentClass = student.classGrade || "Class 10";

  // Load tests and attempts
  const loadData = async () => {
    setIsLoading(true);
    try {
      const bank = await fetchAllPracticeTests();
      setTestsBank(bank || {});
      const allAtt = getAllTestAttempts();
      setAttempts(allAtt || []);
    } catch (err) {
      console.warn("[StudentTestsView] Failed to load data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    const unsubBank = subscribeToPracticeTests((bank) => {
      if (bank) setTestsBank(bank);
    });

    const unsubAttempts = subscribeToTestAttempts((updated) => {
      if (updated) setAttempts(updated);
    });

    const handleSync = () => {
      fetchAllPracticeTests({ forceFresh: true }).then((bank) => {
        setTestsBank(bank || {});
      });
    };
    window.addEventListener("practice-tests-updated", handleSync);
    window.addEventListener("managed-tests-updated", handleSync);
    window.addEventListener("storage", handleSync);

    return () => {
      unsubBank();
      unsubAttempts();
      window.removeEventListener("practice-tests-updated", handleSync);
      window.removeEventListener("managed-tests-updated", handleSync);
      window.removeEventListener("storage", handleSync);
    };
  }, []);

  // Allowed classes for this student (canonical or granted permissions)
  const allowedClasses = useMemo(() => {
    const norm = toStableClassId(studentClass);
    const granted = getAccessibleClassesGrantedToClass(studentClass).map((g) => toStableClassId(g.ownerClass));
    return Array.from(new Set([norm, ...granted]));
  }, [studentClass]);

  // Compute student's enrolled subjects strictly from authenticated student's enrollment data
  const studentSubjects = useMemo(() => {
    const rawEnrolled = (student.enrolledSubjects || []).filter(
      (s) => typeof s === "string" && s.trim().length > 0
    );

    if (rawEnrolled.length > 0) {
      // Deduplicate while preserving clean display names
      const seen = new Set<string>();
      const result: string[] = [];
      rawEnrolled.forEach((s) => {
        const clean = s.trim();
        const normKey = clean.toLowerCase();
        if (!seen.has(normKey)) {
          seen.add(normKey);
          result.push(clean);
        }
      });
      return result.sort((a, b) => a.localeCompare(b));
    }

    return [];
  }, [student.enrolledSubjects]);

  // Filter test bank for this student
  const filteredTests = useMemo(() => {
    const studentAttempts = attempts.filter(
      (a) => a.studentId === studentIdentifier || (student.name && a.studentName.toLowerCase() === student.name.toLowerCase())
    );

    // Deduplicate by canonical ID
    const testMap = new Map<string, TopicPracticeTest>();
    Object.values(testsBank).forEach((t) => {
      if (!t) return;
      const canonicalKey = t.id || (t as any).testId || (t as any).docId;
      if (canonicalKey && !testMap.has(canonicalKey)) {
        testMap.set(canonicalKey, t);
      }
    });

    const list = Array.from(testMap.values()).map((t) => {
      const normalizedType = normalizeTestCategory(t);

      // Collect all exact unique identifiers for this specific test
      const targetIds = new Set<string>();
      if (t.id) targetIds.add(String(t.id).trim().toLowerCase());
      if ((t as any).testId) targetIds.add(String((t as any).testId).trim().toLowerCase());
      if ((t as any).docId) targetIds.add(String((t as any).docId).trim().toLowerCase());
      if ((t as any).assessmentTestId) targetIds.add(String((t as any).assessmentTestId).trim().toLowerCase());

      const canonicalId = buildAssessmentTestId(t.classGrade, t.subject, t.chapterNo, t.topicName, normalizedType);
      if (canonicalId) targetIds.add(canonicalId.trim().toLowerCase());

      // Match student attempts for this test strictly by unique test ID
      // Every test is completely independent. Never reuse, copy, inherit, or calculate
      // a student's marks from another test, chapter test, or subject test.
      const myAttempts = studentAttempts.filter((a) => {
        if (!a) return false;
        const aTestId = (a.testId || (a as any).topicTestId || (a as any).assessmentTestId || "").trim().toLowerCase();
        if (aTestId) {
          return targetIds.has(aTestId);
        }
        // If an attempt has no testId, it can never be safely associated with this test.
        return false;
      });

      const latestAttempt = myAttempts.length > 0 ? myAttempts[myAttempts.length - 1] : null;
      const bestAttempt = myAttempts.length > 0
        ? [...myAttempts].sort((a, b) => (b.percentage || 0) - (a.percentage || 0))[0]
        : null;

      // Check for active in-progress draft in session manager
      const draft = loadTestDraft(null, student.id, t.id || "", (latestAttempt?.attemptNumber || 0) + 1);
      const hasActiveDraft = draft !== null && !draft.isSubmitted;

      return {
        ...t,
        computedType: normalizedType,
        myAttempts,
        latestAttempt,
        bestAttempt,
        hasActiveDraft,
        isCompleted: myAttempts.length > 0 && latestAttempt !== null
      };
    });

    return list.filter((t) => {
      // 1. Must be published & active & not deleted & have questions
      if (t.isPublished === false || (t as any).published === false) return false;
      if ((t as any).isDeleted || (t as any).deleted) return false;
      if ((t as any).status === "inactive" || (t as any).status === "draft") return false;
      if ((t as any).isActive === false || (t as any).active === false) return false;
      if (
        (t as any).visibility === "hidden" ||
        (t as any).visibility === "private" ||
        (t as any).visibility === "draft"
      ) {
        return false;
      }

      const qCount = Array.isArray(t.questions) && t.questions.length > 0
        ? t.questions.length
        : (Number(t.questionCount) || Number((t as any).totalQuestions) || 0);
      if (qCount <= 0) return false;

      // 2. Permission check (handles UPSC & School, enrolledSubjects)
      if (!isStudentPermittedToAccessTest(student, t)) {
        return false;
      }

      // 2b. Strict Enrolled Subjects Rule:
      // A student must NEVER see a test belonging to a subject in which they are not enrolled.
      const rawEnrolled = (student.enrolledSubjects || []).filter(
        (s) => typeof s === "string" && s.trim().length > 0
      );
      if (rawEnrolled.length > 0) {
        const testSubj = (t.subject || (t as any).subjectName || "").trim();
        const isEnrolledInTestSubj = rawEnrolled.some((enrolled) =>
          isExactOrCanonicalSubjectMatch(enrolled, testSubj) ||
          isSubjectMatching(enrolled, testSubj)
        );
        if (!isEnrolledInTestSubj) {
          return false;
        }
      }

      // 3. Subject filter if specific subject selected
      if (selectedSubject !== "All") {
        const testSubj = (t.subject || (t as any).subjectName || "").trim();
        if (
          !isExactOrCanonicalSubjectMatch(selectedSubject, testSubj) &&
          !isSubjectMatching(selectedSubject, testSubj)
        ) {
          return false;
        }
      }

      // 4. Category filter - Topic tests are exclusively accessed via My Study Space
      if (t.computedType === "TOPIC") {
        return false;
      }
      if (selectedCategory !== "ALL" && t.computedType !== selectedCategory) {
        return false;
      }

      // 5. Status filter
      if (selectedStatus === "COMPLETED" && !t.isCompleted) return false;
      if (selectedStatus === "PENDING" && t.isCompleted) return false;

      // 6. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const titleMatch = (t.title || "").toLowerCase().includes(q);
        const subjMatch = (t.subject || "").toLowerCase().includes(q);
        const chMatch = (t.chapterName || "").toLowerCase().includes(q);
        const topMatch = (t.topicName || "").toLowerCase().includes(q);
        if (!titleMatch && !subjMatch && !chMatch && !topMatch) return false;
      }

      return true;
    });
  }, [testsBank, attempts, studentIdentifier, studentClass, allowedClasses, studentSubjects, selectedSubject, selectedCategory, selectedStatus, searchQuery, student]);

  // Overall student test statistics strictly derived from tests this student has completed
  const stats = useMemo(() => {
    const totalAvailable = filteredTests.length;
    const completedTests = filteredTests.filter((t) => t.isCompleted && t.latestAttempt);
    const completedCount = completedTests.length;
    const validScores = completedTests.map((t) => t.latestAttempt?.percentage).filter((p): p is number => typeof p === "number");

    const avgScore = validScores.length > 0
      ? Math.round(validScores.reduce((acc, curr) => acc + curr, 0) / validScores.length)
      : null;
    const bestScore = validScores.length > 0
      ? Math.max(...validScores)
      : null;

    return { totalAvailable, completedCount, avgScore, bestScore };
  }, [filteredTests]);

  // Handle starting/taking a test
  const handleStartTest = (test: any) => {
    setActiveTestTarget({
      testId: test.id || test.testId,
      classGrade: test.classGrade,
      subject: test.subject,
      chapterNo: test.chapterNo,
      chapterName: test.chapterName,
      topicName: test.computedType === "SUBJECT" ? "Subject Test" : test.computedType === "CHAPTER" ? "Full Chapter Test" : test.topicName,
      testType: test.computedType === "SUBJECT" ? "SUBJECT" : test.computedType === "CHAPTER" ? "CHAPTER" : test.computedType === "PYQ" ? "PYQ" : "TOPIC",
      title: test.title || test.topicName || test.chapterName
    });
  };

  // Group chapter tests by subject and chapter number
  const chapterGroups = useMemo(() => {
    const groupsMap = new Map<string, {
      key: string;
      subject: string;
      chapterNo: number;
      chapterName: string;
      tests: any[];
      completedCount: number;
      bestScore: number;
      hasDraft: boolean;
    }>();

    const chapterTests = filteredTests.filter((t) => t.computedType === "CHAPTER");

    chapterTests.forEach((t) => {
      const subj = t.subject || "General";
      const chNo = Number(t.chapterNo) || 1;
      const key = `${subj.toLowerCase()}__${chNo}`;
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          key,
          subject: subj,
          chapterNo: chNo,
          chapterName: t.chapterName || `Chapter ${chNo}`,
          tests: [],
          completedCount: 0,
          bestScore: 0,
          hasDraft: false,
        });
      }
      const grp = groupsMap.get(key)!;
      grp.tests.push(t);
      if (t.isCompleted) {
        grp.completedCount++;
        if (t.latestAttempt?.percentage && t.latestAttempt.percentage > grp.bestScore) {
          grp.bestScore = t.latestAttempt.percentage;
        }
      }
      if (t.hasActiveDraft) grp.hasDraft = true;
    });

    const list = Array.from(groupsMap.values());
    list.sort((a, b) => {
      if (a.subject.localeCompare(b.subject) !== 0) {
        return a.subject.localeCompare(b.subject);
      }
      return a.chapterNo - b.chapterNo;
    });

    list.forEach((grp) => {
      grp.tests.sort((a, b) => {
        const numA = typeof a.testNumber === "number" && a.testNumber > 0
          ? a.testNumber
          : (a.title?.match(/\bTest\s*(\d+)\b/i)?.[1] ? parseInt(a.title.match(/\bTest\s*(\d+)\b/i)![1], 10) : 1);
        const numB = typeof b.testNumber === "number" && b.testNumber > 0
          ? b.testNumber
          : (b.title?.match(/\bTest\s*(\d+)\b/i)?.[1] ? parseInt(b.title.match(/\bTest\s*(\d+)\b/i)![1], 10) : 1);
        if (numA !== numB) return numA - numB;
        return (a.title || "").localeCompare(b.title || "");
      });
    });

    return list;
  }, [filteredTests]);

  // Group subject tests by subject
  const subjectGroups = useMemo(() => {
    const groupsMap = new Map<string, {
      key: string;
      subject: string;
      tests: any[];
      completedCount: number;
      bestScore: number;
      hasDraft: boolean;
    }>();

    const subjTests = filteredTests.filter((t) => t.computedType === "SUBJECT");

    subjTests.forEach((t) => {
      const subj = t.subject || "General";
      const key = subj.toLowerCase();
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          key,
          subject: subj,
          tests: [],
          completedCount: 0,
          bestScore: 0,
          hasDraft: false,
        });
      }
      const grp = groupsMap.get(key)!;
      grp.tests.push(t);
      if (t.isCompleted) {
        grp.completedCount++;
        if (t.latestAttempt?.percentage && t.latestAttempt.percentage > grp.bestScore) {
          grp.bestScore = t.latestAttempt.percentage;
        }
      }
      if (t.hasActiveDraft) grp.hasDraft = true;
    });

    const list = Array.from(groupsMap.values());
    list.sort((a, b) => a.subject.localeCompare(b.subject));

    list.forEach((grp) => {
      grp.tests.sort((a, b) => {
        const numA = typeof a.testNumber === "number" && a.testNumber > 0
          ? a.testNumber
          : (a.title?.match(/\bTest\s*(\d+)\b/i)?.[1] ? parseInt(a.title.match(/\bTest\s*(\d+)\b/i)![1], 10) : 1);
        const numB = typeof b.testNumber === "number" && b.testNumber > 0
          ? b.testNumber
          : (b.title?.match(/\bTest\s*(\d+)\b/i)?.[1] ? parseInt(b.title.match(/\bTest\s*(\d+)\b/i)![1], 10) : 1);
        if (numA !== numB) return numA - numB;
        return (a.title || "").localeCompare(b.title || "");
      });
    });

    return list;
  }, [filteredTests]);

  // Tests for currently opened Chapter
  const currentChapterTests = useMemo(() => {
    if (!selectedChapterGroup) return [];
    return filteredTests
      .filter(
        (t) =>
          t.computedType === "CHAPTER" &&
          (isExactOrCanonicalSubjectMatch(selectedChapterGroup.subject, t.subject || "") ||
            isSubjectMatching(selectedChapterGroup.subject, t.subject || "")) &&
          Number(t.chapterNo) === Number(selectedChapterGroup.chapterNo)
      )
      .sort((a, b) => {
        const numA = typeof a.testNumber === "number" && a.testNumber > 0
          ? a.testNumber
          : (a.title?.match(/\bTest\s*(\d+)\b/i)?.[1] ? parseInt(a.title.match(/\bTest\s*(\d+)\b/i)![1], 10) : 1);
        const numB = typeof b.testNumber === "number" && b.testNumber > 0
          ? b.testNumber
          : (b.title?.match(/\bTest\s*(\d+)\b/i)?.[1] ? parseInt(b.title.match(/\bTest\s*(\d+)\b/i)![1], 10) : 1);
        if (numA !== numB) return numA - numB;
        return (a.title || "").localeCompare(b.title || "");
      });
  }, [selectedChapterGroup, filteredTests]);

  // Tests for currently opened Subject
  const currentSubjectTests = useMemo(() => {
    if (!selectedSubjectGroup) return [];
    return filteredTests
      .filter(
        (t) =>
          t.computedType === "SUBJECT" &&
          (isExactOrCanonicalSubjectMatch(selectedSubjectGroup.subject, t.subject || "") ||
            isSubjectMatching(selectedSubjectGroup.subject, t.subject || ""))
      )
      .sort((a, b) => {
        const numA = typeof a.testNumber === "number" && a.testNumber > 0
          ? a.testNumber
          : (a.title?.match(/\bTest\s*(\d+)\b/i)?.[1] ? parseInt(a.title.match(/\bTest\s*(\d+)\b/i)![1], 10) : 1);
        const numB = typeof b.testNumber === "number" && b.testNumber > 0
          ? b.testNumber
          : (b.title?.match(/\bTest\s*(\d+)\b/i)?.[1] ? parseInt(b.title.match(/\bTest\s*(\d+)\b/i)![1], 10) : 1);
        if (numA !== numB) return numA - numB;
        return (a.title || "").localeCompare(b.title || "");
      });
  }, [selectedSubjectGroup, filteredTests]);

  // Render a clean, compact test card (reduced height and visual size)
  const renderCompactTestCard = (test: any) => {
    const questionCount = Array.isArray(test.questions)
      ? test.questions.length
      : test.questionCount || 0;
    const totalMarks = test.totalMarks || test.declaredTotalMarks || questionCount;
    const duration = test.durationMinutes || (test as any).duration_minutes || 0;

    const testNum = typeof test.testNumber === "number" && test.testNumber > 0
      ? test.testNumber
      : (test.title?.match(/\bTest\s*(\d+)\b/i)?.[1] ? parseInt(test.title.match(/\bTest\s*(\d+)\b/i)![1], 10) : undefined);

    const displayTitle = test.title || 
      (test.computedType === "SUBJECT"
        ? (testNum ? `${test.subject} Test ${testNum}` : `${test.subject} Subject Test`)
        : test.computedType === "CHAPTER"
        ? (testNum ? `${test.chapterName || `Chapter ${test.chapterNo}`} Test ${testNum}` : `Chapter ${test.chapterNo}: ${test.chapterName || "Test"}`)
        : test.topicName || "Academic Practice Test");

    return (
      <div
        key={test.id}
        className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl p-3 sm:p-3.5 shadow-2xs hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700 transition-all flex flex-col justify-between gap-2"
        id={`student-test-card-${test.id}`}
      >
        <div className="space-y-1.5">
          {/* Top meta tags */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-blue-900/40 shrink-0">
                {test.subject || "General"}
              </span>
              {test.computedType !== "SUBJECT" && (test.chapterNo || test.chapterName) && (
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate max-w-[180px]">
                  {test.chapterNo ? `Ch ${test.chapterNo}: ` : ""}{test.chapterName}
                </span>
              )}
            </div>
            {testNum && (
              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/60 shrink-0">
                Test {testNum}
              </span>
            )}
          </div>

          {/* Test title */}
          <h3
            className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white leading-tight line-clamp-1"
            title={displayTitle}
          >
            {displayTitle}
          </h3>

          {/* Compact Specs Bar */}
          <div className="flex items-center gap-2.5 py-1 px-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-800/80 text-[10.5px] font-semibold text-slate-600 dark:text-slate-300">
            <span className="flex items-center gap-1" title="Questions">
              <ListChecks className="w-3 h-3 text-blue-500 shrink-0" />
              <span>{questionCount} Qs</span>
            </span>
            <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
            <span className="flex items-center gap-1" title="Marks">
              <Award className="w-3 h-3 text-amber-500 shrink-0" />
              <span>{totalMarks} Marks</span>
            </span>
            <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
            <span className="flex items-center gap-1" title="Duration">
              <Clock className="w-3 h-3 text-emerald-500 shrink-0" />
              <span>{duration > 0 ? `${duration}m` : "Untimed"}</span>
            </span>
          </div>

          {/* Performance status */}
          <div className="pt-0">
            {test.latestAttempt ? (
              <div className="flex items-center justify-between text-xs">
                <span className="text-[10.5px] text-slate-500 dark:text-slate-400">Score:</span>
                <span className={`text-[11px] font-black px-1.5 py-0.5 rounded-md inline-flex items-center gap-1 ${
                  test.latestAttempt.percentage >= 75
                    ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200"
                    : test.latestAttempt.percentage >= 40
                    ? "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200"
                    : "bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-200"
                }`}>
                  <Award className="w-3 h-3" />
                  <span>{test.latestAttempt.score}/{test.latestAttempt.totalQuestions} ({test.latestAttempt.percentage}%)</span>
                </span>
              </div>
            ) : test.hasActiveDraft ? (
              <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                <span>Draft in progress</span>
              </div>
            ) : (
              <div className="text-[11px] text-slate-400 font-medium">
                Not Attempted
              </div>
            )}
          </div>
        </div>

        {/* Card actions */}
        <div className="flex items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-800/80">
          {test.latestAttempt ? (
            <>
              <button
                type="button"
                onClick={() => handleStartTest(test)}
                className="flex-1 py-1.5 px-2.5 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-700 dark:text-amber-300 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer border border-amber-200 dark:border-amber-800/60"
                id={`retake-test-btn-${test.id}`}
              >
                <RotateCcw className="w-3 h-3" />
                <span>Re-take</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveScorecard({
                    testTitle: displayTitle,
                    attempt: test.latestAttempt,
                    questions: test.questions
                  });
                }}
                className="py-1.5 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer"
                title="View scorecard analysis"
              >
                <BarChart3 className="w-3 h-3" />
                <span>Review</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => handleStartTest(test)}
              className="w-full py-1.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-2xs shadow-blue-500/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              id={`start-test-btn-${test.id}`}
            >
              <Play className="w-3 h-3 fill-current" />
              <span>{test.hasActiveDraft ? "Resume Test" : "Start Test"}</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100" id="student-tests-view">
      {/* Top Banner: Metrics & Overall Performance */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-4 sm:px-6 shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/80 px-2 py-0.5 rounded-md border border-amber-200/80 dark:border-amber-800/60">
                {student.classGrade || "Class 10"}
              </span>
              <h1 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                <span>Academic Tests & PYQs</span>
                <Trophy className="w-5 h-5 text-amber-500" />
              </h1>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Take timed chapter tests, subject mocks, and practice assessments with instant scoring & analysis
            </p>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-4 gap-2 sm:gap-3 shrink-0">
            <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-800 rounded-xl px-3 py-2 text-center">
              <p className="text-[10px] uppercase font-bold text-slate-400">Available</p>
              <p className="text-sm sm:text-base font-black text-slate-900 dark:text-white">{stats.totalAvailable}</p>
            </div>
            <div className="bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-900/40 rounded-xl px-3 py-2 text-center">
              <p className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400">Completed</p>
              <p className="text-sm sm:text-base font-black text-emerald-700 dark:text-emerald-300">{stats.completedCount}</p>
            </div>
            <div className="bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-900/40 rounded-xl px-3 py-2 text-center">
              <p className="text-[10px] uppercase font-bold text-blue-600 dark:text-blue-400">Avg Score</p>
              <p className="text-sm sm:text-base font-black text-blue-700 dark:text-blue-300">
                {stats.avgScore !== null ? `${stats.avgScore}%` : "—"}
              </p>
            </div>
            <div className="bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40 rounded-xl px-3 py-2 text-center">
              <p className="text-[10px] uppercase font-bold text-amber-600 dark:text-amber-400">Best Score</p>
              <p className="text-sm sm:text-base font-black text-amber-700 dark:text-amber-300">
                {stats.bestScore !== null ? `${stats.bestScore}%` : "—"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar: Category tabs and filters */}
      <div className="bg-slate-50/90 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 px-4 py-3 sm:px-6 shrink-0 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Category Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
            {[
              { id: "ALL", label: "All Tests" },
              { id: "CHAPTER", label: "Chapter Tests" },
              { id: "SUBJECT", label: "Subject Tests" },
              { id: "PYQ", label: "PYQs" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setSelectedCategory(tab.id as any);
                  setSelectedChapterGroup(null);
                  setSelectedSubjectGroup(null);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                  selectedCategory === tab.id
                    ? "bg-blue-600 text-white shadow-2xs shadow-blue-500/20"
                    : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700"
                }`}
                id={`student-filter-cat-${tab.id.toLowerCase()}`}
              >
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Subject & Search */}
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            {/* Subject Selector */}
            <select
              value={selectedSubject}
              onChange={(e) => {
                const newSubj = e.target.value;
                setSelectedSubject(newSubj);
                if (newSubj !== "All") {
                  if (selectedChapterGroup && !isExactOrCanonicalSubjectMatch(newSubj, selectedChapterGroup.subject) && !isSubjectMatching(newSubj, selectedChapterGroup.subject)) {
                    setSelectedChapterGroup(null);
                  }
                  if (selectedSubjectGroup && !isExactOrCanonicalSubjectMatch(newSubj, selectedSubjectGroup.subject) && !isSubjectMatching(newSubj, selectedSubjectGroup.subject)) {
                    setSelectedSubjectGroup(null);
                  }
                }
              }}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-blue-500 cursor-pointer"
              id="student-filter-subject-select"
            >
              <option value="All">All Subjects</option>
              {studentSubjects.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            {/* Status Selector */}
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as any)}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-blue-500 cursor-pointer"
              id="student-filter-status-select"
            >
              <option value="ALL">All Status</option>
              <option value="PENDING">Pending / New</option>
              <option value="COMPLETED">Completed</option>
            </select>

            {/* Search Input */}
            <div className="relative flex-1 sm:w-52">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search tests..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                id="student-tests-search-input"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-6 sm:px-6 scrollbar-thin">
        <div className="max-w-7xl mx-auto">
          {filteredTests.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center flex flex-col items-center max-w-md mx-auto shadow-sm">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-4 border border-amber-500/20">
                <FileCheck2 className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                No Tests Found
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm">
                There are no tests matching your current filter selections. Check back later or clear filters to see all available tests.
              </p>
            </div>
          ) : selectedChapterGroup ? (
            /* Mode 1: Drilled into a Chapter Group */
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedChapterGroup(null)}
                    className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-all flex items-center gap-1.5 text-xs font-bold shadow-2xs cursor-pointer"
                    id="student-tests-back-btn"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>{selectedCategory === "ALL" ? "Back to All Tests" : "Back to Chapters"}</span>
                  </button>
                  <div className="h-5 w-px bg-slate-200 dark:bg-slate-800" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/60">
                        {selectedChapterGroup.subject}
                      </span>
                      <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white">
                        Chapter {selectedChapterGroup.chapterNo}: {selectedChapterGroup.chapterName}
                      </h2>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {currentChapterTests.length} {currentChapterTests.length === 1 ? "test" : "tests"} available
                    </p>
                  </div>
                </div>
              </div>

              {currentChapterTests.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center flex flex-col items-center max-w-md mx-auto shadow-sm">
                  <FileCheck2 className="w-8 h-8 text-amber-500 mb-3" />
                  <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">No Tests Found</h3>
                  <p className="text-xs text-slate-500">No tests available for this chapter under current filters.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="student-chapter-tests-grid">
                  {currentChapterTests.map(renderCompactTestCard)}
                </div>
              )}
            </div>
          ) : selectedSubjectGroup ? (
            /* Mode 2: Drilled into a Subject Group */
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedSubjectGroup(null)}
                    className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-all flex items-center gap-1.5 text-xs font-bold shadow-2xs cursor-pointer"
                    id="student-tests-back-btn"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>{selectedCategory === "ALL" ? "Back to All Tests" : "Back to Subjects"}</span>
                  </button>
                  <div className="h-5 w-px bg-slate-200 dark:bg-slate-800" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/60">
                        Subject Tests
                      </span>
                      <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-white">
                        {selectedSubjectGroup.subject}
                      </h2>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {currentSubjectTests.length} {currentSubjectTests.length === 1 ? "test" : "tests"} available
                    </p>
                  </div>
                </div>
              </div>

              {currentSubjectTests.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center flex flex-col items-center max-w-md mx-auto shadow-sm">
                  <FileCheck2 className="w-8 h-8 text-indigo-500 mb-3" />
                  <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">No Tests Found</h3>
                  <p className="text-xs text-slate-500">No subject tests available under current filters.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="student-subject-tests-grid">
                  {currentSubjectTests.map(renderCompactTestCard)}
                </div>
              )}
            </div>
          ) : searchQuery.trim().length > 0 ? (
            /* Mode 3: Active Search Query - Show matching compact test cards directly */
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
                <p className="text-xs font-bold text-slate-600 dark:text-slate-400">
                  Search results for "{searchQuery}" ({filteredTests.length} tests found)
                </p>
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold cursor-pointer"
                >
                  Clear Search
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="student-search-tests-grid">
                {filteredTests.map(renderCompactTestCard)}
              </div>
            </div>
          ) : selectedCategory === "CHAPTER" ? (
            /* Mode 4: Chapter Tests Tab - Grouped by Chapter */
            chapterGroups.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center flex flex-col items-center max-w-md mx-auto shadow-sm">
                <div className="w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-4 border border-amber-500/20">
                  <FileCheck2 className="w-8 h-8" />
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                  No Chapter Tests Found
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm">
                  There are no chapter tests matching your current filter selections.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="student-chapter-groups-grid">
                {chapterGroups.map((grp) => (
                  <div
                    key={grp.key}
                    onClick={() => setSelectedChapterGroup({ subject: grp.subject, chapterNo: grp.chapterNo, chapterName: grp.chapterName })}
                    className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl p-3 sm:p-3.5 shadow-2xs hover:shadow-md hover:border-amber-400 dark:hover:border-amber-500/60 transition-all cursor-pointer group flex flex-col justify-between gap-2"
                    id={`chapter-group-card-${grp.key}`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/80 px-2 py-0.5 rounded-md border border-amber-200/80 dark:border-amber-800/60">
                          {grp.subject}
                        </span>
                        <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700">
                          {grp.tests.length} {grp.tests.length === 1 ? "Test" : "Tests"}
                        </span>
                      </div>

                      <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-1 mt-0.5">
                        {grp.chapterNo ? `Chapter ${grp.chapterNo}: ` : ""}{grp.chapterName}
                      </h3>
                    </div>

                    <div className="flex items-center justify-between pt-1.5 border-t border-slate-100 dark:border-slate-800/80 text-xs">
                      <div className="text-xs">
                        {grp.completedCount === grp.tests.length && grp.tests.length > 0 ? (
                          <span className="inline-flex items-center gap-1 font-bold text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>All Completed ({grp.bestScore}%)</span>
                          </span>
                        ) : grp.completedCount > 0 ? (
                          <span className="font-semibold text-amber-600 dark:text-amber-400">
                            {grp.completedCount} of {grp.tests.length} Completed
                          </span>
                        ) : grp.hasDraft ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-amber-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                            <span>Draft in progress</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 font-medium">
                            Not started
                          </span>
                        )}
                      </div>

                      <div className="text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                        <span>View Tests</span>
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : selectedCategory === "SUBJECT" ? (
            /* Mode 5: Subject Tests Tab - Grouped by Subject */
            subjectGroups.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center flex flex-col items-center max-w-md mx-auto shadow-sm">
                <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-4 border border-indigo-500/20">
                  <FileCheck2 className="w-8 h-8" />
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                  No Subject Tests Found
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm">
                  There are no subject tests matching your current filter selections.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="student-subject-groups-grid">
                {subjectGroups.map((grp) => (
                  <div
                    key={grp.key}
                    onClick={() => setSelectedSubjectGroup({ subject: grp.subject })}
                    className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-2xs hover:shadow-md hover:border-indigo-400 dark:hover:border-indigo-500/60 transition-all cursor-pointer group flex flex-col justify-between gap-3"
                    id={`subject-group-card-${grp.key}`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-[11px] font-extrabold uppercase tracking-wider text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/80 px-2 py-0.5 rounded-md border border-indigo-200/80 dark:border-indigo-800/60">
                          Subject Test
                        </span>
                        <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700">
                          {grp.tests.length} {grp.tests.length === 1 ? "Test" : "Tests"}
                        </span>
                      </div>

                      <h3 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors mt-1">
                        {grp.subject}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Full curriculum subject tests and comprehensive papers
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/80">
                      <div className="text-xs">
                        {grp.completedCount === grp.tests.length && grp.tests.length > 0 ? (
                          <span className="inline-flex items-center gap-1 font-bold text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>All Completed ({grp.bestScore}%)</span>
                          </span>
                        ) : grp.completedCount > 0 ? (
                          <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                            {grp.completedCount} of {grp.tests.length} Completed
                          </span>
                        ) : grp.hasDraft ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-amber-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                            <span>Draft in progress</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 font-medium">
                            Not started
                          </span>
                        )}
                      </div>

                      <div className="text-xs font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                        <span>View Tests</span>
                        <ChevronRight className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : selectedCategory === "ALL" ? (
            /* Mode 6: All Tests Tab - Categorized Sections */
            <div className="space-y-8" id="student-all-tests-view">
              {/* Chapter Tests Section */}
              {chapterGroups.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                        <span>Chapter Tests</span>
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Organized by chapter across your curriculum
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCategory("CHAPTER");
                        setSelectedChapterGroup(null);
                        setSelectedSubjectGroup(null);
                      }}
                      className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 cursor-pointer"
                    >
                      <span>View all chapters</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {chapterGroups.slice(0, 6).map((grp) => (
                      <div
                        key={grp.key}
                        onClick={() => setSelectedChapterGroup({ subject: grp.subject, chapterNo: grp.chapterNo, chapterName: grp.chapterName })}
                        className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl p-3 sm:p-3.5 shadow-2xs hover:shadow-md hover:border-amber-400 dark:hover:border-amber-500/60 transition-all cursor-pointer group flex flex-col justify-between gap-2"
                        id={`chapter-group-card-${grp.key}`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/80 px-2 py-0.5 rounded-md border border-amber-200/80 dark:border-amber-800/60">
                              {grp.subject}
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                              {grp.tests.length} {grp.tests.length === 1 ? "Test" : "Tests"}
                            </span>
                          </div>
                          <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-1 mt-0.5">
                            {grp.chapterNo ? `Chapter ${grp.chapterNo}: ` : ""}{grp.chapterName}
                          </h3>
                        </div>
                        <div className="flex items-center justify-between pt-1.5 border-t border-slate-100 dark:border-slate-800/80 text-xs">
                          <span className="text-slate-500">
                            {grp.completedCount > 0 ? `${grp.completedCount}/${grp.tests.length} Completed` : "Not started"}
                          </span>
                          <span className="font-bold text-blue-600 dark:text-blue-400 flex items-center gap-0.5">
                            <span>View</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Subject Tests Section */}
              {subjectGroups.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-indigo-500" />
                        <span>Subject Tests</span>
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Comprehensive full curriculum assessments
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCategory("SUBJECT");
                        setSelectedChapterGroup(null);
                        setSelectedSubjectGroup(null);
                      }}
                      className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 cursor-pointer"
                    >
                      <span>View all subjects</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {subjectGroups.slice(0, 6).map((grp) => (
                      <div
                        key={grp.key}
                        onClick={() => setSelectedSubjectGroup({ subject: grp.subject })}
                        className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl p-4 shadow-2xs hover:shadow-md hover:border-indigo-400 dark:hover:border-indigo-500/60 transition-all cursor-pointer group flex flex-col justify-between gap-3"
                        id={`subject-group-card-${grp.key}`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/80 px-2 py-0.5 rounded-md border border-indigo-200/80 dark:border-indigo-800/60">
                              Subject Test
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                              {grp.tests.length} {grp.tests.length === 1 ? "Test" : "Tests"}
                            </span>
                          </div>
                          <h3 className="text-base font-black text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors mt-1">
                            {grp.subject}
                          </h3>
                        </div>
                        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/80 text-xs">
                          <span className="text-slate-500">
                            {grp.completedCount > 0 ? `${grp.completedCount}/${grp.tests.length} Completed` : "Not started"}
                          </span>
                          <span className="font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-0.5">
                            <span>View</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* PYQs Section */}
              {filteredTests.filter((t) => t.computedType === "PYQ").length > 0 && (
                <div className="space-y-3">
                  <div>
                    <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span>PYQs</span>
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Previous year question papers and past assessments
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredTests
                      .filter((t) => t.computedType === "PYQ")
                      .map(renderCompactTestCard)}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Mode 7: PYQ Tab - Compact cards grid */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="student-tests-grid">
              {filteredTests.map(renderCompactTestCard)}
            </div>
          )}
        </div>
      </div>

      {/* Modal: Scorecard Analysis Review */}
      {activeScorecard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full max-h-[85vh] flex flex-col shadow-2xl">
            <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  Test Scorecard & Analysis
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {activeScorecard.testTitle} • Attempt #{activeScorecard.attempt.attemptNumber}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveScorecard(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 text-xs scrollbar-thin">
              {/* Summary Stats Card */}
              <div className="grid grid-cols-3 gap-3 p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-800 text-center">
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-400">Score</p>
                  <p className="text-base font-black text-slate-900 dark:text-white">
                    {activeScorecard.attempt.score} / {activeScorecard.attempt.totalQuestions}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-400">Accuracy</p>
                  <p className="text-base font-black text-blue-600 dark:text-blue-400">
                    {activeScorecard.attempt.percentage}%
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-400">Time Taken</p>
                  <p className="text-base font-black text-slate-900 dark:text-white">
                    {activeScorecard.attempt.timeTakenSeconds 
                      ? `${Math.floor(activeScorecard.attempt.timeTakenSeconds / 60)}m ${activeScorecard.attempt.timeTakenSeconds % 60}s`
                      : "Completed"}
                  </p>
                </div>
              </div>

              {/* Questions breakdown */}
              {activeScorecard.questions && activeScorecard.questions.length > 0 && (
                <div className="space-y-3">
                  <h4 className="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider">
                    Question-by-Question Solutions
                  </h4>
                  {activeScorecard.questions.map((q: any, qIdx: number) => {
                    const studentAns = activeScorecard.attempt.userAnswers?.[q.id] || "Not answered";
                    const isCorrect = studentAns === q.correctAnswer;
                    const formattedCorrectAns = formatCorrectAnswerForDisplay(q.correctAnswer);
                    const isMultiLineAns = formattedCorrectAns.includes("\n");

                    return (
                      <div key={q.id || qIdx} className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <p className="font-bold text-slate-900 dark:text-slate-100 text-xs sm:text-sm">
                            Q{qIdx + 1}. {q.question}
                          </p>
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-md shrink-0 ${
                            isCorrect
                              ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"
                              : "bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300"
                          }`}>
                            {isCorrect ? "Correct" : "Incorrect"}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                          <p className="break-words [overflow-wrap:anywhere]">
                            Your Answer: <span className="font-bold text-slate-800 dark:text-slate-200">{studentAns}</span>
                          </p>
                          {isMultiLineAns ? (
                            <div className="pt-0.5">
                              <span className="text-slate-600 dark:text-slate-400">Correct Answer:</span>
                              <div className="mt-1 font-bold text-emerald-600 dark:text-emerald-400 whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed">
                                {formattedCorrectAns}
                              </div>
                            </div>
                          ) : (
                            <p className="break-words [overflow-wrap:anywhere] leading-relaxed">
                              Correct Answer:{" "}
                              <span className="font-bold text-emerald-600 dark:text-emerald-400 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                {formattedCorrectAns}
                              </span>
                            </p>
                          )}
                        </div>
                        {q.explanation && (
                          <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100/80 dark:bg-slate-800/80 p-2.5 rounded-lg mt-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed">
                            <span className="font-bold text-slate-700 dark:text-slate-300">Explanation: </span>
                            {formatCorrectAnswerForDisplay(q.explanation)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setActiveScorecard(null)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-xl font-bold cursor-pointer"
              >
                Close Scorecard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Test Taking Modal */}
      {activeTestTarget && (
        <StudentPracticeTestModal
          isOpen={true}
          onClose={() => {
            setActiveTestTarget(null);
            loadData();
          }}
          testId={activeTestTarget.testId}
          studentId={student.id}
          studentName={student.name}
          classGrade={activeTestTarget.classGrade}
          subject={activeTestTarget.subject}
          chapterNo={activeTestTarget.chapterNo}
          chapterName={activeTestTarget.chapterName}
          topicName={activeTestTarget.topicName}
          testType={activeTestTarget.testType}
          title={activeTestTarget.title}
          serviceStatus={student.serviceStatus}
        />
      )}
    </div>
  );
};

export default StudentTestsView;
