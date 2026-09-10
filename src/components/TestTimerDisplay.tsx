import React, { useState, useEffect, useRef, memo } from "react";
import { Clock } from "lucide-react";
import { testDiagnostics } from "../lib/testDiagnostics";

interface TestTimerDisplayProps {
  isActive: boolean;
  initialSeconds?: number;
  durationMinutes?: number;
  timerSecondsRef: React.MutableRefObject<number>;
  onPeriodicAutosave?: (elapsedSeconds: number) => void;
  onTimeExpired?: () => void;
}

function formatTime(totalSecs: number): string {
  const mins = Math.floor(Math.max(0, totalSecs) / 60);
  const secs = Math.max(0, totalSecs) % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export const TestTimerDisplay: React.FC<TestTimerDisplayProps> = memo(({
  isActive,
  initialSeconds = 0,
  durationMinutes,
  timerSecondsRef,
  onPeriodicAutosave,
  onTimeExpired
}) => {
  const isCountdown = typeof durationMinutes === "number" && durationMinutes > 0;
  const totalDurationSecs = isCountdown ? durationMinutes * 60 : 0;

  const getInitialDisplay = () => {
    if (isCountdown) {
      return Math.max(0, totalDurationSecs - initialSeconds);
    }
    return initialSeconds;
  };

  const [displaySeconds, setDisplaySeconds] = useState(getInitialDisplay);
  const startTimeRef = useRef<number>(Date.now() - initialSeconds * 1000);
  const autosaveIntervalRef = useRef<number>(0);
  const hasExpiredRef = useRef<boolean>(false);

  useEffect(() => {
    startTimeRef.current = Date.now() - initialSeconds * 1000;
    const initialDisp = isCountdown
      ? Math.max(0, totalDurationSecs - initialSeconds)
      : initialSeconds;
    setDisplaySeconds(initialDisp);
    timerSecondsRef.current = initialSeconds;
    hasExpiredRef.current = false;
  }, [initialSeconds, durationMinutes, isCountdown, totalDurationSecs, timerSecondsRef]);

  useEffect(() => {
    if (!isActive) return;

    testDiagnostics.incrementTimerCount("TestTimerDisplay");

    const timerId = setInterval(() => {
      // Wall-clock calculation guarantees zero drift even if the browser throttles
      const now = Date.now();
      const elapsed = Math.max(0, Math.floor((now - startTimeRef.current) / 1000));
      timerSecondsRef.current = elapsed;

      if (isCountdown) {
        const remaining = Math.max(0, totalDurationSecs - elapsed);
        setDisplaySeconds(remaining);

        if (remaining <= 0 && !hasExpiredRef.current) {
          hasExpiredRef.current = true;
          if (onTimeExpired) {
            onTimeExpired();
          }
        }
      } else {
        setDisplaySeconds(elapsed);
      }

      // Periodic autosave every 10 seconds
      autosaveIntervalRef.current += 1;
      if (autosaveIntervalRef.current >= 10) {
        autosaveIntervalRef.current = 0;
        if (onPeriodicAutosave) {
          onPeriodicAutosave(elapsed);
        }
      }
    }, 1000);

    // Sync back up when tab becomes visible after backgrounding
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const now = Date.now();
        const elapsed = Math.max(0, Math.floor((now - startTimeRef.current) / 1000));
        timerSecondsRef.current = elapsed;
        if (isCountdown) {
          const remaining = Math.max(0, totalDurationSecs - elapsed);
          setDisplaySeconds(remaining);
          if (remaining <= 0 && !hasExpiredRef.current) {
            hasExpiredRef.current = true;
            if (onTimeExpired) {
              onTimeExpired();
            }
          }
        } else {
          setDisplaySeconds(elapsed);
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      testDiagnostics.decrementTimerCount("TestTimerDisplay");
      clearInterval(timerId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isActive, isCountdown, totalDurationSecs, timerSecondsRef, onPeriodicAutosave, onTimeExpired]);

  if (!isActive) return null;

  const isUrgent = isCountdown && displaySeconds <= 60;
  const isWarning = isCountdown && displaySeconds <= 300 && displaySeconds > 60;

  const badgeClasses = isUrgent
    ? "bg-rose-600 text-white border-rose-300 animate-pulse shadow-md shadow-rose-500/40"
    : isWarning
      ? "bg-amber-500 text-white border-amber-300 shadow-xs"
      : "bg-blue-700/80 dark:bg-blue-800/80 border-white/25 text-white";

  return (
    <div
      id="test-timer-display"
      className={`h-[28px] sm:h-[32px] px-2.5 border rounded-full flex items-center gap-1.5 text-xs font-mono font-bold shadow-xs select-none transition-colors duration-300 ${badgeClasses}`}
      title={isCountdown ? `Time remaining: ${formatTime(displaySeconds)}` : "Time elapsed"}
    >
      <Clock className={`w-3.5 h-3.5 shrink-0 ${isUrgent ? "text-white animate-pulse" : isWarning ? "text-amber-100" : "text-amber-300"}`} />
      <span>{formatTime(displaySeconds)}</span>
      {isCountdown && (
        <span className="text-[10px] font-sans font-normal opacity-90 hidden xs:inline">
          remaining
        </span>
      )}
    </div>
  );
});

TestTimerDisplay.displayName = "TestTimerDisplay";
