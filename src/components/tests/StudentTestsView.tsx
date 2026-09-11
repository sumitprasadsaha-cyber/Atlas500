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
  AlertCircle
} from "lucide-react";
import { TopicPracticeTest, TestAttemptRecord, AssessmentTestType, Student, ClassNote } from "../../types";
import { 
  fetchAllPracticeTests, 
  buildTopicTestId, 
  buildChapterTestId, 
  buildSubjectTestId 
} from "../../lib/practiceTestService";
import { getAllTestAttempts, subscribeToTestAttempts } from "../../utils/assessmentParser";
import { toStableClassId, getAccessibleClassesGrantedToClass } from "../../lib/curriculumAccessService";
import { loadTestDraft } from "../../lib/testSessionManager";
import StudentPracticeTestModal from "../StudentPracticeTestModal";

interface StudentTestsViewProps {
  student: Student;
  notes?: ClassNote[];
}

export const StudentTestsView: React.FC<StudentTestsViewProps> = ({
  student,
  notes = []
}) => {
  const [testsBank, setTestsBank] = useState<Record<string, TopicPracticeTest>>({});
  const [attempts, setAttempts] = useState<TestAttemptRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedSubject, setSelectedSubject] = useState<string>("All");
  const [selectedCategory, setSelectedCategory] = useState<"ALL" | "SUBJECT" | "CHAPTER" | "TOPIC" | "PYQ">("ALL");
  const [selectedStatus, setSelectedStatus] = useState<"ALL" | "COMPLETED" | "PENDING">("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Test Taking Modal state
  const [activeTestTarget, setActiveTestTarget] = useState<{
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

    const unsubAttempts = subscribeToTestAttempts((updated) => {
      if (updated) setAttempts(updated);
    });

    const handleSync = () => {
      fetchAllPracticeTests().then((bank) => {
        setTestsBank(bank || {});
      });
    };
    window.addEventListener("practice-tests-updated", handleSync);

    return () => {
      unsubAttempts();
      window.removeEventListener("practice-tests-updated", handleSync);
    };
  }, []);

  // Allowed classes for this student (canonical or granted permissions)
  const allowedClasses = useMemo(() => {
    const norm = toStableClassId(studentClass);
    const granted = getAccessibleClassesGrantedToClass(studentClass).map((g) => toStableClassId(g.ownerClass));
    return Array.from(new Set([norm, ...granted]));
  }, [studentClass]);

  // Compute student's enrolled subjects
  const studentSubjects = useMemo(() => {
    const rawEnrolled = student.enrolledSubjects || [];
    if (rawEnrolled.length > 0) {
      return rawEnrolled;
    }
    // Fallback: collect subjects from notes matching student's class
    const subs = new Set<string>();
    const normStudentClass = toStableClassId(studentClass);
    notes.forEach((n) => {
      const nClass = toStableClassId(n.classGrade || (n as any).className || "");
      if (allowedClasses.includes(nClass) || nClass === normStudentClass) {
        const s = n.subject || (n as any).subjectName;
        if (s) subs.add(s.trim());
      }
    });
    return Array.from(subs);
  }, [student, notes, allowedClasses, studentClass]);

  // Filter test bank for this student
  const filteredTests = useMemo(() => {
    const studentAttempts = attempts.filter(
      (a) => a.studentId === studentIdentifier || (student.name && a.studentName.toLowerCase() === student.name.toLowerCase())
    );

    const list = Object.values(testsBank).map((t) => {
      const rawType = (t.testType || (t as any).test_type || "TOPIC").toUpperCase();
      let normalizedType: "SUBJECT" | "CHAPTER" | "TOPIC" | "PYQ" = "TOPIC";
      if (rawType === "SUBJECT") normalizedType = "SUBJECT";
      else if (rawType === "CHAPTER" || rawType === "FULL_CHAPTER") normalizedType = "CHAPTER";
      else if (rawType === "PYQ") normalizedType = "PYQ";

      // Match student attempts for this test
      const myAttempts = studentAttempts.filter((a) => {
        if (a.testId && t.id && a.testId === t.id) return true;
        const matchClass = allowedClasses.includes(toStableClassId(a.classGrade || "")) ||
          toStableClassId(a.classGrade || "") === toStableClassId(t.classGrade || "");
        const matchSubj = (a.subject || "").toLowerCase().trim() === (t.subject || "").toLowerCase().trim();

        if (normalizedType === "SUBJECT") return matchClass && matchSubj && a.testType === "subject";
        if (normalizedType === "CHAPTER") return matchClass && matchSubj && a.chapterNo === t.chapterNo && (a.testType === "chapter" || a.testType === "full_chapter");
        return matchClass && matchSubj && a.chapterNo === t.chapterNo && (a.topicName || "").toLowerCase().trim() === (t.topicName || "").toLowerCase().trim();
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
        isCompleted: myAttempts.length > 0
      };
    });

    return list.filter((t) => {
      // 1. Class match check: test must belong to student's class or allowed access classes
      const normTestClass = toStableClassId(t.classGrade || "");
      const isClassMatch = allowedClasses.includes(normTestClass) || 
        normTestClass === toStableClassId(studentClass) ||
        (studentClass.toLowerCase().includes("upsc") && (t.classGrade || "").toLowerCase().includes("upsc"));
      
      if (!isClassMatch) return false;

      // 2. Subject filter
      if (selectedSubject !== "All") {
        if ((t.subject || "").toLowerCase().trim() !== selectedSubject.toLowerCase().trim()) return false;
      } else if (studentSubjects.length > 0) {
        // Only show enrolled subjects unless "All" is selected and subject matches enrolled
        const matchesEnrolled = studentSubjects.some(
          (s) => s.toLowerCase().trim() === (t.subject || "").toLowerCase().trim()
        );
        // If student has explicit enrolled subjects, check match
        if (student.enrolledSubjects && student.enrolledSubjects.length > 0 && !matchesEnrolled) {
          return false;
        }
      }

      // 3. Category filter
      if (selectedCategory !== "ALL" && t.computedType !== selectedCategory) {
        return false;
      }

      // 4. Status filter
      if (selectedStatus === "COMPLETED" && !t.isCompleted) return false;
      if (selectedStatus === "PENDING" && t.isCompleted) return false;

      // 5. Search query
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
  }, [testsBank, attempts, studentIdentifier, studentClass, allowedClasses, studentSubjects, selectedSubject, selectedCategory, selectedStatus, searchQuery, student.id, student.name, student.enrolledSubjects]);

  // Overall student test statistics
  const stats = useMemo(() => {
    const studentAttempts = attempts.filter(
      (a) => a.studentId === studentIdentifier || (student.name && a.studentName.toLowerCase() === student.name.toLowerCase())
    );
    const totalAvailable = filteredTests.length;
    const completedCount = filteredTests.filter((t) => t.isCompleted).length;
    const avgScore = studentAttempts.length > 0
      ? Math.round(studentAttempts.reduce((acc, curr) => acc + (curr.percentage || 0), 0) / studentAttempts.length)
      : 0;
    const bestScore = studentAttempts.length > 0
      ? Math.max(...studentAttempts.map((a) => a.percentage || 0))
      : 0;

    return { totalAvailable, completedCount, avgScore, bestScore };
  }, [filteredTests, attempts, studentIdentifier, student.name]);

  // Handle starting/taking a test
  const handleStartTest = (test: any) => {
    setActiveTestTarget({
      classGrade: test.classGrade,
      subject: test.subject,
      chapterNo: test.chapterNo,
      chapterName: test.chapterName,
      topicName: test.computedType === "SUBJECT" ? "Subject Test" : test.computedType === "CHAPTER" ? "Full Chapter Test" : test.topicName,
      testType: test.computedType === "SUBJECT" ? "SUBJECT" : test.computedType === "CHAPTER" ? "CHAPTER" : test.computedType === "PYQ" ? "PYQ" : "TOPIC",
      title: test.title || test.topicName || test.chapterName
    });
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
              <p className="text-sm sm:text-base font-black text-blue-700 dark:text-blue-300">{stats.avgScore}%</p>
            </div>
            <div className="bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40 rounded-xl px-3 py-2 text-center">
              <p className="text-[10px] uppercase font-bold text-amber-600 dark:text-amber-400">Best Score</p>
              <p className="text-sm sm:text-base font-black text-amber-700 dark:text-amber-300">{stats.bestScore}%</p>
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
              { id: "TOPIC", label: "Topic Tests" },
              { id: "PYQ", label: "PYQs" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedCategory(tab.id as any)}
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
              onChange={(e) => setSelectedSubject(e.target.value)}
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

      {/* Tests Grid View */}
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
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="student-tests-grid">
              {filteredTests.map((test: any) => {
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
                    ? `${test.subject} Full Subject Test`
                    : test.computedType === "CHAPTER"
                    ? `Chapter ${test.chapterNo}: ${test.chapterName || "Full Chapter Test"}`
                    : test.topicName || "Academic Practice Test");

                return (
                  <div
                    key={test.id}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-2xs hover:shadow-md transition-all flex flex-col justify-between"
                    id={`student-test-card-${test.id}`}
                  >
                    <div>
                      {/* Top Badges */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md border uppercase tracking-wider ${typeColors[test.computedType as keyof typeof typeColors]}`}>
                          {typeLabels[test.computedType as keyof typeof typeLabels]}
                        </span>
                        
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-blue-900/40">
                          {test.subject || "General"}
                        </span>
                      </div>

                      {/* Test Title */}
                      <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white mb-2 leading-snug line-clamp-2">
                        {displayTitle}
                      </h3>

                      {/* Chapter Scope */}
                      {test.computedType !== "SUBJECT" && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-1.5 truncate">
                          <BookOpen className="w-3 h-3 shrink-0 text-slate-400" />
                          <span className="truncate">
                            {test.chapterNo ? `Chapter ${test.chapterNo}: ` : ""}{test.chapterName || test.topicName}
                          </span>
                        </p>
                      )}

                      {/* Test Specs: Questions, Duration, Marks */}
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

                      {/* Student Performance Record */}
                      <div className="mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
                        {test.latestAttempt ? (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-500 dark:text-slate-400">
                              Latest Attempt:
                            </span>
                            <span className={`font-black px-2 py-0.5 rounded-md inline-flex items-center gap-1 ${
                              test.latestAttempt.percentage >= 75
                                ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200"
                                : test.latestAttempt.percentage >= 40
                                ? "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200"
                                : "bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-200"
                            }`}>
                              <Award className="w-3.5 h-3.5" />
                              <span>{test.latestAttempt.score}/{test.latestAttempt.totalQuestions} ({test.latestAttempt.percentage}%)</span>
                            </span>
                          </div>
                        ) : test.hasActiveDraft ? (
                          <div className="flex items-center justify-between text-xs text-amber-600 dark:text-amber-400 font-bold bg-amber-50 dark:bg-amber-950/40 p-2 rounded-lg border border-amber-200 dark:border-amber-800/40">
                            <span className="flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                              <span>Draft in progress</span>
                            </span>
                            <span className="text-[10px]">Autosaved</span>
                          </div>
                        ) : (
                          <div className="text-xs text-slate-400 font-medium">
                            Not attempted yet
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 pt-1">
                      {test.latestAttempt ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleStartTest(test)}
                            className="flex-1 py-2 px-3 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-700 dark:text-amber-300 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer border border-amber-200 dark:border-amber-800/60"
                            id={`retake-test-btn-${test.id}`}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Re-take Test</span>
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
                            className="py-2 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer"
                            title="View scorecard analysis"
                          >
                            <BarChart3 className="w-3.5 h-3.5" />
                            <span>Review</span>
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleStartTest(test)}
                          className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
                          id={`start-test-btn-${test.id}`}
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>{test.hasActiveDraft ? "Resume Test" : "Start Test"}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
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
                    return (
                      <div key={q.id || qIdx} className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-800">
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <p className="font-bold text-slate-900 dark:text-slate-100">
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
                        <div className="text-[11px] text-slate-600 dark:text-slate-400 space-y-0.5">
                          <p>Your Answer: <span className="font-bold text-slate-800 dark:text-slate-200">{studentAns}</span></p>
                          <p>Correct Answer: <span className="font-bold text-emerald-600 dark:text-emerald-400">{q.correctAnswer}</span></p>
                        </div>
                        {q.explanation && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-100/80 dark:bg-slate-800/80 p-2 rounded-lg mt-2">
                            <span className="font-bold text-slate-700 dark:text-slate-300">Explanation: </span>
                            {q.explanation}
                          </p>
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
