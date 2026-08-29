import { TestAttemptRecord } from "../types";
import { isSubjectCompatible } from "../lib/practiceTestService";

export interface TopicTestStats {
  bestScore: number;
  totalQuestions: number;
  bestPercentage: number;
  latestScore: number;
  latestPercentage: number;
  latestTotalQuestions: number;
  averageScore: number;
  attemptCount: number;
  lastAttemptDate: string;
  bestAttempt: TestAttemptRecord;
  latestAttempt: TestAttemptRecord;
  tooltipText: string;
}

function cleanString(str?: string): string {
  return (str || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, "");
}

function formatAttemptDate(dateStr?: string, timestamp?: number): string {
  if (dateStr && dateStr.trim()) return dateStr.trim();
  if (timestamp) {
    try {
      const d = new Date(timestamp);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        });
      }
    } catch {}
  }
  return "Recently";
}

/**
 * Calculates student practice test statistics for a given topic.
 * Extracts best score, latest attempt, attempt count, and last attempt date.
 */
export function getTopicTestStats(
  allAttempts: TestAttemptRecord[],
  studentIdentifier: string | undefined,
  studentName: string | undefined,
  classGrade: string,
  subject: string,
  chapterNo: number,
  topicLabel: string
): TopicTestStats | null {
  if (!Array.isArray(allAttempts) || allAttempts.length === 0) return null;

  const normStudentId = cleanString(studentIdentifier);
  const normStudentName = cleanString(studentName);
  const normClass = cleanString(classGrade);
  const normSubj = (subject || "").toLowerCase().trim();
  const normTopic = cleanString(topicLabel);

  const topicAttempts = allAttempts.filter((a) => {
    if (!a) return false;
    
    // 1. Verify student identity match
    const aStudentId = cleanString(a.studentId);
    const aStudentName = cleanString(a.studentName);
    const matchesStudent =
      (!normStudentId && !normStudentName) ||
      (normStudentId && (aStudentId === normStudentId || aStudentName === normStudentId)) ||
      (normStudentName && (aStudentName === normStudentName || aStudentId === normStudentName));

    if (!matchesStudent) return false;
    if (a.testType && a.testType !== "topic") return false;

    // 2. Class match (lenient check for UPSC or grade number)
    const aClass = cleanString(a.classGrade);
    if (normClass && aClass && normClass !== aClass && !normClass.includes(aClass) && !aClass.includes(normClass)) {
      return false;
    }

    // 3. Subject compatibility
    if (subject && a.subject && !isSubjectCompatible(subject, a.subject)) {
      return false;
    }

    // 4. Chapter number match
    if (chapterNo && a.chapterNo && Number(a.chapterNo) !== Number(chapterNo)) {
      return false;
    }

    // 5. Topic name match
    const aTopic = cleanString(a.topicName);
    if (normTopic && aTopic) {
      if (aTopic === normTopic || aTopic.includes(normTopic) || normTopic.includes(aTopic)) {
        return true;
      }
      return false;
    }

    return true;
  });

  if (topicAttempts.length === 0) return null;

  // Sort chronologically by timestamp ascending (earliest to latest)
  const sortedAttempts = [...topicAttempts].sort((a, b) => {
    const tA = a.timestamp || (a.date ? new Date(a.date).getTime() : 0);
    const tB = b.timestamp || (b.date ? new Date(b.date).getTime() : 0);
    return tA - tB;
  });

  const attemptCount = sortedAttempts.length;
  const latestAttempt = sortedAttempts[sortedAttempts.length - 1];

  let bestAttempt = sortedAttempts[0];
  let bestRatio = (bestAttempt.totalQuestions || bestAttempt.totalMarks || 1) > 0 
    ? bestAttempt.score / (bestAttempt.totalQuestions || bestAttempt.totalMarks || 1) 
    : 0;

  for (let i = 1; i < sortedAttempts.length; i++) {
    const curr = sortedAttempts[i];
    const totalQ = curr.totalQuestions || curr.totalMarks || 1;
    const currRatio = totalQ > 0 ? curr.score / totalQ : 0;
    if (currRatio > bestRatio || (currRatio === bestRatio && curr.score > bestAttempt.score)) {
      bestAttempt = curr;
      bestRatio = currRatio;
    }
  }

  const bestScore = bestAttempt.score;
  const totalQuestions = bestAttempt.totalQuestions || bestAttempt.totalMarks || 1;
  const bestPercentage = Math.round(bestRatio * 100);

  const latestTotalQuestions = latestAttempt.totalQuestions || latestAttempt.totalMarks || 1;
  const latestScore = latestAttempt.score;
  const latestPercentage = latestTotalQuestions > 0 ? Math.round((latestScore / latestTotalQuestions) * 100) : 0;

  const sumScores = sortedAttempts.reduce((acc, a) => acc + a.score, 0);
  const averageScore = Number((sumScores / attemptCount).toFixed(1));
  const lastAttemptDate = formatAttemptDate(latestAttempt.date, latestAttempt.timestamp);

  const tooltipText = [
    `Latest Attempt: ${latestScore}/${latestTotalQuestions}`,
    `Highest Score: ${bestScore}/${totalQuestions}`,
    `Number of Attempts: ${attemptCount}`,
    `Last Attempt Date: ${lastAttemptDate}`
  ].join("\n");

  return {
    bestScore,
    totalQuestions,
    bestPercentage,
    latestScore,
    latestPercentage,
    latestTotalQuestions,
    averageScore,
    attemptCount,
    lastAttemptDate,
    bestAttempt,
    latestAttempt,
    tooltipText
  };
}
