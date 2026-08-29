import React, { useState, useMemo, useEffect, useCallback } from "react";
import { 
  School, 
  GraduationCap, 
  Search, 
  Plus, 
  RefreshCw, 
  Trash2, 
  ChevronRight,
  BookOpen,
  Layers,
  HardDrive,
  FileText,
  AlertTriangle,
  X,
  Sparkles,
  Upload,
  CheckCircle2,
  FileCheck,
  ChevronDown,
  MoreVertical,
  MoreHorizontal
} from "lucide-react";
import { ClassNote, Student } from "../../types";
import { 
  uploadNotePipeline, 
  replaceNotePipeline, 
  deleteNotePipeline, 
  renameNotePipeline,
  renameSubjectPipeline,
  deleteChapterPipeline,
  deleteClassPipeline,
  deleteSubjectPipeline,
  deletePaperPipeline
} from "../../lib/notesService";
import { searchHierarchicalNotes } from "../../utils/notesHierarchyHelper";
import { fetchAllPracticeTests, buildTopicTestId, subscribeToPracticeTests, getTopicPracticeTestSync } from "../../lib/practiceTestService";

import TopicCard from "./TopicCard";
import QuickAddTopicModal, { ParentContext } from "./QuickAddTopicModal";
import CreateHierarchyNodeModal, { 
  CreateHierarchyNodeContext, 
  NodeType 
} from "./CreateHierarchyNodeModal";
import NotesPreviewModal from "./NotesPreviewModal";
import AdminPracticeTestModal from "../AdminPracticeTestModal";
import NotesMainPanel from "./NotesMainPanel";
import Toast from "../Toast";
import {
  getSchoolHierarchy,
  getUpscHierarchy,
  saveSchoolHierarchy,
  saveUpscHierarchy,
  subscribeToCurriculumHierarchy,
  getSavedNotesSelectionState,
  saveNotesSelectionState,
  extractHierarchyFromNotes,
  SchoolHierarchyData,
  UpscHierarchyData
} from "../../lib/curriculumService";

interface AdminNotesDashboardProps {
  notes: ClassNote[];
  students?: Student[];
  onRefresh?: () => void;
}

