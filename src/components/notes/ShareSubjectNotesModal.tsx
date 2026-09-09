import React, { useState, useMemo, useCallback } from "react";
import { 
  X, 
  Share2, 
  AlertTriangle, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  BookOpen, 
  Layers, 
  CheckSquare, 
  Square 
} from "lucide-react";
import { ClassNote, TopicPracticeTest } from "../../types";
import { SchoolHierarchyData } from "../../lib/curriculumService";
import { 
  checkSubjectExistsInClass, 
  copySubjectToClasses, 
  ShareSubjectResult 
} from "../../lib/subjectSharingService";

interface ShareSubjectNotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSubject: string;
  currentClass: string;
  allClasses: string[];
  notes: ClassNote[];
  schoolHierarchy: SchoolHierarchyData;
  practiceTestBank?: Record<string, TopicPracticeTest>;
  onRefresh?: () => void;
}

type ModalStep = "select" | "confirm_replace" | "copying" | "result";

export default function ShareSubjectNotesModal({
  isOpen,
  onClose,
  currentSubject,
  currentClass,
  allClasses = [],
  notes = [],
  schoolHierarchy,
  practiceTestBank = {},
  onRefresh,
}: ShareSubjectNotesModalProps) {
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [step, setStep] = useState<ModalStep>("select");
  const [progressStep, setProgressStep] = useState<string>("Sharing notes...");
  const [conflictingClasses, setConflictingClasses] = useState<string[]>([]);
  const [result, setResult] = useState<ShareSubjectResult | null>(null);

  // Filter available destination classes (all except current class)
  const destinationClasses = useMemo(() => {
    return allClasses.filter(
      (c) => c.trim().toLowerCase() !== currentClass.trim().toLowerCase()
    );
  }, [allClasses, currentClass]);

  // Reset state when opening/closing
  const handleClose = useCallback(() => {
    if (step === "copying") return; // Prevent closing while in flight
    setSelectedClasses([]);
    setStep("select");
    setConflictingClasses([]);
    setResult(null);
    onClose();
  }, [step, onClose]);

  const toggleClassSelection = (cls: string) => {
    setSelectedClasses((prev) =>
      prev.includes(cls) ? prev.filter((c) => c !== cls) : [...prev, cls]
    );
  };

  const handleSelectAll = () => {
    if (selectedClasses.length === destinationClasses.length) {
      setSelectedClasses([]);
    } else {
      setSelectedClasses([...destinationClasses]);
    }
  };

  // Check for conflicts when user clicks "Share Notes"
  const handleInitialShareClick = () => {
    if (selectedClasses.length === 0) return;

    const conflicts = selectedClasses.filter((cls) =>
      checkSubjectExistsInClass(cls, currentSubject, schoolHierarchy, notes)
    );

    if (conflicts.length > 0) {
      setConflictingClasses(conflicts);
      setStep("confirm_replace");
    } else {
      executeShare();
    }
  };

  // Perform actual copy pipeline
  const executeShare = async () => {
    setStep("copying");
    setProgressStep("Sharing notes...");

    try {
      const shareResult = await copySubjectToClasses({
        sourceClass: currentClass,
        sourceSubject: currentSubject,
        destinationClasses: selectedClasses,
        notes,
        schoolHierarchy,
        practiceTestBank,
        onProgress: (msg) => setProgressStep(msg),
      });

      setResult(shareResult);
      setStep("result");

      // Notify parent to refresh affected destination classes without reloading the whole page
      if (shareResult.successfulClasses.length > 0) {
        onRefresh?.();
        window.dispatchEvent(
          new CustomEvent("curriculum-hierarchy-updated", {
            detail: { affectedClasses: shareResult.successfulClasses },
          })
        );
        window.dispatchEvent(new CustomEvent("notes-progress-updated"));
        window.dispatchEvent(new CustomEvent("practice-tests-updated"));
      }
    } catch (err) {
      console.error("[ShareSubjectModal] Unexpected error:", err);
      setResult({
        successfulClasses: [],
        failedClasses: [...selectedClasses],
        totalNotesCopied: 0,
        totalChaptersCopied: 0,
        totalTestsCopied: 0,
      });
      setStep("result");
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn"
      id="share-subject-notes-modal-overlay"
    >
      <div 
        className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh]"
        id="share-subject-notes-modal"
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Share Subject Notes
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Copy complete subject curriculum to other classes
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            disabled={step === "copying"}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors cursor-pointer"
            id="share-modal-close-btn"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Subject / Class Context Bar */}
        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 dark:text-slate-400 font-medium">Current Subject:</span>
            <span className="font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1">
              <BookOpen className="w-3.5 h-3.5 inline" />
              {currentSubject}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 dark:text-slate-400 font-medium">Current Class:</span>
            <span className="font-bold text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-800 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700">
              {currentClass}
            </span>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1">
          {/* STEP 1: CLASS SELECTION */}
          {step === "select" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Select destination classes:
                </span>
                {destinationClasses.length > 1 && (
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                    id="share-modal-select-all-btn"
                  >
                    {selectedClasses.length === destinationClasses.length ? (
                      <>
                        <Square className="w-3.5 h-3.5" /> Deselect All
                      </>
                    ) : (
                      <>
                        <CheckSquare className="w-3.5 h-3.5" /> Select All
                      </>
                    )}
                  </button>
                )}
              </div>

              {destinationClasses.length === 0 ? (
                <div className="p-4 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-900/30">
                  <p className="text-xs text-slate-400 font-medium">
                    No other classes available to share to.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1" id="share-destination-classes-list">
                  {destinationClasses.map((cls) => {
                    const isSelected = selectedClasses.includes(cls);
                    const alreadyHas = checkSubjectExistsInClass(cls, currentSubject, schoolHierarchy, notes);

                    return (
                      <label
                        key={cls}
                        className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer select-none ${
                          isSelected
                            ? "bg-blue-50/70 dark:bg-blue-900/30 border-blue-500/80 text-blue-900 dark:text-blue-100"
                            : "bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200"
                        }`}
                        id={`dest-class-label-${cls.replace(/\s+/g, "-")}`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleClassSelection(cls)}
                            className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                            id={`dest-class-checkbox-${cls.replace(/\s+/g, "-")}`}
                          />
                          <span className="text-sm font-semibold">{cls}</span>
                        </div>

                        {alreadyHas && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                            Already exists
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}

              <p className="text-[11px] text-slate-400 dark:text-slate-500 italic">
                * Notes, chapters, ordering, permissions, and attached tests will be safely copied. Storage files are reused without duplicating space.
              </p>
            </div>
          )}

          {/* STEP 2: REPLACE CONFIRMATION */}
          {step === "confirm_replace" && (
            <div className="space-y-4 py-1 animate-fadeIn" id="share-replace-confirmation-view">
              <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                    This subject already exists.
                  </h3>
                  <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                    Subject <span className="font-semibold underline">{currentSubject}</span> already exists in:
                  </p>
                  <ul className="text-xs font-semibold text-amber-900 dark:text-amber-200 list-disc list-inside">
                    {conflictingClasses.map((cls) => (
                      <li key={cls}>{cls}</li>
                    ))}
                  </ul>
                  <p className="text-xs text-amber-800/90 dark:text-amber-300/90 pt-1 font-medium">
                    Replace it?
                  </p>
                </div>
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                Replacing will overwrite the existing subject, its chapters, and notes in the destination classes with the new copy.
              </p>
            </div>
          )}

          {/* STEP 3: COPYING PROGRESS */}
          {step === "copying" && (
            <div className="py-8 flex flex-col items-center justify-center space-y-4 text-center animate-fadeIn" id="share-copying-progress-view">
              <div className="relative">
                <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  {progressStep}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Reusing storage references and updating curriculum metadata...
                </p>
              </div>
            </div>
          )}

          {/* STEP 4: RESULT SUMMARY */}
          {step === "result" && result && (
            <div className="space-y-4 py-2 animate-fadeIn" id="share-result-summary-view">
              {result.failedClasses.length === 0 ? (
                <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                      Subject shared successfully.
                    </h3>
                    <p className="text-xs text-emerald-800 dark:text-emerald-300">
                      Shared to:{" "}
                      <span className="font-semibold">
                        {result.successfulClasses.join(", ")}
                      </span>
                    </p>
                    <div className="text-[11px] text-emerald-700 dark:text-emerald-400 pt-1">
                      {result.totalChaptersCopied} chapters & {result.totalNotesCopied} notes configured.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {result.successfulClasses.length > 0 && (
                    <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800">
                      <p className="text-xs font-bold text-emerald-900 dark:text-emerald-200 mb-1">
                        Shared successfully:
                      </p>
                      <ul className="text-xs text-emerald-800 dark:text-emerald-300 list-disc list-inside">
                        {result.successfulClasses.map((cls) => (
                          <li key={cls}>{cls}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800">
                    <p className="text-xs font-bold text-rose-900 dark:text-rose-200 mb-1 flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-rose-600" />
                      Failed:
                    </p>
                    <ul className="text-xs text-rose-800 dark:text-rose-300 list-disc list-inside">
                      {result.failedClasses.map((cls) => (
                        <li key={cls}>{cls}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2.5">
          {step === "select" && (
            <>
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
                id="share-modal-cancel-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleInitialShareClick}
                disabled={selectedClasses.length === 0}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center gap-1.5"
                id="share-modal-confirm-btn"
              >
                <Share2 className="w-3.5 h-3.5" />
                Share Notes
              </button>
            </>
          )}

          {step === "confirm_replace" && (
            <>
              <button
                type="button"
                onClick={() => setStep("select")}
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
                id="share-replace-cancel-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeShare}
                className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-1.5"
                id="share-replace-confirm-btn"
              >
                Replace
              </button>
            </>
          )}

          {step === "result" && (
            <button
              type="button"
              onClick={handleClose}
              className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition-all cursor-pointer"
              id="share-result-done-btn"
            >
              {result?.failedClasses.length === 0 ? "Done" : "Close"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
