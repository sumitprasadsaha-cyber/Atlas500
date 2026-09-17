import React, { useState, useMemo, useEffect } from "react";
import { 
  ChevronRight, 
  ChevronDown, 
  BookOpen, 
  FileText, 
  Image as ImageIcon, 
  Search, 
  X, 
  FlaskConical,
  AlertCircle,
  Eye
} from "lucide-react";
import { Student, ClassNote, ChapterNote } from "../types";
import { StudentUPSCGSPaper, StudentUPSCSubject, StudentUPSCModule } from "../utils/studentUPSCHierarchyHelper";
import { 
  getTopicPracticeTestSync, 
  getChapterPracticeTestSync,
  subscribeToPracticeTests,
  getTopicPracticeTest
} from "../lib/practiceTestService";
import { getAllTestAttempts } from "../utils/assessmentParser";
import { fetchStudentTestAttempts } from "../lib/testScorePersistence";
import { getTopicTestStats, getChapterTestStats } from "../utils/testStatsHelper";
import StudentTestScoreButton from "./StudentTestScoreButton";
import { notesLogger } from "../lib/notesLogger";
import { TopicDownloadProgressBar } from "./notes/TopicDownloadProgressBar";
import { topicDownloadProgress } from "../lib/topicDownloadProgress";

interface StudentUPSCTreeProps {
  paper: StudentUPSCGSPaper;
  student: Student;
  onPreviewNote: (note: ClassNote | ChapterNote) => void | Promise<any>;
  onToggleTopicCompletion?: (note: ClassNote | ChapterNote, subject: string, isCompleted: boolean) => void;
  onOpenPracticeTest?: (testTarget: {
    classGrade: string;
    subject: string;
    chapterNo: number;
    chapterName: string;
    topicName: string;
    testType: "topic" | "full_chapter";
  }) => void;
  downloadingNoteId?: string | null;
  openingNoteId?: string | null;
  openErrorNoteId?: string | null;
  isAdmin?: boolean;
}

