import {
  ParsedAssessmentQuestion,
  StudentTestAttempt,
  StudentTestAnswer,
  SubjectiveEvaluationResult,
  TopicPracticeTest
} from "../types";

export interface EvaluationRequest {
  test: TopicPracticeTest;
  studentId: string;
  studentName: string;
  answers: Record<string, string | string[]>; // questionId -> answer
  timeSpentSeconds: number;
}

export interface EvaluationResult {
  attempt: StudentTestAttempt;
  subjectiveEvaluations: Record<string, SubjectiveEvaluationResult>;
}

/**
 * Normalizes an answer string for robust comparison
 */
function normalizeAnswer(str: string): string {
  return (str || "")
    .trim()
    .toLowerCase()
    .replace(/^option\s+/i, "")
    .replace(/^([a-e])[\.\)]\s*/i, "$1")
    .trim();
}

/**
 * Evaluates objective answers deterministically
 */
export function evaluateObjectiveAnswer(
  q: ParsedAssessmentQuestion,
  rawStudentAnswer: string | string[] | undefined
): { isCorrect: boolean; marksAwarded: number; feedback: string } {
  const maxMarks = q.marks || 1;

  if (rawStudentAnswer === undefined || rawStudentAnswer === null || rawStudentAnswer === "") {
    return { isCorrect: false, marksAwarded: 0, feedback: "Unattempted" };
  }

  // True / False
  if (q.type === "true_false") {
    const studentStr = String(rawStudentAnswer).trim().toLowerCase();
    const correctStr = String(q.correctAnswer || "").trim().toLowerCase();
    const isCorrect = studentStr === correctStr || (studentStr.startsWith("t") && correctStr.startsWith("t")) || (studentStr.startsWith("f") && correctStr.startsWith("f"));
    return {
      isCorrect,
      marksAwarded: isCorrect ? maxMarks : 0,
      feedback: isCorrect ? "Correct answer." : `Incorrect. The correct answer is: ${q.correctAnswer || "False"}.`
    };
  }

  // Multiple Select
  if (q.type === "multiple_select") {
    const selectedArr: string[] = Array.isArray(rawStudentAnswer)
      ? rawStudentAnswer.map((s) => normalizeAnswer(s))
      : [normalizeAnswer(String(rawStudentAnswer))];

    const correctArr: string[] = (q.correctAnswers || (q.correctAnswer ? q.correctAnswer.split(/[,;\s]+/) : []))
      .map((s) => normalizeAnswer(s))
      .filter(Boolean);

    const hasAllCorrect = correctArr.every((c) => selectedArr.includes(c));
    const hasNoExtra = selectedArr.every((s) => correctArr.includes(s));
    const isCorrect = hasAllCorrect && hasNoExtra;

    return {
      isCorrect,
      marksAwarded: isCorrect ? maxMarks : 0,
      feedback: isCorrect ? "All correct options identified." : `Expected options: ${correctArr.join(", ").toUpperCase()}.`
    };
  }

  // MCQ & Assertion-Reason
  const studentChoice = normalizeAnswer(String(rawStudentAnswer));
  const correctChoice = normalizeAnswer(String(q.correctAnswer || ""));

  const isCorrect = Boolean(studentChoice && correctChoice && (studentChoice === correctChoice || studentChoice[0] === correctChoice[0]));

  return {
    isCorrect,
    marksAwarded: isCorrect ? maxMarks : 0,
    feedback: isCorrect ? "Correct answer." : `Incorrect. Correct choice was (${(q.correctAnswer || "").toUpperCase()}).`
  };
}

/**
 * Complete evaluation pipeline for student test submission
 */
