import React, { useState, useEffect, useMemo, useRef } from "react";
import { 
  Trophy, 
  Plus, 
  Search, 
  Filter, 
  BookOpen, 
  GraduationCap, 
  Clock, 
  ListChecks, 
  FileText, 
  Trash2, 
  Edit3, 
  Eye, 
  Users, 
  Sparkles, 
  RefreshCw, 
  CheckCircle2, 
  Award,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Layers,
  Calendar,
  AlertTriangle,
  X,
  FileCheck2,
  ExternalLink
} from "lucide-react";
import { TopicPracticeTest, TestAttemptRecord, AssessmentTestType, ClassNote, Student } from "../../types";
import { 
  fetchAllPracticeTests, 
  subscribeToPracticeTests,
  deletePracticeTest,
  deleteTopicPracticeTest, 
  deleteChapterPracticeTest, 
  deleteSubjectPracticeTest,
  buildTopicTestId,
  buildChapterTestId,
  buildSubjectTestId,
  buildPyqTestId,
  buildAssessmentTestId,
  normalizeTestCategory,
  isValidPracticeTest,
  isClassCompatible,
  isExactOrCanonicalSubjectMatch,
  isSubjectMatching,
} from "../../lib/practiceTestService";
import { getAllTestAttempts, subscribeToTestAttempts } from "../../utils/assessmentParser";
import { toStableClassId } from "../../lib/curriculumAccessService";
import AdminPracticeTestModal from "../AdminPracticeTestModal";
import ConfirmDeleteModal from "../ConfirmDeleteModal";
import Toast from "../Toast";

interface AdminTestsViewProps {
  notes?: ClassNote[];
  students?: Student[];
  onRefresh?: () => void;
}

const SCHOOL_CLASSES = [
  "Class 6", "Class 7", "Class 8", "Class 9", "Class 10", 
  "Class 11", "Class 12", "Foundation", "Prep"
];

const UPSC_PAPERS = [
  "UPSC - GS Paper 1", "UPSC - GS Paper 2", "UPSC - GS Paper 3", "UPSC - GS Paper 4"
];

