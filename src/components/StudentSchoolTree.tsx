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
  AlertCircle 
} from "lucide-react";
import { Student, ClassNote, ChapterNote } from "../types";
import { StudentSchoolSubject, StudentSchoolModule } from "../utils/studentSchoolHierarchyHelper";
import { 
  getTopicPracticeTestSync, 
  subscribeToPracticeTests, 
  preloadChapterPracticeTests,
  getTopicPracticeTest
} from "../lib/practiceTestService";
import { getAllTestAttempts } from "../utils/assessmentParser";
import { fetchStudentTestAttempts } from "../lib/testScorePersistence";
import { getTopicTestStats } from "../utils/testStatsHelper";
import StudentTestScoreButton from "./StudentTestScoreButton";
import { notesLogger } from "../lib/notesLogger";

/**
 * Animated three-dot loading indicator: "Downloading." -> "Downloading.." -> "Downloading..."
 */
function AnimatedDownloadingIndicator() {
  const [dotCount, setDotCount] = useState(1);

  useEffect(() => {
    const interval = setInterval(() => {
      setDotCount((prev) => (prev >= 3 ? 1 : prev + 1));
    }, 350);
    return () => clearInterval(interval);
  }, []);

  const dots = ".".repeat(dotCount);

  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/70 border border-blue-200/80 dark:border-blue-800/70 text-[11px] font-bold text-blue-700 dark:text-blue-300 shrink-0 select-none shadow-2xs">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping shrink-0" />
      <span>Downloading{dots}</span>
    </span>
  );
}

interface StudentSchoolTreeProps {
  className: string;
  subjects: StudentSchoolSubject[];
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

export default function StudentSchoolTree({
  className,
  subjects,
  student,
  onPreviewNote,
  onOpenPracticeTest,
  downloadingNoteId,
  openingNoteId,
  openErrorNoteId,
  isAdmin = false,
}: StudentSchoolTreeProps) {
  const activeDownloadingId = downloadingNoteId || openingNoteId;
  const storageKeyPrefix = `school_tree_${className || student?.classGrade || "def"}_${student?.id || "anon"}`;

  const [searchQuery, setSearchQuery] = useState(() => {
    try {
      return sessionStorage.getItem(`${storageKeyPrefix}_search`) || "";
    } catch {
      return "";
    }
  });

  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>(() => {
    try {
      const saved = sessionStorage.getItem(`${storageKeyPrefix}_expanded`);
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });

  const [, setTestBankTick] = useState(0);
  const [localDownloadingId, setLocalDownloadingId] = useState<string | null>(null);
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
  }, [student?.id, student?.name]);

  const toggleModule = (moduleKey: string) => {
    setExpandedModules((prev) => ({
      ...prev,
      [moduleKey]: !(prev[moduleKey] ?? true), // default expanded
    }));
  };

  const cleanQuery = searchQuery.trim().toLowerCase();

