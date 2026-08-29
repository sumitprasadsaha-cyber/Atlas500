export interface ClassNote {
  id: string;
  isUPSC?: boolean;
  class?: string;
  classGrade: string; // e.g. "Class 6", "Class 7", "Class 8", "Class 9", "Class 10", "UPSC"
  subject: string; // e.g. "Mathematics", "Science", "English", "Polity", "International Relations"
  chapterNo: number;
  chapterName: string;
  
  // Atlas400 v5.0.8 Hierarchical Fields (School & UPSC)
  type?: "school" | "upsc";
  classId?: string; // e.g. "class-9" or "upsc"
  className?: string; // e.g. "Class 9" or "UPSC"
  subjectId?: string; // e.g. "mathematics"
  subjectName?: string; // e.g. "Mathematics"
  chapterNumber?: number; // e.g. 1
  chapterTitle?: string; // e.g. "Number Systems"
  topicNumber?: number | string; // e.g. 1
  topicTitle?: string; // e.g. "Introduction"
  r2Key?: string; // Hierarchical R2 path: class_notes/Class_9/Mathematics/Chapter_01_Number_Systems/Topic_01_Introduction/note.pdf
  practiceTestId?: string | null; // Attached practice test ID
  visibility?: "public" | "visible" | "all" | "selected" | "hidden" | string;
  accessRules?: {
    accessType?: "all" | "selected";
    allowedStudentIds?: string[];
    allowedClasses?: string[];
  };
  searchableText?: string;
  version?: string; // e.g. "5.0.8"

  // UPSC specific fields
  paper?: string; // e.g. "General Studies Paper II"
  moduleNo?: number; // alias for UPSC module_number
  moduleName?: string; // alias for UPSC module_name
  module_number?: number; // exact UPSC metadata specification
  module_name?: string; // exact UPSC metadata specification
  moduleNumber?: number; // canonical v5.0.8
  moduleTitle?: string; // canonical v5.0.8
  generalStudiesPaper?: string; // e.g. "General Studies Paper I", "General Studies Paper II", "General Studies Paper III", "General Studies Paper IV", "Essay", "CSAT" (UPSC only)
  gs_paper?: string; // exact UPSC metadata specification
  partLabel?: string; // e.g. "Topic 1", "Topic 2", or legacy part label
  teachMode?: string | boolean;
  teach_mode?: string | boolean;
  isTeachMode?: boolean;
  topicNo?: number | string; // e.g. 1, 2, "1.1"
  topicName?: string; // e.g. "Introduction"
  topic_number?: number | string; // exact UPSC metadata specification
  topic_name?: string; // exact UPSC metadata specification
  pdfUrl: string;
  pdfFileName: string;
  originalFilename?: string;
  storedFilename?: string;
  fileName?: string;
  filename?: string; // exact UPSC metadata specification
  storagePath?: string;
  storage_path?: string; // exact UPSC metadata specification
  storageKey?: string; // Primary single source of truth for Cloudflare R2 object key
  objectKey?: string;
  downloadKey?: string;
  publicUrl?: string;
  downloadUrl?: string;
  bucket?: string;
  fileType?: "pdf" | "image";
  fileSize?: number;
  file_size?: number;
  mimeType?: string;
  mime_type?: string; // exact UPSC metadata specification
  createdAt: string;
  uploadedAt?: string;
  uploaded_at?: string; // exact UPSC metadata specification
  uploadedDate?: string;
  updatedAt?: string;
  updated_at?: string;
  updatedDate?: string;
  uploadedBy?: string;

  // Student Access Control metadata
  accessType?: "all" | "selected";
  allowedStudentIds?: string[];
  allowedClasses?: string[];
}

export interface ChapterNote {
  id: string;
  classGrade?: string;
  subject?: string;
  chapterNo: number; // Only number!
  chapterName: string; // Chapter name
  
