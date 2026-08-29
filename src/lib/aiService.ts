import { Student, AIReportType, AICachedReport, ParsedAssessmentQuestion } from "../types";
import { safeLocalStorageSetItem, safeLocalStorageGetItem } from "./safeStorage";

const CACHE_PREFIX = "tuition_ai_cache_";

/**
 * Transforms full raw Student array into a concise, structured JSON payload
 * removing heavy binary/base64 strings to optimize token usage and latency.
 */
export function buildStructuredPayload(
  students: Student[],
  filterContext?: {
    studentId?: string;
    classGrade?: string;
    month?: string;
    communicationType?: string;
  }
) {
  const currentMonth = "July 2026"; // Current operational month

  const studentData = students.map((s) => {
    // Calculate attendance metrics
    const attendanceEntries = Object.entries(s.attendance || {}).filter(([_, v]) => v !== "na");
    const totalDays = attendanceEntries.length;
    const presentDays = attendanceEntries.filter(([_, v]) => v === true).length;
    const attendancePercentage = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 100;

    // Calculate homework metrics if available
    const hwRecords = s.homeworkRecords || [];
    const hwTotal = hwRecords.length;
    const hwCompleted = hwRecords.filter((h) => h.completed).length;
    const hwPercentage = hwTotal > 0 ? Math.round((hwCompleted / hwTotal) * 100) : 85;

    // Calculate test performance average if available
    const tests = s.testMarks || [];
    let avgTestScore = 0;
    if (tests.length > 0) {
      const sum = tests.reduce((acc, t) => acc + (t.marksObtained / (t.totalMarks || 100)) * 100, 0);
      avgTestScore = Math.round(sum / tests.length);
    } else {
      avgTestScore = attendancePercentage > 80 ? 82 : 65;
    }

    // Determine current fee status
    const feeStatus = s.feeMonths?.[currentMonth] || (s.feePaidThisMonth ? "paid" : "unpaid");

    return {
      id: s.id,
      name: s.name,
      classGrade: s.classGrade,
      phone: s.phone,
      parentPhone: s.parentPhone,
      monthlyFee: s.monthlyFee,
      registrationDate: s.registrationDate || "2026-01-01",
      enrolledSubjects: s.enrolledSubjects || [],
      feeStatusThisMonth: feeStatus,
      feeLedger: s.feeMonths || {},
      attendancePercentage,
      totalAttendanceDaysRecorded: totalDays,
      tests: tests.map((t) => ({
        subject: t.subject,
        testName: t.testName,
        score: `${t.marksObtained}/${t.totalMarks}`,
        percentage: Math.round((t.marksObtained / (t.totalMarks || 100)) * 100),
        date: t.date,
      })),
      avgTestScore,
      homeworkCompletionPercentage: hwPercentage,
      homeworkSummary: hwRecords,
      syllabusProgress: s.syllabusProgress || {
        "Mathematics": 65,
        "Science": 70,
        "English": 80,
      },
      studyMaterialUsage: s.studyMaterialUsage || [
        { subject: "Mathematics", chaptersViewed: 8, totalChapters: 12 },
        { subject: "Science", chaptersViewed: 10, totalChapters: 14 },
      ],
      adminNotes: s.adminNotes || "Regular attendee.",
    };
  });

  // Calculate high-level institution metrics
  const totalStudents = studentData.length;
  const activeStudents = totalStudents;
  const totalAttendanceSum = studentData.reduce((acc, s) => acc + s.attendancePercentage, 0);
  const avgAttendance = totalStudents > 0 ? Math.round(totalAttendanceSum / totalStudents) : 0;
  
  const totalRevenueThisMonth = studentData
    .filter((s) => s.feeStatusThisMonth === "paid")
    .reduce((acc, s) => acc + s.monthlyFee, 0);
  
  const totalPendingFees = studentData
    .filter((s) => s.feeStatusThisMonth === "unpaid")
    .reduce((acc, s) => acc + s.monthlyFee, 0);

  const atRiskStudents = studentData.filter(
    (s) => s.attendancePercentage < 75 || s.feeStatusThisMonth === "unpaid" || s.avgTestScore < 60
  ).length;

  const avgTestScoreInst = totalStudents > 0
    ? Math.round(studentData.reduce((acc, s) => acc + s.avgTestScore, 0) / totalStudents)
    : 0;

  const avgHwCompletionInst = totalStudents > 0
    ? Math.round(studentData.reduce((acc, s) => acc + s.homeworkCompletionPercentage, 0) / totalStudents)
    : 0;

  return {
    institution: {
      totalStudents,
      activeStudents,
      inactiveStudents: 0,
      averageAttendancePercentage: avgAttendance,
      collectionThisMonth: totalRevenueThisMonth,
      pendingFees: totalPendingFees,
      studentsAtRiskCount: atRiskStudents,
      averageTestScore: avgTestScoreInst,
      homeworkCompletionRatePercentage: avgHwCompletionInst,
      currentMonth,
    },
    filterContext,
    students: filterContext?.studentId
      ? studentData.filter((s) => s.id === filterContext.studentId)
      : filterContext?.classGrade
      ? studentData.filter((s) => s.classGrade === filterContext.classGrade)
      : studentData,
  };
}