export async function evaluateStudentTest(
  req: EvaluationRequest
): Promise<EvaluationResult> {
  const { test, studentId, studentName, answers, timeSpentSeconds } = req;
  const subjectiveItemsToEvaluate: any[] = [];
  const processedAnswers: StudentTestAnswer[] = [];
  let totalScore = 0;
  let totalMaxMarks = 0;

  // 1. Process each question
  for (const q of test.questions) {
    const maxMarks = q.marks || 1;
    totalMaxMarks += maxMarks;
    const rawAnswer = answers[q.id];

    const isSubjective = ["very_short_answer", "short_answer", "long_answer"].includes(q.type);

    if (isSubjective) {
      const studentText = typeof rawAnswer === "string" ? rawAnswer : Array.isArray(rawAnswer) ? rawAnswer.join("\n") : "";
      subjectiveItemsToEvaluate.push({
        questionId: q.id,
        question: q.question,
        questionType: q.type,
        maximumMarks: maxMarks,
        commandWord: q.commandWord,
        modelAnswer: q.modelAnswer,
        evaluationCriteria: q.evaluationCriteria,
        studentAnswer: studentText,
        curriculumContext: {
          classGrade: test.classGrade,
          subject: test.subject,
          chapterName: test.chapterName
        }
      });

      // Default placeholder until API evaluation returns
      processedAnswers.push({
        questionId: q.id,
        questionNumber: q.questionNumber,
        type: q.type,
        studentAnswer: studentText,
        marksAwarded: 0,
        maximumMarks: maxMarks,
        feedback: "Evaluating subjective response...",
        isCorrect: false
      });
    } else {
      // Objective evaluation
      const evalObj = evaluateObjectiveAnswer(q, rawAnswer);
      totalScore += evalObj.marksAwarded;

      processedAnswers.push({
        questionId: q.id,
        questionNumber: q.questionNumber,
        type: q.type,
        studentAnswer: rawAnswer ?? "",
        marksAwarded: evalObj.marksAwarded,
        maximumMarks: maxMarks,
        feedback: evalObj.feedback,
        isCorrect: evalObj.isCorrect
      });
    }
  }

  // 2. Evaluate subjective questions via backend AI if any exist
  const subjectiveEvaluations: Record<string, SubjectiveEvaluationResult> = {};

  if (subjectiveItemsToEvaluate.length > 0) {
    try {
      const res = await fetch("/api/ai/test-evaluation/evaluate-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testId: test.id,
          studentId,
          items: subjectiveItemsToEvaluate
        })
      });

      if (res.ok) {
        const data = await res.json();
        const evals: Record<string, SubjectiveEvaluationResult> = data.evaluations || {};

        for (let i = 0; i < processedAnswers.length; i++) {
          const a = processedAnswers[i];
          const evalResult = evals[a.questionId];
          if (evalResult) {
            subjectiveEvaluations[a.questionId] = evalResult;
            a.marksAwarded = evalResult.marksAwarded;
            a.feedback = evalResult.feedback;
            a.isCorrect = evalResult.marksAwarded === a.maximumMarks;
            totalScore += evalResult.marksAwarded;
          }
        }
      } else {
        console.warn("Subjective batch evaluation failed with status:", res.status);
      }
    } catch (err) {
      console.error("Error calling subjective evaluation endpoint:", err);
    }
  }

  const percentage = totalMaxMarks > 0 ? Math.round((totalScore / totalMaxMarks) * 100) : 0;
  const isPassed = percentage >= (test.passingPercentage || 40);

  const attempt: StudentTestAttempt = {
    id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    testId: test.id,
    studentId,
    studentName,
    startedAt: new Date(Date.now() - timeSpentSeconds * 1000).toISOString(),
    completedAt: new Date().toISOString(),
    timeSpentSeconds,
    totalQuestions: test.questions.length,
    attemptedQuestions: Object.keys(answers).filter((k) => answers[k] !== undefined && answers[k] !== "").length,
    score: totalScore,
    totalMarks: totalMaxMarks,
    percentage,
    isPassed,
    answers: processedAnswers,
    subjectiveEvaluations
  };

  return {
    attempt,
    subjectiveEvaluations
  };
}
