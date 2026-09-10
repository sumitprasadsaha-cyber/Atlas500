import React, { useState, useEffect, useMemo } from "react";
import { Shield, Check, X, Lock, AlertCircle, CheckSquare, Square, Info } from "lucide-react";
import {
  SubjectClassAccess,
  getSubjectAccessConfig,
  saveSubjectAccessRule,
  normalizeClassId,
} from "../../lib/curriculumAccessService";

interface ManageClassAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  subjectName: string;
  currentClass: string;
  availableClasses: string[];
  onAccessSaved?: (access: SubjectClassAccess) => void;
}

export const ManageClassAccessModal: React.FC<ManageClassAccessModalProps> = ({
  isOpen,
  onClose,
  subjectName,
  currentClass,
  availableClasses,
  onAccessSaved,
}) => {
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [ownerClass, setOwnerClass] = useState<string>(currentClass);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Initialize access state when modal opens or props change
  useEffect(() => {
    if (!isOpen || !subjectName) return;

    setErrorMessage(null);
    setSuccessMessage(null);

    const accessConfig = getSubjectAccessConfig(subjectName, currentClass);
    const resolvedOwner = accessConfig.ownerClassId || currentClass;
    setOwnerClass(resolvedOwner);

    // Initial allowed classes must always include the owner class
    const initialAllowed = new Set<string>(accessConfig.allowedClasses || [resolvedOwner]);
    initialAllowed.add(resolvedOwner);

    // If current class isn't in allowed, add it
    if (currentClass) {
      initialAllowed.add(currentClass);
    }

    setSelectedClasses(Array.from(initialAllowed));
  }, [isOpen, subjectName, currentClass]);

  // List of distinct school classes to show
  const displayClasses = useMemo(() => {
    const list = Array.from(new Set([...availableClasses, ownerClass, currentClass])).filter(Boolean);
    // Sort logically e.g. Class 6, Class 7, Class 8...
    return list.sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ""), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ""), 10) || 0;
      if (numA && numB) return numA - numB;
      return a.localeCompare(b);
    });
  }, [availableClasses, ownerClass, currentClass]);

  if (!isOpen) return null;

  const handleToggleClass = (cls: string) => {
    // Owner class can NEVER be unchecked
    if (normalizeClassId(cls) === normalizeClassId(ownerClass)) {
      return;
    }

    setErrorMessage(null);
    setSelectedClasses((prev) => {
      const norm = normalizeClassId(cls);
      const isSelected = prev.some((c) => normalizeClassId(c) === norm);
      if (isSelected) {
        return prev.filter((c) => normalizeClassId(c) !== norm);
      } else {
        return [...prev, cls];
      }
    });
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setErrorMessage(null);

      // Strict client-side check: owner cannot be removed
      const normOwner = normalizeClassId(ownerClass);
      const finalAllowed = Array.from(new Set([ownerClass, ...selectedClasses]));

      if (!finalAllowed.some((c) => normalizeClassId(c) === normOwner)) {
        throw new Error(`Owner class "${ownerClass}" cannot be removed from allowed classes.`);
      }

      const updated = await saveSubjectAccessRule(subjectName, ownerClass, finalAllowed);

      setSuccessMessage("Class access updated successfully.");
      onAccessSaved?.(updated);

      setTimeout(() => {
        setIsSaving(false);
        onClose();
      }, 500);
    } catch (err: any) {
      setIsSaving(false);
      setErrorMessage(err?.message || "Failed to update class access permissions.");
    }
  };

  return (
    <div
      id="manage-class-access-modal-overlay"
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        id="manage-class-access-modal"
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Manage Class Access</h2>
              <p className="text-xs text-slate-500">Configure permission-based curriculum access</p>
            </div>
          </div>
          <button
            id="manage-access-close-btn"
            onClick={onClose}
            disabled={isSaving}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4">
          {/* Metadata Display */}
          <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/80 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500 font-medium">Subject</span>
              <span className="text-slate-900 font-semibold">{subjectName}</span>
            </div>
            <div className="flex items-center justify-between text-sm border-t border-slate-200/60 pt-2">
              <span className="text-slate-500 font-medium">Owner</span>
              <div className="flex items-center space-x-1.5">
                <span className="text-slate-900 font-semibold">{ownerClass}</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200/70">
                  <Lock className="w-2.5 h-2.5 mr-1" />
                  Owner Class
                </span>
              </div>
            </div>
          </div>

          {/* Rules explanation pill */}
          <div className="text-xs text-slate-600 bg-indigo-50/60 border border-indigo-100 rounded-lg p-3 flex items-start space-x-2">
            <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
            <span>
              The owner class edits curriculum and manages notes. Allowed classes receive instant read-only access to the canonical curriculum with no duplication.
            </span>
          </div>

          {/* Classes Checklist */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2.5">
              Classes with access
            </label>
            <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-60 overflow-y-auto bg-white">
              {displayClasses.map((cls) => {
                const isOwner = normalizeClassId(cls) === normalizeClassId(ownerClass);
                const isChecked = isOwner || selectedClasses.some((c) => normalizeClassId(c) === normalizeClassId(cls));

                return (
                  <div
                    key={cls}
                    id={`class-access-row-${cls.replace(/\s+/g, "-")}`}
                    onClick={() => !isOwner && handleToggleClass(cls)}
                    className={`flex items-center justify-between px-4 py-3 transition-colors ${
                      isOwner
                        ? "bg-slate-50/80 cursor-not-allowed opacity-90"
                        : "cursor-pointer hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className="text-indigo-600">
                        {isChecked ? (
                          <CheckSquare className={`w-5 h-5 ${isOwner ? "text-slate-400" : "text-indigo-600"}`} />
                        ) : (
                          <Square className="w-5 h-5 text-slate-300" />
                        )}
                      </div>
                      <div>
                        <span className={`text-sm font-medium ${isOwner ? "text-slate-700 font-semibold" : "text-slate-800"}`}>
                          {cls}
                        </span>
                        {isOwner && (
                          <span className="ml-2 text-xs font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/60">
                            Owner
                          </span>
                        )}
                      </div>
                    </div>

                    {isOwner ? (
                      <span className="text-[11px] text-slate-400 font-normal">Cannot be removed</span>
                    ) : isChecked ? (
                      <span className="text-[11px] text-emerald-600 font-medium">Consumer</span>
                    ) : (
                      <span className="text-[11px] text-slate-400">No access</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 p-2.5 rounded-lg flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Success Message */}
          {successMessage && (
            <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 p-2.5 rounded-lg flex items-center space-x-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end space-x-3">
          <button
            id="manage-access-cancel-btn"
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 rounded-xl transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            id="manage-access-save-btn"
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-xl transition-colors shadow-sm disabled:opacity-50 flex items-center space-x-1.5"
          >
            {isSaving ? (
              <span>Saving...</span>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>Save</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ManageClassAccessModal;
