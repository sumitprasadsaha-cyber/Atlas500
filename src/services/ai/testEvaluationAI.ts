import { getAIProvider } from "./provider";
import { costTracker } from "./costTracker";
import { usageLimitManager } from "./usageLimits";
import { SubjectiveEvaluationResult } from "../../types";

export interface EvaluateSubjectiveAnswerParams {
  questionId: string;
  question: string;
  questionType: "very_short_answer" | "short_answer" | "long_answer" | "comprehension" | "case_study";
  maximumMarks: number;
  commandWord?: string;
  modelAnswer?: string;
  evaluationCriteria?: string[];
  studentAnswer: string;
  curriculumContext: {
    classGrade: string;
    subject: string;
    chapterName?: string;
  };
  userId?: string;
  userRole?: string;
}

export interface BatchEvaluateSubjectiveParams {
  testId: string;
  studentId: string;
  items: EvaluateSubjectiveAnswerParams[];
  userId?: string;
  userRole?: string;
}

const EVALUATION_SYSTEM_INSTRUCTION = `
You are a senior academic curriculum evaluator and examiner for school assessments.
Your role is to objectively and fairly evaluate student answers against the question, maximum marks, command words (e.g., Define, Explain, Differentiate), model answer, and scoring criteria.

CRITICAL RULES:
1. Marks awarded MUST be a number between 0 and maximumMarks. NEVER award more than maximumMarks.
2. If student answer is completely empty, unintelligible, or completely irrelevant, award 0 marks.
3. Be fair with minor spelling or grammatical errors if the core scientific/mathematical concept is demonstrated.
4. If a command word like "Differentiate" is used, check if the contrast is clearly made.
5. If the student answer is borderline or ambiguous, flag "needsReview": true and set confidence accordingly.
6. Provide encouraging, constructive feedback explaining precisely what was done well and what was missed.
7. Return strictly valid JSON conforming to the requested schema.
`;

