import { getAIProvider } from "./provider";
import { REPORT_SYSTEM_INSTRUCTION, buildReportPrompt } from "./prompts";
import { costTracker } from "./costTracker";
import { usageLimitManager } from "./usageLimits";

export interface GenerateReportParams {
  reportType: string;
  dataPayload: any;
  promptExtra?: string;
  userId?: string;
  userRole?: string;
}

export async function handleReportGeneration(params: GenerateReportParams) {
  const userId = params.userId || "admin-reports";
  const userRole = params.userRole || "admin";

  const quota = usageLimitManager.checkAndIncrementQuota(userId, userRole);
  if (!quota.allowed) {
    throw new Error(quota.reason || "AI report quota exceeded.");
  }

  const prompt = buildReportPrompt({
    reportType: params.reportType,
    dataPayload: params.dataPayload,
    promptExtra: params.promptExtra,
  });

  const provider = getAIProvider();
  const startTime = Date.now();

  try {
    const result = await provider.generateText({
      prompt,
      systemInstruction: REPORT_SYSTEM_INSTRUCTION,
      temperature: 0.35,
    });

    costTracker.trackUsage({
      endpoint: "/api/ai/report",
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
      markdown: result.text,
      model: result.model,
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    costTracker.trackUsage({
      endpoint: "/api/ai/report",
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
