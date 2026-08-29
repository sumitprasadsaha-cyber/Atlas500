import React, { useState, useEffect } from "react";
import { 
  X, 
  FolderPlus, 
  Pencil, 
  Trash2, 
  AlertTriangle, 
  Folder, 
  Layers,
  CheckCircle2,
  Loader2 
} from "lucide-react";
import { ClassNote } from "../../types";

export interface ChapterModuleAction {
  mode: "add" | "rename" | "delete";
  type: "school" | "upsc";
  className?: string; // e.g. "Class 10"
  subject: string; // e.g. "Mathematics" or "Polity"
  gsPaper?: string; // e.g. "General Studies Paper II"
  chapterNumber?: number;
  chapterName?: string;
  moduleNumber?: number;
  moduleName?: string;
  affectedTopics?: ClassNote[];
}

interface ChapterModuleModalProps {
  action: ChapterModuleAction | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirmAdd: (data: { number: number; name: string }) => void;
  onConfirmRename: (data: { oldNumber: number; newNumber: number; newName: string }) => void;
  onConfirmDelete: (data: { number: number; topics: ClassNote[] }) => void;
}

export default function ChapterModuleModal({
  action,
  isOpen,
  onClose,
  onConfirmAdd,
  onConfirmRename,
  onConfirmDelete,
}: ChapterModuleModalProps) {
  const [number, setNumber] = useState<number | "">(1);
  const [name, setName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && action) {
      setErrorMsg("");
      setIsSubmitting(false);
      if (action.mode === "add") {
        const nextNo = (action.chapterNumber ?? action.moduleNumber ?? 0) + 1;
        setNumber(nextNo);
        setName("");
      } else if (action.mode === "rename") {
        setNumber(action.chapterNumber ?? action.moduleNumber ?? 1);
        setName(action.chapterName ?? action.moduleName ?? "");
      }
    }
  }, [isOpen, action]);

  if (!isOpen || !action) return null;

  const isSchool = action.type === "school";
  const entityLabel = isSchool ? "Chapter" : "Module";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (action.mode === "delete") {
      setIsSubmitting(true);
      onConfirmDelete({
        number: action.chapterNumber ?? action.moduleNumber ?? 1,
        topics: action.affectedTopics || [],
      });
      return;
    }

    const num = typeof number === "number" ? number : parseInt(String(number), 10);
    if (!num || num <= 0) {
      setErrorMsg(`Please enter a valid ${entityLabel} number.`);
      return;
    }

    if (!name.trim()) {
      setErrorMsg(`Please enter a ${entityLabel} name.`);
      return;
    }

    setIsSubmitting(true);
    if (action.mode === "add") {
      onConfirmAdd({ number: num, name: name.trim() });
    } else if (action.mode === "rename") {
      const oldNo = action.chapterNumber ?? action.moduleNumber ?? 1;
      onConfirmRename({ oldNumber: oldNo, newNumber: num, newName: name.trim() });
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn"
      id="chapter-module-modal-backdrop"
    >
      <div 
        className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
        id="chapter-module-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-xl border ${
              action.mode === "delete" 
                ? "bg-rose-50 dark:bg-rose-950/50 text-rose-600 border-rose-200 dark:border-rose-800"
                : "bg-blue-50 dark:bg-blue-950/50 text-blue-600 border-blue-200 dark:border-blue-800"
            }`}>
              {action.mode === "delete" ? (
                <Trash2 className="w-5 h-5" />
              ) : action.mode === "rename" ? (
                <Pencil className="w-5 h-5" />
              ) : (
                <FolderPlus className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {action.mode === "add" 
                  ? `New ${entityLabel}` 
                  : action.mode === "rename" 
                  ? `Rename ${entityLabel}` 
                  : `Delete ${entityLabel}`}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[240px]">
                {isSchool ? `${action.className} • ${action.subject}` : `UPSC • ${action.gsPaper} • ${action.subject}`}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {action.mode === "delete" ? (
            <div className="space-y-3">
              <div className="p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl text-xs text-rose-800 dark:text-rose-300 space-y-2">
                <div className="font-bold flex items-center gap-2 text-rose-900 dark:text-rose-200">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  Are you sure you want to delete this {entityLabel.toLowerCase()}?
                </div>
                <p className="leading-relaxed">
                  This will permanently delete <span className="font-bold">{entityLabel} {action.chapterNumber ?? action.moduleNumber}: {action.chapterName ?? action.moduleName}</span> and all <span className="font-bold">{action.affectedTopics?.length || 0} topic notes</span> contained within it.
                </p>
              </div>

              {action.affectedTopics && action.affectedTopics.length > 0 && (
                <div className="max-h-36 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 p-2 space-y-1 bg-slate-50 dark:bg-slate-950">
                  {action.affectedTopics.map((t) => (
                    <div key={t.id} className="text-xs text-slate-600 dark:text-slate-400 px-2 py-1 truncate">
                      • {(t as any).topicTitle || (t as any).topicName || t.partLabel || t.fileName}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-3">
                <div className="col-span-1">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    No.
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={number}
                    onChange={(e) => setNumber(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                    placeholder="01"
                    required
                  />
                </div>

                <div className="col-span-3">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {entityLabel} Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                    placeholder={`e.g. ${isSchool ? "Real Numbers" : "Salient Features of Constitution"}`}
                    required
                    autoFocus
                  />
                </div>
              </div>

              {errorMsg && (
                <p className="text-xs text-rose-600 font-semibold">{errorMsg}</p>
              )}
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className={`px-4 py-2 rounded-xl text-xs font-bold text-white transition-colors flex items-center gap-1.5 shadow-sm ${
                action.mode === "delete"
                  ? "bg-rose-600 hover:bg-rose-700"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : action.mode === "delete" ? (
                "Confirm Delete"
              ) : action.mode === "rename" ? (
                "Save Changes"
              ) : (
                "Create"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