  // Atlas400 v5.0.7 Hierarchical Fields
  isUPSC?: boolean;
  class?: string;
  classId?: string;
  className?: string;
  subjectId?: string;
  subjectName?: string;
  chapterNumber?: number;
  chapterTitle?: string;
  topicNumber?: number | string;
  topicTitle?: string;
  r2Key?: string;
  practiceTestId?: string | null;
  visibility?: "public" | "visible" | "all" | "selected" | string;
  accessRules?: {
    accessType?: "all" | "selected";
    allowedStudentIds?: string[];
    allowedClasses?: string[];
    allowedRole?: string;
  };
  searchableText?: string;
  version?: string;
  originalFilename?: string;
  updatedAt?: string;

  paper?: string;
  moduleNo?: number;
  moduleName?: string;
  module_number?: number;
  module_name?: string;
  moduleNumber?: number;
  moduleTitle?: string;
  generalStudiesPaper?: string; // e.g. "General Studies Paper I", "General Studies Paper II", "General Studies Paper III", "General Studies Paper IV", "Essay", "CSAT" (UPSC only)
  gs_paper?: string;
  partLabel?: string; // Optional part label or legacy part label
  teachMode?: string | boolean;
  teach_mode?: string | boolean;
  isTeachMode?: boolean;
  topicNo?: number | string; // e.g. 1, 2
  topicName?: string; // e.g. "Introduction"
  topic_number?: number | string;
  topic_name?: string;
  pdfUrl: string; // Base64 PDF content or URL
  pdfFileName: string; // Original PDF filename
  isCompleted?: boolean; // For tracking revision progress
  remark?: string; // Specific tutor remark on student's performance/difficulty
  createdAt: string;

  // Student Access Control metadata
  accessType?: "all" | "selected";
  allowedStudentIds?: string[];
  allowedClasses?: string[];

  // Cloudflare R2 Storage metadata
  storageProvider?: "r2";
  bucket?: string;
  storagePath?: string;
  storage_path?: string;
  storageKey?: string;
  objectKey?: string;
  downloadKey?: string;
  fileName?: string;
  filename?: string;
  fileSize?: number;
  mimeType?: string;
  mime_type?: string;
  fileType?: "pdf" | "image";
  uploadedAt?: string;
  uploaded_at?: string;
  uploadedBy?: string;
  downloadUrl?: string;
}

export interface ChapterProgressData {
  studentId: string;
  subjectId: string;
  chapterId: string;
  selectedStatus: string;
  calculatedProgress: number;
  remarks?: string;
  updatedAt: string;
}

export interface StudentReport {
  id: string;
  storageProvider: "r2";
  bucket: string;
  storagePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
  uploadedBy: string;
  downloadUrl: string;
}

export interface TestMarkRecord {
  id: string;
  subject: string;
  testName: string;
  marksObtained: number;
  totalMarks: number;
  date: string;
}

export interface HomeworkRecord {
  id: string;
  date: string;
  subject: string;
  title: string;
  completed: boolean;
  remark?: string;
}

export interface StudyMaterialUsageRecord {
  subject: string;
  chaptersViewed: number;
  totalChapters: number;
}

export type StudentServiceStatus = "active" | "paused" | "ended";

export interface Student {
  id: string;
  uid?: string; // Firebase Auth UID for deleting account
  rollNo?: string | number;
  name: string;
  classGrade: string; // "Class 8", "Class 9", "Class 10"
  phone: string;
  parentPhone: string;
  monthlyFee: number;
  feePaidThisMonth: boolean; // Legacy fallback
  registrationDate?: string; // YYYY-MM-DD joining date
  feeMonths?: Record<string, "paid" | "unpaid" | "na">; // e.g. {"June 2026": "unpaid", "July 2026": "paid"}
  feeMonthsList?: string[]; // e.g. ["March 2026", "April 2026"]
  feePaymentDates?: Record<string, string>; // e.g. {"June 2026": "2026-06-15"}
  enrolledSubjects: string[]; // e.g. ["Computer Science", "English", "Mathematics", "Science"]
  avatarUrl?: string; // custom image url
  avatarColor?: string; // fallback background color
  avatarStorageProvider?: "r2";
  avatarBucket?: string;
  avatarStoragePath?: string;
  notes: Record<string, ChapterNote[]>; // subject -> list of pdf notes
  attendance: Record<string, boolean | "na">; // date (YYYY-MM-DD) -> present (true), absent (false), or N/A ("na")
  email?: string;
  password?: string;
  reports?: StudentReport[];
  chapterProgress?: Record<string, ChapterProgressData>; // key: `${subjectId}_${chapterId}` or `${chapterId}`
  lastActiveAt?: string; // ISO timestamp of last app activity
  serviceStatus?: StudentServiceStatus; // "active" | "paused" | "ended"
  service_status?: StudentServiceStatus; // Supabase column mapping
  
