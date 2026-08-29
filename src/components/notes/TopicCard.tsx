import React, { useState, useRef, useEffect } from "react";
import { 
  FileText, 
  Image as ImageIcon, 
  Eye, 
  RefreshCw, 
  Trash2, 
  FlaskConical,
  PlusCircle,
  HardDrive,
  Calendar,
  MoreVertical,
  FileCheck,
  Edit3
} from "lucide-react";
import { ClassNote, ChapterNote } from "../../types";
import { isImageFile } from "../../lib/nativePdfService";

interface TopicCardProps {
  note: ClassNote | ChapterNote;
  topicNumber?: number | string;
  topicTitle?: string;
  isAdmin?: boolean;
  onPreview: (note: ClassNote | ChapterNote) => void;
  onReplace?: (note: ClassNote | ChapterNote) => void;
  onRename?: (note: ClassNote | ChapterNote) => void;
  onDelete?: (note: ClassNote | ChapterNote) => void;
  onOpenPracticeTest?: (note: ClassNote | ChapterNote) => void;
  hasPracticeTest?: boolean;
  isOpening?: boolean;
  className?: string;
}

function formatBytes(bytes?: number): string {
  if (!bytes || isNaN(bytes) || bytes <= 0) return "";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

export default function TopicCard({
  note,
  topicNumber,
  topicTitle,
  isAdmin = true,
  onPreview,
  onReplace,
  onRename,
  onDelete,
  onOpenPracticeTest,
  hasPracticeTest = false,
  isOpening = false,
  className = "",
}: TopicCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const rawFilename = note.fileName || note.pdfFileName || (note as any).originalFilename || "note.pdf";
  const isImg = isImageFile(rawFilename);

  // Topic display calculation
  const rawTopicNo = topicNumber ?? (note as any).topicNumber ?? (note as any).topicNo;
  const paddedNo = rawTopicNo !== undefined && rawTopicNo !== null && String(rawTopicNo).trim() !== ""
    ? String(rawTopicNo)
    : "1";

  const rawTopicName = topicTitle ?? (note as any).topicTitle ?? (note as any).topicName ?? note.partLabel ?? "";
  const displayTitle = rawTopicName || `Topic ${paddedNo}`;
  const fileSizeStr = formatBytes((note as any).fileSize || (note as any).file_size);
  const dateStr = formatDate((note as any).createdAt || (note as any).uploadedAt);
  const fileExt = (rawFilename.split(".").pop() || (isImg ? "IMG" : "PDF")).toUpperCase();

  return (
    <div
      className={`group relative rounded-xl border border-slate-200/90 dark:border-slate-800/90 bg-white dark:bg-slate-900 px-2.5 py-2 sm:px-3 sm:py-2 transition-all duration-150 hover:shadow-xs hover:border-blue-400/70 dark:hover:border-blue-700/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 w-full min-w-0 ${
        isOpening ? "ring-2 ring-blue-500/50 pointer-events-none opacity-90" : ""
      } ${className}`}
      id={`topic-card-${note.id}`}
    >
      {/* Left Section: Topic badge, Title, and Metadata Line */}
      <div 
        onClick={() => onPreview(note)}
        className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1 cursor-pointer select-none"
        title="Click to view preview"
      >
        {/* Compact Topic Pill */}
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-extrabold uppercase tracking-tight bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/70 shrink-0">
          <FileText className="w-3 h-3 text-blue-500 shrink-0" />
          <span>T{paddedNo}</span>
        </span>

        {/* Title + Metadata (horizontal on desktop, compact 2-line on small mobile) */}
        <div className="min-w-0 flex-1 flex flex-col md:flex-row md:items-center md:gap-2.5">
          {/* Title */}
          <div className="flex items-center gap-1.5 min-w-0">
            <h4 className="text-xs sm:text-[13px] font-bold text-slate-800 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate leading-tight">
              {displayTitle}
            </h4>

            {hasPracticeTest && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/70 shrink-0">
                <FileCheck className="w-2.5 h-2.5 text-emerald-600" />
                <span>Test Ready</span>
              </span>
            )}
          </div>

          {/* Metadata Row: Format, Filename, Size, Upload Date */}
          <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-slate-400 dark:text-slate-500 font-medium truncate mt-0.5 md:mt-0">
            <span className="hidden md:inline text-slate-300 dark:text-slate-700">•</span>
            
            {/* File format badge */}
            <span className={`px-1 py-0.2 rounded text-[9px] font-black uppercase tracking-wider shrink-0 ${
              isImg
                ? "bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300"
                : "bg-red-50 dark:bg-red-950/80 text-red-700 dark:text-red-300 border border-red-200/60 dark:border-red-900/60"
            }`}>
              {fileExt}
            </span>

            {/* Filename */}
            <span className="truncate max-w-[120px] sm:max-w-[160px] md:max-w-[200px] text-slate-500 dark:text-slate-400" title={rawFilename}>
              {rawFilename}
            </span>

            {fileSizeStr && (
              <>
                <span className="text-slate-300 dark:text-slate-700">•</span>
                <span className="font-mono text-slate-400 shrink-0">{fileSizeStr}</span>
              </>
            )}

            {dateStr && (
              <>
                <span className="hidden lg:inline text-slate-300 dark:text-slate-700">•</span>
                <span className="hidden lg:inline text-slate-400 shrink-0">{dateStr}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Right Section: Compact Action Buttons (Always fits in single row) */}
      <div 
        className="flex items-center gap-1 sm:gap-1.5 shrink-0 justify-end flex-nowrap"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 1. 👁 View Button */}
        <button
          type="button"
          onClick={() => onPreview(note)}
          className="px-2 py-1 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/60 transition-colors border border-slate-200/80 dark:border-slate-800 flex items-center gap-1 cursor-pointer shrink-0"
          title="View document"
          aria-label="View document"
          id={`view-btn-${note.id}`}
        >
          <Eye className="w-3.5 h-3.5 text-blue-500" />
          <span>View</span>
        </button>

        {/* 2. 🔄 Replace Button */}
        {isAdmin && onReplace && (
          <button
            type="button"
            onClick={() => onReplace(note)}
            className="px-2 py-1 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/60 transition-colors border border-slate-200/80 dark:border-slate-800 flex items-center gap-1 cursor-pointer shrink-0"
            title="Replace document file"
            aria-label="Replace document file"
            id={`replace-btn-${note.id}`}
          >
            <RefreshCw className="w-3 h-3 text-slate-500" />
            <span className="hidden sm:inline">Replace</span>
          </button>
        )}

        {/* 3. 🧪 Practice Test Button */}
        {onOpenPracticeTest && (
          <button
            type="button"
            onClick={() => onOpenPracticeTest(note)}
            className={`px-2 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors border cursor-pointer shrink-0 ${
              hasPracticeTest
                ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300/80 dark:border-emerald-800/80 hover:bg-emerald-100 dark:hover:bg-emerald-900/70"
                : "bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-slate-200/80 dark:border-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-700"
            }`}
            title={hasPracticeTest ? "Edit Practice Test" : "Add Practice Test"}
            aria-label={hasPracticeTest ? "Edit Practice Test" : "Add Practice Test"}
            id={`practice-test-btn-${note.id}`}
          >
            {hasPracticeTest ? (
              <>
                <FlaskConical className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                <span>Test</span>
              </>
            ) : (
              <>
                <PlusCircle className="w-3 h-3 text-slate-400" />
                <span>+ Test</span>
              </>
            )}
          </button>
        )}

        {/* 4. 🗑 Delete Button */}
        {isAdmin && onDelete && (
          <button
            type="button"
            onClick={() => onDelete(note)}
            className="px-2 py-1 rounded-lg text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60 transition-colors border border-slate-200/80 dark:border-slate-800 flex items-center gap-1 cursor-pointer shrink-0"
            title="Delete topic note"
            aria-label="Delete topic note"
            id={`delete-btn-${note.id}`}
          >
            <Trash2 className="w-3 h-3" />
            <span className="hidden sm:inline">Delete</span>
          </button>
        )}

        {/* 5. ✏️ Rename in Kebab Menu / Quick Action */}
        {isAdmin && onRename && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => onRename(note)}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors border border-transparent flex items-center justify-center cursor-pointer shrink-0"
              title="Rename topic title"
              aria-label="Rename topic title"
              id={`rename-btn-${note.id}`}
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