export async function evaluateSingleSubjectiveAnswer(
  params: EvaluateSubjectiveAnswerParams
): Promise<SubjectiveEvaluationResult> {
  const userId = params.userId || "student-test";
  const userRole = params.userRole || "student";
  const maxMarks = Math.max(1, params.maximumMarks || 1);

  // If student answer is completely blank
  const trimmedAnswer = (params.studentAnswer || "").trim();
  if (!trimmedAnswer) {
    return {
      questionId: params.questionId,
      marksAwarded: 0,
      maximumMarks: maxMarks,
      feedback: "No answer was provided for this question.",
      correctness: "incorrect",
      completeness: "incomplete",
      relevance: "irrelevant",
      conceptualUnderstanding: "needs_support",
      matchedPoints: [],
      missingPoints: params.evaluationCriteria && params.evaluationCriteria.length > 0 ? params.evaluationCriteria : ["Key points not addressed"],
      confidence: 1.0,
      needsReview: false,
      evaluatedAt: new Date().toISOString()
    };
  }

  const quota = usageLimitManager.checkAndIncrementQuota(userId, userRole);
  if (!quota.allowed) {
    // Return provisional review flag if quota is exceeded
    return {
      questionId: params.questionId,
      marksAwarded: 0,
      maximumMarks: maxMarks,
      feedback: "Evaluation quota temporarily exceeded. Your answer has been saved and queued for teacher review.",
      correctness: "partially_correct",
      completeness: "adequate",
      relevance: "relevant",
      conceptualUnderstanding: "developing",
      matchedPoints: [],
      missingPoints: [],
      confidence: 0.5,
      needsReview: true,
      evaluatedAt: new Date().toISOString()
    };
  }

  const provider = getAIProvider();
  const startTime = Date.now();

  const prompt = `
Question Details:
- Class: ${params.curriculumContext.classGrade} | Subject: ${params.curriculumContext.subject}
- Question: "${params.question}"
- Question Type: ${params.questionType}
- Maximum Marks: ${maxMarks}
- Command Word: ${params.commandWord || "Answer"}
- Model Answer: "${params.modelAnswer || "Demonstrate accurate core concept"}"
- Key Evaluation Criteria / Rubric: ${JSON.stringify(params.evaluationCriteria || [])}

Student's Answer:
"${trimmedAnswer}"

Evaluate the student's answer fairly and output strict JSON:
{
  "marksAwarded": number (0 to ${maxMarks}),
  "correctness": "correct" | "partially_correct" | "incorrect",
  "completeness": "complete" | "adequate" | "incomplete",
  "relevance": "relevant" | "partially_relevant" | "irrelevant",
  "conceptualUnderstanding": "mastered" | "developing" | "needs_support",
  "feedback": "2-3 sentences of clear, constructive feedback",
  "matchedPoints": ["point student covered"],
  "missingPoints": ["point student missed"],
  "confidence": number between 0.0 and 1.0,
  "needsReview": boolean
}
`;

  try {
    const aiRes = await provider.generateStructured<{
      marksAwarded: number;
      correctness: "correct" | "partially_correct" | "incorrect";
      completeness: "complete" | "adequate" | "incomplete";
      relevance: "relevant" | "partially_relevant" | "irrelevant";
      conceptualUnderstanding: "mastered" | "developing" | "needs_support";
      feedback: string;
      matchedPoints: string[];
      missingPoints: string[];
      confidence: number;
      needsReview: boolean;
    }>({
      prompt,
      systemInstruction: EVALUATION_SYSTEM_INSTRUCTION,
      temperature: 0.15
    });

    const data = aiRes.data;

    costTracker.trackUsage({
      endpoint: "/api/ai/test-evaluation/evaluate-subjective",
      provider: provider.name,
      model: aiRes.model,
      promptTokens: aiRes.tokenUsage?.promptTokens,
      completionTokens: aiRes.tokenUsage?.completionTokens,
      latencyMs: Date.now() - startTime,
      userId,
      userRole,
      success: true
    });

    // Ensure strict bounds on marks
    const rawMarks = Number(data.marksAwarded);
    const clampedMarks = Math.max(0, Math.min(maxMarks, isNaN(rawMarks) ? 0 : Math.round(rawMarks * 2) / 2));

    return {
      questionId: params.questionId,
      marksAwarded: clampedMarks,
      maximumMarks: maxMarks,
      feedback: data.feedback || "Evaluated by AI examiner.",
      correctness: data.correctness || (clampedMarks === maxMarks ? "correct" : clampedMarks > 0 ? "partially_correct" : "incorrect"),
      completeness: data.completeness || "adequate",
      relevance: data.relevance || "relevant",
      conceptualUnderstanding: data.conceptualUnderstanding || "developing",
      matchedPoints: data.matchedPoints || [],
      missingPoints: data.missingPoints || [],
      confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0.85)),
      needsReview: Boolean(data.needsReview || (clampedMarks < maxMarks && clampedMarks > 0 && Number(data.confidence) < 0.75)),
      evaluatedAt: new Date().toISOString()
    };
  } catch (err: any) {
    console.error("[TestEvaluationAI] Evaluation error:", err);
    return {
      questionId: params.questionId,
      marksAwarded: 0,
      maximumMarks: maxMarks,
      feedback: "Automated evaluation encountered an unexpected error. Flagged for manual review.",
      correctness: "partially_correct",
      completeness: "adequate",
      relevance: "relevant",
      conceptualUnderstanding: "developing",
      matchedPoints: [],
      missingPoints: [],
      confidence: 0.3,
      needsReview: true,
      evaluatedAt: new Date().toISOString()
    };
  }
}

export async function evaluateBatchSubjectiveAnswers(
  params: BatchEvaluateSubjectiveParams
): Promise<Record<string, SubjectiveEvaluationResult>> {
  const results: Record<string, SubjectiveEvaluationResult> = {};

  // Process questions sequentially to respect rate limits and ensure thorough evaluation
  for (const item of params.items) {
    const res = await evaluateSingleSubjectiveAnswer({
      ...item,
      userId: params.userId,
      userRole: params.userRole
    });
    results[item.questionId] = res;
  }

  return results;
}
