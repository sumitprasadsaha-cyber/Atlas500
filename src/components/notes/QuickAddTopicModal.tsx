import React, { useState, useRef, useEffect } from "react";
import { 
  X, 
  Upload, 
  Plus, 
  FileCheck,
  AlertTriangle,
  Layers,
  School,
  GraduationCap
} from "lucide-react";
import { ClassNote } from "../../types";
import { uploadNotePipeline } from "../../lib/notesService";
import NotesUploadProgressModal, { UploadProgressState } from "./NotesUploadProgressModal";

export interface ParentContext {
  type: "school" | "upsc";
  className?: string; // e.g. "Class 10"
  subject: string; // e.g. "Mathematics" or "Polity"
  gsPaper?: string; // e.g. "General Studies Paper II"
  chapterNumber?: number; // e.g. 1
  chapterName?: string; // e.g. "Real Numbers"
  moduleNumber?: number; // e.g. 1
  moduleName?: string; // e.g. "Historical Background"
  existingTopics: ClassNote[];
}

interface QuickAddTopicModalProps {
  isOpen: boolean;
  parentContext: ParentContext | null;
  initialFile?: File | null;
  onClose: () => void;
  onSuccess: (newNote: ClassNote) => void;
}

export default function QuickAddTopicModal({
  isOpen,
  parentContext,
  initialFile = null,
  onClose,
  onSuccess,
}: QuickAddTopicModalProps) {
  const [topicNumber, setTopicNumber] = useState<number | "">(1);
  const [topicName, setTopicName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState<{
    exists: boolean;
    existingNote?: ClassNote;
    field?: "number" | "name";
  } | null>(null);

  // Upload Progress Tracking
  const [uploadState, setUploadState] = useState<UploadProgressState>({
    isOpen: false,
    isUploading: false,
    progress: 0,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadStartTimeRef = useRef<number>(0);

  // Initialize defaults when modal opens
  useEffect(() => {
    if (isOpen && parentContext) {
      setErrorMsg("");
      setDuplicateWarning(null);
      setSelectedFile(initialFile);

      // Auto-suggest next topic number
      const numbers = (parentContext.existingTopics || [])
        .map((t) => {
          const raw = (t as any).topicNumber ?? t.topicNo;
          const num = typeof raw === "number" ? raw : parseInt(String(raw).replace(/\D/g, ""), 10);
          return isNaN(num) ? 0 : num;
        })
        .filter((n) => n > 0);

      const maxNum = numbers.length > 0 ? Math.max(...numbers) : 0;
      setTopicNumber(maxNum + 1);
      setTopicName("");
    }
  }, [isOpen, parentContext, initialFile]);

  // Check duplicate on change
  useEffect(() => {
    if (!parentContext || !isOpen) return;

    const num = typeof topicNumber === "number" ? topicNumber : parseInt(String(topicNumber), 10);
    const cleanName = topicName.trim().toLowerCase();

    if (!num && !cleanName) {
      setDuplicateWarning(null);
      return;
    }

    const dup = (parentContext.existingTopics || []).find((t) => {
      const tNum = (t as any).topicNumber ?? t.topicNo;
      const tName = ((t as any).topicTitle || (t as any).topicName || t.partLabel || "").trim().toLowerCase();

      if (num && tNum !== undefined && Number(tNum) === num) {
        return true;
      }
      if (cleanName && tName && tName === cleanName) {
        return true;
      }
      return false;
    });

    if (dup) {
      const tNum = (dup as any).topicNumber ?? dup.topicNo;
      const field = num && Number(tNum) === num ? "number" : "name";
      setDuplicateWarning({ exists: true, existingNote: dup, field });
    } else {
      setDuplicateWarning(null);
    }
  }, [topicNumber, topicName, parentContext, isOpen]);

  if (!isOpen || !parentContext) return null;

  const isSchool = parentContext.type === "school";

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setSelectedFile(file);
      if (!topicName) {
        const baseName = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
        setTopicName(baseName);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      if (!topicName) {
        const baseName = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
        setTopicName(baseName);
      }
    }
  };

  const handleSaveTopic = async (overrideDuplicate = false) => {
    if (!selectedFile) {
      setErrorMsg("Please choose a PDF or image document to upload.");
      return;
    }

    if (!topicName.trim()) {
      setErrorMsg("Please enter a Topic Name.");
      return;
    }

    if (duplicateWarning?.exists && !overrideDuplicate) {
      setErrorMsg(`A topic with this ${duplicateWarning.field} already exists in this ${isSchool ? "Chapter" : "Module"}. Choose a different number/name or proceed.`);
      return;
    }

    setErrorMsg("");
    uploadStartTimeRef.current = Date.now();

    const totalBytes = selectedFile.size;

    setUploadState({
      isOpen: true,
      isUploading: true,
      progress: 0,
      fileName: selectedFile.name,
      totalBytes,
      uploadedBytes: 0,
      speedMbps: 0,
      remainingSeconds: 0,
      error: null,
      isSuccess: false,
    });

    try {
      const isUPSC = parentContext.type === "upsc";
      const result = await uploadNotePipeline({
        file: selectedFile,
        classGrade: isUPSC ? "UPSC" : (parentContext.className || ""),
        subject: parentContext.subject,
        gsPaper: parentContext.gsPaper,
        generalStudiesPaper: parentContext.gsPaper,
        chapterNo: parentContext.chapterNumber,
        chapterNumber: parentContext.chapterNumber,
        chapterName: parentContext.chapterName,
        chapterTitle: parentContext.chapterName,
        moduleNo: parentContext.moduleNumber,
        moduleNumber: parentContext.moduleNumber,
        moduleName: parentContext.moduleName,
        moduleTitle: parentContext.moduleName,
        topicNo: typeof topicNumber === "number" ? topicNumber : parseInt(String(topicNumber), 10) || 1,
        topicNumber: typeof topicNumber === "number" ? topicNumber : parseInt(String(topicNumber), 10) || 1,
        topicName: topicName.trim(),
        topicTitle: topicName.trim(),
        partLabel: topicName.trim(),
        onProgress: (pct) => {
          const now = Date.now();
          const elapsedSec = (now - uploadStartTimeRef.current) / 1000;
          const currentUploaded = (pct / 100) * totalBytes;
          const speed = elapsedSec > 0 ? (currentUploaded / (1024 * 1024)) / elapsedSec : 0;
          const remainingBytes = Math.max(totalBytes - currentUploaded, 0);
          const remainingSec = speed > 0 ? (remainingBytes / (1024 * 1024)) / speed : 0;

          setUploadState((prev) => ({
            ...prev,
            progress: pct,
            uploadedBytes: currentUploaded,
            speedMbps: speed,
            remainingSeconds: remainingSec,
          }));
        },
      });

      setUploadState((prev) => ({
        ...prev,
        isUploading: false,
        progress: 100,
        isSuccess: true,
      }));

      setTimeout(() => {
        setUploadState((prev) => ({ ...prev, isOpen: false }));
        onSuccess(result);
        onClose();
      }, 500);
    } catch (err: any) {
      console.error("[QuickAddTopicModal] Upload failed:", err);
      setUploadState((prev) => ({
        ...prev,
        isUploading: false,
        error: err?.message || "Failed to upload note. Please check your network and try again.",
      }));
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn"
      id="quick-add-topic-backdrop"
    >
      <div 
        className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[92vh]"
        id="quick-add-topic-modal"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/40">
              <Plus className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Upload Topic Note
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isSchool ? "Add note to selected school chapter" : "Add note to selected UPSC module"}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            id="close-add-topic-modal-btn"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Automatic Destination Hierarchy display */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-850/60 rounded-xl border border-slate-200/80 dark:border-slate-800 space-y-2 text-xs">
            <div className="flex items-center gap-2 font-bold text-slate-700 dark:text-slate-300 pb-1.5 border-b border-slate-200/60 dark:border-slate-800">
              {isSchool ? <School className="w-4 h-4 text-blue-500" /> : <GraduationCap className="w-4 h-4 text-indigo-500" />}
              <span>Upload Destination</span>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                  {isSchool ? "Class" : "GS Paper"}
                </span>
                <span className="font-bold text-slate-900 dark:text-slate-100 truncate block">
                  {isSchool ? (parentContext.className || "") : (parentContext.gsPaper || "")}
                </span>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                  Subject
                </span>
                <span className="font-bold text-slate-900 dark:text-slate-100 truncate block">
                  {parentContext.subject}
                </span>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                  {isSchool ? "Chapter" : "Module"}
                </span>
                <span className="font-bold text-slate-900 dark:text-slate-100 truncate block">
                  {isSchool
                    ? `Chapter ${parentContext.chapterNumber}${parentContext.chapterName && parentContext.chapterName !== `Chapter ${parentContext.chapterNumber}` ? `: ${parentContext.chapterName}` : ""}`
                    : `Module ${parentContext.moduleNumber}${parentContext.moduleName && parentContext.moduleName !== `Module ${parentContext.moduleNumber}` ? `: ${parentContext.moduleName}` : ""}`
                  }
                </span>
              </div>
            </div>
          </div>

          {/* Form Fields: Topic Number + Topic Name */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-1">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Topic Number <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                value={topicNumber}
                onChange={(e) => setTopicNumber(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                placeholder="1"
                id="topic-number-input"
              />
            </div>

            <div className="sm:col-span-3">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Topic Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={topicName}
                onChange={(e) => setTopicName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                placeholder="e.g. Real Numbers / Historical Background"
                id="topic-name-input"
              />
            </div>
          </div>

          {/* Duplicate Warning Alert */}
          {duplicateWarning?.exists && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold">Topic Already Exists</p>
                <p className="mt-0.5 text-[11px] leading-relaxed">
                  A topic with this {duplicateWarning.field} already exists in this {isSchool ? "chapter" : "module"}.
                </p>
              </div>
            </div>
          )}

          {/* File Upload Dropzone */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Upload PDF or Image <span className="text-rose-500">*</span>
            </label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-5 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center gap-2 ${
                isDragOver
                  ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 scale-[1.01]"
                  : selectedFile
                  ? "border-emerald-400 bg-emerald-50/30 dark:bg-emerald-950/20"
                  : "border-slate-200 dark:border-slate-800 hover:border-blue-400 bg-slate-50/50 dark:bg-slate-950/40"
              }`}
              id="topic-upload-dropzone"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,image/png,image/jpeg,image/webp,image/jpg"
                onChange={handleFileSelect}
                className="hidden"
                id="topic-file-input"
              />

              {selectedFile ? (
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-300">
                    <FileCheck className="w-6 h-6" />
                  </div>
                  <div className="text-left">
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate max-w-[240px]">
                      {selectedFile.name}
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • Click to replace file
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="p-3 rounded-2xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400">
                    <Upload className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Drag & Drop PDF or Image here, or <span className="text-blue-600 dark:text-blue-400 underline">Browse</span>
                    </p>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                      Supports PDF, PNG, JPG, WebP
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl text-xs text-rose-700 dark:text-rose-300 font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Upload Progress Display */}
          {uploadState.isUploading && (
            <div className="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl text-xs space-y-1.5">
              <div className="flex justify-between text-[11px] font-bold text-blue-700 dark:text-blue-300">
                <span>Uploading note...</span>
                <span>{uploadState.progress}%</span>
              </div>
              <div className="w-full h-2 bg-blue-100 dark:bg-blue-900 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-600 rounded-full transition-all duration-300"
                  style={{ width: `${uploadState.progress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50">
          <button
            type="button"
            onClick={onClose}
            disabled={uploadState.isUploading}
            className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
            id="cancel-add-topic-btn"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() => handleSaveTopic(false)}
            disabled={uploadState.isUploading || !selectedFile || !topicName.trim()}
            className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-blue-500/20 transition-all flex items-center gap-2"
            id="save-topic-btn"
          >
            {uploadState.isUploading ? "Uploading..." : "Save Topic Note"}
          </button>
        </div>
      </div>

      {/* Real-time Upload Progress Modal */}
      <NotesUploadProgressModal
        state={uploadState}
        onCancel={() => {
          setUploadState((prev) => ({ ...prev, isOpen: false, isUploading: false }));
        }}
        onRetry={() => {
          handleSaveTopic(true);
        }}
        onClose={() => {
          setUploadState((prev) => ({ ...prev, isOpen: false }));
        }}
      />
    </div>
  );
}
