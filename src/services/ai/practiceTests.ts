import { getAIProvider } from "./provider";
import { PRACTICE_TEST_SYSTEM_INSTRUCTION, buildPracticeTestPrompt } from "./prompts";
import { costTracker } from "./costTracker";
import { usageLimitManager } from "./usageLimits";
import { ParsedAssessmentQuestion } from "../../types";

export interface GeneratePracticeTestParams {
  classGrade: string;
  subject: string;
  chapterNo?: number;
  chapterName: string;
  topicName?: string;
  questionCount?: number;
  questionType?: "mcq" | "true_false" | "assertion_reason" | "mixed";
  difficulty?: "Easy" | "Medium" | "Hard" | "Mixed";
  language?: string;
  syllabusContext?: string;
  userId?: string;
  userRole?: string;
}

export interface GeneratedPracticeTestResponse {
  testTitle: string;
  totalQuestions: number;
  estimatedTimeMinutes: number;
  questions: ParsedAssessmentQuestion[];
  formattedRawText: string;
}

export async function handlePracticeTestGeneration(
  params: GeneratePracticeTestParams
): Promise<GeneratedPracticeTestResponse> {
  const userId = params.userId || "admin-tests";
  const userRole = params.userRole || "admin";

  const quota = usageLimitManager.checkAndIncrementQuota(userId, userRole);
  if (!quota.allowed) {
    throw new Error(quota.reason || "Practice test generation quota exceeded.");
  }

  const questionCount = params.questionCount || 10;
  const questionType = params.questionType || "mcq";
  const difficulty = params.difficulty || "Medium";

  const prompt = buildPracticeTestPrompt({
    classGrade: params.classGrade,
    subject: params.subject,
    chapterNo: params.chapterNo,
    chapterName: params.chapterName,
    topicName: params.topicName,
    questionCount,
    questionType,
    difficulty,
    language: params.language,
    syllabusContext: params.syllabusContext,
  });

  const provider = getAIProvider();
  const startTime = Date.now();

  try {
    const result = await provider.generateStructured<GeneratedPracticeTestResponse>({
      prompt,
      systemInstruction: PRACTICE_TEST_SYSTEM_INSTRUCTION,
      temperature: 0.25,
    });

    const parsedData = result.data;

    // Normalize generated questions to fit ParsedAssessmentQuestion format cleanly
    const normalizedQuestions: ParsedAssessmentQuestion[] = (parsedData.questions || []).map((q, idx) => ({
      id: q.id || `q-${idx + 1}-${Date.now()}`,
      classGrade: params.classGrade,
      subject: params.subject,
      chapterNo: params.chapterNo || 1,
      chapterName: params.chapterName,
      topicName: params.topicName || "General Topic",
      type: (q.type as any) || (params.questionType === "true_false" ? "true_false" : params.questionType === "assertion_reason" ? "assertion_reason" : "mcq"),
      question: q.question,
      options: q.options || [],
      correctAnswer: q.correctAnswer,
      explanation: q.explanation || "",
      orderIndex: idx,
      published: true,
      createdAt: new Date().toISOString(),
    }));

    costTracker.trackUsage({
      endpoint: "/api/ai/practice-test/generate",
      provider: provider.name,
      model: result.model,
      promptTokens: result.tokenUsage?.promptTokens,
      completionTokens: result.tokenUsage?.completionTokens,
      latencyMs: result.latencyMs,
      userId,
      userRole,
      success: true,
    });

    return {
      testTitle: parsedData.testTitle || `${params.subject} - Chapter ${params.chapterNo || 1}: ${params.chapterName} Practice Test`,
      totalQuestions: normalizedQuestions.length,
      estimatedTimeMinutes: parsedData.estimatedTimeMinutes || Math.max(10, normalizedQuestions.length * 2),
      questions: normalizedQuestions,
      formattedRawText: parsedData.formattedRawText || "",
    };
  } catch (err: any) {
    costTracker.trackUsage({
      endpoint: "/api/ai/practice-test/generate",
      provider: provider.name,
      latencyMs: Date.now() - startTime,
      userId,
      userRole,
      success: false,
      errorMessage: err.message,
    });
    throw err;
  }
}
