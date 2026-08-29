export interface AIUsageLog {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  endpoint: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  userId?: string;
  userRole?: string;
  success: boolean;
  errorMessage?: string;
}

export interface AIMetricsSummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  averageLatencyMs: number;
  provider: string;
  activeModel: string;
  recentLogs: AIUsageLog[];
}

/**
 * Pricing rates per million tokens (Gemini 3.7 Flash estimate)
 * Input: $0.075 / 1M tokens
 * Output: $0.30 / 1M tokens
 */
const PRICE_PER_MILLION_INPUT = 0.075;
const PRICE_PER_MILLION_OUTPUT = 0.30;

class CostTracker {
  private logs: AIUsageLog[] = [];
  private maxLogsStored = 200;

  public trackUsage(params: {
    endpoint: string;
    model?: string;
    provider?: string;
    promptTokens?: number;
    completionTokens?: number;
    latencyMs?: number;
    userId?: string;
    userRole?: string;
    success?: boolean;
    errorMessage?: string;
  }): AIUsageLog {
    const promptTokens = params.promptTokens || 0;
    const completionTokens = params.completionTokens || 0;
    const totalTokens = promptTokens + completionTokens;

    const estimatedCostUsd =
      (promptTokens / 1_000_000) * PRICE_PER_MILLION_INPUT +
      (completionTokens / 1_000_000) * PRICE_PER_MILLION_OUTPUT;

    const log: AIUsageLog = {
      id: `ai-log-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      timestamp: new Date().toISOString(),
      provider: params.provider || "google-gemini",
      model: params.model || "gemini-3.7-flash",
      endpoint: params.endpoint,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCostUsd,
      latencyMs: params.latencyMs || 0,
      userId: params.userId,
      userRole: params.userRole,
      success: params.success !== false,
      errorMessage: params.errorMessage,
    };

    this.logs.unshift(log);
    if (this.logs.length > this.maxLogsStored) {
      this.logs = this.logs.slice(0, this.maxLogsStored);
    }

    return log;
  }

  public getMetrics(): AIMetricsSummary {
    const totalRequests = this.logs.length;
    const successfulRequests = this.logs.filter((l) => l.success).length;
    const failedRequests = totalRequests - successfulRequests;

    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;
    let totalEstimatedCostUsd = 0;
    let totalLatency = 0;

    for (const log of this.logs) {
      totalPromptTokens += log.promptTokens;
      totalCompletionTokens += log.completionTokens;
      totalTokens += log.totalTokens;
      totalEstimatedCostUsd += log.estimatedCostUsd;
      totalLatency += log.latencyMs;
    }

    const averageLatencyMs = totalRequests > 0 ? Math.round(totalLatency / totalRequests) : 0;

    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      totalEstimatedCostUsd: Number(totalEstimatedCostUsd.toFixed(6)),
      averageLatencyMs,
      provider: "Google Gemini",
      activeModel: "gemini-3.7-flash",
      recentLogs: this.logs.slice(0, 30),
    };
  }

  public resetMetrics() {
    this.logs = [];
  }
}

export const costTracker = new CostTracker();
