import React, { useState, useEffect, useRef } from "react";
import { 
  X, 
  CheckCircle2, 
  XCircle, 
  Award, 
  Clock, 
  RotateCcw, 
  ChevronRight, 
  ChevronLeft, 
  Send,
  HelpCircle,
  Trophy,
  Sparkles,
  BookOpen,
  FileCheck,
  ZoomIn,
  Loader2,
  AlertTriangle,
  Info,
  CheckSquare,
  Square
} from "lucide-react";
import ImageZoomModal from "./ImageZoomModal";
import { ParsedAssessmentQuestion, TestAttemptRecord, ComprehensionPassage, AssessmentTestType, TopicPracticeTest } from "../types";
import { 
  saveTestAttempt, 
  getStudentNextAttemptNumber,
  getStudentTestAttempts,
  normalizeQuestionOptions,
  getAssessmentQuestionTypeLabel
} from "../utils/assessmentParser";
import {
  buildTopicTestId,
  buildChapterTestId,
  buildSubjectTestId,
  buildAssessmentTestId,
  fetchQuestions,
  getQuestionsSync,
  getPassagesForTopicSync,
  preloadQuestionImages,
  getAssessmentPracticeTestSync,
  getAssessmentPracticeTest
} from "../lib/practiceTestService";
import { fetchStudentScore } from "../lib/testScorePersistence";
import { TestTimerDisplay } from "./TestTimerDisplay";
import {
  startTestSession,
  endTestSession,
  updateTestDraft,
  loadTestDraft,
  clearTestDraft,
  saveTestDraftSync
} from "../lib/testSessionManager";
import { testDiagnostics } from "../lib/testDiagnostics";

interface StudentPracticeTestModalProps {
  isOpen?: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
  classGrade: string;
  subject: string;
  chapterNo?: number;
  chapterName?: string;
  topicName?: string; // Specific topic name OR "Full Chapter Test" OR "Subject Test"
  testType: AssessmentTestType;
  serviceStatus?: string;
  title?: string;
}

