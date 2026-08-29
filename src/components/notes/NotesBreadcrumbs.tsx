import React from "react";
import { ChevronRight, Home, School, GraduationCap, Folder, BookOpen, Layers } from "lucide-react";

export interface BreadcrumbItem {
  id: string;
  label: string;
  type: "root" | "class" | "gsPaper" | "subject" | "chapter" | "module" | "topics";
  icon?: React.ReactNode;
}

interface NotesBreadcrumbsProps {
  items: BreadcrumbItem[];
  onNavigate: (item: BreadcrumbItem, index: number) => void;
  className?: string;
}

export default function NotesBreadcrumbs({
  items,
  onNavigate,
  className = "",
}: NotesBreadcrumbsProps) {
  if (!items || items.length === 0) return null;

  return (
    <nav 
      aria-label="Notes hierarchy breadcrumbs" 
      className={`flex items-center gap-1 sm:gap-1.5 overflow-x-auto scrollbar-none py-1.5 px-3 rounded-xl bg-slate-100/80 dark:bg-slate-900/80 border border-slate-200/60 dark:border-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300 ${className}`}
      id="notes-breadcrumbs-bar"
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <React.Fragment key={`${item.id}-${index}`}>
            {index > 0 && (
              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 select-none" />
            )}
            <button
              type="button"
              onClick={() => onNavigate(item, index)}
              disabled={isLast}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors shrink-0 ${
                isLast
                  ? "bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 font-bold shadow-2xs cursor-default"
                  : "hover:bg-white/60 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
              }`}
              title={item.label}
              id={`breadcrumb-item-${index}`}
            >
              {item.type === "root" ? (
                <Home className="w-3.5 h-3.5 text-slate-400" />
              ) : item.type === "class" ? (
                <School className="w-3.5 h-3.5 text-slate-400" />
              ) : item.type === "gsPaper" ? (
                <GraduationCap className="w-3.5 h-3.5 text-slate-400" />
              ) : item.type === "subject" ? (
                <BookOpen className="w-3.5 h-3.5 text-slate-400" />
              ) : item.type === "chapter" || item.type === "module" ? (
                <Folder className="w-3.5 h-3.5 text-slate-400" />
              ) : (
                <Layers className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span className="truncate max-w-[130px] sm:max-w-[200px]">{item.label}</span>
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
}
