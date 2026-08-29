import { getAIProvider } from "./provider";
import { NOTE_PROCESSING_SYSTEM_INSTRUCTION, buildNoteProcessingPrompt } from "./prompts";
import { costTracker } from "./costTracker";
import { usageLimitManager } from "./usageLimits";

export interface NoteAnalysisParams {
  textSnippet: string;
  originalFileName?: string;
  suggestedSubject?: string;
  suggestedGrade?: string;
  userId?: string;
}

export interface NoteAnalysisResult {
  title: string;
  subject: string;
  chapterNo: number;
  chapterName: string;
  topicName: string;
  summary: string;
  keywords: string[];
  estimatedReadingTimeMinutes: number;
  difficultyLevel: "Easy" | "Medium" | "Hard" | "Advanced";
  learningObjectives?: string[];
  keyConcepts?: Array<{ term: string; definition: string }>;
}

export async function handleNoteAnalysis(params: NoteAnalysisParams): Promise<NoteAnalysisResult> {
  const userId = params.userId || "admin-notes";
  const quota = usageLimitManager.checkAndIncrementQuota(userId, "admin");
  if (!quota.allowed) {
    throw new Error(quota.reason || "Note analysis quota exceeded.");
  }

  const prompt = buildNoteProcessingPrompt({
    textSnippet: params.textSnippet,
    originalFileName: params.originalFileName,
    suggestedSubject: params.suggestedSubject,
    suggestedGrade: params.suggestedGrade,
  });

  const provider = getAIProvider();
  const startTime = Date.now();

  try {
    const result = await provider.generateStructured<NoteAnalysisResult>({
      prompt,
      systemInstruction: NOTE_PROCESSING_SYSTEM_INSTRUCTION,
      temperature: 0.2,
    });

    costTracker.trackUsage({
      endpoint: "/api/ai/notes/analyze",
      provider: provider.name,
      model: result.model,
      promptTokens: result.tokenUsage?.promptTokens,
      completionTokens: result.tokenUsage?.completionTokens,
      latencyMs: result.latencyMs,
      userId,
      userRole: "admin",
      success: true,
    });

    return result.data;
  } catch (err: any) {
    costTracker.trackUsage({
      endpoint: "/api/ai/notes/analyze",
      provider: provider.name,
      latencyMs: Date.now() - startTime,
      userId,
      userRole: "admin",
      success: false,
      errorMessage: err.message,
    });
    throw err;
  }
}