export default function StudentPracticeTestModal({
  isOpen,
  onClose,
  studentId,
  studentName,
  classGrade,
  subject,
  chapterNo,
  chapterName,
  topicName,
  testType,
  serviceStatus,
  title
}: StudentPracticeTestModalProps) {
  const normStatus = String(serviceStatus || "").toLowerCase();

  if (normStatus === "paused") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
        <div className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 rounded-2xl p-6 max-w-md w-full shadow-2xl text-center flex flex-col items-center">
          <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-950 flex items-center justify-center text-amber-600 dark:text-amber-400 mb-4">
            <XCircle className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 mb-2">Services Paused</h3>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-6">
            Your learning services are temporarily paused. Please contact the academy for assistance.
          </p>
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white font-bold text-xs cursor-pointer transition"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  if (normStatus === "ended") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
        <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 rounded-2xl p-6 max-w-md w-full shadow-2xl text-center flex flex-col items-center">
          <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950 flex items-center justify-center text-rose-600 dark:text-rose-400 mb-4">
            <XCircle className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 mb-2">Services Ended</h3>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-6">
            Your academy services have ended. Please contact the administrator if you believe this is an error.
          </p>
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white font-bold text-xs cursor-pointer transition"
          >
            Close
          </button>
        </div>
      </div>
    );
  }
  // Normalize test types & level
  const normTestType = String(testType || "topic").toLowerCase();
  const isSubjectLevel = normTestType === "subject";
  const isChapterLevel = normTestType === "chapter" || normTestType === "full_chapter";
  const resolvedAssessmentTestType: AssessmentTestType = isSubjectLevel ? "SUBJECT" : isChapterLevel ? "CHAPTER" : "TOPIC";

  const resolvedChapterNo = chapterNo ?? 0;
  const resolvedChapterName = chapterName ?? "";
  const resolvedTopicName = topicName ?? "";

  const testId = buildAssessmentTestId(classGrade, subject, resolvedChapterNo, resolvedTopicName, resolvedAssessmentTestType);

  const [testMeta, setTestMeta] = useState<TopicPracticeTest | null>(() => {
    return getAssessmentPracticeTestSync(classGrade, subject, resolvedChapterNo, resolvedTopicName, resolvedAssessmentTestType);
  });

  const durationMinutes = testMeta?.durationMinutes || testMeta?.duration_minutes;

  // Test State
  const initialQuestions = React.useMemo(() => {
    if (!isOpen) return [];
    if (testMeta && Array.isArray(testMeta.questions) && testMeta.questions.length > 0) {
      return testMeta.questions;
    }
    return getQuestionsSync(
      classGrade,
      subject,
      resolvedChapterNo,
      resolvedTopicName,
      testType,
      { publishedOnly: true }
    ) || [];
  }, [isOpen, classGrade, subject, resolvedChapterNo, resolvedTopicName, testType, testMeta]);

  const [isLoading, setIsLoading] = useState<boolean>(!initialQuestions || initialQuestions.length === 0);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<ParsedAssessmentQuestion[]>(initialQuestions || []);
  const [testStage, setTestStage] = useState<"intro" | "active" | "result">("intro");
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [zoomImage, setZoomImage] = useState<{ url: string; label?: string } | null>(null);
  const [restoredFromDraft, setRestoredFromDraft] = useState<boolean>(false);
  const [autoSubmittedByTimer, setAutoSubmittedByTimer] = useState<boolean>(false);
  const [passages, setPassages] = useState<Record<string, ComprehensionPassage>>(() => {
    return testMeta?.passages || getPassagesForTopicSync(classGrade, subject, resolvedChapterNo, resolvedTopicName);
  });
  
  // Timer State - decoupled from parent modal rendering to prevent 1-second full-page rerenders
  const [initialElapsedSeconds, setInitialElapsedSeconds] = useState(0);
  const timerSecondsRef = useRef<number>(0);

  // Result & Attempt record state
  const [lastAttemptRecord, setLastAttemptRecord] = useState<TestAttemptRecord | null>(null);
  const [attemptCount, setAttemptCount] = useState(1);
  const testStageRef = useRef<"intro" | "active" | "result">("intro");
  testStageRef.current = testStage;

  // Ref for scroll container
  const modalScrollRef = useRef<HTMLDivElement>(null);

  // Auto scroll to top when stage or question index changes
  useEffect(() => {
    if (modalScrollRef.current) {
      modalScrollRef.current.scrollTop = 0;
    }
  }, [testStage, currentQuestionIdx]);

  // Lazy image preloading: only preload images for current and immediate next question
  useEffect(() => {
    if (testStage === "active" && questions.length > 0) {
      preloadQuestionImages(questions.slice(currentQuestionIdx, currentQuestionIdx + 2), 2);
    }
  }, [testStage, currentQuestionIdx, questions]);

  // Instant open & cache performance measurement + draft recovery
  useEffect(() => {
    if (!isOpen) return;

    const openStartTime = performance.now();
    let isMounted = true;

    // Load fresh assessment metadata
    const syncMeta = getAssessmentPracticeTestSync(classGrade, subject, resolvedChapterNo, resolvedTopicName, resolvedAssessmentTestType);
    if (syncMeta) {
      setTestMeta(syncMeta);
      if (syncMeta.passages) setPassages(syncMeta.passages);
    } else {
      getAssessmentPracticeTest(classGrade, subject, resolvedChapterNo, resolvedTopicName, resolvedAssessmentTestType)
        .then((m) => {
          if (isMounted && m) {
            setTestMeta(m);
            if (m.passages) setPassages(m.passages);
          }
        })
        .catch(() => {});
    }

    // Calculate next attempt number
    const nextNum = getStudentNextAttemptNumber(
      studentId,
      classGrade,
      subject,
      resolvedChapterNo,
      resolvedTopicName,
      testType
    );
    setAttemptCount(nextNum);
    setAutoSubmittedByTimer(false);

    const applyQuestionsAndRestore = (loadedQuestions: ParsedAssessmentQuestion[]) => {
      setQuestions(loadedQuestions);
      setIsLoading(false);
      setFetchError(null);

      // Lazy preload: only first 2 questions
      preloadQuestionImages(loadedQuestions.slice(0, 2), 2);

      // Check for crash recovery / existing draft from interrupted attempt
      const draft = loadTestDraft(undefined, studentId, testId, nextNum);
      if (draft && draft.userAnswers && Object.keys(draft.userAnswers).length > 0) {
        console.log(`[TestSession] Restoring interrupted draft attempt for testId: ${testId}`);
        setUserAnswers(draft.userAnswers);
        const safeIdx = Math.min(Math.max(0, draft.currentQuestionIdx || 0), Math.max(0, loadedQuestions.length - 1));
        setCurrentQuestionIdx(safeIdx);
        setInitialElapsedSeconds(draft.elapsedSeconds || 0);
        timerSecondsRef.current = draft.elapsedSeconds || 0;
        setRestoredFromDraft(true);
        setTestStage("active");

        startTestSession({
          testId,
          studentId,
          studentName,
          attemptNumber: nextNum,
          questions: loadedQuestions,
          totalQuestions: loadedQuestions.length
        });
        testDiagnostics.recordCrashRecovery();
      } else {
        setTestStage("intro");
        setCurrentQuestionIdx(0);
        setUserAnswers({});
        setInitialElapsedSeconds(0);
        timerSecondsRef.current = 0;
        setRestoredFromDraft(false);
      }
    };

    // 1. Check synchronous in-memory cache first
    const cached = syncMeta?.questions?.length 
      ? syncMeta.questions 
      : getQuestionsSync(
          classGrade,
          subject,
          resolvedChapterNo,
          resolvedTopicName,
          testType,
          { publishedOnly: true }
        );

    if (cached && cached.length > 0) {
      const durationMs = Math.round(performance.now() - openStartTime);
      console.log(`[PracticeTest] Cache Hit: ${testId} (${durationMs}ms)`);
      applyQuestionsAndRestore(cached);

      // Fetch student score history in background without blocking UI
      if (studentId) {
        fetchStudentScore(studentId, classGrade, subject, resolvedChapterNo, resolvedTopicName, testType)
          .then((studentScore) => {
            if (isMounted && studentScore && testStageRef.current !== "result") {
              setLastAttemptRecord(studentScore);
            }
          })
          .catch(() => {});
      }
    } else {
      // 2. Cache Miss (rare): Fetch in background
      setIsLoading(true);
      setFetchError(null);

      fetchQuestions(classGrade, subject, resolvedChapterNo, resolvedTopicName, testType, { publishedOnly: true })
        .then((qList) => {
          if (!isMounted) return;
          if (Array.isArray(qList) && qList.length > 0) {
            applyQuestionsAndRestore(qList);
          } else {
            setQuestions([]);
            setFetchError("No assessment questions found for this test yet.");
            setIsLoading(false);
          }
        })
        .catch((err) => {
          if (!isMounted) return;
          console.warn("[StudentPracticeTestModal] Error loading test questions on cache miss:", err);
          setFetchError("Unable to load Assessment Test. Please try again.");
          setIsLoading(false);
        });

      if (studentId) {
        fetchStudentScore(studentId, classGrade, subject, resolvedChapterNo, resolvedTopicName, testType)
          .then((studentScore) => {
            if (isMounted && studentScore && testStageRef.current !== "result") {
              setLastAttemptRecord(studentScore);
            }
          })
          .catch(() => {});
      }
    }

    return () => {
      isMounted = false;
      if (testStageRef.current === "active") {
        saveTestDraftSync();
        endTestSession();
      }
    };
  }, [isOpen, studentId, classGrade, subject, resolvedChapterNo, resolvedTopicName, testType, testId]);

  if (!isOpen) return null;

  const handleStartTest = () => {
    if (questions.length === 0) return;
    const nextAttempt = testStage === "result" ? attemptCount + 1 : attemptCount;
    setAttemptCount(nextAttempt);
    startTestSession({
      testId,
      studentId,
      studentName,
      attemptNumber: nextAttempt,
      questions,
      totalQuestions: questions.length
    });
    setTestStage("active");
    setCurrentQuestionIdx(0);
    setUserAnswers({});
    setInitialElapsedSeconds(0);
    timerSecondsRef.current = 0;
    setRestoredFromDraft(false);
    setAutoSubmittedByTimer(false);
    updateTestDraft({ userAnswers: {}, currentQuestionIdx: 0, elapsedSeconds: 0 });
  };

  const handleSelectAnswer = (questionId: string, answerKey: string) => {
    const nextAnswers = {
      ...userAnswers,
      [questionId]: answerKey
    };
    setUserAnswers(nextAnswers);
    updateTestDraft({
      userAnswers: nextAnswers,
      currentQuestionIdx,
      elapsedSeconds: timerSecondsRef.current
    });
  };

  const handleToggleMultipleSelect = (questionId: string, optionLetter: string) => {
    const currentVal = userAnswers[questionId] || "";
    let selected = currentVal.split(/[, ]+/).filter(Boolean).map(s => s.trim().toUpperCase());
    const target = optionLetter.trim().toUpperCase();
    if (selected.includes(target)) {
      selected = selected.filter(s => s !== target);
    } else {
      selected.push(target);
    }
    selected.sort();
    const nextAns = selected.join(", ");
    handleSelectAnswer(questionId, nextAns);
  };

  const handleNextQuestion = () => {
    if (currentQuestionIdx < questions.length - 1) {
      const nextIdx = currentQuestionIdx + 1;
      setCurrentQuestionIdx(nextIdx);
      updateTestDraft({
        currentQuestionIdx: nextIdx,
        elapsedSeconds: timerSecondsRef.current
      });
    }
  };

  const handlePrevQuestion = () => {
    if (currentQuestionIdx > 0) {
      const prevIdx = currentQuestionIdx - 1;
      setCurrentQuestionIdx(prevIdx);
      updateTestDraft({
        currentQuestionIdx: prevIdx,
        elapsedSeconds: timerSecondsRef.current
      });
    }
  };

  const handlePeriodicAutosave = (secs: number) => {
    if (testStageRef.current === "active") {
      updateTestDraft({
        elapsedSeconds: secs
      });
    }
  };

  const handleClose = () => {
    if (testStage === "active") {
      updateTestDraft({
        userAnswers,
        currentQuestionIdx,
        elapsedSeconds: timerSecondsRef.current
      });
      saveTestDraftSync();
      endTestSession();
    }
    onClose();
  };

  const handleSubmitTest = (isAutoSubmittedByTimer: boolean = false) => {
    if (isAutoSubmittedByTimer) {
      setAutoSubmittedByTimer(true);
    }
    const finalElapsedSeconds = timerSecondsRef.current;
    let correctCount = 0;
    let wrongCount = 0;
    let unattemptedCount = 0;
    let totalMarksAwarded = 0;
    let totalPossibleMarks = 0;

    const questionScores: Record<string, {
      marks: number;
      maxMarks: number;
      isCorrect: boolean;
      type: import("../types").AssessmentQuestionType;
      studentAnswer?: string;
      correctAnswer?: string;
      modelAnswer?: string;
      feedback?: string;
      status?: "evaluated" | "pending_review";
    }> = {};

    questions.forEach((q) => {
      const qMaxMarks = typeof q.marks === "number" && q.marks > 0 ? q.marks : 1;
      totalPossibleMarks += qMaxMarks;

      const studentAns = userAnswers[q.id];
      const isSubjective = (!q.options || q.options.length === 0) || 
        ["very_short_answer", "short_answer", "long_answer"].includes(q.type);

      if (!studentAns || studentAns.trim() === "") {
        unattemptedCount++;
        questionScores[q.id] = {
          marks: 0,
          maxMarks: qMaxMarks,
          isCorrect: false,
          type: q.type,
          studentAnswer: "",
          correctAnswer: q.correctAnswer || q.modelAnswer || "",
          modelAnswer: q.modelAnswer || q.correctAnswer || "",
          status: "evaluated"
        };
        return;
      }

      let isCorrect = false;
      let awardedMarks = 0;

      if (q.type === "true_false") {
        isCorrect = studentAns.toLowerCase().trim() === q.correctAnswer.toLowerCase().trim();
      } else if (isSubjective) {
        const expected = (q.correctAnswer || q.modelAnswer || "").trim().toLowerCase();
        const studentClean = studentAns.trim().toLowerCase();

        if (expected && (studentClean === expected || (expected.length < 60 && studentClean.includes(expected)))) {
          isCorrect = true;
          awardedMarks = qMaxMarks;
        } else if (expected) {
          const expectedWords = expected.split(/\s+/).filter(w => w.length > 3);
          const matchedWords = expectedWords.filter(w => studentClean.includes(w));
          const matchRatio = expectedWords.length > 0 ? (matchedWords.length / expectedWords.length) : 0;

          if (matchRatio >= 0.6) {
            isCorrect = true;
            awardedMarks = qMaxMarks;
          } else if (matchRatio >= 0.3) {
            awardedMarks = Math.round(qMaxMarks * 0.5 * 10) / 10;
            isCorrect = false;
          } else {
            isCorrect = false;
            awardedMarks = 0;
          }
        } else {
          isCorrect = studentClean.length > 5;
          awardedMarks = isCorrect ? qMaxMarks : 0;
        }
      } else if (q.type === "multiple_select") {
        const studentSet = studentAns.toUpperCase().split(/[, ]+/).filter(Boolean).sort().join(",");
        const correctSet = q.correctAnswer.toUpperCase().split(/[, ]+/).filter(Boolean).sort().join(",");
        isCorrect = studentSet === correctSet;
      } else {
        const corrNorm = q.correctAnswer.trim().toLowerCase();
        const studentNorm = studentAns.trim().toLowerCase();
        const optChar = studentNorm.charAt(0);
        const corrChar = corrNorm.charAt(0);
        isCorrect = optChar === corrChar || studentNorm === corrNorm || studentNorm.startsWith(corrNorm);
      }

      if (!isSubjective) {
        if (isCorrect) {
          awardedMarks = qMaxMarks;
        } else if (q.negativeMarks && q.negativeMarks > 0) {
          awardedMarks = -q.negativeMarks;
        } else {
          awardedMarks = 0;
        }
      }

      if (isCorrect) {
        correctCount++;
      } else {
        wrongCount++;
      }

      totalMarksAwarded += awardedMarks;

      questionScores[q.id] = {
        marks: awardedMarks,
        maxMarks: qMaxMarks,
        isCorrect,
        type: q.type,
        studentAnswer: studentAns,
        correctAnswer: q.correctAnswer || q.modelAnswer || "",
        modelAnswer: q.modelAnswer || q.correctAnswer || "",
        status: isSubjective && !isCorrect ? "pending_review" : "evaluated"
      };
    });

    const totalQuestions = questions.length;
    const totalMarks = testMeta?.totalMarks && testMeta.totalMarks > 0 ? testMeta.totalMarks : (totalPossibleMarks || totalQuestions);
    const score = Math.max(0, Math.round(totalMarksAwarded * 10) / 10);
    const percentage = totalMarks > 0 ? Math.min(100, Math.max(0, Math.round((score / totalMarks) * 100))) : 0;
    const passingMarks = testMeta?.passingMarks;
    const isPassed = passingMarks != null ? (score >= passingMarks) : percentage >= 40;

    const formattedDate = new Date().toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });

    const topicId = (resolvedTopicName || "").toLowerCase().replace(/[^a-z0-9]/g, "_");
    const chapterId = `ch_${resolvedChapterNo}`;
    const subjectId = (subject || "").toLowerCase().replace(/\s+/g, "_");

    const attemptRecord: TestAttemptRecord = {
      id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      studentId,
      studentName,
      testId,
      topicId,
      chapterId,
      subjectId,
      classGrade,
      subject,
      chapterNo: resolvedChapterNo,
      chapterName: resolvedChapterName,
      topicName: isSubjectLevel ? `${subject} Subject Test` : isChapterLevel ? `Chapter ${resolvedChapterNo} Test` : resolvedTopicName,
      testType: resolvedAssessmentTestType,
      attemptNumber: attemptCount,
      date: formattedDate,
      timestamp: Date.now(),
      timeTakenSeconds: finalElapsedSeconds,
      score,
      totalMarks,
      passingMarks,
      isPassed,
      totalQuestions,
      percentage,
      correctAnswersCount: correctCount,
      wrongAnswersCount: wrongCount,
      unattemptedCount,
      userAnswers,
      questionScores
    };

    saveTestAttempt(attemptRecord);
    clearTestDraft(undefined, studentId, testId, attemptCount);
    endTestSession();
    setLastAttemptRecord(attemptRecord);
    setTestStage("result");
  };

  const currentQuestion = questions[currentQuestionIdx];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/80 backdrop-blur-sm animate-fadeIn overflow-hidden">
      <div className="relative w-full max-w-3xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[92vh] sm:max-h-[90vh] overflow-hidden">
        
        {/* Compact Mobile Header */}
        <div className="px-3.5 py-2.5 sm:px-6 sm:py-3 bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-700 text-white flex items-center justify-between shrink-0 min-h-[72px] sm:min-h-[84px] shadow-md border-b border-blue-700/50">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1 pr-2">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-white/15 dark:bg-white/20 backdrop-blur-md rounded-xl border border-white/20 shrink-0 flex items-center justify-center">
              {isSubjectLevel || isChapterLevel ? (
                <Trophy className="w-4 h-4 sm:w-5 sm:h-5 text-amber-300" />
              ) : (
                <BookOpen className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              )}
            </div>
            <div className="min-w-0 flex-1 flex flex-col justify-center">
              <p className="text-[11px] sm:text-xs font-semibold leading-tight text-blue-100 uppercase tracking-wider">
                {isSubjectLevel ? "Subject Assessment" : isChapterLevel ? "Chapter Assessment" : "Topic Practice Test"}
              </p>
              <h2 className="text-xs sm:text-sm font-bold leading-snug text-white mt-0.5 break-words whitespace-normal max-w-full">
                {testMeta?.title || title || (isSubjectLevel ? `${subject} Assessment` : isChapterLevel ? `Chapter ${resolvedChapterNo}: ${resolvedChapterName}` : resolvedTopicName)}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <TestTimerDisplay
              isActive={testStage === "active"}
              initialSeconds={initialElapsedSeconds}
              timerSecondsRef={timerSecondsRef}
              durationMinutes={durationMinutes}
              onTimeExpired={() => {
                handleSubmitTest(true);
              }}
              onPeriodicAutosave={handlePeriodicAutosave}
            />
            <button
              onClick={handleClose}
              className="w-7 h-7 sm:w-8 sm:h-8 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition cursor-pointer shrink-0"
              title="Close"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body - overflow-x-hidden and touch-pan-y ensure smooth non-wobble vertical scrolling */}
        <div ref={modalScrollRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 scrollbar-thin touch-pan-y">
          
          {/* INTRO STAGE */}
          {testStage === "intro" && (
            <div className="text-center py-4 sm:py-6 space-y-5 max-w-lg mx-auto">
              <div className="p-4 bg-indigo-50 dark:bg-indigo-950/40 rounded-full w-16 h-16 sm:w-20 sm:h-20 mx-auto flex items-center justify-center border border-indigo-200 dark:border-indigo-800 shadow-sm">
                {isSubjectLevel || isChapterLevel ? (
                  <Trophy className="w-8 h-8 sm:w-10 sm:h-10 text-amber-500" />
                ) : (
                  <FileCheck className="w-8 h-8 sm:w-10 sm:h-10 text-indigo-600 dark:text-indigo-400" />
                )}
              </div>

              <div>
                <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-slate-100 break-words max-w-full px-1">
                  {testMeta?.title || title || (isSubjectLevel ? `${subject} Assessment` : isChapterLevel ? `Chapter ${resolvedChapterNo}: ${resolvedChapterName}` : resolvedTopicName)}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 break-words">
                  [{classGrade}] {subject} {isChapterLevel ? `• Ch ${resolvedChapterNo}: ${resolvedChapterName}` : ""}
                </p>
              </div>

              {isLoading ? (
                <div className="py-8 flex flex-col items-center justify-center gap-3">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                </div>
              ) : fetchError ? (
                <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-300 text-xs font-semibold">
                  {fetchError}
                </div>
              ) : questions.length === 0 ? (
                <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-300 text-xs font-semibold">
                  No Practice Test Available.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="p-2.5 sm:p-3 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Questions</p>
                      <p className="text-base sm:text-lg font-black text-slate-900 dark:text-slate-100">{questions.length}</p>
                    </div>
                    <div className="p-2.5 sm:p-3 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Total Marks</p>
                      <p className="text-base sm:text-lg font-black text-slate-900 dark:text-slate-100">{testMeta?.totalMarks || questions.length}</p>
                    </div>
                    <div className="p-2.5 sm:p-3 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Duration</p>
                      <p className="text-base sm:text-lg font-black text-indigo-600 dark:text-indigo-400">
                        {durationMinutes ? `${durationMinutes}m` : "No limit"}
                      </p>
                    </div>
                    <div className="p-2.5 sm:p-3 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Attempt</p>
                      <p className="text-base sm:text-lg font-black text-blue-600 dark:text-blue-400">
                        #{attemptCount} {testMeta?.maxAttempts ? `/ ${testMeta.maxAttempts}` : ""}
                      </p>
                    </div>
                  </div>

                  {testMeta?.passingMarks != null && (
                    <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-purple-900 dark:text-purple-200 text-xs font-semibold flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Award className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                        <span>Passing Criteria:</span>
                      </span>
                      <span className="font-bold">{testMeta.passingMarks} Marks to Pass</span>
                    </div>
                  )}

                  {testMeta?.instructions && (
                    <div className="text-left p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-1">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                        <Info className="w-3.5 h-3.5 text-blue-500" />
                        <span>Instructions:</span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-line leading-relaxed">
                        {testMeta.instructions}
                      </p>
                    </div>
                  )}

                  {testMeta?.maxAttempts && attemptCount > testMeta.maxAttempts ? (
                    <div className="p-3.5 bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 rounded-xl text-amber-900 dark:text-amber-200 text-xs font-semibold flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Maximum attempts reached ({testMeta.maxAttempts} of {testMeta.maxAttempts}). You cannot retake this test.</span>
                    </div>
                  ) : (
                    <button
                      onClick={handleStartTest}
                      className="w-full py-3 sm:py-3.5 bg-blue-600 hover:bg-blue-500 active:scale-98 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-blue-900/30 transition-all cursor-pointer flex items-center justify-center gap-2"
                    >
                      <span>Start Test Now</span>
                      <ChevronRight className="w-4 h-4 stroke-[3]" />
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* ACTIVE TEST STAGE */}
          {testStage === "active" && currentQuestion && (
            <div className="space-y-4">
              
              {/* Question Navigation Header - Wrapped to prevent overflow */}
              <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 pb-2.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-[11px] sm:text-xs font-extrabold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/80 border border-blue-100 dark:border-blue-900/50 px-2.5 py-1 rounded-lg">
                  Question {currentQuestionIdx + 1} of {questions.length}
                </span>
                <span className="text-[11px] sm:text-xs font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2.5 py-1 rounded-lg">
                  {getAssessmentQuestionTypeLabel(currentQuestion.type, currentQuestion.passageId)}
                </span>
                <span className="text-[11px] sm:text-xs font-black text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200 dark:border-indigo-800 px-2.5 py-1 rounded-lg">
                  {currentQuestion.marks ?? 1} {((currentQuestion.marks ?? 1) === 1) ? "Mark" : "Marks"}
                </span>
                <span className="text-[11px] sm:text-xs font-extrabold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2.5 py-1 rounded-lg">
                  {Object.keys(userAnswers).length} / {questions.length} Answered
                </span>
              </div>

              {restoredFromDraft && (
                <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300 text-xs font-semibold flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span>Interrupted test session recovered. Your previous answers and timer have been restored.</span>
                </div>
              )}

              {/* Comprehension Reading Passage (Linked once and rendered for all connected questions) */}
              {currentQuestion.passageId && (
                <div className="p-4 sm:p-5 rounded-xl bg-indigo-50/90 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800/80 text-slate-800 dark:text-slate-200 space-y-2.5 shadow-2xs">
                  <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300 font-extrabold text-xs uppercase tracking-wider">
                    <BookOpen className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <span>{passages[currentQuestion.passageId]?.title || "Reading Passage"}</span>
                  </div>
                  {passages[currentQuestion.passageId]?.text ? (
                    <div className="text-xs sm:text-sm leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-line bg-white/80 dark:bg-slate-900/70 p-3.5 sm:p-4 rounded-lg border border-indigo-100 dark:border-indigo-900/60 font-normal shadow-2xs">
                      {passages[currentQuestion.passageId].text}
                    </div>
                  ) : (
                    <div className="text-xs italic text-indigo-600 dark:text-indigo-400">
                      Reading passage reference linked to this question.
                    </div>
                  )}
                </div>
              )}

              {/* Question Card - Clear & Balanced Typography */}
              <div className="p-4 sm:p-5 rounded-xl bg-slate-50/90 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 my-2 shadow-2xs space-y-3">
                {/* IMAGE ABOVE QUESTION IF imagePosition IS 'above' */}
                {currentQuestion.imageUrl && currentQuestion.imagePosition === "above" && (
                  <div
                    className="text-center pb-2 cursor-pointer group"
                    onClick={() => setZoomImage({ url: currentQuestion.imageUrl!, label: currentQuestion.imageLabel || currentQuestion.question })}
                  >
                    <div className="relative inline-block max-w-full">
                      <img
                        src={currentQuestion.imageUrl}
                        referrerPolicy="no-referrer"
                        alt="Question Diagram"
                        className="max-h-72 max-w-full rounded-xl border border-slate-200 dark:border-slate-700 object-contain mx-auto shadow-sm group-hover:scale-[1.01] transition-transform"
                      />
                      <div className="absolute bottom-2 right-2 bg-slate-900/80 text-white text-[10px] font-bold px-2 py-1 rounded-lg backdrop-blur-xs flex items-center gap-1 shadow-sm">
                        <ZoomIn className="w-3 h-3 text-blue-400" />
                        <span>Tap to Zoom</span>
                      </div>
                    </div>
                    {currentQuestion.imageLabel && (
                      <p className="text-[11px] font-semibold text-slate-500 mt-1.5">
                        Diagram: {currentQuestion.imageLabel}
                      </p>
                    )}
                  </div>
                )}

                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 leading-snug sm:leading-relaxed whitespace-pre-line break-words">
                  {currentQuestion.question}
                </h3>

                {/* IMAGE BELOW QUESTION IF imagePosition IS 'below' OR DEFAULT */}
                {currentQuestion.imageUrl && currentQuestion.imagePosition !== "above" ? (
                  <div
                    className="text-center pt-2 cursor-pointer group"
                    onClick={() => setZoomImage({ url: currentQuestion.imageUrl!, label: currentQuestion.imageLabel || currentQuestion.question })}
                  >
                    <div className="relative inline-block max-w-full">
                      <img
                        src={currentQuestion.imageUrl}
                        referrerPolicy="no-referrer"
                        alt="Question Diagram"
                        className="max-h-72 max-w-full rounded-xl border border-slate-200 dark:border-slate-700 object-contain mx-auto shadow-sm group-hover:scale-[1.01] transition-transform"
                      />
                      <div className="absolute bottom-2 right-2 bg-slate-900/80 text-white text-[10px] font-bold px-2 py-1 rounded-lg backdrop-blur-xs flex items-center gap-1 shadow-sm">
                        <ZoomIn className="w-3 h-3 text-blue-400" />
                        <span>Tap to Zoom</span>
                      </div>
                    </div>
                    {currentQuestion.imageLabel && (
                      <p className="text-[11px] font-semibold text-slate-500 mt-1.5">
                        Diagram: {currentQuestion.imageLabel}
                      </p>
                    )}
                  </div>
                ) : !currentQuestion.imageUrl && currentQuestion.imageLabel ? (
                  <div className="p-2.5 rounded-lg bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-900/60 text-blue-700 dark:text-blue-300 text-xs font-bold flex items-center justify-center gap-1.5">
                    <span>Diagram Reference: {currentQuestion.imageLabel}</span>
                  </div>
                ) : null}
              </div>

              {/* Options Section */}
              <div className="my-3">
                {(() => {
                  const studentAns = userAnswers[currentQuestion.id];
                  const hasAnswered = studentAns !== undefined && studentAns !== null && studentAns !== "";
                  const isSubjective = (!currentQuestion.options || currentQuestion.options.length === 0) || 
                    ["very_short_answer", "short_answer", "long_answer"].includes(currentQuestion.type);
                  const isMultipleSelect = currentQuestion.type === "multiple_select";
                  const isTrueFalse = currentQuestion.type === "true_false";

                  if (isSubjective) {
                    const charCount = (studentAns || "").length;
                    const wordCount = (studentAns || "").trim() ? (studentAns || "").trim().split(/\s+/).length : 0;

                    return (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                          <span className="font-bold flex items-center gap-1 text-indigo-600 dark:text-indigo-400">
                            <Info className="w-3.5 h-3.5" />
                            {currentQuestion.type === "very_short_answer" 
                              ? "Very Short Answer (1-2 sentences)" 
                              : currentQuestion.type === "short_answer" 
                              ? "Short Answer (30-50 words recommended)" 
                              : "Detailed Long Answer (Key points & explanation)"}
                          </span>
                          <span className="text-[11px] font-semibold">
                            {wordCount} words • {charCount} chars
                          </span>
                        </div>

                        <textarea
                          rows={currentQuestion.type === "long_answer" ? 6 : currentQuestion.type === "short_answer" ? 4 : 3}
                          value={studentAns || ""}
                          onChange={(e) => handleSelectAnswer(currentQuestion.id, e.target.value)}
                          placeholder={
                            currentQuestion.type === "very_short_answer"
                              ? "Write your direct answer here..."
                              : currentQuestion.type === "long_answer"
                              ? "Type your detailed explanation with headings or bullet points here..."
                              : "Type your answer here..."
                          }
                          className="w-full p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-medium text-xs sm:text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none leading-relaxed transition-all"
                        />

                        <div className="flex items-center justify-between text-[11px] px-1">
                          <div className="flex items-center gap-1.5 font-bold">
                            {hasAnswered ? (
                              <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Answer Recorded
                              </span>
                            ) : (
                              <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                <HelpCircle className="w-3.5 h-3.5" /> Pending Response
                              </span>
                            )}
                          </div>
                          {currentQuestion.rubric && (
                            <span className="text-slate-500 dark:text-slate-400 italic">
                              Rubric: {currentQuestion.rubric}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  }

                  if (isMultipleSelect) {
                    const selectedList = (studentAns || "").toUpperCase().split(/[, ]+/).filter(Boolean);
                    const currentOptions = normalizeQuestionOptions(currentQuestion.options);

                    return (
                      <div className="space-y-2.5">
                        <div className="p-2.5 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-[11px] font-bold text-indigo-800 dark:text-indigo-300 flex items-center gap-2">
                          <Info className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                          <span>Multiple Correct Options: You can select one or more options.</span>
                        </div>

                        {currentOptions.map((opt, oIdx) => {
                          const letter = opt.charAt(0).toUpperCase();
                          const isSelected = selectedList.includes(letter);

                          return (
                            <button
                              key={oIdx}
                              type="button"
                              onClick={() => handleToggleMultipleSelect(currentQuestion.id, letter)}
                              className={`w-full min-h-[48px] p-3 sm:p-3.5 rounded-xl text-left text-xs sm:text-sm font-semibold transition-all border flex items-start sm:items-center justify-between gap-2.5 cursor-pointer ${
                                isSelected
                                  ? "bg-indigo-50 dark:bg-indigo-950/70 border-indigo-500 text-indigo-900 dark:text-indigo-200 font-bold ring-2 ring-indigo-500/30"
                                  : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-indigo-300"
                              }`}
                            >
                              <span className="flex-1 break-words leading-snug">{opt}</span>
                              <div className="shrink-0 mt-0.5 sm:mt-0">
                                {isSelected ? (
                                  <CheckSquare className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                                ) : (
                                  <Square className="w-5 h-5 text-slate-300 dark:text-slate-600" />
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    );
                  }

                  const isOptionCorrect = (optValue: string) => {
                    const corrNorm = currentQuestion.correctAnswer.trim().toLowerCase();
                    const optNorm = optValue.trim().toLowerCase();
                    const optChar = optNorm.charAt(0);
                    const corrChar = corrNorm.charAt(0);
                    return optChar === corrChar || optNorm.startsWith(corrNorm) || corrNorm.startsWith(optNorm);
                  };

                  const isStudentCorrect = hasAnswered && isOptionCorrect(studentAns);
                  const currentOptions = !isTrueFalse
                    ? normalizeQuestionOptions(currentQuestion.options)
                    : currentQuestion.options;

                  return (
                    <>
                      {!isTrueFalse ? (
                        <div className="space-y-2.5">
                          {currentOptions.map((opt, oIdx) => {
                            const letter = opt.charAt(0);
                            const isThisSelected = studentAns === letter;
                            const isThisCorrect = isOptionCorrect(letter);

                            let btnStyle = "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-blue-300";
                            let badge = null;

                            if (hasAnswered) {
                              if (isThisSelected) {
                                if (isThisCorrect) {
                                  btnStyle = "bg-emerald-50 dark:bg-emerald-950/70 border-emerald-500 text-emerald-900 dark:text-emerald-200 font-bold ring-2 ring-emerald-500/30";
                                  badge = (
                                    <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-1 shrink-0">
                                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                      <span>Correct!</span>
                                    </span>
                                  );
                                } else {
                                  btnStyle = "bg-rose-50 dark:bg-rose-950/70 border-rose-500 text-rose-900 dark:text-rose-200 font-bold ring-2 ring-rose-500/30";
                                  badge = (
                                    <span className="text-xs font-black text-rose-600 dark:text-rose-400 flex items-center gap-1 shrink-0">
                                      <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                                      <span>Incorrect</span>
                                    </span>
                                  );
                                }
                              } else if (isThisCorrect) {
                                btnStyle = "bg-emerald-50/90 dark:bg-emerald-950/60 border-emerald-500 text-emerald-900 dark:text-emerald-200 font-bold ring-2 ring-emerald-500/30";
                                badge = (
                                  <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-1 shrink-0">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                    <span>Correct Answer</span>
                                  </span>
                                );
                              } else {
                                btnStyle = "opacity-40 bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-400";
                              }
                            } else if (isThisSelected) {
                              btnStyle = "bg-blue-600 text-white border-blue-600 font-bold shadow-sm";
                            }

                            return (
                              <button
                                key={oIdx}
                                type="button"
                                onClick={() => handleSelectAnswer(currentQuestion.id, letter)}
                                className={`w-full min-h-[48px] p-3 sm:p-3.5 rounded-xl text-left text-xs sm:text-sm font-semibold transition-all border flex items-start sm:items-center justify-between gap-2.5 cursor-pointer ${btnStyle}`}
                              >
                                <span className="flex-1 break-words leading-snug">{opt}</span>
                                {badge ? (
                                  badge
                                ) : (
                                  <div className={`w-4 h-4 sm:w-5 sm:h-5 rounded-full border flex items-center justify-center shrink-0 mt-0.5 sm:mt-0 ${isThisSelected ? "border-white bg-white/20" : "border-slate-300 dark:border-slate-600"}`} />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                          {["True", "False"].map((tfVal) => {
                            const isThisSelected = studentAns === tfVal;
                            const isThisCorrect = isOptionCorrect(tfVal);

                            let btnStyle = "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-blue-300";
                            let icon = null;

                            if (hasAnswered) {
                              if (isThisSelected) {
                                if (isThisCorrect) {
                                  btnStyle = "bg-emerald-600 text-white border-emerald-600 shadow-md font-black";
                                  icon = <CheckCircle2 className="w-4 h-4 text-white shrink-0" />;
                                } else {
                                  btnStyle = "bg-rose-600 text-white border-rose-600 shadow-md font-black";
                                  icon = <XCircle className="w-4 h-4 text-white shrink-0" />;
                                }
                              } else if (isThisCorrect) {
                                btnStyle = "bg-emerald-100 dark:bg-emerald-950/80 border-emerald-500 text-emerald-800 dark:text-emerald-200 font-extrabold ring-2 ring-emerald-500/40";
                                icon = <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />;
                              } else {
                                btnStyle = "opacity-40 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400";
                              }
                            } else if (isThisSelected) {
                              btnStyle = "bg-blue-600 text-white border-blue-600 shadow-md font-black";
                            }

                            return (
                              <button
                                key={tfVal}
                                type="button"
                                onClick={() => handleSelectAnswer(currentQuestion.id, tfVal)}
                                className={`h-11 sm:h-12 px-3 rounded-xl font-bold text-sm sm:text-base transition-all border flex items-center justify-center gap-2 cursor-pointer ${btnStyle}`}
                              >
                                <span>{tfVal}</span>
                                {icon}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Instant Answer Feedback Callout Banner */}
                      {hasAnswered && (
                        <div className={`p-3 sm:p-3.5 rounded-xl border flex flex-col gap-2 font-bold text-xs sm:text-sm mt-3 ${
                          isStudentCorrect
                            ? "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200"
                            : "bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200"
                        }`}>
                          <div className="flex items-center gap-2.5">
                            {isStudentCorrect ? (
                              <>
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                <div>
                                  <p className="font-extrabold text-xs sm:text-sm text-emerald-700 dark:text-emerald-300">Correct!</p>
                                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">Great job! You selected the right answer.</p>
                                </div>
                              </>
                            ) : (
                              <>
                                <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                                <div>
                                  <p className="font-extrabold text-xs sm:text-sm text-rose-700 dark:text-rose-300">Incorrect</p>
                                  <p className="text-[11px] text-rose-700 dark:text-rose-300 font-medium">
                                    Correct Answer: <span className="font-black underline">{currentQuestion.correctAnswer}</span>
                                  </p>
                                </div>
                              </>
                            )}
                          </div>
                          {currentQuestion.explanation && (
                            <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/60 text-[11px] font-normal text-slate-700 dark:text-slate-300 leading-relaxed">
                              <span className="font-bold">Explanation: </span>
                              {currentQuestion.explanation}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* Bottom Navigation Buttons */}
              <div className="grid grid-cols-2 gap-2.5 sm:gap-4 pt-3 mt-4 border-t border-slate-200 dark:border-slate-800">
                <button
                  disabled={currentQuestionIdx === 0}
                  onClick={handlePrevQuestion}
                  className="h-11 sm:h-12 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-bold text-xs sm:text-sm hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1 transition-all"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Previous</span>
                </button>

                {currentQuestionIdx < questions.length - 1 ? (
                  <button
                    onClick={handleNextQuestion}
                    className="h-11 sm:h-12 bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xs sm:text-sm rounded-xl shadow-sm transition-all cursor-pointer flex items-center justify-center gap-1"
                  >
                    <span>Next Question</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => handleSubmitTest(false)}
                    className="h-11 sm:h-12 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs sm:text-sm uppercase tracking-wider rounded-xl shadow-md shadow-emerald-900/20 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Send className="w-4 h-4" />
                    <span>Submit Test</span>
                  </button>
                )}
              </div>

            </div>
          )}

          {/* RESULT STAGE */}
          {testStage === "result" && lastAttemptRecord && (
            <div className="space-y-5">
              
              {/* Timer auto-submit indicator */}
              {autoSubmittedByTimer && (
                <div className="p-3 bg-amber-500/20 border border-amber-400/40 rounded-xl text-amber-200 text-xs font-bold flex items-center justify-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Time Expired! Your test was automatically submitted when the countdown reached 0:00.</span>
                </div>
              )}

              {/* Score Header Card */}
              <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-850 to-slate-900 bg-slate-900 text-white text-center shadow-xl border border-slate-700/80 relative overflow-hidden">
                <div className="p-2.5 bg-amber-500/20 rounded-full w-12 h-12 mx-auto mb-2 flex items-center justify-center border border-amber-400/30">
                  <Award className="w-6 h-6 text-amber-400" />
                </div>

                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-400">
                  {isSubjectLevel ? "Subject Assessment Result" : isChapterLevel ? "Chapter Assessment Result" : "Topic Practice Result"}
                </p>
                <h3 className="text-xs sm:text-sm font-bold text-slate-100 mt-0.5 break-words whitespace-normal max-w-full">
                  {testMeta?.title || title || (isSubjectLevel ? `${subject} Assessment` : isChapterLevel ? `Chapter ${resolvedChapterNo}: ${resolvedChapterName}` : resolvedTopicName)}
                </h3>

                {/* Score & Percentage Display */}
                <div className="my-3 p-3 sm:p-4 rounded-xl bg-slate-950/90 border border-amber-400/40 shadow-inner max-w-md mx-auto">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">
                    Marks Obtained
                  </div>
                  <div className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                    {lastAttemptRecord.score} / {lastAttemptRecord.totalMarks || lastAttemptRecord.totalQuestions}
                  </div>
                  <div className="text-xl font-black text-amber-300 mt-0.5">
                    {lastAttemptRecord.percentage}%
                  </div>

                  {lastAttemptRecord.passingMarks != null && (
                    <div className="mt-2.5 pt-2 border-t border-slate-800 flex items-center justify-center">
                      {lastAttemptRecord.isPassed ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-xs">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          PASSED (Passing: {lastAttemptRecord.passingMarks} Marks)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-xs">
                          <XCircle className="w-3.5 h-3.5 text-rose-400" />
                          NEEDS IMPROVEMENT (Passing: {lastAttemptRecord.passingMarks} Marks)
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 mt-3 text-xs font-bold text-slate-200 border-t border-slate-800/80 pt-3">
                  <div className="px-2.5 py-1 bg-emerald-950/90 text-emerald-300 rounded-lg border border-emerald-500/40 font-bold shadow-xs flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Correct: {lastAttemptRecord.correctAnswersCount}</span>
                  </div>
                  <div className="px-2.5 py-1 bg-rose-950/90 text-rose-300 rounded-lg border border-rose-500/40 font-bold shadow-xs flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    <span>Wrong: {lastAttemptRecord.wrongAnswersCount}</span>
                  </div>
                  <div className="px-2.5 py-1 bg-amber-950/90 text-amber-300 rounded-lg border border-amber-500/40 font-bold shadow-xs flex items-center gap-1">
                    <HelpCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>Not Attempted: {lastAttemptRecord.unattemptedCount ?? (lastAttemptRecord.totalQuestions - lastAttemptRecord.correctAnswersCount - lastAttemptRecord.wrongAnswersCount)}</span>
                  </div>
                  <div className="px-2.5 py-1 bg-slate-800 text-blue-300 rounded-lg border border-blue-500/40 font-bold shadow-xs flex items-center gap-1">
                    <Trophy className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                    <span>Attempt #{lastAttemptRecord.attemptNumber}</span>
                  </div>
                </div>
              </div>

              {/* Question-by-Question Review */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Detailed Answer Review
                </h4>

                <div className="space-y-3">
                  {questions.map((q, idx) => {
                    const userAns = userAnswers[q.id];
                    const isAttempted = !!(userAns && userAns.trim());
                    const qScore = lastAttemptRecord.questionScores?.[q.id];
                    const qMaxMarks = qScore?.maxMarks ?? (q.marks ?? 1);
                    const marksAwarded = qScore?.marks ?? (isAttempted ? 1 : 0);
                    const isCorrect = qScore?.isCorrect ?? false;
                    const isSubjective = (!q.options || q.options.length === 0) || 
                      ["very_short_answer", "short_answer", "long_answer"].includes(q.type);

                    return (
                      <div
                        key={q.id}
                        className={`p-4 rounded-xl border space-y-2.5 transition-all ${
                          !isAttempted
                            ? "bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/60"
                            : isCorrect
                            ? "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/60"
                            : marksAwarded > 0
                            ? "bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800/60"
                            : "bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800/60"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                {getAssessmentQuestionTypeLabel(q.type, q.passageId)}
                              </span>
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                {marksAwarded} / {qMaxMarks} {qMaxMarks === 1 ? "Mark" : "Marks"}
                              </span>
                            </div>
                            <p className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 leading-snug break-words">
                              Q{idx + 1}. {q.question}
                            </p>
                          </div>

                          {!isAttempted ? (
                            <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/80 px-2 py-0.5 rounded-md border border-amber-300 dark:border-amber-800 flex items-center gap-1 shrink-0">
                              <HelpCircle className="w-3 h-3 text-amber-600 dark:text-amber-400" /> Not Attempted
                            </span>
                          ) : isCorrect ? (
                            <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/80 px-2 py-0.5 rounded-md border border-emerald-300 dark:border-emerald-800 flex items-center gap-1 shrink-0">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> Correct
                            </span>
                          ) : marksAwarded > 0 ? (
                            <span className="text-[11px] font-bold text-blue-700 dark:text-blue-400 bg-blue-100 dark:bg-blue-950/80 px-2 py-0.5 rounded-md border border-blue-300 dark:border-blue-800 flex items-center gap-1 shrink-0">
                              <CheckCircle2 className="w-3 h-3 text-blue-600 dark:text-blue-400" /> Partial Credit
                            </span>
                          ) : (
                            <span className="text-[11px] font-bold text-rose-700 dark:text-rose-400 bg-rose-100 dark:bg-rose-950/80 px-2 py-0.5 rounded-md border border-rose-300 dark:border-rose-800 flex items-center gap-1 shrink-0">
                              <XCircle className="w-3 h-3 text-rose-600 dark:text-rose-400" /> Wrong
                            </span>
                          )}
                        </div>

                        {/* Answer Details */}
                        <div className="text-xs space-y-1.5 pt-1.5 border-t border-slate-200/50 dark:border-slate-800/50">
                          <div>
                            <span className="text-slate-500 dark:text-slate-400 font-semibold">Your Answer: </span>
                            {!isAttempted ? (
                              <span className="text-amber-700 dark:text-amber-400 italic font-bold">None</span>
                            ) : (
                              <span className={`font-bold ${isCorrect ? "text-emerald-700 dark:text-emerald-300" : marksAwarded > 0 ? "text-blue-700 dark:text-blue-300" : "text-rose-700 dark:text-rose-300"}`}>
                                {userAns}
                              </span>
                            )}
                          </div>

                          {q.correctAnswer && (
                            <div>
                              <span className="text-emerald-700 dark:text-emerald-400 font-semibold">Correct Answer / Key: </span>
                              <span className="font-bold text-emerald-800 dark:text-emerald-200">{q.correctAnswer}</span>
                            </div>
                          )}

                          {q.modelAnswer && (
                            <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                              <p className="text-[11px] font-bold text-indigo-700 dark:text-indigo-400 uppercase">Model Answer / Key Points:</p>
                              <p className="text-xs font-medium mt-0.5 whitespace-pre-wrap leading-relaxed">{q.modelAnswer}</p>
                            </div>
                          )}

                          {q.rubric && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                              <span className="font-semibold">Grading Rubric:</span> {q.rubric}
                            </p>
                          )}

                          {q.explanation && (
                            <p className="text-[11px] text-slate-600 dark:text-slate-300 pt-1 leading-relaxed">
                              <strong className="text-slate-800 dark:text-slate-200">Explanation: </strong>
                              {q.explanation}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Action Buttons - sticky at bottom for easy closing */}
              <div className="sticky -bottom-4 sm:-bottom-6 -mx-4 sm:-mx-6 p-4 sm:p-6 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 z-10 shadow-lg mt-6">
                {testMeta?.maxAttempts && attemptCount >= testMeta.maxAttempts ? (
                  <button
                    disabled
                    className="px-4 py-2.5 bg-slate-200 dark:bg-slate-800 text-slate-400 text-xs font-bold rounded-xl opacity-60 cursor-not-allowed flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Max Attempts Reached ({testMeta.maxAttempts}/{testMeta.maxAttempts})</span>
                  </button>
                ) : (
                  <button
                    onClick={handleStartTest}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Re-attempt Test</span>
                  </button>
                )}

                <button
                  onClick={handleClose}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-black uppercase tracking-wider rounded-xl transition cursor-pointer shadow-md"
                >
                  Close & Return
                </button>
              </div>

            </div>
          )}

        </div>

      </div>

      {/* --- IMAGE ZOOM MODAL --- */}
      {zoomImage && (
        <ImageZoomModal
          imageUrl={zoomImage.url}
          imageLabel={zoomImage.label}
          onClose={() => setZoomImage(null)}
        />
      )}
    </div>
  );
}
