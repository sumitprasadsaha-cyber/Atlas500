import React from "react";
import { 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  FileText, 
  ArrowUpCircle,
  RefreshCw,
  HardDrive,
  Clock,
  Zap
} from "lucide-react";

export interface UploadProgressState {
  isOpen: boolean;
  isUploading: boolean;
  progress: number; // 0 to 100
  uploadedBytes?: number;
  totalBytes?: number;
  speedMbps?: number;
  remainingSeconds?: number;
  fileName?: string;
  error?: string | null;
  isSuccess?: boolean;
}

interface NotesUploadProgressModalProps {
  state: UploadProgressState;
  onCancel: () => void;
  onRetry?: () => void;
  onClose: () => void;
}

function formatBytes(bytes?: number): string {
  if (!bytes || isNaN(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatTime(seconds?: number): string {
  if (seconds === undefined || isNaN(seconds) || seconds <= 0) return "< 1s";
  if (seconds > 60) {
    const mins = Math.floor(seconds / 60);
    const sec = Math.round(seconds % 60);
    return `${mins}m ${sec}s`;
  }
  return `${Math.round(seconds)}s`;
}

export default function NotesUploadProgressModal({
  state,
  onCancel,
  onRetry,
  onClose,
}: NotesUploadProgressModalProps) {
  if (!state.isOpen) return null;

  const {
    isUploading,
    progress,
    uploadedBytes = 0,
    totalBytes = 0,
    speedMbps = 0,
    remainingSeconds = 0,
    fileName = "document.pdf",
    error,
    isSuccess,
  } = state;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn"
      id="notes-upload-progress-backdrop"
    >
      <div 
        className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 overflow-hidden relative"
        id="notes-upload-progress-card"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-xl border ${
              isSuccess 
                ? "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 border-emerald-200 dark:border-emerald-800" 
                : error 
                ? "bg-rose-50 dark:bg-rose-950/50 text-rose-600 border-rose-200 dark:border-rose-800" 
                : "bg-blue-50 dark:bg-blue-950/50 text-blue-600 border-blue-200 dark:border-blue-800"
            }`}>
              {isSuccess ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : error ? (
                <AlertCircle className="w-5 h-5" />
              ) : (
                <ArrowUpCircle className="w-5 h-5 animate-pulse" />
              )}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {isSuccess ? "Upload Complete" : error ? "Upload Failed" : "Uploading Topic Note"}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[240px]">
                {fileName}
              </p>
            </div>
          </div>

          {(isSuccess || error) && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Error message */}
        {error ? (
          <div className="my-4 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl text-xs text-rose-700 dark:text-rose-300">
            <div className="font-semibold flex items-center gap-1.5 mb-1">
              <AlertCircle className="w-4 h-4 shrink-0" /> Error Details
            </div>
            <p className="leading-relaxed">{error}</p>
          </div>
        ) : isSuccess ? (
          <div className="my-4 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>Note was successfully uploaded and saved.</span>
          </div>
        ) : (
          /* Active Progress Bar */
          <div className="my-4 space-y-3">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span className="text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" /> Uploading note...
              </span>
              <span className="font-mono text-blue-600 dark:text-blue-400 font-bold">
                {Math.round(progress)}%
              </span>
            </div>

            <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-200/60 dark:border-slate-700/60">
              <div 
                className="h-full bg-gradient-to-r from-blue-600 to-indigo-600 rounded-full transition-all duration-200 ease-out"
                style={{ width: `${Math.max(progress, 4)}%` }}
              />
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-3 gap-2 pt-2 text-[11px] text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800">
              <div className="flex flex-col items-center p-2 rounded-lg bg-slate-50 dark:bg-slate-950/50">
                <span className="flex items-center gap-1 text-[10px] text-slate-400 uppercase font-semibold">
                  <HardDrive className="w-3 h-3" /> Size
                </span>
                <span className="font-mono font-bold text-slate-700 dark:text-slate-300 mt-0.5 truncate max-w-full">
                  {formatBytes(uploadedBytes)} / {formatBytes(totalBytes)}
                </span>
              </div>

              <div className="flex flex-col items-center p-2 rounded-lg bg-slate-50 dark:bg-slate-950/50">
                <span className="flex items-center gap-1 text-[10px] text-slate-400 uppercase font-semibold">
                  <Zap className="w-3 h-3" /> Speed
                </span>
                <span className="font-mono font-bold text-slate-700 dark:text-slate-300 mt-0.5">
                  {speedMbps > 0 ? `${speedMbps.toFixed(1)} MB/s` : "Calculating..."}
                </span>
              </div>

              <div className="flex flex-col items-center p-2 rounded-lg bg-slate-50 dark:bg-slate-950/50">
                <span className="flex items-center gap-1 text-[10px] text-slate-400 uppercase font-semibold">
                  <Clock className="w-3 h-3" /> Remaining
                </span>
                <span className="font-mono font-bold text-slate-700 dark:text-slate-300 mt-0.5">
                  {isUploading && progress > 0 ? formatTime(remainingSeconds) : "--"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Action Controls Footer */}
        <div className="mt-5 pt-3 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
          {isUploading && (
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors border border-rose-200 dark:border-rose-800"
              id="upload-cancel-btn"
            >
              Cancel Upload
            </button>
          )}

          {error && onRetry && (
            <button
              onClick={onRetry}
              className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 transition-colors flex items-center gap-1.5 shadow-sm"
              id="upload-retry-btn"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          )}

          {isSuccess && (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors flex items-center gap-1.5 shadow-sm"
              id="upload-done-btn"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
