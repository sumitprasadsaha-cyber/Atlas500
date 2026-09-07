import React, { useState, useEffect, useRef, memo } from "react";
import { Clock } from "lucide-react";
import { testDiagnostics } from "../lib/testDiagnostics";

interface TestTimerDisplayProps {
  isActive: boolean;
  initialSeconds?: number;
  timerSecondsRef: React.MutableRefObject<number>;
  onPeriodicAutosave?: (elapsedSeconds: number) => void;
}

function formatTime(totalSecs: number): string {
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export const TestTimerDisplay: React.FC<TestTimerDisplayProps> = memo(({
  isActive,
  initialSeconds = 0,
  timerSecondsRef,
  onPeriodicAutosave
}) => {
  const [displaySeconds, setDisplaySeconds] = useState(initialSeconds);
  const startTimeRef = useRef<number>(Date.now() - initialSeconds * 1000);
  const autosaveIntervalRef = useRef<number>(0);

  useEffect(() => {
    startTimeRef.current = Date.now() - initialSeconds * 1000;
    setDisplaySeconds(initialSeconds);
    timerSecondsRef.current = initialSeconds;
  }, [initialSeconds, timerSecondsRef]);

  useEffect(() => {
    if (!isActive) return;

    testDiagnostics.incrementTimerCount("TestTimerDisplay");

    const timerId = setInterval(() => {
      // Wall-clock calculation guarantees zero drift even if the browser throttles
      const now = Date.now();
      const elapsed = Math.max(0, Math.floor((now - startTimeRef.current) / 1000));
      setDisplaySeconds(elapsed);
      timerSecondsRef.current = elapsed;

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
        setDisplaySeconds(elapsed);
        timerSecondsRef.current = elapsed;
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      testDiagnostics.decrementTimerCount("TestTimerDisplay");
      clearInterval(timerId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isActive, timerSecondsRef, onPeriodicAutosave]);

  if (!isActive) return null;

  return (
    <div
      id="test-timer-display"
      className="h-[28px] sm:h-[32px] px-2.5 bg-blue-700/80 dark:bg-blue-800/80 border border-white/25 rounded-full flex items-center gap-1.5 text-xs font-mono font-bold text-white shadow-xs select-none"
    >
      <Clock className="w-3.5 h-3.5 text-amber-300 shrink-0" />
      <span>{formatTime(displaySeconds)}</span>
    </div>
  );
});

TestTimerDisplay.displayName = "TestTimerDisplay";
