import { getAIProvider } from "./provider";
import { HOMEWORK_SYSTEM_INSTRUCTION, buildHomeworkPrompt } from "./prompts";
import { costTracker } from "./costTracker";
import { usageLimitManager } from "./usageLimits";

export interface GenerateHomeworkParams {
  classGrade: string;
  subject: string;
  chapterName: string;
  topicName?: string;
  difficulty?: "Easy" | "Medium" | "Hard" | "Mixed";
  learningObjectives?: string[];
  estimatedDurationMinutes?: number;
  userId?: string;
  userRole?: string;
}

export interface HomeworkProblem {
  id: string;
  section: string;
  question: string;
  points: number;
  hint: string;
  rubric: string;
  expectedSolution: string;
}

export interface GeneratedHomeworkResponse {
  title: string;
  subject: string;
  chapter: string;
  instructions: string;
  dueDateSuggestionDays: number;
  estimatedMinutes: number;
  problems: HomeworkProblem[];
  formattedMarkdown: string;
}

export async function handleHomeworkGeneration(
  params: GenerateHomeworkParams
): Promise<GeneratedHomeworkResponse> {
  const userId = params.userId || "admin-homework";
  const userRole = params.userRole || "teacher";

  const quota = usageLimitManager.checkAndIncrementQuota(userId, userRole);
  if (!quota.allowed) {
    throw new Error(quota.reason || "Homework generation quota exceeded.");
  }

  const prompt = buildHomeworkPrompt({
    classGrade: params.classGrade,
    subject: params.subject,
    chapterName: params.chapterName,
    topicName: params.topicName,
    difficulty: params.difficulty || "Medium",
    learningObjectives: params.learningObjectives,
    estimatedDurationMinutes: params.estimatedDurationMinutes || 30,
  });

  const provider = getAIProvider();
  const startTime = Date.now();

  try {
    const result = await provider.generateStructured<GeneratedHomeworkResponse>({
      prompt,
      systemInstruction: HOMEWORK_SYSTEM_INSTRUCTION,
      temperature: 0.3,
    });

    costTracker.trackUsage({
      endpoint: "/api/ai/homework/generate",
      provider: provider.name,
      model: result.model,
      promptTokens: result.tokenUsage?.promptTokens,
      completionTokens: result.tokenUsage?.completionTokens,
      latencyMs: result.latencyMs,
      userId,
      userRole,
      success: true,
    });

    return result.data;
  } catch (err: any) {
    costTracker.trackUsage({
      endpoint: "/api/ai/homework/generate",
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