  // AI Analysis additional dimensions
  testMarks?: TestMarkRecord[];
  homeworkRecords?: HomeworkRecord[];
  adminNotes?: string;
  studyMaterialUsage?: StudyMaterialUsageRecord[];
  syllabusProgress?: Record<string, number>;
}

export type AIReportType =
  | "institution_overview"
  | "student_performance"
  | "class_report"
  | "attendance_insights"
  | "fee_insights"
  | "test_performance"
  | "homework_analytics"
  | "syllabus_insights"
  | "parent_communication"
  | "recommendations"
  | "monthly_report"
  | "ask_ai";

export interface AICachedReport {
  reportType: AIReportType;
  key: string;
  markdown: string;
  updatedAt: string;
}


export interface TuitionStats {
  totalEnrolled: number;
  presentToday: number;
  activeClassesCount: number;
  feesPendingCount: number;
  totalRevenue: number;
  monthlyTarget: number;
  monthlyCollected: number;
  subjectProgress: Record<string, number>; // subject -> progress %
}

// ----------------------------------------------------
// SMART TOPIC-WISE ASSESSMENT SYSTEM TYPES
// ----------------------------------------------------

export interface ParsedAssessmentQuestion {
  id: string;
  classGrade: string;
  subject: string;
  chapterNo: number;
  chapterName: string;
  topicName: string;
  type: "mcq" | "true_false" | "assertion_reason";
  question: string;
  options: string[]; // Clean option text for student view (e.g. ["A. Plants and animals", "B. Internal and external forces"])
  correctAnswer: string; // "A" | "B" | "C" | "D" or "True" | "False"
  explanation?: string; // Optional explanation for the answer
  imageUrl?: string; // Optional image data URL or hosted image URL for diagram/image-based questions
  imageLabel?: string; // Optional diagram label, e.g. "Ocean-floor diagram"
  imagePosition?: "above" | "below"; // "above" or "below" the question text
  rawText?: string;
  published?: boolean;
  orderIndex?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface TopicPracticeTest {
  id: string; // Unique test key: `${classGrade}_${subject}_ch${chapterNo}_${topicName}`
  testId?: string;
  noteId?: string;
  topicNoteId?: string;
  hasTest?: boolean;
  hasPracticeTest?: boolean;
  questionCount?: number;
  classGrade: string;
  subject: string;
  chapterNo: number;
  chapterName: string;
  topicName: string;
  rawText: string;
  questions: ParsedAssessmentQuestion[];
  createdAt: string;
  updatedAt: string;
  uploadedBy?: string;
}

export interface TestAttemptRecord {
  id: string;
  studentId: string;
  studentName: string;
  testId?: string;
  topicId?: string;
  chapterId?: string;
  subjectId?: string;
  classGrade: string;
  subject: string;
  chapterNo: number;
  chapterName: string;
  topicName: string; // Topic Name OR "Full Chapter Test"
  testType: "topic" | "full_chapter";
  attemptNumber: number; // 1, 2, 3...
  date: string; // Formatted date string
  timestamp: number;
  timeTakenSeconds: number; // In seconds
  score: number; // Marks obtained, e.g. 18
  totalMarks?: number; // Total marks, e.g. 20
  totalQuestions: number; // e.g., 20
  percentage: number; // e.g., 90
  correctAnswersCount: number;
  wrongAnswersCount: number;
  unattemptedCount?: number;
  userAnswers: Record<string, string>; // questionId -> chosen answer
}
