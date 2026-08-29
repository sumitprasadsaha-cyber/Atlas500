import React, { useState, useEffect } from "react";
import { X, Plus, School, GraduationCap, BookOpen, Layers, FolderPlus } from "lucide-react";

export type NodeType = "new_class" | "new_gs_paper" | "add_subject" | "add_chapter" | "add_module";

export interface CreateHierarchyNodeContext {
  nodeType: NodeType;
  type: "school" | "upsc";
  className?: string;
  gsPaper?: string;
  subject?: string;
  suggestedNumber?: number;
}

interface CreateHierarchyNodeModalProps {
  isOpen: boolean;
  context: CreateHierarchyNodeContext | null;
  onClose: () => void;
  onSubmit: (result: {
    nodeType: NodeType;
    name: string;
    number?: number;
    className?: string;
    gsPaper?: string;
    subject?: string;
  }) => void;
}

export default function CreateHierarchyNodeModal({
  isOpen,
  context,
  onClose,
  onSubmit,
}: CreateHierarchyNodeModalProps) {
  const [name, setName] = useState("");
  const [numberVal, setNumberVal] = useState<number | "">(1);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (isOpen && context) {
      setName("");
      setErrorMsg("");
      setNumberVal(context.suggestedNumber || 1);
    }
  }, [isOpen, context]);

  if (!isOpen || !context) return null;

  const getTitle = () => {
    switch (context.nodeType) {
      case "new_class":
        return "+ New Class";
      case "new_gs_paper":
        return "+ New GS Paper";
      case "add_subject":
        return "+ Add Subject";
      case "add_chapter":
        return "+ Add Chapter";
      case "add_module":
        return "+ Add Module";
      default:
        return "Add Item";
    }
  };

  const getSubtitle = () => {
    switch (context.nodeType) {
      case "new_class":
        return "Create a new school standard / class category";
      case "new_gs_paper":
        return "Add a new UPSC General Studies Paper or Optional";
      case "add_subject":
        return context.type === "school"
          ? `Add subject under ${context.className || "Class"}`
          : `Add subject under ${context.gsPaper || "UPSC Paper"}`;
      case "add_chapter":
        return `Add new chapter under ${context.className} • ${context.subject}`;
      case "add_module":
        return `Add new module under ${context.gsPaper} • ${context.subject}`;
      default:
        return "";
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();

    if (!cleanName && (context.nodeType === "new_class" || context.nodeType === "new_gs_paper" || context.nodeType === "add_subject")) {
      setErrorMsg("Please enter a name.");
      return;
    }

    const num = typeof numberVal === "number" ? numberVal : parseInt(String(numberVal), 10) || 1;

    onSubmit({
      nodeType: context.nodeType,
      name: cleanName || (context.nodeType === "add_chapter" ? `Chapter ${num}` : `Module ${num}`),
      number: num,
      className: context.className,
      gsPaper: context.gsPaper,
      subject: context.subject,
    });

    onClose();
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn"
      id="create-node-backdrop"
    >
      <div 
        className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col"
        id="create-node-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/40">
              <FolderPlus className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {getTitle()}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-xs">
                {getSubtitle()}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {(context.nodeType === "add_chapter" || context.nodeType === "add_module") && (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {context.nodeType === "add_chapter" ? "Chapter No." : "Module No."}
                </label>
                <input
                  type="number"
                  min="1"
                  value={numberVal}
                  onChange={(e) => setNumberVal(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  required
                />
              </div>

              <div className="col-span-2">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {context.nodeType === "add_chapter" ? "Chapter Title" : "Module Title"}
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={context.nodeType === "add_chapter" ? "e.g. Real Numbers" : "e.g. Historical Background"}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  autoFocus
                />
              </div>
            </div>
          )}

          {(context.nodeType === "new_class" || context.nodeType === "new_gs_paper" || context.nodeType === "add_subject") && (
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {context.nodeType === "new_class"
                  ? "Class Name"
                  : context.nodeType === "new_gs_paper"
                  ? "GS Paper Name"
                  : "Subject Name"}{" "}
                <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  context.nodeType === "new_class"
                    ? "e.g. Class 5 or Foundation Batch"
                    : context.nodeType === "new_gs_paper"
                    ? "e.g. GS Paper V or History Optional"
                    : "e.g. Mathematics, Science, Polity..."
                }
                className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                autoFocus
              />
            </div>
          )}

          {errorMsg && (
            <p className="text-xs font-semibold text-rose-500 dark:text-rose-400">
              {errorMsg}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-500/20 transition-all"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
