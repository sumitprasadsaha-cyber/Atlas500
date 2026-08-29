import React, { useState, useMemo, useEffect } from "react";
import { 
  ChevronRight, 
  ChevronDown, 
  BookOpen, 
  FileText, 
  Image as ImageIcon,
  Search, 
  X,
  FlaskConical
} from "lucide-react";
import { Student, ClassNote, ChapterNote } from "../types";
import { StudentSchoolSubject, StudentSchoolModule } from "../utils/studentSchoolHierarchyHelper";
import { getTopicPracticeTestSync, subscribeToPracticeTests } from "../lib/practiceTestService";

interface StudentSchoolTreeProps {
  className: string;
  subjects: StudentSchoolSubject[];
  student: Student;
  onPreviewNote: (note: ClassNote | ChapterNote) => void;
  onToggleTopicCompletion?: (note: ClassNote | ChapterNote, subject: string, isCompleted: boolean) => void;
  onOpenPracticeTest?: (testTarget: {
    classGrade: string;
    subject: string;
    chapterNo: number;
    chapterName: string;
    topicName: string;
    testType: "topic" | "full_chapter";
  }) => void;
  openingNoteId?: string | null;
  isAdmin?: boolean;
}

export default function StudentSchoolTree({
  className,
  subjects,
  student,
  onPreviewNote,
  onOpenPracticeTest,
  openingNoteId,
  isAdmin = false,
}: StudentSchoolTreeProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});
  const [, setTestBankTick] = useState(0);

  // Subscribe to real-time practice test changes so attached tests update instantly
  useEffect(() => {
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
  }, []);

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
                      className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50/70 dark:bg-slate-850/50 hover:bg-slate-100/80 dark:hover:bg-slate-800/70 cursor-pointer select-none transition-colors border-b border-slate-100 dark:border-slate-800/60"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 pr-2">
                        <span className="text-slate-400 shrink-0">
                          {isModExpanded ? <ChevronDown className="w-4 h-4 text-slate-600 dark:text-slate-300" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                        </span>
                        <h5 className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                          {mod.moduleTitle}
                        </h5>
                      </div>

                      <div className="shrink-0">
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
                            const isOpening = openingNoteId === topic.id;
                            const targetClass = className || student.classGrade || (topic.note as any).classGrade || "";
                            const targetSubj = subj.subject || (topic.note as any).subject || "";
                            const chapterNo = mod.moduleNo || (topic.note as any).chapterNo || 1;

                            // Check if an attached practice test exists for this topic
                            const topicTest =
                              getTopicPracticeTestSync(targetClass, targetSubj, chapterNo, topic.topicName) ||
                              getTopicPracticeTestSync(targetClass, targetSubj, chapterNo, topic.topicLabel) ||
                              getTopicPracticeTestSync(targetClass, targetSubj, chapterNo, (topic.note as any).topicTitle || "") ||
                              ((topic.note as any).hasPracticeTest ? { questions: [{ id: "1" }] } : null);

                            const hasTest = !!(topicTest && Array.isArray(topicTest.questions) && topicTest.questions.length > 0);

                            return (
                              <div
                                key={topic.id}
                                onClick={() => onPreviewNote(topic.note)}
                                className={`group flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100/90 dark:hover:bg-slate-800/70 transition-colors cursor-pointer select-none ${
                                  isOpening ? "opacity-75 bg-blue-50/50 dark:bg-blue-950/30" : ""
                                }`}
                                id={`school-topic-${topic.id}`}
                                title="Tap to open note in browser"
                              >
                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                  {topic.fileType === "image" ? (
                                    <ImageIcon className="w-4 h-4 text-amber-500 shrink-0" />
                                  ) : (
                                    <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                                  )}

                                  <span className="truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                    {topic.topicName}
                                  </span>

                                  {isOpening && (
                                    <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 animate-pulse shrink-0">
                                      Opening...
                                    </span>
                                  )}
                                </div>

                                {/* Attached Test Button (Only displayed if test exists for this topic) */}
                                {hasTest && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onOpenPracticeTest?.({
                                        classGrade: targetClass,
                                        subject: targetSubj,
                                        chapterNo: mod.moduleNo,
                                        chapterName: mod.moduleName,
                                        topicName: topic.topicName,
                                        testType: "topic",
                                      });
                                    }}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/90 dark:border-emerald-800/80 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 cursor-pointer transition active:scale-95 shrink-0 shadow-2xs"
                                    title="Take Practice Test"
                                    aria-label={`Take practice test for ${topic.topicName}`}
                                  >
                                    <FlaskConical className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                    <span>Test</span>
                                  </button>
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