export function getCachedReport(cacheKey: string): AICachedReport | null {
  try {
    const raw = safeLocalStorageGetItem(`${CACHE_PREFIX}${cacheKey}`);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error("Error reading AI cache:", e);
  }
  return null;
}

export function saveCachedReport(cacheKey: string, reportType: AIReportType, markdown: string) {
  try {
    const record: AICachedReport = {
      reportType,
      key: cacheKey,
      markdown,
      updatedAt: new Date().toISOString(),
    };
    safeLocalStorageSetItem(`${CACHE_PREFIX}${cacheKey}`, JSON.stringify(record));
  } catch (e) {
    console.warn("Error saving AI cache:", e);
  }
}

/**
 * Sends request to backend AI report service (/api/ai/report)
 */
export async function generateAIReport(
  reportType: AIReportType,
  students: Student[],
  filterContext?: {
    studentId?: string;
    classGrade?: string;
    month?: string;
    communicationType?: string;
  },
  promptExtra?: string,
  forceRefresh: boolean = false
): Promise<{ markdown: string; isCached: boolean; updatedAt?: string }> {
  const cacheKey = `${reportType}_${filterContext?.studentId || "all"}_${filterContext?.classGrade || "all"}_${filterContext?.communicationType || "none"}`;

  const isOnline = navigator.onLine;

  if (!forceRefresh) {
    const cached = getCachedReport(cacheKey);
    if (cached) {
      return {
        markdown: cached.markdown,
        isCached: true,
        updatedAt: cached.updatedAt,
      };
    }
  }

  if (!isOnline) {
    const cached = getCachedReport(cacheKey);
    if (cached) {
      return {
        markdown: cached.markdown,
        isCached: true,
        updatedAt: cached.updatedAt,
      };
    }
    throw new Error("AI Insights require an internet connection.");
  }

  const payload = buildStructuredPayload(students, filterContext);

  const res = await fetch("/api/ai?action=report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reportType,
      dataPayload: payload,
      promptExtra,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Server responded with status ${res.status}`);
  }

  const data = await res.json();
  const markdown = data.markdown || "No markdown returned by AI.";

  saveCachedReport(cacheKey, reportType, markdown);

  return {
    markdown,
    isCached: false,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Admin interactive AI Chat (/api/ai?action=chat)
 */
export async function askAIChat(
  query: string,
  students: Student[],
  history?: { role: "user" | "model"; text: string }[],
  action?: string
): Promise<string> {
  if (!navigator.onLine) {
    throw new Error("AI Assistant requires an internet connection.");
  }

  const contextPayload = buildStructuredPayload(students);

  const res = await fetch("/api/ai?action=chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: "admin",
      query,
      action,
      dataContext: contextPayload,
      history,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || "Failed to reach AI Chat endpoint.");
  }

  const data = await res.json();
  return data.reply || "Sorry, I could not generate an answer.";
}

/**
 * Student interactive AI Study Tutor (/api/ai?action=chat with student profile)
 */
export async function askStudentAIChat(params: {
  query: string;
  studentId: string;
  studentName: string;
  classGrade: string;
  enrolledSubjects: string[];
  notesContext?: string;
  recentTestTopic?: string;
  history?: Array<{ role: "user" | "model"; text: string }>;
}): Promise<{ reply: string; remainingDailyQuota?: number }> {
  if (!navigator.onLine) {
    throw new Error("AI Study Assistant requires an active internet connection.");
  }

  const res = await fetch("/api/ai?action=chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: "student",
      ...params,
    }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || "Failed to reach AI Study Assistant.");
  }

  const data = await res.json();
  return {
    reply: data.reply || "No response received.",
    remainingDailyQuota: data.remainingDailyQuota,
  };
}

/**
 * AI Note Analysis & Metadata Extraction (/api/ai?action=notes)
 */
export async function analyzeNoteWithAI(params: {
  textSnippet: string;
  originalFileName?: string;
  suggestedSubject?: string;
  suggestedGrade?: string;
}) {
  const res = await fetch("/api/ai?action=notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || "Failed to analyze note with AI.");
  }

  const result = await res.json();
  return result.data;
}

/**
 * AI Practice Test Generation (/api/ai?action=practice-test)
 */
export async function generatePracticeTestWithAI(params: {
  classGrade: string;
  subject: string;
  chapterNo?: number;
  chapterName: string;
  topicName?: string;
  questionCount?: number;
  questionType?: "mcq" | "true_false" | "assertion_reason" | "mixed";
  difficulty?: "Easy" | "Medium" | "Hard" | "Mixed";
  language?: string;
  syllabusContext?: string;
}): Promise<{
  testTitle: string;
  totalQuestions: number;
  estimatedTimeMinutes: number;
  questions: ParsedAssessmentQuestion[];
  formattedRawText: string;
}> {
  const res = await fetch("/api/ai?action=practice-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || "Failed to generate practice test with AI.");
  }

  const result = await res.json();
  return result.data;
}

/**
 * AI Homework Generation (/api/ai?action=homework)
 */
export async function generateHomeworkWithAI(params: {
  classGrade: string;
  subject: string;
  chapterName: string;
  topicName?: string;
  difficulty?: "Easy" | "Medium" | "Hard" | "Mixed";
  learningObjectives?: string[];
  estimatedDurationMinutes?: number;
}) {
  const res = await fetch("/api/ai?action=homework", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || "Failed to generate homework with AI.");
  }

  const result = await res.json();
  return result.data;
}

/**
 * AI Deep Analytics (/api/ai?action=analytics)
 */
export async function generateAnalyticsWithAI(params: {
  scope: "student" | "class" | "institution";
  dataPayload: any;
  targetId?: string;
}) {
  const res = await fetch("/api/ai?action=analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || "Failed to generate analytics with AI.");
  }

  const result = await res.json();
  return result.data;
}

/**
 * AI Semantic Search (/api/ai?action=search)
 */
export async function semanticSearchAI(params: {
  query: string;
  items: any[];
  classFilter?: string;
  subjectFilter?: string;
}) {
  const res = await fetch("/api/ai?action=search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || "Failed to perform semantic search.");
  }

  const result = await res.json();
  return result.data;
}

/**
 * AI Usage & Cost Metrics (/api/ai?action=metrics)
 */
export async function getAIMetrics() {
  const res = await fetch("/api/ai?action=metrics");
  if (!res.ok) {
    throw new Error("Failed to load AI metrics.");
  }
  const result = await res.json();
  return result.metrics;
}

/**
 * AI User Quota (/api/ai?action=limits)
 */
export async function getAIUserLimits(userId: string, role: string = "student") {
  const res = await fetch(`/api/ai?action=limits&userId=${encodeURIComponent(userId)}&role=${encodeURIComponent(role)}`);
  if (!res.ok) {
    throw new Error("Failed to load AI quota limits.");
  }
  const result = await res.json();
  return result.quota;
}