export default function StudentUPSCTree({
  paper,
  student,
  onPreviewNote,
  onOpenPracticeTest,
  downloadingNoteId,
  openingNoteId,
  openErrorNoteId,
  isAdmin = false,
}: StudentUPSCTreeProps) {
  const activeDownloadingId = downloadingNoteId || openingNoteId;
  const storageKeyPrefix = `upsc_tree_${paper?.gsPaper || "def"}_${student?.id || "anon"}`;

  const [searchQuery, setSearchQuery] = useState(() => {
    try {
      return sessionStorage.getItem(`${storageKeyPrefix}_search`) || "";
    } catch {
      return "";
    }
  });

  const [expandedSubjects, setExpandedSubjects] = useState<Record<string, boolean>>(() => {
    try {
      const saved = sessionStorage.getItem(`${storageKeyPrefix}_expanded_subjects`);
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });

  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>(() => {
    try {
      const saved = sessionStorage.getItem(`${storageKeyPrefix}_expanded`);
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });

  const [testBankTick, setTestBankTick] = useState(0);
  const [downloadingIds, setDownloadingIds] = useState<Record<string, boolean>>({});
  const [localErrorId, setLocalErrorId] = useState<string | null>(null);
  const [localErrorMsg, setLocalErrorMsg] = useState<string>("");

  // Sync state to sessionStorage
  useEffect(() => {
    try {
      if (searchQuery) {
        sessionStorage.setItem(`${storageKeyPrefix}_search`, searchQuery);
      } else {
        sessionStorage.removeItem(`${storageKeyPrefix}_search`);
      }
    } catch {}
  }, [searchQuery, storageKeyPrefix]);

  useEffect(() => {
    try {
      sessionStorage.setItem(`${storageKeyPrefix}_expanded_subjects`, JSON.stringify(expandedSubjects));
    } catch {}
  }, [expandedSubjects, storageKeyPrefix]);

  useEffect(() => {
    try {
      sessionStorage.setItem(`${storageKeyPrefix}_expanded`, JSON.stringify(expandedModules));
    } catch {}
  }, [expandedModules, storageKeyPrefix]);

  // Fetch student test attempts and subscribe to real-time practice test & score changes
  useEffect(() => {
    if (student?.id) {
      fetchStudentTestAttempts(student.id, student.name);
    }

    const handleUpdate = () => setTestBankTick((t) => t + 1);
    const unsub = subscribeToPracticeTests(handleUpdate);
    if (typeof window !== "undefined") {
      window.addEventListener("practice-tests-updated", handleUpdate);
      window.addEventListener("test-attempts-updated", handleUpdate);
      window.addEventListener("storage", handleUpdate);
    }
    return () => {
      if (unsub) unsub();
      if (typeof window !== "undefined") {
        window.removeEventListener("practice-tests-updated", handleUpdate);
        window.removeEventListener("test-attempts-updated", handleUpdate);
        window.removeEventListener("storage", handleUpdate);
      }
    };
  }, [student?.id, student?.name]);

  const allAttempts = useMemo(() => {
    return getAllTestAttempts();
  }, [student?.id, student?.name, testBankTick]);

  const toggleSubject = (subjectKey: string) => {
    setExpandedSubjects((prev) => ({
      ...prev,
      [subjectKey]: !(prev[subjectKey] ?? true), // default expanded
    }));
  };

  const toggleModule = (moduleKey: string) => {
    setExpandedModules((prev) => ({
      ...prev,
      [moduleKey]: !(prev[moduleKey] ?? true), // default expanded
    }));
  };

  const cleanQuery = searchQuery.trim().toLowerCase();

  // Filter subjects and modules by search
  const filteredSubjects = useMemo(() => {
    if (!cleanQuery) return paper.subjects;

    return paper.subjects
      .map((subj) => {
        const subjMatch = subj.subject.toLowerCase().includes(cleanQuery);

        const matchedModules = subj.modules
          .map((mod) => {
            const modMatch =
              mod.moduleName.toLowerCase().includes(cleanQuery) ||
              mod.moduleTitle.toLowerCase().includes(cleanQuery);

            const matchedTopics = mod.topics.filter((top) => {
              const topNameMatch = top.topicName.toLowerCase().includes(cleanQuery);
              const topLabelMatch = top.topicLabel.toLowerCase().includes(cleanQuery);
              const fileMatch = (top.fileName || "").toLowerCase().includes(cleanQuery);
              return topNameMatch || topLabelMatch || fileMatch;
            });

            if (modMatch || matchedTopics.length > 0) {
              return {
                ...mod,
                topics: modMatch ? mod.topics : matchedTopics,
              };
            }
            return null;
          })
          .filter(Boolean) as StudentUPSCModule[];

        if (subjMatch || matchedModules.length > 0) {
          return {
            ...subj,
            modules: subjMatch ? subj.modules : matchedModules,
          };
        }
        return null;
      })
      .filter(Boolean) as StudentUPSCSubject[];
  }, [paper.subjects, cleanQuery]);

  // Collect all visible subject keys
  const allSubjectKeys = useMemo(() => {
    return filteredSubjects.map((s) => s.subjectKey);
  }, [filteredSubjects]);

  // Collect all visible module keys for toggle expand/collapse
  const allModuleKeys = useMemo(() => {
    const keys: string[] = [];
    filteredSubjects.forEach((s) => {
      s.modules.forEach((m) => {
        keys.push(`${s.subjectKey}_${m.moduleKey}`);
      });
    });
    return keys;
  }, [filteredSubjects]);

  const areAllExpanded = useMemo(() => {
    if (allModuleKeys.length === 0 && allSubjectKeys.length === 0) return false;
    const subjectsExpanded = allSubjectKeys.length === 0 || allSubjectKeys.every((key) => expandedSubjects[key] !== false);
    const modulesExpanded = allModuleKeys.length === 0 || allModuleKeys.every((key) => expandedModules[key] !== false);
    return subjectsExpanded && modulesExpanded;
  }, [allModuleKeys, allSubjectKeys, expandedModules, expandedSubjects]);

  const handleToggleExpandCollapseAll = () => {
    const nextState = !areAllExpanded;
    const nextSubjects: Record<string, boolean> = {};
    allSubjectKeys.forEach((key) => {
      nextSubjects[key] = nextState;
    });
    setExpandedSubjects(nextSubjects);

    const nextMods: Record<string, boolean> = {};
    allModuleKeys.forEach((key) => {
      nextMods[key] = nextState;
    });
    setExpandedModules(nextMods);
  };

  const totalModulesCount = useMemo(() => {
    return filteredSubjects.reduce((acc, s) => acc + s.modules.length, 0);
  }, [filteredSubjects]);

  return (
    <div className="flex flex-col gap-3 h-full overflow-hidden" id="student-upsc-tree-container">
      {/* Search Input Bar (Restricted to selected paper) & Single Toggle Button */}
      <div className="flex items-center gap-2 shrink-0" id="upsc-search-bar-row">
        <div className="relative flex-1" id="upsc-paper-search">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder={`Search modules or topics in ${paper.gsPaper}...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Single Expand / Collapse Toggle Button */}
        <button
          onClick={handleToggleExpandCollapseAll}
          className="px-3 py-2 text-[11px] font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition cursor-pointer shrink-0"
          title={areAllExpanded ? "Collapse All" : "Expand All"}
        >
          {areAllExpanded ? "Collapse All" : "Expand All"}
        </button>
      </div>

      {/* Modules List */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-2.5 scrollbar-thin" id="upsc-tree-scroll-area">
        {paper.subjects.length === 0 || totalModulesCount === 0 ? (
          <div className="flex flex-col items-center justify-center p-10 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-900/30">
            <div className="p-3 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-2xl mb-2">
              <BookOpen className="w-6 h-6" />
            </div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
              {cleanQuery ? "No matching modules or topics found." : "No modules available."}
            </p>
            <p className="text-xs text-slate-400 mt-1 max-w-sm">
              {cleanQuery ? "Try searching for a different keyword." : `Study notes for ${paper.gsPaper} will appear here once uploaded.`}
            </p>
          </div>
        ) : (
          filteredSubjects.map((subj) => {
            const subjKey = subj.subjectKey;
            const isSubjExpanded = cleanQuery ? true : (expandedSubjects[subjKey] ?? true);

            return (
              <div 
                key={`upsc-subj-${subjKey}`} 
                className="space-y-2.5 rounded-2xl border border-slate-200/90 dark:border-slate-800/90 bg-slate-50/50 dark:bg-slate-900/40 p-2.5 sm:p-3"
                id={`upsc-subject-section-${subjKey}`}
              >
                {/* Subject Header (Collapsible & clearly identifies the Subject) */}
                <div
                  onClick={() => toggleSubject(subjKey)}
                  className="flex items-center justify-between gap-2.5 px-3.5 py-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs cursor-pointer select-none transition-all hover:border-indigo-300 dark:hover:border-indigo-800/60 flex-wrap sm:flex-nowrap"
                  id={`upsc-subject-header-${subjKey}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className="text-slate-400 shrink-0">
                      {isSubjExpanded ? (
                        <ChevronDown className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-500" />
                      )}
                    </span>
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shrink-0">
                        <BookOpen className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex items-center gap-2 flex-wrap flex-1">
                        <span className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900/50 shrink-0">
                          Subject
                        </span>
                        <h4 className="text-xs sm:text-sm font-black text-slate-900 dark:text-slate-100 break-words whitespace-normal leading-tight">
                          {subj.subject}
                        </h4>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto sm:ml-2 self-center">
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {subj.totalModules} {subj.totalModules === 1 ? "Module" : "Modules"}
                    </span>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {subj.totalTopics} {subj.totalTopics === 1 ? "Topic Note" : "Topic Notes"}
                    </span>
                  </div>
                </div>

                {/* Modules list under this Subject */}
                {isSubjExpanded && (
                  <div className="space-y-2 pt-0.5 pl-1 sm:pl-2" id={`upsc-subject-modules-${subjKey}`}>
                    {subj.modules.map((mod) => {
                const modKey = `${subj.subjectKey}_${mod.moduleKey}`;
                const isModExpanded = cleanQuery ? true : (expandedModules[modKey] ?? true);
                const targetClass = "UPSC";
                const targetSubj = subj.subject || "";
                const chapterNo = mod.moduleNo || 1;

                const chapterTest =
                  getChapterPracticeTestSync(targetClass, targetSubj, chapterNo) ||
                  getChapterPracticeTestSync(paper.gsPaper, targetSubj, chapterNo);

                const hasChapterTest = !!(chapterTest && Array.isArray(chapterTest.questions) && chapterTest.questions.length > 0);

                const chapterStats =
                  getChapterTestStats(
                    allAttempts,
                    student.id,
                    student.name,
                    targetClass,
                    targetSubj,
                    chapterNo
                  ) ||
                  getChapterTestStats(
                    allAttempts,
                    student.id,
                    student.name,
                    paper.gsPaper,
                    targetSubj,
                    chapterNo
                  );

                return (
                  <div
                    key={`upsc-mod-${modKey}`}
                    className="border border-slate-200 dark:border-slate-800/90 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-2xs transition-all"
                    id={`upsc-module-${modKey}`}
                  >
                    {/* Module Header (Collapsible) */}
                    <div
                      onClick={() => toggleModule(modKey)}
                      className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50/70 dark:bg-slate-855/50 hover:bg-slate-100/80 dark:hover:bg-slate-800/70 cursor-pointer select-none transition-colors border-b border-slate-100 dark:border-slate-800/60"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                        <span className="text-slate-400 shrink-0">
                          {isModExpanded ? <ChevronDown className="w-4 h-4 text-slate-600 dark:text-slate-300" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                        </span>
                        <h5 className="text-xs font-bold text-slate-900 dark:text-slate-100 break-words whitespace-normal leading-snug">
                          {mod.moduleTitle}
                        </h5>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 ml-2 self-center" onClick={(e) => e.stopPropagation()}>
                        {hasChapterTest && (
                          <StudentTestScoreButton
                            stats={chapterStats}
                            hasTest={true}
                            topicName={`${mod.moduleTitle} Chapter Test`}
                            onOpenTest={() => {
                              onOpenPracticeTest?.({
                                classGrade: targetClass,
                                subject: targetSubj,
                                chapterNo,
                                chapterName: mod.moduleName,
                                topicName: "Full Chapter Test",
                                testType: "full_chapter",
                              });
                            }}
                          />
                        )}
                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                          {mod.totalTopics} {mod.totalTopics === 1 ? "Topic" : "Topics"}
                        </span>
                      </div>
                    </div>

                    {/* Level 3: Compact Topic Rows */}
                    {isModExpanded && (
                      <div className="p-1.5 space-y-1 bg-white dark:bg-slate-900">
                        {mod.topics.length === 0 ? (
                          <div className="py-2.5 px-3 text-center text-xs text-slate-400 italic">
                            No topic notes available in this module yet.
                          </div>
                        ) : (
                          mod.topics.map((topic) => {
                            const isDownloading = Boolean(downloadingIds[topic.id] || (activeDownloadingId === topic.id) || topicDownloadProgress.isDownloading(topic.id));
                            const hasError = (openErrorNoteId === topic.id) || (localErrorId === topic.id);
                            const targetClass = "UPSC";
                            const targetSubj = subj.subject || (topic.note as any).subject || "";
                            const chapterNo = mod.moduleNo || (topic.note as any).chapterNo || 1;

                            // Check if an attached practice test actually exists with uploaded questions
                            const topicTest =
                              getTopicPracticeTestSync(targetClass, targetSubj, chapterNo, topic.topicName) ||
                              getTopicPracticeTestSync(targetClass, targetSubj, chapterNo, topic.topicLabel) ||
                              getTopicPracticeTestSync(targetClass, targetSubj, chapterNo, (topic.note as any).topicTitle || "") ||
                              getTopicPracticeTestSync(paper.gsPaper, targetSubj, chapterNo, topic.topicName) ||
                              (Array.isArray((topic.note as any).practiceTestQuestions) && (topic.note as any).practiceTestQuestions.length > 0
                                ? { questions: (topic.note as any).practiceTestQuestions }
                                : null);

                            const hasTest = !!(topicTest && Array.isArray(topicTest.questions) && topicTest.questions.length > 0);

                            const stats =
                              getTopicTestStats(
                                allAttempts,
                                student.id,
                                student.name,
                                targetClass,
                                targetSubj,
                                chapterNo,
                                topic.topicName || topic.topicLabel
                              ) ||
                              getTopicTestStats(
                                allAttempts,
                                student.id,
                                student.name,
                                paper.gsPaper,
                                targetSubj,
                                chapterNo,
                                topic.topicName || topic.topicLabel
                              );

                            const handleTopicClick = async () => {
                              if (isDownloading) return;
                              const isRetry = hasError;
                              setLocalErrorId(null);
                              setLocalErrorMsg("");
                              setDownloadingIds((prev) => ({ ...prev, [topic.id]: true }));

                              const topicId = topic.id;
                              const chapterId = mod.moduleKey || `mod_${chapterNo}`;
                              const subjectName = targetSubj;
                              const studentId = student?.id || "anonymous";

                              // 1. Student clicks topic
                              console.log("[Trace 1: Topic Click]", {
                                topicId,
                                chapterId,
                                subject: subjectName,
                                studentId,
                              });

                              // 2. Log the Firestore document
                              const noteDoc = topic.note || ({} as any);
                              console.log("[Trace 2: Firestore Document]", {
                                storagePath: noteDoc.storagePath || (noteDoc as any).storage_path || (noteDoc as any).objectKey || (noteDoc as any).r2Key || "",
                                bucket: noteDoc.bucket || "academy-connect-files",
                                contentType: noteDoc.mimeType || (noteDoc as any).contentType || (noteDoc as any).mime_type || "application/pdf",
                                fileName: noteDoc.pdfFileName || noteDoc.fileName || (noteDoc as any).filename || "note.pdf",
                                allUrlFields: {
                                  pdfUrl: noteDoc.pdfUrl || "",
                                  downloadUrl: (noteDoc as any).downloadUrl || "",
                                  publicUrl: (noteDoc as any).publicUrl || "",
                                  fileUrl: (noteDoc as any).fileUrl || "",
                                  url: (noteDoc as any).url || "",
                                  signedUrl: (noteDoc as any).signedUrl || "",
                                },
                              });

                              const topicName = topic.topicName || topic.topicLabel || (topic.note as any)?.topicTitle || (topic as any).name || "";
                              const noteUrl = topic.note?.pdfUrl || topic.note?.storagePath || (topic.note as any)?.url || (topic.note as any)?.downloadUrl || "";
                              console.log("Topic ID:", topicId);
                              console.log("Topic Name:", topicName);
                              console.log("Download URL:", noteUrl);

                              if (isRetry) {
                                notesLogger.info("RETRY_ATTEMPT", {
                                  noteId: topic.id,
                                  topicTitle: topic.topicName,
                                  subject: targetSubj,
                                  chapterNumber: chapterNo,
                                });
                              }

                              try {
                                if (typeof window !== "undefined") {
                                  sessionStorage.setItem("student_last_scroll_y", String(window.scrollY));
                                }
                                const result = onPreviewNote(topic.note);
                                if (result && typeof result.then === "function") {
                                  await result;
                                }
                              } catch (err: any) {
                                console.error("[StudentUPSCTree] Error opening note:", err);
                                setLocalErrorId(topic.id);
                                const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
                                const isOfflineMsg = (err?.message || "").includes("offline") || (err?.message || "").includes("internet");
                                setLocalErrorMsg(
                                  isOffline || isOfflineMsg
                                    ? "This note is not available offline. Connect to the internet to download it."
                                    : (err?.message || "Failed to open. Please try again.")
                                );
                                setTimeout(() => {
                                  setLocalErrorId((curr) => (curr === topic.id ? null : curr));
                                }, 5000);
                              } finally {
                                setDownloadingIds((prev) => {
                                  const next = { ...prev };
                                  delete next[topic.id];
                                  return next;
                                });
                              }
                            };

                            const rawFileName = topic.fileName || topic.note?.fileName || (topic.note as any)?.pdfFileName || "";
                            const fileExt = (rawFileName.split(".").pop() || (topic.fileType === "image" ? "IMG" : "PDF")).toUpperCase();
                            const partBadge = topic.partLabel || (topic.partNumber !== undefined && topic.partNumber !== null && topic.partNumber !== "" ? `Part ${topic.partNumber}` : null);
                            const displayName = topic.cleanBaseName || topic.topicName;

                            return (
                              <div
                                key={`upsc-topic-${topic.id}`}
                                onClick={handleTopicClick}
                                className={`group flex flex-col rounded-lg transition-all select-none ${
                                  isDownloading
                                    ? "opacity-90 bg-blue-50/70 dark:bg-blue-950/40 cursor-wait pointer-events-none"
                                    : "hover:bg-slate-100/90 dark:hover:bg-slate-800/70 cursor-pointer"
                                } ${hasError ? "bg-rose-50/50 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-900/60" : ""}`}
                                id={`upsc-topic-${topic.id}`}
                                title={isDownloading ? "Downloading note..." : hasError ? "Failed to load. Tap to try again" : "Tap to open note in browser"}
                              >
                                {/* Main Topic Content Row */}
                                <div className="flex items-start sm:items-center justify-between gap-2.5 px-3 py-2.5">
                                  {/* Left: Icon, Topic #, Name, Part, Format, and Progress */}
                                  <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
                                    <span className="mt-0.5 sm:mt-0 shrink-0">
                                      {topic.fileType === "image" ? (
                                        <ImageIcon className="w-4 h-4 text-amber-500" />
                                      ) : (
                                        <FileText className="w-4 h-4 text-blue-500" />
                                      )}
                                    </span>

                                    <div className="min-w-0 flex-1 flex flex-wrap items-center gap-1.5 sm:gap-2">
                                      {/* Topic Number Badge */}
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-tight bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/70 shrink-0">
                                        Topic {topic.topicNo}
                                      </span>

                                      {/* Topic Name */}
                                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors break-words whitespace-normal leading-relaxed">
                                        {displayName}
                                      </span>

                                      {/* Part Badge (if part exists) */}
                                      {partBadge && (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/70 shrink-0">
                                          {partBadge}
                                        </span>
                                      )}

                                      {/* File format tag */}
                                      <span className={`px-1 py-0.2 rounded text-[9px] font-black uppercase tracking-wider shrink-0 ${
                                        topic.fileType === "image"
                                          ? "bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300"
                                          : "bg-red-50 dark:bg-red-950/80 text-red-700 dark:text-red-300 border border-red-200/60 dark:border-red-900/60"
                                      }`}>
                                        {fileExt}
                                      </span>

                                      {isDownloading && (
                                        <TopicDownloadProgressBar
                                          topicId={topic.id}
                                          storageKey={topic.note?.storagePath || (topic.note as any)?.storageKey}
                                        />
                                      )}

                                      {hasError && !isDownloading && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 text-[11px] font-bold shrink-0 animate-fadeIn">
                                          Try Again
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Right: Attached Document View Button and Attached Test */}
                                  <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleTopicClick();
                                      }}
                                      disabled={isDownloading}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 hover:bg-blue-50 dark:bg-slate-800 dark:hover:bg-blue-950/60 text-slate-700 hover:text-blue-600 dark:text-slate-300 dark:hover:text-blue-400 border border-slate-200/90 dark:border-slate-700 hover:border-blue-200 dark:hover:border-blue-800 transition-colors shadow-2xs"
                                      title="View/Open this note"
                                    >
                                      <Eye className="w-3 h-3 text-blue-500" />
                                      <span className="hidden xs:inline">View Note</span>
                                    </button>

                                    {hasTest && (
                                      <div className="shrink-0">
                                        <StudentTestScoreButton
                                          stats={stats}
                                          hasTest={hasTest}
                                          topicName={topic.topicName}
                                          onPreload={() => {
                                            getTopicPracticeTest(targetClass, targetSubj, mod.moduleNo, topic.topicName);
                                          }}
                                          onOpenTest={() => {
                                            onOpenPracticeTest?.({
                                              classGrade: targetClass,
                                              subject: targetSubj,
                                              chapterNo: mod.moduleNo,
                                              chapterName: mod.moduleName,
                                              topicName: topic.topicName,
                                              testType: "topic",
                                            });
                                          }}
                                        />
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Inline Error Message */}
                                {hasError && (
                                  <div className="px-3 pb-2 pt-0.5 animate-fadeIn">
                                    <div 
                                      className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 px-2.5 py-1 rounded-md"
                                      role="alert"
                                    >
                                      <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-500" />
                                      <span>{localErrorMsg || "Failed to open. Tap to try again."}</span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
