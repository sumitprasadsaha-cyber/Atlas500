import React, { useState, useRef, useEffect } from "react";
import { FlaskConical, Check, Trophy, Calendar, RotateCcw, Award } from "lucide-react";
import { TopicTestStats } from "../utils/testStatsHelper";
import { getScoreButtonStyles } from "../lib/practiceTestService";

interface StudentTestScoreButtonProps {
  stats: TopicTestStats | null;
  hasTest: boolean;
  topicName: string;
  onOpenTest: () => void;
  onPreload?: () => void;
  className?: string;
  size?: "sm" | "md";
  showCustomTooltip?: boolean;
}

export default function StudentTestScoreButton({
  stats,
  hasTest,
  topicName,
  onOpenTest,
  onPreload,
  className = "",
  size = "sm",
  showCustomTooltip = true,
}: StudentTestScoreButtonProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const isAttempted = !!(stats && stats.attemptCount > 0);
  const btnStyles = getScoreButtonStyles(isAttempted, stats?.bestPercentage);

  // Close custom tooltip when clicking outside on mobile
  useEffect(() => {
    if (!showTooltip) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (
        tooltipRef.current &&
        !tooltipRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setShowTooltip(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [showTooltip]);

  if (!hasTest) return null;

  const handleMouseEnter = () => {
    setShowTooltip(true);
    if (onPreload) onPreload();
  };

  const handlePointerDown = () => {
    if (onPreload) onPreload();
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenTest();
  };

  const defaultClasses = size === "md"
    ? "px-3 py-1.5 rounded-xl text-xs sm:text-sm font-bold border shadow-2xs transition active:scale-95 shrink-0"
    : "px-2.5 py-1 rounded-lg text-[11px] font-bold border shadow-2xs transition active:scale-95 shrink-0";

  return (
    <div 
      className="relative inline-flex items-center" 
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShowTooltip(false)}
      onPointerDown={handlePointerDown}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        onFocus={onPreload}
        className={`inline-flex items-center gap-1.5 cursor-pointer ${btnStyles.container} ${defaultClasses} ${className}`}
        title={isAttempted && stats ? stats.tooltipText : `Take Practice Test for ${topicName}`}
        aria-label={
          isAttempted && stats
            ? `Score ${stats.bestScore} of ${stats.totalQuestions} on ${topicName}`
            : `Take practice test for ${topicName}`
        }
      >
        {isAttempted && stats ? (
          <span className="font-extrabold flex items-center gap-1 tracking-tight">
            <span>✓</span>
            <span>{stats.bestScore}/{stats.totalQuestions}</span>
          </span>
        ) : (
          <>
            <FlaskConical className={`w-3.5 h-3.5 shrink-0 ${btnStyles.icon}`} />
            <span>Test</span>
          </>
        )}
      </button>

      {/* Rich Interactive Tooltip on Hover / Tap */}
      {showCustomTooltip && isAttempted && stats && showTooltip && (
        <div
          ref={tooltipRef}
          className="absolute right-0 bottom-full mb-2 z-50 w-56 p-2.5 bg-slate-900/95 dark:bg-slate-950/95 backdrop-blur-md text-white rounded-xl shadow-xl border border-slate-700/60 text-left text-xs pointer-events-none animate-fadeIn select-none"
          style={{ transform: "translateY(-2px)" }}
        >
          <div className="flex items-center gap-1.5 pb-1.5 mb-1.5 border-b border-slate-700/60">
            <Award className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="font-bold text-[11px] text-slate-200 truncate">
              {topicName}
            </span>
          </div>

          <div className="space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-medium">Latest Attempt:</span>
              <span className="font-bold text-blue-400">
                {stats.latestScore}/{stats.latestTotalQuestions}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-medium">Highest Score:</span>
              <span className="font-bold text-emerald-400">
                {stats.bestScore}/{stats.totalQuestions}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-medium">Number of Attempts:</span>
              <span className="font-bold text-slate-200">
                {stats.attemptCount}
              </span>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-slate-800">
              <span className="text-slate-400 font-medium">Last Attempt Date:</span>
              <span className="font-semibold text-slate-300 text-[10px] text-right truncate max-w-[110px]">
                {stats.lastAttemptDate}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