export default function AdminNotesDashboard({
  notes = [],
  students = [],
  onRefresh,
}: AdminNotesDashboardProps) {
  // Load saved active selections
  const initialSelection = useMemo(() => getSavedNotesSelectionState(), []);

  // Top Level Mode: School vs UPSC
  const [activeTab, setActiveTab] = useState<"school" | "upsc">(initialSelection.activeTab || "school");

  // Custom Created Hierarchy Nodes from Curriculum Service (Firestore + Local)
  const [schoolHierarchy, setSchoolHierarchy] = useState<SchoolHierarchyData>(() => getSchoolHierarchy());
  const [upscHierarchy, setUpscHierarchy] = useState<UpscHierarchyData>(() => getUpscHierarchy());

  const customSchoolClasses = schoolHierarchy.classes;
  const customSchoolSubjects = schoolHierarchy.subjects;
  const customSchoolChapters = schoolHierarchy.chapters;
  const removedSchoolSubjects = schoolHierarchy.removedSubjects;

  const customUpscPapers = upscHierarchy.papers;
  const customUpscSubjects = upscHierarchy.subjects;
  const customUpscModules = upscHierarchy.modules;
  const removedUpscSubjects = upscHierarchy.removedSubjects;

  // Active Hierarchy Selection State - School (Dynamic, no hardcoded defaults)
  const [selectedSchoolClass, setSelectedSchoolClass] = useState<string>(initialSelection.selectedSchoolClass || "");
  const [selectedSchoolSubject, setSelectedSchoolSubject] = useState<string>(initialSelection.selectedSchoolSubject || "");
  const [selectedSchoolChapterNo, setSelectedSchoolChapterNo] = useState<number>(initialSelection.selectedSchoolChapterNo || 0);
  const [selectedSchoolChapterName, setSelectedSchoolChapterName] = useState<string>(initialSelection.selectedSchoolChapterName || "");

  // Active Hierarchy Selection State - UPSC (Dynamic, no hardcoded defaults)
  const [selectedUpscPaper, setSelectedUpscPaper] = useState<string>(initialSelection.selectedUpscPaper || "");
  const [selectedUpscSubject, setSelectedUpscSubject] = useState<string>(initialSelection.selectedUpscSubject || "");
  const [selectedUpscModuleNo, setSelectedUpscModuleNo] = useState<number>(initialSelection.selectedUpscModuleNo || 0);
  const [selectedUpscModuleName, setSelectedUpscModuleName] = useState<string>(initialSelection.selectedUpscModuleName || "");

  // Accordion state: map of expanded chapter numbers
  const [expandedChapters, setExpandedChapters] = useState<Record<number, boolean>>({});

  // Active Selected Topic Note ID for 3rd Panel
  const [selectedTopicNoteId, setSelectedTopicNoteId] = useState<string | null>(initialSelection.selectedTopicNoteId || null);

  // Unified hierarchy update and persistence helpers
  const updateSchoolHierarchy = useCallback((updater: (prev: SchoolHierarchyData) => SchoolHierarchyData) => {
    setSchoolHierarchy((prev) => {
      const next = updater(prev);
      saveSchoolHierarchy(next);
      return next;
    });
  }, []);

  const updateUpscHierarchy = useCallback((updater: (prev: UpscHierarchyData) => UpscHierarchyData) => {
    setUpscHierarchy((prev) => {
      const next = updater(prev);
      saveUpscHierarchy(next);
      return next;
    });
  }, []);

  // Subscribe to real-time curriculum hierarchy updates
  useEffect(() => {
    const unsub = subscribeToCurriculumHierarchy((data) => {
      setSchoolHierarchy(data.school);
      setUpscHierarchy(data.upsc);
    });
    return () => unsub();
  }, []);

  // Sync existing notes into curriculum hierarchy non-destructively
  useEffect(() => {
    if (notes && notes.length > 0) {
      const { school: mergedSchool, upsc: mergedUpsc, added } = extractHierarchyFromNotes(
        notes,
        getSchoolHierarchy(),
        getUpscHierarchy()
      );
      if (added) {
        saveSchoolHierarchy(mergedSchool);
        saveUpscHierarchy(mergedUpsc);
      }
    }
  }, [notes]);

  // Persist selections whenever they change
  useEffect(() => {
    saveNotesSelectionState({
      activeTab,
      selectedSchoolClass,
      selectedSchoolSubject,
      selectedSchoolChapterNo,
      selectedSchoolChapterName,
      selectedUpscPaper,
      selectedUpscSubject,
      selectedUpscModuleNo,
      selectedUpscModuleName,
      selectedTopicNoteId
    });
  }, [
    activeTab,
    selectedSchoolClass,
    selectedSchoolSubject,
    selectedSchoolChapterNo,
    selectedSchoolChapterName,
    selectedUpscPaper,
    selectedUpscSubject,
    selectedUpscModuleNo,
    selectedUpscModuleName,
    selectedTopicNoteId
  ]);

  // Modals state
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [createNodeContext, setCreateNodeContext] = useState<CreateHierarchyNodeContext | null>(null);
  const [previewNote, setPreviewNote] = useState<ClassNote | null>(null);

  // Replace & Rename Modals
  const [replacingNote, setReplacingNote] = useState<ClassNote | null>(null);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [isReplacing, setIsReplacing] = useState(false);

  const [renamingNote, setRenamingNote] = useState<ClassNote | null>(null);
  const [renameTopicNumber, setRenameTopicNumber] = useState<number | "">(1);
  const [renameTopicTitle, setRenameTopicTitle] = useState("");
  const [renameChapterTitle, setRenameChapterTitle] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  // Topic Delete Modal
  const [deletingNote, setDeletingNote] = useState<ClassNote | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Subject Rename Modal state
  const [renamingSubject, setRenamingSubject] = useState<{
    type: "school" | "upsc";
    className?: string;
    gsPaper?: string;
    oldSubject: string;
    newSubject: string;
  } | null>(null);
  const [isRenamingSubject, setIsRenamingSubject] = useState(false);

  // Rename Chapter / Module Modal State
  const [renamingChapter, setRenamingChapter] = useState<{
    type: "school" | "upsc";
    className?: string;
    gsPaper?: string;
    subject: string;
    oldNumber: number;
    oldName: string;
    newNumber: number | "";
    newName: string;
  } | null>(null);
  const [isRenamingChapter, setIsRenamingChapter] = useState(false);

  // Delete Class Modal State
  const [deletingClass, setDeletingClass] = useState<string | null>(null);
  const [isDeletingClass, setIsDeletingClass] = useState(false);

  // Delete GS Paper Modal State
  const [deletingPaper, setDeletingPaper] = useState<string | null>(null);
  const [isDeletingPaper, setIsDeletingPaper] = useState(false);

  // Delete Subject Modal State
  const [deletingSubject, setDeletingSubject] = useState<{
    type: "school" | "upsc";
    className?: string;
    gsPaper?: string;
    subject: string;
  } | null>(null);
  const [isDeletingSubject, setIsDeletingSubject] = useState(false);

  // Delete Chapter / Module Modal State
  const [deletingChapter, setDeletingChapter] = useState<{
    type: "school" | "upsc";
    className?: string;
    gsPaper?: string;
    subject: string;
    chapterNumber: number;
    chapterName: string;
  } | null>(null);
  const [isDeletingChapter, setIsDeletingChapter] = useState(false);

  // Practice Test Bank & Modal state
  const [practiceTestBank, setPracticeTestBank] = useState<Record<string, any>>({});
  const [practiceTestTarget, setPracticeTestTarget] = useState<{
    classGrade: string;
    subject: string;
    chapterNo: number;
    chapterName: string;
    topicName: string;
    noteId?: string;
  } | null>(null);

  // Toast feedback
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Load practice tests bank on mount and refresh
  const loadPracticeTests = useCallback(async () => {
    try {
      const tests = await fetchAllPracticeTests();
      if (tests) {
        setPracticeTestBank(tests);
      }
    } catch (e) {
      console.warn("[AdminNotesDashboard] Failed to fetch practice tests:", e);
    }
  }, []);

  useEffect(() => {
    loadPracticeTests();
    const unsub = subscribeToPracticeTests((updatedBank) => {
      setPracticeTestBank(updatedBank);
    });
    const handleUpdate = () => {
      loadPracticeTests();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("practice-tests-updated", handleUpdate);
      window.addEventListener("storage", handleUpdate);
    }
    return () => {
      if (unsub) unsub();
      if (typeof window !== "undefined") {
        window.removeEventListener("practice-tests-updated", handleUpdate);
        window.removeEventListener("storage", handleUpdate);
      }
    };
  }, [loadPracticeTests]);

  // Helper to check if a topic note has an active practice test
  const checkIfTopicHasPracticeTest = useCallback((note: ClassNote): boolean => {
    if (!note) return false;
    if ((note as any).hasPracticeTest || (note as any).hasTest) return true;
    const classGrade = (note as any).className || note.classGrade || (note as any).class || "";
    const subject = (note as any).subjectName || note.subject || "";
    const chapterNo = (note as any).chapterNumber ?? note.chapterNo ?? 1;
    const topicName = (note as any).topicTitle || (note as any).topicName || note.partLabel || "";
    const testId = (note as any).practiceTestId || buildTopicTestId(classGrade, subject, Number(chapterNo), topicName);
    if (practiceTestBank[testId] && Array.isArray(practiceTestBank[testId].questions) && practiceTestBank[testId].questions.length > 0) {
      return true;
    }
    const syncTest = getTopicPracticeTestSync(classGrade, subject, Number(chapterNo), topicName);
    return Boolean(syncTest && Array.isArray(syncTest.questions) && syncTest.questions.length > 0);
  }, [practiceTestBank]);

  // Separate Notes by Category: School vs UPSC
  const { schoolNotes, upscNotes } = useMemo(() => {
    const sNotes: ClassNote[] = [];
    const uNotes: ClassNote[] = [];

    (notes || []).forEach((n) => {
      const isUpsc = 
        (n as any).type === "upsc" || 
        Boolean((n as any).gsPaper) || 
        Boolean((n as any).generalStudiesPaper) || 
        (n as any).category === "upsc" ||
        String(n.classGrade || "").toLowerCase().includes("upsc") ||
        String((n as any).className || "").toLowerCase().includes("upsc");

      if (isUpsc) {
        uNotes.push(n);
      } else {
        sNotes.push(n);
      }
    });

    return { schoolNotes: sNotes, upscNotes: uNotes };
  }, [notes]);

  // =========================================================================
  // SCHOOL HIERARCHY COMPUTATION (Dynamic from storage & notes)
  // =========================================================================
  const schoolClasses = useMemo(() => {
    const set = new Set<string>();
    customSchoolClasses.forEach((c) => {
      if (c && c.trim()) set.add(c.trim());
    });
    schoolNotes.forEach((n) => {
      const c = (n as any).className || n.classGrade || (n as any).class;
      if (c && c.trim()) set.add(c.trim());
    });
    return Array.from(set).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ""), 10);
      const numB = parseInt(b.replace(/\D/g, ""), 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });
  }, [customSchoolClasses, schoolNotes]);

  useEffect(() => {
    if (schoolClasses.length > 0) {
      if (!selectedSchoolClass || !schoolClasses.includes(selectedSchoolClass)) {
        setSelectedSchoolClass(schoolClasses[0]);
      }
    } else {
      setSelectedSchoolClass("");
    }
  }, [schoolClasses, selectedSchoolClass]);

  const schoolSubjectsForSelectedClass = useMemo(() => {
    if (!selectedSchoolClass) return [];
    const set = new Set<string>();
    const removedForClass = new Set(removedSchoolSubjects[selectedSchoolClass] || []);

    const customList = customSchoolSubjects[selectedSchoolClass] || [];
    customList.forEach((s) => {
      if (s && s.trim() && !removedForClass.has(s.trim())) set.add(s.trim());
    });

    schoolNotes.forEach((n) => {
      const c = (n as any).className || n.classGrade || (n as any).class || "";
      if (c.toLowerCase() === selectedSchoolClass.toLowerCase()) {
        const s = (n as any).subjectName || n.subject || "";
        if (s && s.trim() && !removedForClass.has(s.trim())) set.add(s.trim());
      }
    });

    return Array.from(set).sort();
  }, [selectedSchoolClass, schoolNotes, customSchoolSubjects, removedSchoolSubjects]);

  useEffect(() => {
    if (schoolSubjectsForSelectedClass.length > 0) {
      if (!selectedSchoolSubject || !schoolSubjectsForSelectedClass.includes(selectedSchoolSubject)) {
        setSelectedSchoolSubject(schoolSubjectsForSelectedClass[0]);
      }
    } else {
      setSelectedSchoolSubject("");
    }
  }, [schoolSubjectsForSelectedClass, selectedSchoolSubject]);

  const schoolChaptersForSelected = useMemo(() => {
    if (!selectedSchoolClass || !selectedSchoolSubject) return [];
    const map = new Map<number, string>();

    const customList = customSchoolChapters[selectedSchoolClass]?.[selectedSchoolSubject] || [];
    customList.forEach((ch) => {
      map.set(ch.number, ch.name || `Chapter ${ch.number}`);
    });

    schoolNotes.forEach((n) => {
      const c = (n as any).className || n.classGrade || (n as any).class || "";
      const s = (n as any).subjectName || n.subject || "";
      if (c.toLowerCase() === selectedSchoolClass.toLowerCase() && s.toLowerCase() === selectedSchoolSubject.toLowerCase()) {
        const rawChNo = (n as any).chapterNumber ?? n.chapterNo ?? 1;
        const chNo = typeof rawChNo === "number" ? rawChNo : parseInt(String(rawChNo).replace(/\D/g, ""), 10) || 1;
        const chName = (n as any).chapterTitle || (n as any).chapterName || `Chapter ${chNo}`;
        map.set(chNo, chName);
      }
    });

    return Array.from(map.entries())
      .map(([number, name]) => ({ number, name }))
      .sort((a, b) => a.number - b.number);
  }, [selectedSchoolClass, selectedSchoolSubject, schoolNotes, customSchoolChapters]);

  useEffect(() => {
    if (schoolChaptersForSelected.length > 0) {
      const exists = schoolChaptersForSelected.find((c) => c.number === selectedSchoolChapterNo);
      if (!exists) {
        setSelectedSchoolChapterNo(schoolChaptersForSelected[0].number);
        setSelectedSchoolChapterName(schoolChaptersForSelected[0].name);
      } else {
        setSelectedSchoolChapterName(exists.name);
      }
    } else {
      setSelectedSchoolChapterNo(0);
      setSelectedSchoolChapterName("");
    }
  }, [schoolChaptersForSelected, selectedSchoolChapterNo]);

  // =========================================================================
  // UPSC HIERARCHY COMPUTATION (Dynamic from storage & notes)
  // =========================================================================
  const upscPapers = useMemo(() => {
    const set = new Set<string>();
    customUpscPapers.forEach((p) => {
      if (p && p.trim()) set.add(p.trim());
    });
    upscNotes.forEach((n) => {
      const p = (n as any).gsPaper || (n as any).generalStudiesPaper || (n as any).paper;
      if (p && p.trim()) set.add(p.trim());
    });
    return Array.from(set).sort();
  }, [customUpscPapers, upscNotes]);

  useEffect(() => {
    if (upscPapers.length > 0) {
      if (!selectedUpscPaper || !upscPapers.includes(selectedUpscPaper)) {
        setSelectedUpscPaper(upscPapers[0]);
      }
    } else {
      setSelectedUpscPaper("");
    }
  }, [upscPapers, selectedUpscPaper]);

  const upscSubjectsForSelectedPaper = useMemo(() => {
    if (!selectedUpscPaper) return [];
    const set = new Set<string>();
    const removedForPaper = new Set(removedUpscSubjects[selectedUpscPaper] || []);

    const customList = customUpscSubjects[selectedUpscPaper] || [];
    customList.forEach((s) => {
      if (s && s.trim() && !removedForPaper.has(s.trim())) set.add(s.trim());
    });

    upscNotes.forEach((n) => {
      const p = (n as any).gsPaper || (n as any).generalStudiesPaper || (n as any).paper || "";
      if (p.toLowerCase() === selectedUpscPaper.toLowerCase()) {
        const s = (n as any).subjectName || n.subject || "";
        if (s && s.trim() && !removedForPaper.has(s.trim())) set.add(s.trim());
      }
    });

    return Array.from(set).sort();
  }, [selectedUpscPaper, upscNotes, customUpscSubjects, removedUpscSubjects]);

  useEffect(() => {
    if (upscSubjectsForSelectedPaper.length > 0) {
      if (!selectedUpscSubject || !upscSubjectsForSelectedPaper.includes(selectedUpscSubject)) {
        setSelectedUpscSubject(upscSubjectsForSelectedPaper[0]);
      }
    } else {
      setSelectedUpscSubject("");
    }
  }, [upscSubjectsForSelectedPaper, selectedUpscSubject]);

  const upscModulesForSelected = useMemo(() => {
    if (!selectedUpscPaper || !selectedUpscSubject) return [];
    const map = new Map<number, string>();

    const customList = customUpscModules[selectedUpscPaper]?.[selectedUpscSubject] || [];
    customList.forEach((m) => {
      map.set(m.number, m.name || `Module ${m.number}`);
    });

    upscNotes.forEach((n) => {
      const p = (n as any).gsPaper || (n as any).generalStudiesPaper || (n as any).paper || "";
      const subj = (n as any).subjectName || n.subject || "";
      if (p.toLowerCase() === selectedUpscPaper.toLowerCase() && subj.toLowerCase() === selectedUpscSubject.toLowerCase()) {
        const rawModNo = (n as any).moduleNumber ?? (n as any).moduleNo ?? (n as any).chapterNumber ?? n.chapterNo ?? 1;
        const modNo = typeof rawModNo === "number" ? rawModNo : parseInt(String(rawModNo).replace(/\D/g, ""), 10) || 1;
        const modName = (n as any).moduleTitle || (n as any).moduleName || (n as any).chapterTitle || (n as any).chapterName || `Module ${modNo}`;
        map.set(modNo, modName);
      }
    });

    return Array.from(map.entries())
      .map(([number, name]) => ({ number, name }))
      .sort((a, b) => a.number - b.number);
  }, [selectedUpscPaper, selectedUpscSubject, upscNotes, customUpscModules]);

  useEffect(() => {
    if (upscModulesForSelected.length > 0) {
      const exists = upscModulesForSelected.find((m) => m.number === selectedUpscModuleNo);
      if (!exists) {
        setSelectedUpscModuleNo(upscModulesForSelected[0].number);
        setSelectedUpscModuleName(upscModulesForSelected[0].name);
      } else {
        setSelectedUpscModuleName(exists.name);
      }
    } else {
      setSelectedUpscModuleNo(0);
      setSelectedUpscModuleName("");
    }
  }, [upscModulesForSelected, selectedUpscModuleNo]);

  // =========================================================================
  // CHAPTER NOTES MAP (For Middle Panel Accordion)
  // =========================================================================
  const chapterNotesMap = useMemo(() => {
    const map = new Map<number, ClassNote[]>();
    const currentNotes = activeTab === "school" ? schoolNotes : upscNotes;
    const currentSubject = (activeTab === "school" ? selectedSchoolSubject : selectedUpscSubject).trim().toLowerCase();

    if (!currentSubject) return map;

    currentNotes.forEach((n) => {
      const s = ((n as any).subjectName || n.subject || "").trim().toLowerCase();
      if (s !== currentSubject) return;

      if (activeTab === "school") {
        const c = ((n as any).className || n.classGrade || (n as any).class || "").trim().toLowerCase();
        if (c !== selectedSchoolClass.trim().toLowerCase()) return;
        const rawCh = (n as any).chapterNumber ?? n.chapterNo ?? 1;
        const chNum = typeof rawCh === "number" ? rawCh : parseInt(String(rawCh).replace(/\D/g, ""), 10) || 1;
        if (!map.has(chNum)) map.set(chNum, []);
        map.get(chNum)!.push(n);
      } else {
        const p = ((n as any).gsPaper || (n as any).generalStudiesPaper || (n as any).paper || "").trim().toLowerCase();
        if (p !== selectedUpscPaper.trim().toLowerCase()) return;
        const rawMod = (n as any).moduleNumber ?? (n as any).moduleNo ?? (n as any).chapterNumber ?? n.chapterNo ?? 1;
        const modNum = typeof rawMod === "number" ? rawMod : parseInt(String(rawMod).replace(/\D/g, ""), 10) || 1;
        if (!map.has(modNum)) map.set(modNum, []);
        map.get(modNum)!.push(n);
      }
    });

    // Sort notes in each chapter
    map.forEach((notesList) => {
      notesList.sort((a, b) => {
        const aNo = (a as any).topicNumber ?? a.topicNo ?? 1;
        const bNo = (b as any).topicNumber ?? b.topicNo ?? 1;
        const numA = typeof aNo === "number" ? aNo : parseInt(String(aNo).replace(/\D/g, ""), 10) || 0;
        const numB = typeof bNo === "number" ? bNo : parseInt(String(bNo).replace(/\D/g, ""), 10) || 0;
        return numA - numB;
      });
    });

    return map;
  }, [
    activeTab, 
    schoolNotes, 
    upscNotes, 
    selectedSchoolClass, 
    selectedSchoolSubject, 
    selectedUpscPaper, 
    selectedUpscSubject
  ]);

  // Current active chapter's topic notes for Right Panel
  const activeChapterTopics = useMemo(() => {
    const chNum = activeTab === "school" ? selectedSchoolChapterNo : selectedUpscModuleNo;
    return chapterNotesMap.get(chNum) || [];
  }, [activeTab, selectedSchoolChapterNo, selectedUpscModuleNo, chapterNotesMap]);

  // Selected Topic Note object
  const selectedTopicNote = useMemo(() => {
    if (!selectedTopicNoteId) return null;
    const allNotes = activeTab === "school" ? schoolNotes : upscNotes;
    return allNotes.find((n) => n.id === selectedTopicNoteId) || null;
  }, [selectedTopicNoteId, activeTab, schoolNotes, upscNotes]);

  // Toggle Accordion Expansion
  const handleToggleExpand = useCallback((chNum: number) => {
    setExpandedChapters((prev) => ({
      ...prev,
      [chNum]: prev[chNum] === undefined ? false : !prev[chNum],
    }));
  }, []);

  // Handle Selection from Middle Panel
  const handleSelectChapter = useCallback((chNum: number, chName: string) => {
    if (activeTab === "school") {
      setSelectedSchoolChapterNo(chNum);
      setSelectedSchoolChapterName(chName);
    } else {
      setSelectedUpscModuleNo(chNum);
      setSelectedUpscModuleName(chName);
    }
    // Auto expand on selection
    setExpandedChapters((prev) => ({ ...prev, [chNum]: true }));
    // Reset or keep topic
    const notes = chapterNotesMap.get(chNum) || [];
    if (notes.length > 0) {
      setSelectedTopicNoteId(notes[0].id);
    } else {
      setSelectedTopicNoteId(null);
    }
  }, [activeTab, chapterNotesMap]);

  const handleSelectTopic = useCallback((note: ClassNote, chNum: number, chName: string) => {
    if (activeTab === "school") {
      setSelectedSchoolChapterNo(chNum);
      setSelectedSchoolChapterName(chName);
    } else {
      setSelectedUpscModuleNo(chNum);
      setSelectedUpscModuleName(chName);
    }
    setSelectedTopicNoteId(note.id);
  }, [activeTab]);

  // Parent Context for QuickAddTopicModal
  const parentContext: ParentContext = useMemo(() => {
    if (activeTab === "school") {
      return {
        type: "school",
        className: selectedSchoolClass,
        subject: selectedSchoolSubject,
        chapterNumber: selectedSchoolChapterNo,
        chapterName: selectedSchoolChapterName,
        existingTopics: activeChapterTopics,
      };
    } else {
      return {
        type: "upsc",
        gsPaper: selectedUpscPaper,
        subject: selectedUpscSubject,
        moduleNumber: selectedUpscModuleNo,
        moduleName: selectedUpscModuleName,
        existingTopics: activeChapterTopics,
      };
    }
  }, [
    activeTab, 
    selectedSchoolClass, 
    selectedSchoolSubject, 
    selectedSchoolChapterNo, 
    selectedSchoolChapterName, 
    selectedUpscPaper, 
    selectedUpscSubject, 
    selectedUpscModuleNo, 
    selectedUpscModuleName, 
    activeChapterTopics
  ]);

  // =========================================================================
  // ACTIONS: RENAME / REPLACE / DELETE MODALS HANDLERS
  // =========================================================================
  const handleOpenRename = (note: ClassNote) => {
    setRenamingNote(note);
    setRenameTopicNumber((note as any).topicNumber ?? note.topicNo ?? 1);
    setRenameTopicTitle((note as any).topicTitle || (note as any).topicName || note.partLabel || "");
    setRenameChapterTitle((note as any).chapterTitle || (note as any).chapterName || (note as any).moduleTitle || "");
  };

  const handleConfirmRename = async () => {
    if (!renamingNote || !renameTopicTitle.trim()) return;
    setIsRenaming(true);
    try {
      await renameNotePipeline({
        noteId: renamingNote.id,
        currentNote: renamingNote,
        newTopicNumber: renameTopicNumber === "" ? 1 : Number(renameTopicNumber),
        newTopicTitle: renameTopicTitle.trim(),
        newChapterTitle: renameChapterTitle.trim() || undefined,
      });
      showToast("Note renamed successfully.", "success");
      setRenamingNote(null);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      showToast(err?.message || "Failed to rename note.", "error");
    } finally {
      setIsRenaming(false);
    }
  };

  const handleOpenReplace = (note: ClassNote) => {
    setReplacingNote(note);
    setReplaceFile(null);
  };

  const handleConfirmReplace = async () => {
    if (!replacingNote || !replaceFile) return;
    setIsReplacing(true);
    try {
      await replaceNotePipeline({
        noteId: replacingNote.id,
        currentNote: replacingNote,
        newFile: replaceFile,
      });
      showToast("Note file replaced successfully.", "success");
      setReplacingNote(null);
      setReplaceFile(null);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      showToast(err?.message || "Failed to replace note.", "error");
    } finally {
      setIsReplacing(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingNote) return;
    setIsDeleting(true);
    try {
      await deleteNotePipeline(deletingNote.id, deletingNote);
      showToast("Note deleted successfully.", "success");
      if (selectedTopicNoteId === deletingNote.id) {
        setSelectedTopicNoteId(null);
      }
      setDeletingNote(null);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      showToast(err?.message || "Failed to delete note.", "error");
    } finally {
      setIsDeleting(false);
    }
  };

  // Subject Rename Handlers
  const handleOpenRenameSubject = (subj: string) => {
    if (activeTab === "school") {
      setRenamingSubject({
        type: "school",
        className: selectedSchoolClass,
        oldSubject: subj,
        newSubject: subj,
      });
    } else {
      setRenamingSubject({
        type: "upsc",
        gsPaper: selectedUpscPaper,
        oldSubject: subj,
        newSubject: subj,
      });
    }
  };

  const handleConfirmRenameSubject = async () => {
    if (!renamingSubject || !renamingSubject.newSubject.trim()) return;
    const { type, className, gsPaper, oldSubject, newSubject } = renamingSubject;
    if (oldSubject.trim().toLowerCase() === newSubject.trim().toLowerCase()) {
      setRenamingSubject(null);
      return;
    }

    setIsRenamingSubject(true);
    try {
      await renameSubjectPipeline({
        type,
        className,
        gsPaper,
        oldSubject: oldSubject.trim(),
        newSubject: newSubject.trim(),
        notes,
      });

      if (type === "school" && className) {
        updateSchoolHierarchy((prev) => {
          const curList = prev.subjects[className] || [];
          const nextList = curList.map((s) => (s === oldSubject ? newSubject.trim() : s));
          if (!nextList.includes(newSubject.trim())) nextList.push(newSubject.trim());
          
          const curChapters = prev.chapters[className] || {};
          const chs = curChapters[oldSubject] || [];
          const nextChaptersForClass = { ...curChapters, [newSubject.trim()]: chs };
          delete nextChaptersForClass[oldSubject];

          return {
            ...prev,
            subjects: { ...prev.subjects, [className]: nextList },
            chapters: { ...prev.chapters, [className]: nextChaptersForClass }
          };
        });
        setSelectedSchoolSubject(newSubject.trim());
      } else if (type === "upsc" && gsPaper) {
        updateUpscHierarchy((prev) => {
          const curList = prev.subjects[gsPaper] || [];
          const nextList = curList.map((s) => (s === oldSubject ? newSubject.trim() : s));
          if (!nextList.includes(newSubject.trim())) nextList.push(newSubject.trim());
          
          const curModules = prev.modules[gsPaper] || {};
          const mods = curModules[oldSubject] || [];
          const nextModsForPaper = { ...curModules, [newSubject.trim()]: mods };
          delete nextModsForPaper[oldSubject];

          return {
            ...prev,
            subjects: { ...prev.subjects, [gsPaper]: nextList },
            modules: { ...prev.modules, [gsPaper]: nextModsForPaper }
          };
        });
        setSelectedUpscSubject(newSubject.trim());
      }

      showToast(`Subject renamed to "${newSubject.trim()}".`, "success");
      setRenamingSubject(null);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      showToast(err?.message || "Failed to rename subject.", "error");
    } finally {
      setIsRenamingSubject(false);
    }
  };

  // Subject Delete Handler (Full Cascade Deletion)
  const handleConfirmDeleteSubject = async () => {
    if (!deletingSubject) return;
    const { type, className, gsPaper, subject } = deletingSubject;
    setIsDeletingSubject(true);

    try {
      await deleteSubjectPipeline({
        type,
        className,
        gsPaper,
        subject,
        notes,
      });

      if (type === "school" && className) {
        updateSchoolHierarchy((prev) => {
          const curRemoved = prev.removedSubjects[className] || [];
          const nextRemoved = Array.from(new Set([...curRemoved, subject]));

          const curSubjs = prev.subjects[className] || [];
          const nextSubjs = curSubjs.filter((s) => s !== subject);

          const curChs = prev.chapters[className] || {};
          const nextChs = { ...curChs };
          delete nextChs[subject];

          return {
            ...prev,
            removedSubjects: { ...prev.removedSubjects, [className]: nextRemoved },
            subjects: { ...prev.subjects, [className]: nextSubjs },
            chapters: { ...prev.chapters, [className]: nextChs }
          };
        });

        const remaining = schoolSubjectsForSelectedClass.filter((s) => s !== subject);
        setSelectedSchoolSubject(remaining.length > 0 ? remaining[0] : "");
      } else if (type === "upsc" && gsPaper) {
        updateUpscHierarchy((prev) => {
          const curRemoved = prev.removedSubjects[gsPaper] || [];
          const nextRemoved = Array.from(new Set([...curRemoved, subject]));

          const curSubjs = prev.subjects[gsPaper] || [];
          const nextSubjs = curSubjs.filter((s) => s !== subject);

          const curMods = prev.modules[gsPaper] || {};
          const nextMods = { ...curMods };
          delete nextMods[subject];

          return {
            ...prev,
            removedSubjects: { ...prev.removedSubjects, [gsPaper]: nextRemoved },
            subjects: { ...prev.subjects, [gsPaper]: nextSubjs },
            modules: { ...prev.modules, [gsPaper]: nextMods }
          };
        });

        const remaining = upscSubjectsForSelectedPaper.filter((s) => s !== subject);
        setSelectedUpscSubject(remaining.length > 0 ? remaining[0] : "");
      }

      showToast(`Subject "${subject}" and all child notes deleted.`, "success");
      setDeletingSubject(null);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      showToast(err?.message || `Failed to delete subject "${subject}".`, "error");
    } finally {
      setIsDeletingSubject(false);
    }
  };

  // Class Delete Handler
  const handleConfirmDeleteClass = async () => {
    if (!deletingClass) return;
    const targetClass = deletingClass;
    setIsDeletingClass(true);

    try {
      await deleteClassPipeline({
        className: targetClass,
        notes: notes,
      });

      updateSchoolHierarchy((prev) => {
        const nextClasses = prev.classes.filter((c) => c.toLowerCase() !== targetClass.toLowerCase());
        const nextSubjects = { ...prev.subjects };
        delete nextSubjects[targetClass];
        const nextChapters = { ...prev.chapters };
        delete nextChapters[targetClass];
        const nextRemoved = { ...prev.removedSubjects };
        delete nextRemoved[targetClass];

        return {
          ...prev,
          classes: nextClasses,
          subjects: nextSubjects,
          chapters: nextChapters,
          removedSubjects: nextRemoved
        };
      });

      const remaining = schoolClasses.filter(
        (c) => c.toLowerCase() !== targetClass.toLowerCase()
      );
      setSelectedSchoolClass(remaining.length > 0 ? remaining[0] : "");

      showToast(`Class "${targetClass}" deleted successfully.`, "success");
      setDeletingClass(null);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      showToast(err?.message || `Failed to delete "${targetClass}".`, "error");
    } finally {
      setIsDeletingClass(false);
    }
  };

  // GS Paper Delete Handler (UPSC)
  const handleConfirmDeletePaper = async () => {
    if (!deletingPaper) return;
    const targetPaper = deletingPaper;
    setIsDeletingPaper(true);

    try {
      await deletePaperPipeline({
        gsPaper: targetPaper,
        notes: notes,
      });

      updateUpscHierarchy((prev) => {
        const nextPapers = prev.papers.filter((p) => p.toLowerCase() !== targetPaper.toLowerCase());
        const nextSubjects = { ...prev.subjects };
        delete nextSubjects[targetPaper];
        const nextModules = { ...prev.modules };
        delete nextModules[targetPaper];
        const nextRemoved = { ...prev.removedSubjects };
        delete nextRemoved[targetPaper];

        return {
          ...prev,
          papers: nextPapers,
          subjects: nextSubjects,
          modules: nextModules,
          removedSubjects: nextRemoved
        };
      });

      const remaining = upscPapers.filter(
        (p) => p.toLowerCase() !== targetPaper.toLowerCase()
      );
      setSelectedUpscPaper(remaining.length > 0 ? remaining[0] : "");

      showToast(`GS Paper "${targetPaper}" deleted successfully.`, "success");
      setDeletingPaper(null);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      showToast(err?.message || `Failed to delete "${targetPaper}".`, "error");
    } finally {
      setIsDeletingPaper(false);
    }
  };

  // Chapter / Module Rename & Delete Handlers
  const handleOpenRenameChapter = (chNumber: number, chName: string) => {
    if (activeTab === "school") {
      setRenamingChapter({
        type: "school",
        className: selectedSchoolClass,
        subject: selectedSchoolSubject,
        oldNumber: chNumber,
        oldName: chName,
        newNumber: chNumber,
        newName: chName,
      });
    } else {
      setRenamingChapter({
        type: "upsc",
        gsPaper: selectedUpscPaper,
        subject: selectedUpscSubject,
        oldNumber: chNumber,
        oldName: chName,
        newNumber: chNumber,
        newName: chName,
      });
    }
  };

  const handleConfirmRenameChapter = async () => {
    if (!renamingChapter || !renamingChapter.newName.trim()) return;
    const { type, className, gsPaper, subject, oldNumber, newNumber, newName } = renamingChapter;
    const validNewNum = newNumber === "" ? oldNumber : Number(newNumber);

    setIsRenamingChapter(true);
    try {
      if (type === "school" && className) {
        updateSchoolHierarchy((prev) => {
          const curSubjectChapters = prev.chapters[className]?.[subject] || [];
          const updated = curSubjectChapters.filter((c) => c.number !== oldNumber);
          updated.push({ number: validNewNum, name: newName.trim() });
          updated.sort((a, b) => a.number - b.number);

          return {
            ...prev,
            chapters: {
              ...prev.chapters,
              [className]: {
                ...(prev.chapters[className] || {}),
                [subject]: updated
              }
            }
          };
        });

        if (selectedSchoolChapterNo === oldNumber) {
          setSelectedSchoolChapterNo(validNewNum);
          setSelectedSchoolChapterName(newName.trim());
        }
      } else if (type === "upsc" && gsPaper) {
        updateUpscHierarchy((prev) => {
          const curSubjectModules = prev.modules[gsPaper]?.[subject] || [];
          const updated = curSubjectModules.filter((m) => m.number !== oldNumber);
          updated.push({ number: validNewNum, name: newName.trim() });
          updated.sort((a, b) => a.number - b.number);

          return {
            ...prev,
            modules: {
              ...prev.modules,
              [gsPaper]: {
                ...(prev.modules[gsPaper] || {}),
                [subject]: updated
              }
            }
          };
        });

        if (selectedUpscModuleNo === oldNumber) {
          setSelectedUpscModuleNo(validNewNum);
          setSelectedUpscModuleName(newName.trim());
        }
      }

      showToast(`Chapter updated successfully.`, "success");
      setRenamingChapter(null);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      showToast(err?.message || "Failed to update chapter.", "error");
    } finally {
      setIsRenamingChapter(false);
    }
  };

  const handleConfirmDeleteChapter = async () => {
    if (!deletingChapter) return;
    const { type, className, gsPaper, subject, chapterNumber, chapterName } = deletingChapter;
    setIsDeletingChapter(true);

    try {
      await deleteChapterPipeline({
        type,
        className,
        gsPaper,
        subject,
        chapterNumber,
        notes,
      });

      if (type === "school" && className) {
        updateSchoolHierarchy((prev) => {
          const curSubjectChapters = prev.chapters[className]?.[subject] || [];
          const updated = curSubjectChapters.filter((c) => c.number !== chapterNumber);
          return {
            ...prev,
            chapters: {
              ...prev.chapters,
              [className]: {
                ...(prev.chapters[className] || {}),
                [subject]: updated
              }
            }
          };
        });

        const remaining = schoolChaptersForSelected.filter((c) => c.number !== chapterNumber);
        if (remaining.length > 0) {
          setSelectedSchoolChapterNo(remaining[0].number);
          setSelectedSchoolChapterName(remaining[0].name);
        } else {
          setSelectedSchoolChapterNo(0);
          setSelectedSchoolChapterName("");
        }
      } else if (type === "upsc" && gsPaper) {
        updateUpscHierarchy((prev) => {
          const curSubjectModules = prev.modules[gsPaper]?.[subject] || [];
          const updated = curSubjectModules.filter((m) => m.number !== chapterNumber);
          return {
            ...prev,
            modules: {
              ...prev.modules,
              [gsPaper]: {
                ...(prev.modules[gsPaper] || {}),
                [subject]: updated
              }
            }
          };
        });

        const remaining = upscModulesForSelected.filter((m) => m.number !== chapterNumber);
        if (remaining.length > 0) {
          setSelectedUpscModuleNo(remaining[0].number);
          setSelectedUpscModuleName(remaining[0].name);
        } else {
          setSelectedUpscModuleNo(0);
          setSelectedUpscModuleName("");
        }
      }

      showToast(`Chapter ${chapterNumber} deleted successfully.`, "success");
      setDeletingChapter(null);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      showToast(err?.message || "Failed to delete chapter.", "error");
    } finally {
      setIsDeletingChapter(false);
    }
  };

  // Practice Test Launcher
  const handleOpenPracticeTest = (note: ClassNote) => {
    const classGrade = (note as any).className || note.classGrade || (note as any).class || "";
    const subject = (note as any).subjectName || note.subject || "";
    const chapterNo = (note as any).chapterNumber ?? note.chapterNo ?? 1;
    const chapterName = (note as any).chapterTitle || (note as any).chapterName || `Chapter ${chapterNo}`;
    const topicName = (note as any).topicTitle || (note as any).topicName || note.partLabel || "";

    setPracticeTestTarget({
      classGrade,
      subject,
      chapterNo: Number(chapterNo),
      chapterName,
      topicName,
      noteId: note.id
    });
  };

  // Subject Kebab Menu state in Left Panel
  const [activeSubjectKebab, setActiveSubjectKebab] = useState<string | null>(null);

  return (
    <div className="h-full flex flex-col bg-slate-100 dark:bg-slate-950 overflow-hidden" id="admin-notes-dashboard">
      {/* Toast notification rendered via Portal to document.body above all modals */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          duration={3500}
          onClose={() => setToast(null)}
          id="admin-notes-dashboard-toast"
        />
      )}

      {/* =========================================================================
          RESPONSIVE 2-PANEL LAYOUT
          Mobile (<768px): Single vertical stacked scrollable flow (Sidebar Cards -> Main Panel)
          Desktop (>=768px): Left Navigation Sidebar (w-72/80) + Right Main Panel (flex-1)
          ========================================================================= */}
      <div 
        className="flex-1 min-h-0 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden p-3.5 sm:p-4 md:p-0 space-y-4 md:space-y-0 w-full max-w-full overflow-x-hidden" 
        id="notes-dashboard-container"
      >
        
        {/* =========================================================================
            LEFT SIDEBAR (School/UPSC Switcher, Classes / Papers & Subjects)
            ========================================================================= */}
        <aside 
          className="w-full md:w-72 xl:w-80 md:border-r border-slate-200 dark:border-slate-800 md:bg-white md:dark:bg-slate-900 flex flex-col shrink-0 md:min-h-0 md:overflow-hidden space-y-3.5 md:space-y-0" 
          id="notes-left-sidebar"
        >
          {/* Top Switcher: School vs UPSC */}
          <div className="rounded-2xl md:rounded-none border md:border-0 md:border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 md:bg-slate-50/70 md:dark:bg-slate-950/60 p-2.5 sm:p-3 md:p-4 shrink-0 shadow-xs md:shadow-none">
            <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
              <button
                type="button"
                onClick={() => setActiveTab("school")}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 md:py-2 rounded-lg text-xs font-bold transition-all cursor-pointer min-h-[40px] md:min-h-0 ${
                  activeTab === "school"
                    ? "bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                }`}
                id="school-tab-btn"
              >
                <School className="w-4 h-4" />
                <span>SCHOOL</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("upsc")}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 md:py-2 rounded-lg text-xs font-bold transition-all cursor-pointer min-h-[40px] md:min-h-0 ${
                  activeTab === "upsc"
                    ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                }`}
                id="upsc-tab-btn"
              >
                <GraduationCap className="w-4 h-4" />
                <span>UPSC</span>
              </button>
            </div>
          </div>

          {/* Classes & Subjects List */}
          <div 
            className="space-y-3.5 md:space-y-6 md:flex-1 md:min-h-0 md:overflow-y-auto md:p-3.5 md:scrollbar-thin md:overscroll-contain" 
            id="notes-sidebar-scroll"
          >
            {activeTab === "school" ? (
              <>
                {/* 1. Classes List Card */}
                <div className="rounded-2xl md:rounded-none border md:border-0 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-4 md:p-0 shadow-xs md:shadow-none">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Classes
                    </span>
                    <span className="text-[11px] font-bold text-slate-400">
                      {schoolClasses.length} Available
                    </span>
                  </div>

                  {schoolClasses.length === 0 ? (
                    <div className="p-3 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-900/30">
                      <p className="text-xs text-slate-400 font-medium">No classes created yet</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 gap-1.5" id="school-classes-list">
                      {schoolClasses.map((cls) => {
                        const isSelected = selectedSchoolClass.toLowerCase() === cls.toLowerCase();
                        const classNotesCount = schoolNotes.filter((n) => {
                          const c = (n as any).className || n.classGrade || (n as any).class || "";
                          return c.toLowerCase() === cls.toLowerCase();
                        }).length;

                        return (
                          <div
                            key={cls}
                            onClick={() => setSelectedSchoolClass(cls)}
                            className={`group min-h-[38px] px-3 py-2 rounded-xl text-left text-xs font-bold transition-all flex items-center justify-between gap-1 border cursor-pointer ${
                              isSelected
                                ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-300/80 dark:border-blue-700/80 shadow-2xs"
                                : "bg-slate-50/70 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300 border-slate-200/70 dark:border-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800"
                            }`}
                            id={`class-btn-${cls.replace(/\s+/g, "-")}`}
                          >
                            <div className="flex items-center gap-1 min-w-0 flex-1">
                              <span className="truncate">{cls}</span>
                              {classNotesCount > 0 && (
                                <span className="text-[10px] px-1 py-0.2 rounded-md bg-slate-200/60 dark:bg-slate-800 font-mono text-slate-500 dark:text-slate-400 shrink-0">
                                  {classNotesCount}
                                </span>
                              )}
                            </div>

                            {/* Delete Class Icon (🗑️) */}
                            <button
                              type="button"
                              title={`Delete ${cls}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeletingClass(cls);
                              }}
                              className="p-1 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors shrink-0 cursor-pointer"
                              id={`delete-class-${cls.replace(/\s+/g, "-")}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* + New Class Button */}
                  <button
                    type="button"
                    onClick={() => setCreateNodeContext({ nodeType: "new_class", type: "school" })}
                    className="w-full mt-2.5 py-2.5 px-3 min-h-[38px] rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 bg-transparent text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    id="add-new-class-btn"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ New Class</span>
                  </button>
                </div>

                {/* 2. Subjects List Card */}
                <div className="rounded-2xl md:rounded-none border md:border-0 md:pt-4 md:border-t border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-4 md:p-0 shadow-xs md:shadow-none">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">
                      {selectedSchoolClass ? `Subjects • ${selectedSchoolClass}` : "Subjects"}
                    </span>
                  </div>

                  {!selectedSchoolClass ? (
                    <p className="text-xs text-slate-400 italic p-2">Create or select a class first</p>
                  ) : schoolSubjectsForSelectedClass.length === 0 ? (
                    <div className="p-3 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-900/30">
                      <p className="text-xs text-slate-400 font-medium">No subjects in {selectedSchoolClass}</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5" id="school-subjects-list">
                      {schoolSubjectsForSelectedClass.map((subj) => {
                        const isSelected = selectedSchoolSubject.toLowerCase() === subj.toLowerCase();
                        const subjNotesCount = schoolNotes.filter((n) => {
                          const c = (n as any).className || n.classGrade || (n as any).class || "";
                          const s = (n as any).subjectName || n.subject || "";
                          return c.toLowerCase() === selectedSchoolClass.toLowerCase() && s.toLowerCase() === subj.toLowerCase();
                        }).length;
                        const subjectKebabKey = `school-subj-${subj}`;

                        return (
                          <div
                            key={subj}
                            className={`group/subj w-full min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-between gap-1.5 border ${
                              isSelected
                                ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                                : "bg-slate-50/70 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300 border-slate-200/70 dark:border-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => setSelectedSchoolSubject(subj)}
                              className="flex items-center gap-2 min-w-0 flex-1 text-left py-0.5 cursor-pointer"
                              id={`subject-btn-${subj.replace(/\s+/g, "-")}`}
                            >
                              <BookOpen className={`w-3.5 h-3.5 shrink-0 ${isSelected ? "text-blue-100" : "text-slate-400"}`} />
                              <span className="truncate">{subj}</span>
                              {subjNotesCount > 0 && (
                                <span className={`text-[10px] px-1.5 py-0.2 rounded-md font-mono shrink-0 ${
                                  isSelected ? "bg-blue-700 text-blue-100" : "bg-slate-200/60 dark:bg-slate-800 text-slate-500"
                                }`}>
                                  {subjNotesCount}
                                </span>
                              )}
                            </button>

                            {/* Subject Actions: Delete & 3-dots Kebab for Rename */}
                            <div className="flex items-center gap-0.5 shrink-0">
                              {/* Delete Subject Button (🗑️) */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeletingSubject({
                                    type: "school",
                                    className: selectedSchoolClass,
                                    subject: subj,
                                  });
                                }}
                                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                  isSelected 
                                    ? "hover:bg-blue-700 text-blue-100 hover:text-rose-200" 
                                    : "text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                                }`}
                                title={`Delete ${subj}`}
                                id={`delete-subj-${subj.replace(/\s+/g, "-")}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>

                              {/* 3-dots Kebab for Rename */}
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveSubjectKebab(activeSubjectKebab === subjectKebabKey ? null : subjectKebabKey);
                                  }}
                                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                    isSelected 
                                      ? "hover:bg-blue-700 text-blue-100" 
                                      : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"
                                  }`}
                                  title="Subject options"
                                >
                                  <MoreVertical className="w-3.5 h-3.5" />
                                </button>

                                {activeSubjectKebab === subjectKebabKey && (
                                  <div className="absolute right-0 top-full mt-1 w-32 bg-white dark:bg-slate-850 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 py-1 z-30 animate-fadeIn">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActiveSubjectKebab(null);
                                        handleOpenRenameSubject(subj);
                                      }}
                                      className="w-full text-left px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                      Rename Subject
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* + Add Subject Button */}
                  {selectedSchoolClass && (
                    <button
                      type="button"
                      onClick={() => setCreateNodeContext({ 
                        nodeType: "add_subject", 
                        type: "school", 
                        className: selectedSchoolClass 
                      })}
                      className="w-full mt-2.5 py-2.5 px-3 min-h-[38px] rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 bg-transparent text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      id="add-school-subject-btn"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>+ Add Subject</span>
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* UPSC 1. GS Papers List Card */}
                <div className="rounded-2xl md:rounded-none border md:border-0 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-4 md:p-0 shadow-xs md:shadow-none">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      GS Papers
                    </span>
                    <span className="text-[11px] font-bold text-slate-400">
                      {upscPapers.length} Available
                    </span>
                  </div>

                  {upscPapers.length === 0 ? (
                    <div className="p-3 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-900/30">
                      <p className="text-xs text-slate-400 font-medium">No GS papers created yet</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5" id="upsc-papers-list">
                      {upscPapers.map((paper) => {
                        const isSelected = selectedUpscPaper.toLowerCase() === paper.toLowerCase();
                        const paperNotesCount = upscNotes.filter((n) => {
                          const p = (n as any).gsPaper || (n as any).generalStudiesPaper || (n as any).paper || "";
                          return p.toLowerCase() === paper.toLowerCase();
                        }).length;

                        return (
                          <div
                            key={paper}
                            onClick={() => setSelectedUpscPaper(paper)}
                            className={`w-full min-h-[38px] px-3 py-2 rounded-xl text-left text-xs font-bold transition-all flex items-center justify-between gap-1.5 border cursor-pointer ${
                              isSelected
                                ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-300/80 dark:border-indigo-700/80 shadow-2xs"
                                : "bg-slate-50/70 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300 border-slate-200/70 dark:border-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800"
                            }`}
                            id={`upsc-paper-btn-${paper.replace(/\s+/g, "-")}`}
                          >
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                              <span className="truncate">{paper}</span>
                              {paperNotesCount > 0 && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-slate-200/60 dark:bg-slate-800 font-mono text-slate-500 dark:text-slate-400 shrink-0">
                                  {paperNotesCount}
                                </span>
                              )}
                            </div>

                            {/* Delete GS Paper (🗑️) */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeletingPaper(paper);
                              }}
                              className="p-1 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors shrink-0 cursor-pointer"
                              title={`Delete ${paper}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* + New GS Paper Button */}
                  <button
                    type="button"
                    onClick={() => setCreateNodeContext({ nodeType: "new_gs_paper", type: "upsc" })}
                    className="w-full mt-2.5 py-2.5 px-3 min-h-[38px] rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-500 bg-transparent text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    id="add-new-gs-paper-btn"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ New GS Paper</span>
                  </button>
                </div>

                {/* UPSC 2. Subjects List Card */}
                <div className="rounded-2xl md:rounded-none border md:border-0 md:pt-4 md:border-t border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-4 md:p-0 shadow-xs md:shadow-none">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">
                      {selectedUpscPaper ? `Subjects • ${selectedUpscPaper}` : "Subjects"}
                    </span>
                  </div>

                  {!selectedUpscPaper ? (
                    <p className="text-xs text-slate-400 italic p-2">Create or select a GS paper first</p>
                  ) : upscSubjectsForSelectedPaper.length === 0 ? (
                    <div className="p-3 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-900/30">
                      <p className="text-xs text-slate-400 font-medium">No subjects in {selectedUpscPaper}</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5" id="upsc-subjects-list">
                      {upscSubjectsForSelectedPaper.map((subj) => {
                        const isSelected = selectedUpscSubject.toLowerCase() === subj.toLowerCase();
                        const subjNotesCount = upscNotes.filter((n) => {
                          const p = (n as any).gsPaper || (n as any).generalStudiesPaper || (n as any).paper || "";
                          const s = (n as any).subjectName || n.subject || "";
                          return p.toLowerCase() === selectedUpscPaper.toLowerCase() && s.toLowerCase() === subj.toLowerCase();
                        }).length;
                        const subjectKebabKey = `upsc-subj-${subj}`;

                        return (
                          <div
                            key={subj}
                            className={`group/subj w-full min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center justify-between gap-1.5 border ${
                              isSelected
                                ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                                : "bg-slate-50/70 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300 border-slate-200/70 dark:border-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => setSelectedUpscSubject(subj)}
                              className="flex items-center gap-2 min-w-0 flex-1 text-left py-0.5 cursor-pointer"
                              id={`upsc-subject-btn-${subj.replace(/\s+/g, "-")}`}
                            >
                              <BookOpen className={`w-3.5 h-3.5 shrink-0 ${isSelected ? "text-indigo-100" : "text-slate-400"}`} />
                              <span className="truncate">{subj}</span>
                              {subjNotesCount > 0 && (
                                <span className={`text-[10px] px-1.5 py-0.2 rounded-md font-mono shrink-0 ${
                                  isSelected ? "bg-indigo-700 text-indigo-100" : "bg-slate-200/60 dark:bg-slate-800 text-slate-500"
                                }`}>
                                  {subjNotesCount}
                                </span>
                              )}
                            </button>

                            {/* Subject Actions: Delete & 3-dots Kebab for Rename */}
                            <div className="flex items-center gap-0.5 shrink-0">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeletingSubject({
                                    type: "upsc",
                                    gsPaper: selectedUpscPaper,
                                    subject: subj,
                                  });
                                }}
                                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                  isSelected 
                                    ? "hover:bg-indigo-700 text-indigo-100 hover:text-rose-200" 
                                    : "text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                                }`}
                                title={`Delete ${subj}`}
                                id={`delete-upsc-subj-${subj.replace(/\s+/g, "-")}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>

                              {/* 3-dots Kebab for Rename */}
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveSubjectKebab(activeSubjectKebab === subjectKebabKey ? null : subjectKebabKey);
                                  }}
                                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                    isSelected 
                                      ? "hover:bg-indigo-700 text-indigo-100" 
                                      : "text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                                  }`}
                                  title="Subject options"
                                >
                                  <MoreVertical className="w-3.5 h-3.5" />
                                </button>

                                {activeSubjectKebab === subjectKebabKey && (
                                  <div className="absolute right-0 top-full mt-1 w-32 bg-white dark:bg-slate-850 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 py-1 z-30 animate-fadeIn">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActiveSubjectKebab(null);
                                        handleOpenRenameSubject(subj);
                                      }}
                                      className="w-full text-left px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                                    >
                                      Rename Subject
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* + Add Subject Button */}
                  {selectedUpscPaper && (
                    <button
                      type="button"
                      onClick={() => setCreateNodeContext({ 
                        nodeType: "add_subject", 
                        type: "upsc", 
                        gsPaper: selectedUpscPaper 
                      })}
                      className="w-full mt-2.5 py-2.5 px-3 min-h-[38px] rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-500 bg-transparent text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      id="add-upsc-subject-btn"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>+ Add Subject</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </aside>

        {/* =========================================================================
            MAIN/RIGHT PANEL: Chapters / Modules with Collapsible Topics (CMS Full Width)
            ========================================================================= */}
        <NotesMainPanel
          type={activeTab}
          selectedSubject={activeTab === "school" ? selectedSchoolSubject : selectedUpscSubject}
          selectedParentName={activeTab === "school" ? selectedSchoolClass : selectedUpscPaper}
          chapters={activeTab === "school" ? schoolChaptersForSelected : upscModulesForSelected}
          chapterNotesMap={chapterNotesMap}
          selectedChapterNo={activeTab === "school" ? selectedSchoolChapterNo : selectedUpscModuleNo}
          selectedTopicNoteId={selectedTopicNoteId}
          expandedChapters={expandedChapters}
          onToggleExpand={handleToggleExpand}
          onSelectChapter={handleSelectChapter}
          onSelectTopic={handleSelectTopic}
          onAddChapter={() => {
            const list = activeTab === "school" ? schoolChaptersForSelected : upscModulesForSelected;
            const nextNum = list.length > 0 ? Math.max(...list.map((c) => c.number)) + 1 : 1;
            setCreateNodeContext({
              nodeType: activeTab === "school" ? "add_chapter" : "add_module",
              type: activeTab,
              className: activeTab === "school" ? selectedSchoolClass : undefined,
              gsPaper: activeTab === "upsc" ? selectedUpscPaper : undefined,
              subject: activeTab === "school" ? selectedSchoolSubject : selectedUpscSubject,
              suggestedNumber: nextNum,
            });
          }}
          onAddTopic={(chNum, chName) => {
            if (activeTab === "school") {
              setSelectedSchoolChapterNo(chNum);
              setSelectedSchoolChapterName(chName);
            } else {
              setSelectedUpscModuleNo(chNum);
              setSelectedUpscModuleName(chName);
            }
            setQuickAddOpen(true);
          }}
          onRenameChapter={handleOpenRenameChapter}
          onDeleteChapter={(chNum, chName) => {
            setDeletingChapter({
              type: activeTab,
              className: activeTab === "school" ? selectedSchoolClass : undefined,
              gsPaper: activeTab === "upsc" ? selectedUpscPaper : undefined,
              subject: activeTab === "school" ? selectedSchoolSubject : selectedUpscSubject,
              chapterNumber: chNum,
              chapterName: chName,
            });
          }}
          onRenameTopic={handleOpenRename}
          onDeleteTopic={(note) => setDeletingNote(note)}
          onPreviewTopic={(note) => setPreviewNote(note)}
          onReplaceTopic={handleOpenReplace}
          onOpenPracticeTest={handleOpenPracticeTest}
          checkIfTopicHasPracticeTest={checkIfTopicHasPracticeTest}
        />
      </div>

      {/* =========================================================================
          MODALS SECTION
          ========================================================================= */}

      {/* 1. Quick Add Topic Modal */}
      <QuickAddTopicModal
        isOpen={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        parentContext={parentContext}
        onSuccess={(newNote) => {
          if (newNote) {
            if (activeTab === "school") {
              const rawCh = (newNote as any).chapterNumber ?? newNote.chapterNo ?? 1;
              const chNum = typeof rawCh === "number" ? rawCh : parseInt(String(rawCh).replace(/\D/g, ""), 10) || 1;
              const chName = (newNote as any).chapterName || (newNote as any).chapterTitle || `Chapter ${chNum}`;
              setSelectedSchoolChapterNo(chNum);
              setSelectedSchoolChapterName(chName);
              setExpandedChapters((prev) => ({ ...prev, [chNum]: true }));
            } else {
              const rawMod = (newNote as any).moduleNumber ?? (newNote as any).moduleNo ?? (newNote as any).chapterNumber ?? 1;
              const modNum = typeof rawMod === "number" ? rawMod : parseInt(String(rawMod).replace(/\D/g, ""), 10) || 1;
              const modName = (newNote as any).moduleName || (newNote as any).moduleTitle || `Module ${modNum}`;
              setSelectedUpscModuleNo(modNum);
              setSelectedUpscModuleName(modName);
              setExpandedChapters((prev) => ({ ...prev, [modNum]: true }));
            }
            setSelectedTopicNoteId(newNote.id);
          }
          if (onRefresh) onRefresh();
          showToast("Topic note uploaded successfully.", "success");
        }}
      />

      {/* 2. Create Custom Hierarchy Node Modal */}
      {createNodeContext && (
        <CreateHierarchyNodeModal
          isOpen={Boolean(createNodeContext)}
          onClose={() => setCreateNodeContext(null)}
          context={createNodeContext}
          onSubmit={(result) => {
            if (result.nodeType === "new_class") {
              updateSchoolHierarchy((prev) => ({
                ...prev,
                classes: Array.from(new Set([...prev.classes, result.name]))
              }));
              setSelectedSchoolClass(result.name);
              showToast(`Class "${result.name}" created.`, "success");
            } else if (result.nodeType === "new_gs_paper") {
              updateUpscHierarchy((prev) => ({
                ...prev,
                papers: Array.from(new Set([...prev.papers, result.name]))
              }));
              setSelectedUpscPaper(result.name);
              showToast(`GS Paper "${result.name}" created.`, "success");
            } else if (result.nodeType === "add_subject") {
              if (result.className) {
                updateSchoolHierarchy((prev) => {
                  const cur = prev.subjects[result.className!] || [];
                  const updated = Array.from(new Set([...cur, result.name]));
                  return {
                    ...prev,
                    subjects: { ...prev.subjects, [result.className!]: updated }
                  };
                });
                setSelectedSchoolSubject(result.name);
                showToast(`Subject "${result.name}" added to ${result.className}.`, "success");
              } else if (result.gsPaper) {
                updateUpscHierarchy((prev) => {
                  const cur = prev.subjects[result.gsPaper!] || [];
                  const updated = Array.from(new Set([...cur, result.name]));
                  return {
                    ...prev,
                    subjects: { ...prev.subjects, [result.gsPaper!]: updated }
                  };
                });
                setSelectedUpscSubject(result.name);
                showToast(`Subject "${result.name}" added to ${result.gsPaper}.`, "success");
              }
            } else if (result.nodeType === "add_chapter" && result.className && result.subject && result.number) {
              updateSchoolHierarchy((prev) => {
                const cur = prev.chapters[result.className!]?.[result.subject!] || [];
                const updated = cur.filter((c) => c.number !== result.number);
                updated.push({ number: result.number!, name: result.name });
                updated.sort((a, b) => a.number - b.number);
                return {
                  ...prev,
                  chapters: {
                    ...prev.chapters,
                    [result.className!]: {
                      ...(prev.chapters[result.className!] || {}),
                      [result.subject!]: updated
                    }
                  }
                };
              });
              setSelectedSchoolChapterNo(result.number);
              setSelectedSchoolChapterName(result.name);
              showToast(`Chapter ${result.number}: ${result.name} created.`, "success");
            } else if (result.nodeType === "add_module" && result.gsPaper && result.subject && result.number) {
              updateUpscHierarchy((prev) => {
                const cur = prev.modules[result.gsPaper!]?.[result.subject!] || [];
                const updated = cur.filter((m) => m.number !== result.number);
                updated.push({ number: result.number!, name: result.name });
                updated.sort((a, b) => a.number - b.number);
                return {
                  ...prev,
                  modules: {
                    ...prev.modules,
                    [result.gsPaper!]: {
                      ...(prev.modules[result.gsPaper!] || {}),
                      [result.subject!]: updated
                    }
                  }
                };
              });
              setSelectedUpscModuleNo(result.number);
              setSelectedUpscModuleName(result.name);
              showToast(`Module ${result.number}: ${result.name} created.`, "success");
            }

            if (onRefresh) onRefresh();
          }}
        />
      )}

      {/* 3. Fullscreen Document Preview Modal */}
      {previewNote && (
        <NotesPreviewModal
          isOpen={Boolean(previewNote)}
          onClose={() => setPreviewNote(null)}
          note={previewNote}
        />
      )}

      {/* 4. Replace File Modal */}
      {replacingNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-slate-100">
                <RefreshCw className="w-4 h-4 text-blue-500" />
                <span>Replace Topic Document</span>
              </div>
              <button
                type="button"
                onClick={() => setReplacingNote(null)}
                disabled={isReplacing}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Replacing file for:{" "}
                <strong className="text-slate-800 dark:text-slate-200">
                  {(replacingNote as any).topicTitle || (replacingNote as any).topicName || replacingNote.partLabel || "Topic"}
                </strong>
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Select New File (PDF, PNG, JPG)
              </label>
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp"
                onChange={(e) => setReplaceFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-blue-50 dark:file:bg-blue-950 file:text-blue-700 dark:file:text-blue-300 hover:file:bg-blue-100"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setReplacingNote(null)}
                disabled={isReplacing}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReplace}
                disabled={isReplacing || !replaceFile}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 shadow-md transition-all cursor-pointer"
              >
                {isReplacing ? "Replacing..." : "Confirm Replace"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Rename Topic Modal */}
      {renamingNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-slate-100">
                <FileText className="w-4 h-4 text-blue-500" />
                <span>Rename Topic Note</span>
              </div>
              <button
                type="button"
                onClick={() => setRenamingNote(null)}
                disabled={isRenaming}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-1">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Topic No.
                </label>
                <input
                  type="number"
                  min="1"
                  value={renameTopicNumber}
                  onChange={(e) => setRenameTopicNumber(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold"
                />
              </div>

              <div className="col-span-3">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Topic Title
                </label>
                <input
                  type="text"
                  value={renameTopicTitle}
                  onChange={(e) => setRenameTopicTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold"
                  placeholder="e.g. Real Numbers"
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {activeTab === "school" ? "Chapter Title" : "Module Title"}
              </label>
              <input
                type="text"
                value={renameChapterTitle}
                onChange={(e) => setRenameChapterTitle(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold"
                placeholder={activeTab === "school" ? "Chapter 1" : "Module 1"}
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRenamingNote(null)}
                disabled={isRenaming}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRename}
                disabled={isRenaming || !renameTopicTitle.trim()}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 shadow-md transition-all cursor-pointer"
              >
                {isRenaming ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Delete Topic Note Modal */}
      {deletingNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 mx-auto flex items-center justify-center">
              <Trash2 className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Delete Topic Note?
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Are you sure you want to delete{" "}
                <strong className="text-slate-800 dark:text-slate-200">
                  {(deletingNote as any).topicTitle || (deletingNote as any).topicName || deletingNote.partLabel || "this note"}
                </strong>
                ? This permanently removes the topic note document.
              </p>
            </div>

            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeletingNote(null)}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 shadow-md shadow-rose-500/20 transition-all cursor-pointer"
              >
                {isDeleting ? "Deleting..." : "Delete Note"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Rename Subject Modal */}
      {renamingSubject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-slate-100">
                <BookOpen className="w-4 h-4 text-blue-500" />
                <span>Rename Subject</span>
              </div>
              <button
                type="button"
                onClick={() => setRenamingSubject(null)}
                disabled={isRenamingSubject}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                  Current Subject
                </label>
                <div className="px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {renamingSubject.oldSubject}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  New Subject Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={renamingSubject.newSubject}
                  onChange={(e) => setRenamingSubject({ ...renamingSubject, newSubject: e.target.value })}
                  placeholder="Enter new subject name..."
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-blue-500"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !isRenamingSubject) {
                      e.preventDefault();
                      handleConfirmRenameSubject();
                    }
                  }}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setRenamingSubject(null)}
                disabled={isRenamingSubject}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRenameSubject}
                disabled={isRenamingSubject || !renamingSubject.newSubject.trim()}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 shadow-md shadow-blue-500/20 transition-all cursor-pointer"
              >
                {isRenamingSubject ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. Rename Chapter / Module Modal */}
      {renamingChapter && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-slate-100">
                <Layers className="w-4 h-4 text-blue-500" />
                <span>{renamingChapter.type === "school" ? "Edit Chapter" : "Edit Module"}</span>
              </div>
              <button
                type="button"
                onClick={() => setRenamingChapter(null)}
                disabled={isRenamingChapter}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-3">
                <div className="col-span-1">
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    {renamingChapter.type === "school" ? "Ch #" : "Mod #"}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={renamingChapter.newNumber}
                    onChange={(e) => setRenamingChapter({ 
                      ...renamingChapter, 
                      newNumber: e.target.value === "" ? "" : parseInt(e.target.value, 10) 
                    })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-blue-500"
                  />
                </div>

                <div className="col-span-3">
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    {renamingChapter.type === "school" ? "Chapter Name" : "Module Name"} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={renamingChapter.newName}
                    onChange={(e) => setRenamingChapter({ ...renamingChapter, newName: e.target.value })}
                    placeholder={renamingChapter.type === "school" ? "e.g. Real Numbers" : "e.g. Historical Background"}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-blue-500"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !isRenamingChapter) {
                        e.preventDefault();
                        handleConfirmRenameChapter();
                      }
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setRenamingChapter(null)}
                disabled={isRenamingChapter}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRenameChapter}
                disabled={isRenamingChapter || !renamingChapter.newName.trim()}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 shadow-md shadow-blue-500/20 transition-all cursor-pointer"
              >
                {isRenamingChapter ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 9. Delete Class Confirmation Modal */}
      {deletingClass && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 font-bold text-sm text-rose-600 dark:text-rose-400">
                <Trash2 className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                <span>Delete Class</span>
              </div>
              <button
                type="button"
                onClick={() => setDeletingClass(null)}
                disabled={isDeletingClass}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-left">
              <p className="text-xs text-slate-700 dark:text-slate-300">
                Are you sure you want to delete <span className="font-bold text-slate-900 dark:text-slate-100">"{deletingClass}"</span>?
              </p>
              
              <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                <p className="font-semibold text-slate-700 dark:text-slate-300">This will permanently remove:</p>
                <ul className="list-disc list-inside space-y-0.5 text-slate-600 dark:text-slate-400 pl-1">
                  <li>All Subjects</li>
                  <li>All Chapters</li>
                  <li>All Topic Notes and Documents</li>
                </ul>
              </div>

              <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400">
                This action cannot be undone.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setDeletingClass(null)}
                disabled={isDeletingClass}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteClass}
                disabled={isDeletingClass}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 shadow-md shadow-rose-500/20 transition-all cursor-pointer flex items-center gap-1.5"
              >
                {isDeletingClass ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <span>Delete</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 10. Delete GS Paper Confirmation Modal */}
      {deletingPaper && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 font-bold text-sm text-rose-600 dark:text-rose-400">
                <Trash2 className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                <span>Delete GS Paper</span>
              </div>
              <button
                type="button"
                onClick={() => setDeletingPaper(null)}
                disabled={isDeletingPaper}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-left">
              <p className="text-xs text-slate-700 dark:text-slate-300">
                Are you sure you want to delete <span className="font-bold text-slate-900 dark:text-slate-100">"{deletingPaper}"</span>?
              </p>
              
              <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                <p className="font-semibold text-slate-700 dark:text-slate-300">This will permanently remove:</p>
                <ul className="list-disc list-inside space-y-0.5 text-slate-600 dark:text-slate-400 pl-1">
                  <li>All Subjects</li>
                  <li>All Modules</li>
                  <li>All Topic Notes and Documents</li>
                </ul>
              </div>

              <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400">
                This action cannot be undone.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setDeletingPaper(null)}
                disabled={isDeletingPaper}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeletePaper}
                disabled={isDeletingPaper}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 shadow-md shadow-rose-500/20 transition-all cursor-pointer flex items-center gap-1.5"
              >
                {isDeletingPaper ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <span>Delete</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 11. Delete Subject Confirmation Modal */}
      {deletingSubject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 font-bold text-sm text-rose-600 dark:text-rose-400">
                <Trash2 className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                <span>Delete Subject</span>
              </div>
              <button
                type="button"
                onClick={() => setDeletingSubject(null)}
                disabled={isDeletingSubject}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-left">
              <p className="text-xs text-slate-700 dark:text-slate-300">
                Are you sure you want to delete <span className="font-bold text-slate-900 dark:text-slate-100">"{deletingSubject.subject}"</span>?
              </p>
              
              <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                <p className="font-semibold text-slate-700 dark:text-slate-300">This will permanently remove:</p>
                <ul className="list-disc list-inside space-y-0.5 text-slate-600 dark:text-slate-400 pl-1">
                  <li>All {deletingSubject.type === "school" ? "Chapters" : "Modules"}</li>
                  <li>All Topic Notes and Documents</li>
                </ul>
              </div>

              <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400">
                This action cannot be undone.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setDeletingSubject(null)}
                disabled={isDeletingSubject}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteSubject}
                disabled={isDeletingSubject}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 shadow-md shadow-rose-500/20 transition-all cursor-pointer flex items-center gap-1.5"
              >
                {isDeletingSubject ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <span>Delete</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 12. Delete Chapter / Module Confirmation Modal */}
      {deletingChapter && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 font-bold text-sm text-rose-600 dark:text-rose-400">
                <Trash2 className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                <span>Delete {deletingChapter.type === "school" ? "Chapter" : "Module"}</span>
              </div>
              <button
                type="button"
                onClick={() => setDeletingChapter(null)}
                disabled={isDeletingChapter}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-left">
              <p className="text-xs text-slate-700 dark:text-slate-300">
                Are you sure you want to delete{" "}
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  "{deletingChapter.type === "school" ? "Chapter" : "Module"} {deletingChapter.chapterNumber}: {deletingChapter.chapterName}"
                </span>?
              </p>
              
              <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                <p className="font-semibold text-slate-700 dark:text-slate-300">This will permanently remove:</p>
                <ul className="list-disc list-inside space-y-0.5 text-slate-600 dark:text-slate-400 pl-1">
                  <li>All Topic Notes and Documents in this {deletingChapter.type === "school" ? "chapter" : "module"}</li>
                </ul>
              </div>

              <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400">
                This action cannot be undone.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setDeletingChapter(null)}
                disabled={isDeletingChapter}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteChapter}
                disabled={isDeletingChapter}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 shadow-md shadow-rose-500/20 transition-all cursor-pointer flex items-center gap-1.5"
              >
                {isDeletingChapter ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <span>Delete</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 13. Practice Test Builder Modal */}
      {practiceTestTarget && (
        <AdminPracticeTestModal
          isOpen={Boolean(practiceTestTarget)}
          onClose={() => setPracticeTestTarget(null)}
          classGrade={practiceTestTarget.classGrade}
          subject={practiceTestTarget.subject}
          chapterNo={practiceTestTarget.chapterNo}
          chapterName={practiceTestTarget.chapterName}
          topicName={practiceTestTarget.topicName}
          noteId={practiceTestTarget.noteId}
          topicNoteId={practiceTestTarget.noteId}
          onPracticeTestChanged={() => {
            loadPracticeTests();
            if (onRefresh) onRefresh();
          }}
        />
      )}
    </div>
  );
}
