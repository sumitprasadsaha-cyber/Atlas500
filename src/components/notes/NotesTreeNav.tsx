import React, { useState } from "react";
import { 
  ChevronRight, 
  ChevronDown, 
  School, 
  GraduationCap, 
  BookOpen, 
  Folder, 
  FolderOpen,
  Layers, 
  ChevronsUpDown,
  Plus
} from "lucide-react";
import { ClassNote } from "../../types";

export interface SelectedNode {
  type: "school" | "upsc";
  className?: string; // e.g. "Class 10"
  gsPaper?: string; // e.g. "General Studies Paper II"
  subject?: string; // e.g. "Mathematics"
  chapterNumber?: number;
  chapterName?: string;
  moduleNumber?: number;
  moduleName?: string;
}

interface NotesTreeNavProps {
  type: "school" | "upsc";
  notes: ClassNote[];
  selectedNode: SelectedNode | null;
  onSelectNode: (node: SelectedNode) => void;
  onAddChapterModule?: (context: {
    type: "school" | "upsc";
    className?: string;
    gsPaper?: string;
    subject: string;
  }) => void;
  isAdmin?: boolean;
}

export default function NotesTreeNav({
  type,
  notes,
  selectedNode,
  onSelectNode,
  onAddChapterModule,
  isAdmin = false,
}: NotesTreeNavProps) {
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});

  const toggleExpand = (key: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const isSchool = type === "school";

  // Build Hierarchy Tree
  if (isSchool) {
    // School hierarchy: Class -> Subject -> Chapter -> Topics
    const classMap: Record<string, Record<string, Record<number, { name: string; topics: ClassNote[] }>>> = {};

    notes.forEach((note) => {
      const cls = (note as any).className || note.classGrade || (note as any).class || "Class 10";
      const subj = (note as any).subjectName || note.subject || "General";
      const rawChNo = (note as any).chapterNumber ?? note.chapterNo ?? 1;
      const chNo = typeof rawChNo === "number" ? rawChNo : parseInt(String(rawChNo).replace(/\D/g, ""), 10) || 1;
      const chName = (note as any).chapterTitle || (note as any).chapterName || note.chapterName || `Chapter ${chNo}`;

      if (!classMap[cls]) classMap[cls] = {};
      if (!classMap[cls][subj]) classMap[cls][subj] = {};
      if (!classMap[cls][subj][chNo]) {
        classMap[cls][subj][chNo] = { name: chName, topics: [] };
      }
      classMap[cls][subj][chNo].topics.push(note);
    });

    const classKeys = Object.keys(classMap).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ""), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ""), 10) || 0;
      return numA - numB || a.localeCompare(b);
    });

    return (
      <div className="space-y-1 text-xs font-semibold select-none" id="school-tree-nav">
        {classKeys.length === 0 ? (
          <p className="text-xs text-slate-400 p-3 italic">No school notes uploaded yet.</p>
        ) : (
          classKeys.map((cls) => {
            const classKey = `class-${cls}`;
            const isClassExpanded = expandedKeys[classKey] ?? true;
            const subjects = Object.keys(classMap[cls]).sort();
            const totalClassTopics = subjects.reduce(
              (acc, s) => acc + Object.values(classMap[cls][s]).reduce((a2, ch) => a2 + ch.topics.length, 0),
              0
            );

            return (
              <div key={classKey} className="rounded-xl overflow-hidden">
                {/* Level 1: Class */}
                <div
                  onClick={() => {
                    toggleExpand(classKey);
                    onSelectNode({ type: "school", className: cls });
                  }}
                  className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
                    selectedNode?.className === cls && !selectedNode?.subject
                      ? "bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-bold"
                      : "hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-800 dark:text-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span 
                      onClick={(e) => toggleExpand(classKey, e)}
                      className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      {isClassExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </span>
                    <School className="w-4 h-4 text-blue-500 shrink-0" />
                    <span className="truncate">{cls}</span>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-mono">
                    {totalClassTopics}
                  </span>
                </div>

                {/* Level 2: Subjects */}
                {isClassExpanded && (
                  <div className="pl-4 ml-2 border-l border-slate-200/80 dark:border-slate-800 space-y-0.5 mt-0.5">
                    {subjects.map((subj) => {
                      const subjKey = `subj-${cls}-${subj}`;
                      const isSubjExpanded = expandedKeys[subjKey] ?? true;
                      const chapters = Object.keys(classMap[cls][subj])
                        .map(Number)
                        .sort((a, b) => a - b);
                      const totalSubjTopics = chapters.reduce((acc, c) => acc + classMap[cls][subj][c].topics.length, 0);

                      const isSubjSelected =
                        selectedNode?.className === cls &&
                        selectedNode?.subject === subj &&
                        !selectedNode?.chapterNumber;

                      return (
                        <div key={subjKey}>
                          <div
                            onClick={() => {
                              toggleExpand(subjKey);
                              onSelectNode({ type: "school", className: cls, subject: subj });
                            }}
                            className={`group flex items-center justify-between px-2 py-1 rounded-lg cursor-pointer transition-colors ${
                              isSubjSelected
                                ? "bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-bold"
                                : "hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span 
                                onClick={(e) => toggleExpand(subjKey, e)}
                                className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                              >
                                {isSubjExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                              </span>
                              <BookOpen className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                              <span className="truncate">{subj}</span>
                            </div>

                            <div className="flex items-center gap-1">
                              {isAdmin && onAddChapterModule && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onAddChapterModule({ type: "school", className: cls, subject: subj });
                                  }}
                                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-opacity"
                                  title="Add Chapter"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              )}
                              <span className="text-[10px] text-slate-400 font-mono">
                                {totalSubjTopics}
                              </span>
                            </div>
                          </div>

                          {/* Level 3: Chapters */}
                          {isSubjExpanded && (
                            <div className="pl-4 ml-1.5 border-l border-slate-200/80 dark:border-slate-800 space-y-0.5 mt-0.5">
                              {chapters.map((chNo) => {
                                const chData = classMap[cls][subj][chNo];
                                const isChSelected =
                                  selectedNode?.className === cls &&
                                  selectedNode?.subject === subj &&
                                  selectedNode?.chapterNumber === chNo;

                                return (
                                  <div
                                    key={`ch-${cls}-${subj}-${chNo}`}
                                    onClick={() =>
                                      onSelectNode({
                                        type: "school",
                                        className: cls,
                                        subject: subj,
                                        chapterNumber: chNo,
                                        chapterName: chData.name,
                                      })
                                    }
                                    className={`flex items-center justify-between px-2 py-1 rounded-lg cursor-pointer transition-colors ${
                                      isChSelected
                                        ? "bg-blue-600 text-white font-bold shadow-2xs"
                                        : "hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-600 dark:text-slate-400"
                                    }`}
                                  >
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      {isChSelected ? (
                                        <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                                      ) : (
                                        <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                      )}
                                      <span className="truncate">
                                        Ch {chNo}: {chData.name}
                                      </span>
                                    </div>
                                    <span className={`text-[10px] font-mono px-1 rounded-sm ${
                                      isChSelected ? "bg-blue-700 text-white" : "text-slate-400"
                                    }`}>
                                      {chData.topics.length}
                                    </span>
                                  </div>
                                );
                              })}
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
    );
  }

  // UPSC Hierarchy: GS Paper -> Subject -> Module -> Topics
  const gsMap: Record<string, Record<string, Record<number, { name: string; topics: ClassNote[] }>>> = {};

  notes.forEach((note) => {
    const gs = (note as any).gsPaper || (note as any).generalStudiesPaper || (note as any).paper || "General Studies Paper I";
    const subj = (note as any).subjectName || note.subject || "General";
    const rawModNo = (note as any).moduleNumber ?? (note as any).moduleNo ?? (note as any).module_number ?? 1;
    const modNo = typeof rawModNo === "number" ? rawModNo : parseInt(String(rawModNo).replace(/\D/g, ""), 10) || 1;
    const modName = (note as any).moduleTitle || (note as any).moduleName || (note as any).module_name || `Module ${modNo}`;

    if (!gsMap[gs]) gsMap[gs] = {};
    if (!gsMap[gs][subj]) gsMap[gs][subj] = {};
    if (!gsMap[gs][subj][modNo]) {
      gsMap[gs][subj][modNo] = { name: modName, topics: [] };
    }
    gsMap[gs][subj][modNo].topics.push(note);
  });

  const gsKeys = Object.keys(gsMap).sort();

  return (
    <div className="space-y-1 text-xs font-semibold select-none" id="upsc-tree-nav">
      {gsKeys.length === 0 ? (
        <p className="text-xs text-slate-400 p-3 italic">No UPSC notes uploaded yet.</p>
      ) : (
        gsKeys.map((gs) => {
          const gsKey = `gs-${gs}`;
          const isGsExpanded = expandedKeys[gsKey] ?? true;
          const subjects = Object.keys(gsMap[gs]).sort();
          const totalGsTopics = subjects.reduce(
            (acc, s) => acc + Object.values(gsMap[gs][s]).reduce((a2, m) => a2 + m.topics.length, 0),
            0
          );

          return (
            <div key={gsKey} className="rounded-xl overflow-hidden">
              {/* Level 1: GS Paper */}
              <div
                onClick={() => {
                  toggleExpand(gsKey);
                  onSelectNode({ type: "upsc", gsPaper: gs });
                }}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
                  selectedNode?.gsPaper === gs && !selectedNode?.subject
                    ? "bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-bold"
                    : "hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-800 dark:text-slate-200"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span 
                    onClick={(e) => toggleExpand(gsKey, e)}
                    className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {isGsExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </span>
                  <GraduationCap className="w-4 h-4 text-indigo-500 shrink-0" />
                  <span className="truncate">{gs}</span>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-mono">
                  {totalGsTopics}
                </span>
              </div>

              {/* Level 2: Subjects */}
              {isGsExpanded && (
                <div className="pl-4 ml-2 border-l border-slate-200/80 dark:border-slate-800 space-y-0.5 mt-0.5">
                  {subjects.map((subj) => {
                    const subjKey = `upsc-subj-${gs}-${subj}`;
                    const isSubjExpanded = expandedKeys[subjKey] ?? true;
                    const modules = Object.keys(gsMap[gs][subj])
                      .map(Number)
                      .sort((a, b) => a - b);
                    const totalSubjTopics = modules.reduce((acc, m) => acc + gsMap[gs][subj][m].topics.length, 0);

                    const isSubjSelected =
                      selectedNode?.gsPaper === gs &&
                      selectedNode?.subject === subj &&
                      !selectedNode?.moduleNumber;

                    return (
                      <div key={subjKey}>
                        <div
                          onClick={() => {
                            toggleExpand(subjKey);
                            onSelectNode({ type: "upsc", gsPaper: gs, subject: subj });
                          }}
                          className={`group flex items-center justify-between px-2 py-1 rounded-lg cursor-pointer transition-colors ${
                            isSubjSelected
                              ? "bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 font-bold"
                              : "hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span 
                              onClick={(e) => toggleExpand(subjKey, e)}
                              className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                            >
                              {isSubjExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            </span>
                            <BookOpen className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                            <span className="truncate">{subj}</span>
                          </div>

                          <div className="flex items-center gap-1">
                            {isAdmin && onAddChapterModule && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAddChapterModule({ type: "upsc", gsPaper: gs, subject: subj });
                                }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-opacity"
                                title="Add Module"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            )}
                            <span className="text-[10px] text-slate-400 font-mono">
                              {totalSubjTopics}
                            </span>
                          </div>
                        </div>

                        {/* Level 3: Modules */}
                        {isSubjExpanded && (
                          <div className="pl-4 ml-1.5 border-l border-slate-200/80 dark:border-slate-800 space-y-0.5 mt-0.5">
                            {modules.map((modNo) => {
                              const modData = gsMap[gs][subj][modNo];
                              const isModSelected =
                                selectedNode?.gsPaper === gs &&
                                selectedNode?.subject === subj &&
                                selectedNode?.moduleNumber === modNo;

                              return (
                                <div
                                  key={`mod-${gs}-${subj}-${modNo}`}
                                  onClick={() =>
                                    onSelectNode({
                                      type: "upsc",
                                      gsPaper: gs,
                                      subject: subj,
                                      moduleNumber: modNo,
                                      moduleName: modData.name,
                                    })
                                  }
                                  className={`flex items-center justify-between px-2 py-1 rounded-lg cursor-pointer transition-colors ${
                                    isModSelected
                                      ? "bg-blue-600 text-white font-bold shadow-2xs"
                                      : "hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-600 dark:text-slate-400"
                                  }`}
                                >
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    {isModSelected ? (
                                      <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                                    ) : (
                                      <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                    )}
                                    <span className="truncate">
                                      Mod {modNo}: {modData.name}
                                    </span>
                                  </div>
                                  <span className={`text-[10px] font-mono px-1 rounded-sm ${
                                    isModSelected ? "bg-blue-700 text-white" : "text-slate-400"
                                  }`}>
                                    {modData.topics.length}
                                  </span>
                                </div>
                              );
                            })}
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
  );
}