  // Filter subjects and chapters by search
  const filteredSubjects = useMemo(() => {
    if (!cleanQuery) return subjects;

    return subjects
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
          .filter(Boolean) as StudentSchoolModule[];

        if (subjMatch || matchedModules.length > 0) {
          return {
            ...subj,
            modules: subjMatch ? subj.modules : matchedModules,
          };
        }
        return null;
      })
      .filter(Boolean) as StudentSchoolSubject[];
  }, [subjects, cleanQuery]);

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
    if (allModuleKeys.length === 0) return false;
    return allModuleKeys.every((key) => expandedModules[key] !== false);
  }, [allModuleKeys, expandedModules]);

  const handleToggleExpandCollapseAll = () => {
    const nextState = !areAllExpanded;
    const nextMods: Record<string, boolean> = {};
    allModuleKeys.forEach((key) => {
      nextMods[key] = nextState;
    });
    setExpandedModules(nextMods);
  };

  const totalChaptersCount = useMemo(() => {
    return filteredSubjects.reduce((acc, s) => acc + s.modules.length, 0);
  }, [filteredSubjects]);

  return (
    <div className="flex flex-col gap-3 h-full overflow-hidden" id="student-school-tree-container">
      {/* Search Input Bar & Single Toggle Button */}
      <div className="flex items-center gap-2 shrink-0" id="school-search-bar-row">
        <div className="relative flex-1" id="school-chapter-search">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search chapters or topics..."
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
          title={areAllExpanded ? "Collapse All Chapters" : "Expand All Chapters"}
        >
          {areAllExpanded ? "Collapse All" : "Expand All"}
        </button>
      </div>

      {/* Chapters List without duplicate Subject container */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-2.5 scrollbar-thin" id="school-tree-scroll-area">
        {filteredSubjects.length === 0 || totalChaptersCount === 0 ? (
          <div className="flex flex-col items-center justify-center p-10 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-900/30">
            <div className="p-3 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-2xl mb-2">
              <BookOpen className="w-6 h-6" />
            </div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
              {cleanQuery ? "No matching chapters or topics found." : "No chapters available."}
            </p>
            <p className="text-xs text-slate-400 mt-1 max-w-sm">
              {cleanQuery ? "Try searching for a different keyword." : "Notes uploaded by your tutor will appear here in real time."}
            </p>
          </div>
        ) : (
          filteredSubjects.map((subj) => (
            <div key={subj.subjectKey} className="space-y-2">
              {filteredSubjects.length > 1 && (
                <div className="px-1 pt-1">
                  <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    {subj.subject}
                  </h4>
                </div>
              )}

              {subj.modules.map((mod) => {
                const modKey = `${subj.subjectKey}_${mod.moduleKey}`;
                const isModExpanded = cleanQuery ? true : (expandedModules[modKey] ?? true);

                return (
                  <div
                    key={mod.moduleKey}
                    className="border border-slate-200 dark:border-slate-800/90 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-2xs transition-all"
                    id={`school-chapter-${modKey}`}
                  >
                    {/* Chapter Header (Collapsible) */}
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

                      <div className="shrink-0 ml-2 self-center">
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
                            No topics uploaded in this chapter yet.
                          </div>
                        ) : (
                          mod.topics.map((topic) => {
                            const isDownloading = (activeDownloadingId === topic.id) || (localDownloadingId === topic.id);
                            const hasError = (openErrorNoteId === topic.id) || (localErrorId === topic.id);
                            const isAnyDownloading = Boolean(activeDownloadingId) || Boolean(localDownloadingId);
                            const targetClass = className || student.classGrade || (topic.note as any).classGrade || "";
                            const targetSubj = subj.subject || (topic.note as any).subject || "";
                            const chapterNo = mod.moduleNo || (topic.note as any).chapterNo || 1;

                            // Check if an attached practice test actually exists with uploaded questions
                            const topicTest =
                              getTopicPracticeTestSync(targetClass, targetSubj, chapterNo, topic.topicName) ||
                              getTopicPracticeTestSync(targetClass, targetSubj, chapterNo, topic.topicLabel) ||
                              getTopicPracticeTestSync(targetClass, targetSubj, chapterNo, (topic.note as any).topicTitle || "") ||
                              (Array.isArray((topic.note as any).practiceTestQuestions) && (topic.note as any).practiceTestQuestions.length > 0
                                ? { questions: (topic.note as any).practiceTestQuestions }
                                : null);

                            const hasTest = !!(topicTest && Array.isArray(topicTest.questions) && topicTest.questions.length > 0);

                            const stats = getTopicTestStats(
                              allAttempts,
                              student.id,
                              student.name,
                              targetClass,
                              targetSubj,
                              chapterNo,
                              topic.topicName || topic.topicLabel
                            );

                            const handleTopicClick = async () => {
                              if (isDownloading) return;
                              const isRetry = hasError;
                              setLocalErrorId(null);
                              setLocalErrorMsg("");
                              setLocalDownloadingId(topic.id);

                              const topicId = topic.id;
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
                                console.error("[StudentSchoolTree] Error opening note:", err);
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
                                setLocalDownloadingId(null);
                              }
                            };

                            return (
                              <div
                                key={topic.id}
                                onClick={handleTopicClick}
                                className={`group flex flex-col rounded-lg transition-all select-none ${
                                  isDownloading
                                    ? "opacity-90 bg-blue-50/70 dark:bg-blue-950/40 cursor-wait pointer-events-none"
                                    : "hover:bg-slate-100/90 dark:hover:bg-slate-800/70 cursor-pointer"
                                } ${hasError ? "bg-rose-50/50 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-900/60" : ""}`}
                                id={`school-topic-${topic.id}`}
                                title={isDownloading ? "Downloading note..." : hasError ? "Failed to load. Tap to try again" : "Tap to open note in browser"}
                              >
                                {/* Main Topic Content Row */}
                                <div className="flex items-start sm:items-center justify-between gap-2.5 px-3 py-2">
                                  {/* Left: Icon, Full Topic Name, and Downloading / Try Again Indicator */}
                                  <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
                                    <span className="mt-0.5 sm:mt-0 shrink-0">
                                      {topic.fileType === "image" ? (
                                        <ImageIcon className="w-4 h-4 text-amber-500" />
                                      ) : (
                                        <FileText className="w-4 h-4 text-blue-500" />
                                      )}
                                    </span>

                                    <div className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
                                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors break-words whitespace-normal leading-relaxed">
                                        {topic.topicName}
                                      </span>

                                      {isDownloading && <AnimatedDownloadingIndicator />}

                                      {hasError && !isDownloading && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 text-[11px] font-bold shrink-0 animate-fadeIn">
                                          Try Again
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Right: Attached Test Button / Obtained Score */}
                                  {hasTest && (
                                    <div className="shrink-0 self-start sm:self-center">
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
          ))
        )}
      </div>
    </div>
  );
}
