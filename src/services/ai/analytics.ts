import { getAIProvider } from "./provider";
import { ANALYTICS_SYSTEM_INSTRUCTION, buildAnalyticsPrompt } from "./prompts";
import { costTracker } from "./costTracker";
import { usageLimitManager } from "./usageLimits";

export interface AnalyticsParams {
  scope: "student" | "class" | "institution";
  dataPayload: any;
  targetId?: string;
  userId?: string;
  userRole?: string;
}

export interface AnalyticsResponse {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  atRiskStatus: {
    level: "Low" | "Medium" | "High" | "Critical";
    riskFactors: string[];
    retentionPrediction: "Stable" | "Needs Attention" | "Immediate Intervention";
  };
  chapterBreakdown: Array<{
    subject: string;
    chapter: string;
    masteryPercentage: number;
    status: "Needs Revision" | "Proficient" | "Mastered";
  }>;
  recommendedActions: Array<{
    priority: "High" | "Medium" | "Low";
    action: string;
    targetArea: string;
  }>;
  formattedMarkdown: string;
}

export async function handleAnalyticsGeneration(
  params: AnalyticsParams
): Promise<AnalyticsResponse> {
  const userId = params.userId || "admin-analytics";
  const userRole = params.userRole || "admin";

  const quota = usageLimitManager.checkAndIncrementQuota(userId, userRole);
  if (!quota.allowed) {
    throw new Error(quota.reason || "Analytics generation quota exceeded.");
  }

  const prompt = buildAnalyticsPrompt({
    scope: params.scope,
    dataPayload: params.dataPayload,
    targetId: params.targetId,
  });

  const provider = getAIProvider();
  const startTime = Date.now();

  try {
    const result = await provider.generateStructured<AnalyticsResponse>({
      prompt,
      systemInstruction: ANALYTICS_SYSTEM_INSTRUCTION,
      temperature: 0.2,
    });

    costTracker.trackUsage({
      endpoint: "/api/ai/analytics/insights",
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
      endpoint: "/api/ai/analytics/insights",
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