export const AdminTestsView: React.FC<AdminTestsViewProps> = ({
  notes = [],
  students = [],
  onRefresh
}) => {
  // --- States ---
  const [testsBank, setTestsBank] = useState<Record<string, TopicPracticeTest>>({});
  const [attempts, setAttempts] = useState<TestAttemptRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedClass, setSelectedClass] = useState<string>("All");
  const [selectedSubject, setSelectedSubject] = useState<string>("All");
  const [selectedType, setSelectedType] = useState<"ALL" | "SUBJECT" | "CHAPTER" | "TOPIC" | "PYQ">("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Modal states
  const [activeEditorTest, setActiveEditorTest] = useState<{
    testId?: string;
    classGrade: string;
    subject: string;
    chapterNo?: number;
    chapterName?: string;
    topicName?: string;
    testType: AssessmentTestType;
    isNewTest?: boolean;
  } | null>(null);

  const [testToDelete, setTestToDelete] = useState<TopicPracticeTest | null>(null);
  const [testToPreview, setTestToPreview] = useState<TopicPracticeTest | null>(null);
  const [testForSubmissions, setTestForSubmissions] = useState<TopicPracticeTest | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // New Test Form States
  const [newTestClass, setNewTestClass] = useState<string>("Class 10");
  const [newTestSubject, setNewTestSubject] = useState<string>("History");
  const [newTestType, setNewTestType] = useState<AssessmentTestType>("CHAPTER");
  const [newTestChapterNo, setNewTestChapterNo] = useState<number>(1);
  const [newTestChapterName, setNewTestChapterName] = useState<string>("");
  const [newTestTopicName, setNewTestTopicName] = useState<string>("");

  // Load tests and attempts
  const loadData = async () => {
    setIsLoading(true);
    try {
      const bank = await fetchAllPracticeTests({ forceFresh: true });
      setTestsBank(bank || {});
      const allAtt = getAllTestAttempts();
      setAttempts(allAtt || []);
    } catch (err) {
      console.warn("[AdminTestsView] Failed to load tests data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    const unsubAttempts = subscribeToTestAttempts((updated) => {
      if (updated) setAttempts(updated);
    });

    const unsubBank = subscribeToPracticeTests((updatedBank) => {
      if (updatedBank) setTestsBank({ ...updatedBank });
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
      unsubAttempts();
      unsubBank();
      window.removeEventListener("practice-tests-updated", handleSync);
      window.removeEventListener("managed-tests-updated", handleSync);
      window.removeEventListener("storage", handleSync);
    };
  }, []);

  // 1. Authoritative tests dataset for Admin Console (deduplicated by canonical ID, excluding only deleted tests)
  const validTests = useMemo(() => {
    const testMap = new Map<string, TopicPracticeTest>();
    Object.values(testsBank).forEach((t) => {
      if (!t || typeof t !== "object") return;
      // In Admin Console, admin must see all uploaded/created tests, excluding only explicitly deleted tests
      if (t.isDeleted === true || (t as any).deleted === true) return;
      const canonicalKey = t.id || (t as any).testId || (t as any).docId;
      if (canonicalKey && !testMap.has(canonicalKey)) {
        testMap.set(canonicalKey, t);
      }
    });

    return Array.from(testMap.values()).map((t) => {
      const computedType = normalizeTestCategory(t);
      return {
        ...t,
        computedType
      };
    });
  }, [testsBank]);

  // Compute all available subjects from notes and valid tests
  const availableSubjects = useMemo(() => {
    const subs = new Set<string>();
    notes.forEach((n) => {
      const s = n.subject || (n as any).subjectName;
      if (s) subs.add(s.trim());
    });
    validTests.forEach((t) => {
      if (t.subject) subs.add(t.subject.trim());
    });
    return Array.from(subs).sort();
  }, [notes, validTests]);

  // Compute available uploaded chapters for the selected class & subject
  const availableChaptersForNewTest = useMemo(() => {
    const chMap = new Map<number, string>();
    const selectedClassNorm = toStableClassId(newTestClass);
    const selectedSubjNorm = newTestSubject.trim().toLowerCase();

    notes.forEach((n) => {
      const noteClass = toStableClassId(n.classGrade || (n as any).className || "");
      const noteSubj = (n.subject || (n as any).subjectName || "").trim().toLowerCase();
      if (noteClass === selectedClassNorm && noteSubj === selectedSubjNorm && n.chapterNo) {
        chMap.set(n.chapterNo, n.chapterName || `Chapter ${n.chapterNo}`);
      }
    });

    validTests.forEach((t) => {
      const testClass = toStableClassId(t.classGrade || "");
      const testSubj = (t.subject || "").trim().toLowerCase();
      if (testClass === selectedClassNorm && testSubj === selectedSubjNorm && t.chapterNo) {
        if (!chMap.has(t.chapterNo)) {
          chMap.set(t.chapterNo, t.chapterName || `Chapter ${t.chapterNo}`);
        }
      }
    });

    return Array.from(chMap.entries())
      .map(([chapterNo, chapterName]) => ({ chapterNo, chapterName }))
      .sort((a, b) => a.chapterNo - b.chapterNo);
  }, [notes, validTests, newTestClass, newTestSubject]);

  // 2. Base dataset filtered by active Class, Subject, and Search query (independent of selected tab)
  const filteredBaseTests = useMemo(() => {
    return validTests.filter((t) => {
      // Class filter
      if (selectedClass !== "All") {
        const testClass = t.classGrade || "";
        const isClassMatch =
          !testClass ||
          testClass.toLowerCase() === "all" ||
          testClass.toLowerCase() === "all classes" ||
          toStableClassId(selectedClass) === toStableClassId(testClass) ||
          isClassCompatible(selectedClass, testClass);
        if (!isClassMatch) return false;
      }

      // Subject filter
      if (selectedSubject !== "All") {
        const testSubj = (t.subject || (t as any).subjectName || "").trim();
        const isSubjMatch =
          !testSubj ||
          testSubj.toLowerCase() === "all" ||
          testSubj.toLowerCase() === "all subjects" ||
          isExactOrCanonicalSubjectMatch(selectedSubject, testSubj) ||
          isSubjectMatching(selectedSubject, testSubj);
        if (!isSubjMatch) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const titleMatch = (t.title || "").toLowerCase().includes(q);
        const subjMatch = (t.subject || "").toLowerCase().includes(q);
        const chMatch = (t.chapterName || "").toLowerCase().includes(q);
        const topMatch = (t.topicName || "").toLowerCase().includes(q);
        const classMatch = (t.classGrade || "").toLowerCase().includes(q);
        if (!titleMatch && !subjMatch && !chMatch && !topMatch && !classMatch) return false;
      }

      return true;
    });
  }, [validTests, selectedClass, selectedSubject, searchQuery]);

  // 3. Tab counts calculated from the exact same filtered and current dataset
  const tabCounts = useMemo(() => {
    const counts = {
      ALL: filteredBaseTests.length,
      CHAPTER: 0,
      SUBJECT: 0,
      TOPIC: 0,
      PYQ: 0,
      all: filteredBaseTests.length,
      chapter: 0,
      subject: 0,
      topic: 0,
      pyq: 0,
    };

    filteredBaseTests.forEach((t) => {
      if (t.computedType === "SUBJECT") {
        counts.SUBJECT++;
        counts.subject++;
      } else if (t.computedType === "CHAPTER") {
        counts.CHAPTER++;
        counts.chapter++;
      } else if (t.computedType === "TOPIC") {
        counts.TOPIC++;
        counts.topic++;
      } else if (t.computedType === "PYQ") {
        counts.PYQ++;
        counts.pyq++;
      }
    });

    return counts;
  }, [filteredBaseTests]);

  // 4. Test list to display on page (cards) - exactly matching selected tab type
  const testList = useMemo(() => {
    const list = filteredBaseTests.filter((t) => {
      if (selectedType === "ALL") return true;
      return t.computedType === selectedType;
    });

    return list.map((t) => {
      // Count submissions strictly for this specific test
      const targetIds = new Set<string>();
      if (t.id) targetIds.add(String(t.id).trim().toLowerCase());
      if ((t as any).testId) targetIds.add(String((t as any).testId).trim().toLowerCase());
      if ((t as any).docId) targetIds.add(String((t as any).docId).trim().toLowerCase());
      if ((t as any).assessmentTestId) targetIds.add(String((t as any).assessmentTestId).trim().toLowerCase());
      const canonicalId = buildAssessmentTestId(t.classGrade, t.subject, t.chapterNo, t.topicName, t.computedType);
      if (canonicalId) targetIds.add(canonicalId.trim().toLowerCase());

      const testAttempts = attempts.filter((a) => {
        if (!a) return false;
        const aTestId = (a.testId || (a as any).topicTestId || (a as any).assessmentTestId || "").trim().toLowerCase();
        if (aTestId) {
          return targetIds.has(aTestId);
        }
        return false;
      });

      const avgScore = testAttempts.length > 0
        ? Math.round(testAttempts.reduce((acc, curr) => acc + (curr.percentage || 0), 0) / testAttempts.length)
        : 0;

      return {
        ...t,
        attemptsCount: testAttempts.length,
        avgScore
      };
    });
  }, [filteredBaseTests, selectedType, attempts]);

  // Deletion loading state & atomic mutex ref to prevent duplicate requests
  const [isDeletingTest, setIsDeletingTest] = useState<boolean>(false);
  const isDeletingRef = useRef<boolean>(false);

  // Handlers
  const handleDeleteTestConfirm = async () => {
    if (!testToDelete || isDeletingRef.current || isDeletingTest) return;
    isDeletingRef.current = true;
    setIsDeletingTest(true);

    const targetTest = testToDelete;
    const deletedId = targetTest.id || (targetTest as any).testId || (targetTest as any).docId;
    const candidateIds = new Set<string>();
    if (deletedId) candidateIds.add(String(deletedId).trim());
    if (targetTest.id) candidateIds.add(String(targetTest.id).trim());
    if ((targetTest as any).testId) candidateIds.add(String((targetTest as any).testId).trim());
    if ((targetTest as any).docId) candidateIds.add(String((targetTest as any).docId).trim());
    if ((targetTest as any).assessmentTestId) candidateIds.add(String((targetTest as any).assessmentTestId).trim());
    const canonicalId = buildAssessmentTestId(
      targetTest.classGrade,
      targetTest.subject,
      targetTest.chapterNo,
      targetTest.topicName,
      (targetTest as any).computedType || targetTest.testType
    );
    if (canonicalId) candidateIds.add(canonicalId.trim());

    try {
      // Race delete with strict 8-second safety timeout so UI never stays stuck on "Deleting..."
      const result = await Promise.race([
        deletePracticeTest(targetTest),
        new Promise<{ success: boolean; message: string }>((_, reject) =>
          setTimeout(() => reject(new Error("Deletion timed out. Please try again.")), 8000)
        )
      ]);

      if (!result || !result.success) {
        throw new Error(result?.message || "Failed to delete test.");
      }

      // 1. Stop loading state immediately
      setIsDeletingTest(false);
      isDeletingRef.current = false;

      // 2. Close delete confirmation modal immediately
      setTestToDelete(null);

      // 3. Optimistic instant removal from local state across all matching candidate keys
      setTestsBank((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          const t = next[key];
          if (!t) {
            delete next[key];
            continue;
          }
          const tId = t.id ? String(t.id).trim() : "";
          const tTestId = (t as any).testId ? String((t as any).testId).trim() : "";
          const tDocId = (t as any).docId ? String((t as any).docId).trim() : "";
          const tCanonical = buildAssessmentTestId(
            t.classGrade,
            t.subject,
            t.chapterNo,
            t.topicName,
            (t as any).computedType || t.testType
          );

          if (
            candidateIds.has(key) ||
            (tId && candidateIds.has(tId)) ||
            (tTestId && candidateIds.has(tTestId)) ||
            (tDocId && candidateIds.has(tDocId)) ||
            (tCanonical && candidateIds.has(tCanonical)) ||
            key === deletedId
          ) {
            delete next[key];
          }
        }
        return next;
      });

      setToastMessage("Test deleted successfully.");

      // 4. Background re-sync with database (non-blocking)
      loadData().catch(console.warn);
      if (onRefresh) onRefresh();

    } catch (err: any) {
      console.error("[AdminTestsView] Deletion error:", err);
      // Stop loading state immediately
      setIsDeletingTest(false);
      isDeletingRef.current = false;
      // Close confirmation modal appropriately so screen is NEVER stuck on "Deleting..."
      setTestToDelete(null);
      // Show clear error message
      setToastMessage(`Failed to delete test: ${err?.message || "Unknown error"}`);
    } finally {
      setIsDeletingTest(false);
      isDeletingRef.current = false;
    }
  };

  // Helper to resolve chapter name with fallback to curriculum notes
  const resolveChapterName = (classGrade: string, subject: string, chapterNo?: number, fallbackName?: string) => {
    if (fallbackName && fallbackName.trim() && !fallbackName.toLowerCase().startsWith("chapter ")) {
      return fallbackName.trim();
    }
    const num = Number(chapterNo);
    if (!num) return fallbackName?.trim() || "Chapter Test";
    const normClass = toStableClassId(classGrade);
    const normSubj = subject.trim().toLowerCase();
    for (const n of notes) {
      const nClass = toStableClassId(n.classGrade || (n as any).className || "");
      const nSubj = (n.subject || (n as any).subjectName || "").trim().toLowerCase();
      if (nClass === normClass && nSubj === normSubj && Number(n.chapterNo) === num) {
        if (n.chapterName && n.chapterName.trim()) {
          return n.chapterName.trim();
        }
      }
    }
    return fallbackName?.trim() || `Chapter ${num}`;
  };

  // State for expanded chapters in Chapter Tests view
  const [expandedChapterKeys, setExpandedChapterKeys] = useState<Set<string>>(new Set());

  const toggleChapterExpanded = (chapterKey: string) => {
    setExpandedChapterKeys((prev) => {
      const next = new Set(prev);
      if (next.has(chapterKey)) {
        next.delete(chapterKey);
      } else {
        next.add(chapterKey);
      }
      return next;
    });
  };

  // Group Chapter Tests by Class -> Subject -> Chapter dynamically
  interface ChapterTestGroup {
    key: string;
    classGrade: string;
    subject: string;
    chapterNo: number;
    chapterName: string;
    tests: any[];
    totalSubmissions: number;
  }

  interface SubjectChapterSection {
    key: string;
    classGrade: string;
    subject: string;
    chapters: ChapterTestGroup[];
    totalTests: number;
  }

  const subjectChapterSections = useMemo(() => {
    const chapterTests = testList.filter((t) => t.computedType === "CHAPTER");
    if (chapterTests.length === 0) return [];

    const sectionMap = new Map<string, SubjectChapterSection>();

    chapterTests.forEach((test) => {
      const cls = test.classGrade || "Class 10";
      const subj = test.subject || "General";
      const sectionKey = `${toStableClassId(cls)}__${subj.trim().toLowerCase()}`;

      if (!sectionMap.has(sectionKey)) {
        sectionMap.set(sectionKey, {
          key: sectionKey,
          classGrade: cls,
          subject: subj,
          chapters: [],
          totalTests: 0,
        });
      }

      const section = sectionMap.get(sectionKey)!;
      section.totalTests++;

      const chNo = Number(test.chapterNo) || 1;
      const chName = resolveChapterName(cls, subj, chNo, test.chapterName);
      const chapterKey = `${sectionKey}__ch_${chNo}`;

      let chapterGroup = section.chapters.find((c) => c.key === chapterKey);
      if (!chapterGroup) {
        chapterGroup = {
          key: chapterKey,
          classGrade: cls,
          subject: subj,
          chapterNo: chNo,
          chapterName: chName,
          tests: [],
          totalSubmissions: 0,
        };
        section.chapters.push(chapterGroup);
      }

      chapterGroup.tests.push(test);
      chapterGroup.totalSubmissions += (test.attemptsCount || 0);
    });

    // Sort chapters within each section by chapterNo
    sectionMap.forEach((sec) => {
      sec.chapters.sort((a, b) => a.chapterNo - b.chapterNo);
      sec.chapters.forEach((ch) => {
        ch.tests.sort((a, b) => {
          const titleA = a.title || a.topicName || "";
          const titleB = b.title || b.topicName || "";
          return titleA.localeCompare(titleB, undefined, { numeric: true });
        });
      });
    });

    // Sort sections: classGrade, then subject
    return Array.from(sectionMap.values()).sort((a, b) => {
      const classCompare = a.classGrade.localeCompare(b.classGrade, undefined, { numeric: true });
      if (classCompare !== 0) return classCompare;
      return a.subject.localeCompare(b.subject);
    });
  }, [testList, notes]);

  const expandAllChapters = () => {
    const allKeys = new Set<string>();
    subjectChapterSections.forEach((sec) => {
      sec.chapters.forEach((ch) => allKeys.add(ch.key));
    });
    setExpandedChapterKeys(allKeys);
  };

  const collapseAllChapters = () => {
    setExpandedChapterKeys(new Set());
  };

  // Non-chapter tests for the ALL tab (Subject, Topic, PYQ)
  const nonChapterTests = useMemo(() => {
    return testList.filter((t) => t.computedType !== "CHAPTER");
  }, [testList]);

  // Determine if a chapter is open (either explicitly expanded or matches search query)
  const isChapterOpen = (chKey: string, ch: ChapterTestGroup) => {
    if (expandedChapterKeys.has(chKey)) return true;
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.trim().toLowerCase();
      if (ch.chapterName.toLowerCase().includes(q)) return true;
      return ch.tests.some((t) => 
        (t.title || "").toLowerCase().includes(q) || 
        (t.topicName || "").toLowerCase().includes(q)
      );
    }
    return false;
  };

  const handleLaunchCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTestSubject.trim()) {
      alert("Please select or enter a subject.");
      return;
    }

    setIsCreatingNew(false);
    setActiveEditorTest({
      classGrade: newTestClass,
      subject: newTestSubject.trim(),
      chapterNo: newTestChapterNo,
      chapterName: newTestChapterName.trim() || `Chapter ${newTestChapterNo}`,
      topicName: newTestType === "SUBJECT" ? `${newTestSubject} Subject Test` : newTestType === "CHAPTER" ? `${newTestChapterName || `Chapter ${newTestChapterNo}`} Chapter Test` : (newTestTopicName.trim() || "Practice Test"),
      testType: newTestType,
      isNewTest: true
    });
  };

  const renderTestCard = (test: any, isChapterSubCard: boolean = false) => {
    const questionCount = Array.isArray(test.questions) ? test.questions.length : (test.questionCount || 0);
    const totalMarks = test.totalMarks || questionCount;
    const duration = test.durationMinutes || (test as any).duration_minutes || 0;

    const typeColors = {
      SUBJECT: "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800",
      CHAPTER: "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
      TOPIC: "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
      PYQ: "bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800"
    };

    const typeLabels = {
      SUBJECT: "Subject Test",
      CHAPTER: "Chapter Test",
      TOPIC: "Topic Test",
      PYQ: "PYQ"
    };

    const displayTitle = test.title || 
      (test.computedType === "SUBJECT"
        ? `${test.subject} Comprehensive Subject Test`
        : test.computedType === "CHAPTER"
        ? (test.chapterNo ? `Chapter ${test.chapterNo}: ${test.chapterName || "Full Chapter Test"}` : "Chapter Test")
        : test.topicName || "Academic Practice Test");

    return (
      <div
        key={test.id}
        className={`bg-white dark:bg-slate-900 border ${
          isChapterSubCard 
            ? "border-amber-200/80 dark:border-amber-900/40 shadow-2xs hover:border-amber-400 dark:hover:border-amber-600" 
            : "border-slate-200 dark:border-slate-800 shadow-2xs"
        } rounded-2xl p-4 sm:p-5 hover:shadow-md transition-all flex flex-col justify-between group`}
        id={`test-card-${test.id}`}
      >
        <div>
          {/* Top Badges */}
          <div className="flex items-center justify-between gap-2 mb-3">
            <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md border uppercase tracking-wider ${typeColors[test.computedType as keyof typeof typeColors] || typeColors.CHAPTER}`}>
              {typeLabels[test.computedType as keyof typeof typeLabels] || "Test"}
            </span>
            
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                {test.classGrade || "Class 10"}
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-blue-900/40">
                {test.subject || "General"}
              </span>
            </div>
          </div>

          {/* Test Title */}
          <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white mb-2 leading-snug line-clamp-2">
            {displayTitle}
          </h3>

          {/* Chapter / Topic Scope if applicable and not already in chapter subcard */}
          {!isChapterSubCard && test.computedType !== "SUBJECT" && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-1.5 truncate">
              <BookOpen className="w-3 h-3 shrink-0 text-slate-400" />
              <span className="truncate">
                {test.chapterNo ? `Ch ${test.chapterNo}: ` : ""}{test.chapterName || test.topicName}
              </span>
            </p>
          )}

          {/* Meta Tags: Duration, Questions, Marks */}
          <div className="grid grid-cols-3 gap-2 py-2.5 px-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-800/80 mb-4 text-center">
            <div>
              <p className="text-[10px] text-slate-400 font-semibold uppercase">Questions</p>
              <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{questionCount} Qs</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 font-semibold uppercase">Marks</p>
              <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{totalMarks} Pts</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 font-semibold uppercase">Duration</p>
              <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                {duration > 0 ? `${duration}m` : "Untimed"}
              </p>
            </div>
          </div>

          {/* Submissions summary */}
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
            <span className="flex items-center gap-1">
              <Users className="w-3.5 h-3.5 text-slate-400" />
              <span>{test.attemptsCount} {test.attemptsCount === 1 ? "submission" : "submissions"}</span>
            </span>
            {test.attemptsCount > 0 && (
              <span className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <Award className="w-3.5 h-3.5" />
                <span>Avg: {test.avgScore}%</span>
              </span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 pt-1">
          <button
            type="button"
            onClick={() => {
              setActiveEditorTest({
                testId: test.id || (test as any).testId,
                classGrade: test.classGrade,
                subject: test.subject,
                chapterNo: test.chapterNo,
                chapterName: test.chapterName,
                topicName: test.topicName,
                testType: test.computedType
              });
            }}
            className="flex-1 py-1.5 px-2 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer border border-blue-200 dark:border-blue-800/60"
            title="Edit questions and test settings"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Manage</span>
          </button>

          <button
            type="button"
            onClick={() => setTestToPreview(test)}
            className="py-1.5 px-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-bold transition-all flex items-center justify-center cursor-pointer"
            title="Preview questions"
          >
            <Eye className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setTestForSubmissions(test)}
            className="py-1.5 px-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-bold transition-all flex items-center justify-center cursor-pointer"
            title="View student submissions"
          >
            <Users className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            disabled={isDeletingTest}
            onClick={() => setTestToDelete(test)}
            className="py-1.5 px-2 bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-100 text-rose-600 dark:text-rose-400 rounded-lg text-xs font-bold transition-all flex items-center justify-center cursor-pointer border border-rose-200 dark:border-rose-900/40 disabled:opacity-50"
            title="Delete test"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  };

  const renderChapterSections = () => {
    return (
      <div className="space-y-6" id="chapter-tests-by-chapter-container">
        {/* Controls Bar: Summary and Expand/Collapse All */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
              {subjectChapterSections.reduce((acc, s) => acc + s.chapters.length, 0)} Chapters with {subjectChapterSections.reduce((acc, s) => acc + s.totalTests, 0)} Tests
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={expandAllChapters}
              className="text-xs font-semibold px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-lg transition-colors cursor-pointer"
            >
              Expand All
            </button>
            <button
              type="button"
              onClick={collapseAllChapters}
              className="text-xs font-semibold px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-lg transition-colors cursor-pointer"
            >
              Collapse All
            </button>
          </div>
        </div>

        {subjectChapterSections.map((sec) => (
          <div
            key={sec.key}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs"
            id={`section-${sec.key}`}
          >
            {/* Section Header: Class -> Subject */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                  {sec.classGrade}
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-xs font-extrabold px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-blue-900/40">
                  {sec.subject}
                </span>
              </div>
              <span className="text-xs font-bold text-slate-400">
                {sec.chapters.length} {sec.chapters.length === 1 ? "Chapter" : "Chapters"} • {sec.totalTests} {sec.totalTests === 1 ? "Test" : "Tests"}
              </span>
            </div>

            {/* Chapters list under this Class & Subject */}
            <div className="space-y-3">
              {sec.chapters.map((ch) => {
                const open = isChapterOpen(ch.key, ch);

                return (
                  <div
                    key={ch.key}
                    className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden transition-all bg-slate-50/40 dark:bg-slate-800/20"
                    id={`chapter-group-${ch.key}`}
                  >
                    {/* Clickable Chapter Bar */}
                    <div
                      onClick={() => toggleChapterExpanded(ch.key)}
                      className="p-3 sm:p-4 bg-white dark:bg-slate-900/90 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors flex items-center justify-between gap-3 cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/20">
                          <BookOpen className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                            Ch {ch.chapterNo}: {ch.chapterName}
                          </h4>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] font-bold text-amber-700 dark:text-amber-300">
                              {ch.tests.length} {ch.tests.length === 1 ? "Chapter Test" : "Chapter Tests"}
                            </span>
                            {ch.totalSubmissions > 0 && (
                              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                                • <Users className="w-3 h-3" /> {ch.totalSubmissions} submissions
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveEditorTest({
                              classGrade: ch.classGrade,
                              subject: ch.subject,
                              chapterNo: ch.chapterNo,
                              chapterName: ch.chapterName,
                              topicName: `${ch.chapterName} Chapter Test`,
                              testType: "CHAPTER",
                              isNewTest: true,
                            });
                          }}
                          className="py-1 px-2.5 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 text-amber-700 dark:text-amber-300 rounded-lg text-xs font-bold transition-all border border-amber-200/80 dark:border-amber-900/40 flex items-center gap-1 cursor-pointer"
                          title="Create another Chapter Test for this chapter"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Add Test</span>
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleChapterExpanded(ch.key);
                          }}
                          className="py-1 px-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                        >
                          <span>{open ? "Hide Tests" : `View Tests (${ch.tests.length})`}</span>
                          {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    {/* Open / Expanded Tests Grid */}
                    {open && (
                      <div className="p-3 sm:p-4 border-t border-slate-200/80 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-900/50">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                          {ch.tests.map((test) => renderTestCard(test, true))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100" id="admin-tests-view">
      {/* Header bar */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-3 sm:px-6 shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 max-w-7xl mx-auto">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center border border-amber-500/20 shadow-2xs">
              <Trophy className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                <span>Test Management</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                  {testList.length} {testList.length === 1 ? "Test" : "Tests"}
                </span>
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Author, schedule, configure timers, and track student submissions for all academic tests
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadData}
              disabled={isLoading}
              className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Refresh Tests Bank"
              id="admin-tests-refresh-btn"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            <button
              type="button"
              onClick={() => setIsCreatingNew(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-500/20 transition-all flex items-center gap-1.5 cursor-pointer"
              id="admin-create-test-btn"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Create Test</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filters and search toolbar */}
      <div className="bg-slate-50/80 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 px-4 py-3 sm:px-6 shrink-0 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Test Type Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
            {[
              { id: "ALL", label: "All Tests", count: tabCounts.ALL },
              { id: "CHAPTER", label: "Chapter Tests", count: tabCounts.CHAPTER },
              { id: "SUBJECT", label: "Subject Tests", count: tabCounts.SUBJECT },
              { id: "TOPIC", label: "Topic Tests", count: tabCounts.TOPIC },
              { id: "PYQ", label: "PYQs", count: tabCounts.PYQ },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedType(tab.id as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                  selectedType === tab.id
                    ? "bg-blue-600 text-white shadow-2xs shadow-blue-500/20"
                    : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700"
                }`}
                id={`filter-type-${tab.id.toLowerCase()}`}
              >
                <span>{tab.label}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-extrabold ${
                  selectedType === tab.id ? "bg-blue-500 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Selectors and search input */}
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            {/* Class filter */}
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-blue-500 cursor-pointer"
              id="admin-filter-class-select"
            >
              <option value="All">All Classes</option>
              <optgroup label="School Grades">
                {SCHOOL_CLASSES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </optgroup>
              <optgroup label="UPSC Syllabus">
                {UPSC_PAPERS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </optgroup>
            </select>

            {/* Subject filter */}
            <select
              value={selectedSubject}
              onChange={(e) => setSelectedSubject(e.target.value)}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-blue-500 cursor-pointer"
              id="admin-filter-subject-select"
            >
              <option value="All">All Subjects</option>
              {availableSubjects.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            {/* Search Input */}
            <div className="relative flex-1 sm:w-56">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search tests..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                id="admin-tests-search-input"
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
          {testList.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center flex flex-col items-center max-w-lg mx-auto shadow-sm">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-4 border border-amber-500/20">
                <FileCheck2 className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                No Tests Found
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 max-w-sm">
                {searchQuery || selectedClass !== "All" || selectedSubject !== "All" || selectedType !== "ALL"
                  ? "Try clearing your filters or search terms to find available tests."
                  : "Get started by creating your first academic test or generate one instantly with AI."}
              </p>
              <button
                type="button"
                onClick={() => setIsCreatingNew(true)}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-500/20 transition-all flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Create New Test</span>
              </button>
            </div>
          ) : selectedType === "CHAPTER" ? (
            /* CHAPTER TAB: Organized by Chapter dynamically across all classes, subjects, and chapters */
            renderChapterSections()
          ) : selectedType === "ALL" ? (
            /* ALL TAB: Chapter Tests grouped by chapter, followed by Subject/Topic/PYQ tests */
            <div className="space-y-8">
              {subjectChapterSections.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <span className="px-2.5 py-1 rounded-md bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 text-xs font-extrabold border border-amber-200 dark:border-amber-800 uppercase tracking-wider">
                      Chapter Tests (Grouped by Chapter)
                    </span>
                  </div>
                  {renderChapterSections()}
                </div>
              )}

              {nonChapterTests.length > 0 && (
                <div>
                  {subjectChapterSections.length > 0 && (
                    <div className="flex items-center gap-2 mb-4 pt-4 border-t border-slate-200 dark:border-slate-800">
                      <span className="text-xs font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Other Tests ({nonChapterTests.length})
                      </span>
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="non-chapter-tests-grid">
                    {nonChapterTests.map((test) => renderTestCard(test))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* TOPIC, SUBJECT, PYQ TABS: Unchanged existing card grid */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="tests-grid-container">
              {testList.map((test: any) => renderTestCard(test))}
            </div>
          )}
        </div>
      </div>

      {/* Modal: Create New Test Configuration */}
      {isCreatingNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800 mb-5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <Plus className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">Create New Test</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Configure scope and open editor</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCreatingNew(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleLaunchCreate} className="space-y-4 text-xs">
              {/* Test Type */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Test Type
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: "CHAPTER", label: "Chapter Test" },
                    { id: "SUBJECT", label: "Subject Test" },
                    { id: "TOPIC", label: "Topic Test" },
                    { id: "PYQ", label: "PYQ Exam" },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setNewTestType(t.id as any)}
                      className={`p-2 rounded-xl text-center font-bold border transition-all cursor-pointer ${
                        newTestType === t.id
                          ? "bg-blue-50 dark:bg-blue-950/60 border-blue-500 text-blue-700 dark:text-blue-300"
                          : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Class Selection */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Target Class / Course
                </label>
                <select
                  value={newTestClass}
                  onChange={(e) => setNewTestClass(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white font-semibold"
                >
                  <optgroup label="School Grades">
                    {SCHOOL_CLASSES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </optgroup>
                  <optgroup label="UPSC Course">
                    {UPSC_PAPERS.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </optgroup>
                </select>
              </div>

              {/* Subject */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Subject
                </label>
                <input
                  type="text"
                  placeholder="e.g. History, Geography, Physics"
                  value={newTestSubject}
                  onChange={(e) => setNewTestSubject(e.target.value)}
                  required
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white font-medium"
                />
              </div>

              {/* Chapter Details if Chapter test */}
              {newTestType === "CHAPTER" && (
                <div className="space-y-3">
                  {availableChaptersForNewTest.length > 0 && (
                    <div>
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5 text-xs">
                        Select from Uploaded Chapters ({availableChaptersForNewTest.length} available)
                      </label>
                      <select
                        onChange={(e) => {
                          const val = e.target.value;
                          if (!val) return;
                          const found = availableChaptersForNewTest.find((c) => String(c.chapterNo) === val);
                          if (found) {
                            setNewTestChapterNo(found.chapterNo);
                            setNewTestChapterName(found.chapterName);
                          }
                        }}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white font-semibold text-xs"
                      >
                        <option value="">-- Choose an uploaded chapter or enter below --</option>
                        {availableChaptersForNewTest.map((c) => (
                          <option key={c.chapterNo} value={c.chapterNo}>
                            Chapter {c.chapterNo}: {c.chapterName}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                        Chapter No.
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={newTestChapterNo}
                        onChange={(e) => setNewTestChapterNo(parseInt(e.target.value, 10) || 1)}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white font-medium"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                        Chapter Name
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Nationalism in India"
                        value={newTestChapterName}
                        onChange={(e) => setNewTestChapterName(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white font-medium"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Tag if PYQ */}
              {newTestType === "PYQ" && (
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    Exam / Year Tag
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. UPSC Prelims 2023 Paper 1"
                    value={newTestTopicName}
                    onChange={(e) => setNewTestTopicName(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white font-medium"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreatingNew(false)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-md shadow-blue-500/20 cursor-pointer flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Open Test Editor</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Preview Test Questions */}
      {testToPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl">
            <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  Test Preview: {testToPreview.title || testToPreview.topicName || testToPreview.chapterName}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {testToPreview.classGrade} • {testToPreview.subject} • {testToPreview.questions?.length || 0} Questions
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTestToPreview(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 text-xs scrollbar-thin">
              {(!testToPreview.questions || testToPreview.questions.length === 0) ? (
                <div className="text-center py-8 text-slate-400">No questions found in this test.</div>
              ) : (
                testToPreview.questions.map((q, idx) => (
                  <div key={q.id || idx} className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                    <p className="font-bold text-slate-900 dark:text-slate-100 mb-2">
                      Q{idx + 1}. {q.question}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-2">
                      {q.options?.map((opt, oIdx) => {
                        const isCorrect = opt.startsWith(`${q.correctAnswer}.`) || opt.startsWith(`${q.correctAnswer} `);
                        return (
                          <div
                            key={oIdx}
                            className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium ${
                              isCorrect
                                ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-800 font-bold"
                                : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                            }`}
                          >
                            {opt}
                          </div>
                        );
                      })}
                    </div>
                    {q.explanation && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-100/80 dark:bg-slate-800 p-2 rounded-lg">
                        <span className="font-bold text-slate-700 dark:text-slate-300">Explanation: </span>
                        {q.explanation}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setTestToPreview(null)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-xl font-bold cursor-pointer"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: View Student Submissions & Attempts */}
      {testForSubmissions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl">
            <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  Student Submissions
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {testForSubmissions.title || testForSubmissions.topicName} • {testForSubmissions.subject}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTestForSubmissions(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 text-xs scrollbar-thin">
              {(() => {
                const targetIds = new Set<string>();
                if (testForSubmissions.id) targetIds.add(String(testForSubmissions.id).trim().toLowerCase());
                if ((testForSubmissions as any).testId) targetIds.add(String((testForSubmissions as any).testId).trim().toLowerCase());
                if ((testForSubmissions as any).docId) targetIds.add(String((testForSubmissions as any).docId).trim().toLowerCase());
                if ((testForSubmissions as any).assessmentTestId) targetIds.add(String((testForSubmissions as any).assessmentTestId).trim().toLowerCase());
                const canonicalId = buildAssessmentTestId(testForSubmissions.classGrade, testForSubmissions.subject, testForSubmissions.chapterNo, testForSubmissions.topicName, (testForSubmissions as any).computedType || (testForSubmissions as any).testType);
                if (canonicalId) targetIds.add(canonicalId.trim().toLowerCase());

                const subAttempts = attempts.filter((a) => {
                  if (!a) return false;
                  const aTestId = (a.testId || (a as any).topicTestId || (a as any).assessmentTestId || "").trim().toLowerCase();
                  if (aTestId) {
                    return targetIds.has(aTestId);
                  }
                  return false;
                });

                if (subAttempts.length === 0) {
                  return <div className="text-center py-8 text-slate-400">No student submissions recorded yet for this test.</div>;
                }

                return subAttempts.map((att, idx) => (
                  <div key={att.id || idx} className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                    <div>
                      <h4 className="font-bold text-slate-900 dark:text-white text-xs">{att.studentName}</h4>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        <span>Attempt #{att.attemptNumber}</span>
                        <span>•</span>
                        <span>{att.date}</span>
                        {att.timeTakenSeconds ? (
                          <>
                            <span>•</span>
                            <span>{Math.floor(att.timeTakenSeconds / 60)}m {att.timeTakenSeconds % 60}s</span>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <div className="text-right">
                      <div className={`text-xs font-black px-2 py-0.5 rounded-md inline-flex items-center gap-1 ${
                        att.percentage >= 75
                          ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200"
                          : att.percentage >= 40
                          ? "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200"
                          : "bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-200"
                      }`}>
                        <Award className="w-3.5 h-3.5" />
                        <span>{att.score}/{att.totalQuestions} ({att.percentage}%)</span>
                      </div>
                    </div>
                  </div>
                ));
              })()}
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setTestForSubmissions(null)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 rounded-xl font-bold cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Editor Modal: launches AdminPracticeTestModal */}
      {activeEditorTest && (
        <AdminPracticeTestModal
          isOpen={true}
          onClose={() => {
            setActiveEditorTest(null);
            loadData();
          }}
          testId={activeEditorTest.testId}
          isNewTest={activeEditorTest.isNewTest}
          classGrade={activeEditorTest.classGrade}
          subject={activeEditorTest.subject}
          chapterNo={activeEditorTest.chapterNo}
          chapterName={activeEditorTest.chapterName}
          topicName={activeEditorTest.topicName}
          testType={activeEditorTest.testType}
          onPracticeTestChanged={loadData}
        />
      )}

      {/* Confirm Delete Modal */}
      {testToDelete && (
        <ConfirmDeleteModal
          isOpen={true}
          onCancel={() => {
            if (!isDeletingTest) {
              setTestToDelete(null);
            }
          }}
          onConfirm={handleDeleteTestConfirm}
          title="Delete Test"
          message={`Are you sure you want to permanently delete "${testToDelete.title || testToDelete.topicName || testToDelete.chapterName || "this test"}"? This will permanently remove the test questions from the database.`}
          isDeleting={isDeletingTest}
        />
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <Toast
          message={toastMessage}
          onClose={() => setToastMessage(null)}
        />
      )}
    </div>
  );
};

export default AdminTestsView;
