import { getAIProvider } from "./provider";
import { 
  STUDENT_CHAT_SYSTEM_INSTRUCTION, 
  buildStudentChatPrompt,
  ADMIN_ASSISTANT_SYSTEM_INSTRUCTION,
  buildAdminAssistantPrompt
} from "./prompts";
import { costTracker } from "./costTracker";
import { moderationService } from "./moderation";
import { usageLimitManager } from "./usageLimits";

export interface ChatMessage {
  role: "user" | "model" | "assistant";
  text: string;
}

export interface StudentChatParams {
  query: string;
  studentId?: string;
  studentName?: string;
  classGrade?: string;
  enrolledSubjects?: string[];
  notesContext?: string;
  recentTestTopic?: string;
  history?: ChatMessage[];
}

export interface AdminChatParams {
  query: string;
  action?: "announcement" | "parent_notice" | "revision_plan" | "general_advice" | "custom";
  dataContext?: any;
  history?: ChatMessage[];
}

export async function handleStudentChat(params: StudentChatParams) {
  const userId = params.studentId || "student-anonymous";
  const quota = usageLimitManager.checkAndIncrementQuota(userId, "student");
  if (!quota.allowed) {
    throw new Error(quota.reason || "Quota exceeded.");
  }

  // Moderation check
  const mod = await moderationService.checkContent(params.query, userId);
  if (mod.flagged) {
    throw new Error(mod.reason || "Message violated content safety policy.");
  }

  const prompt = buildStudentChatPrompt({
    studentName: params.studentName,
    classGrade: params.classGrade,
    enrolledSubjects: params.enrolledSubjects,
    query: params.query,
    notesContext: params.notesContext,
    recentTestTopic: params.recentTestTopic,
    history: params.history?.map(h => ({ role: h.role === "assistant" ? "model" : h.role, text: h.text })),
  });

  const provider = getAIProvider();
  const startTime = Date.now();
  try {
    const result = await provider.generateText({
      prompt,
      systemInstruction: STUDENT_CHAT_SYSTEM_INSTRUCTION,
      temperature: 0.3,
    });

    costTracker.trackUsage({
      endpoint: "/api/ai/chat/student",
      provider: provider.name,
      model: result.model,
      promptTokens: result.tokenUsage?.promptTokens,
      completionTokens: result.tokenUsage?.completionTokens,
      latencyMs: result.latencyMs,
      userId,
      userRole: "student",
      success: true,
    });

    return {
      reply: result.text,
      model: result.model,
      remainingDailyQuota: quota.remainingDaily,
    };
  } catch (err: any) {
    costTracker.trackUsage({
      endpoint: "/api/ai/chat/student",
      provider: provider.name,
      latencyMs: Date.now() - startTime,
      userId,
      userRole: "student",
      success: false,
      errorMessage: err.message,
    });
    throw err;
  }
}

export async function handleAdminChat(params: AdminChatParams) {
  const userId = "admin-session";
  const quota = usageLimitManager.checkAndIncrementQuota(userId, "admin");
  if (!quota.allowed) {
    throw new Error(quota.reason || "Quota exceeded.");
  }

  const mod = await moderationService.checkContent(params.query, userId);
  if (mod.flagged) {
    throw new Error(mod.reason || "Content flagged by moderation filter.");
  }

  let prompt = "";
  if (params.action && params.action !== "custom") {
    prompt = buildAdminAssistantPrompt({
      action: params.action,
      userPrompt: params.query,
      contextData: params.dataContext,
    });
  } else {
    prompt = `Context Data:\n\`\`\`json\n${JSON.stringify(params.dataContext || {}, null, 2)}\n\`\`\`\n\n`;
    if (params.history && params.history.length > 0) {
      prompt += `Conversation History:\n`;
      params.history.forEach((item) => {
        prompt += `${item.role === "user" ? "Admin" : "AI Assistant"}: ${item.text}\n`;
      });
      prompt += `\n`;
    }
    prompt += `Admin Question / Request: ${params.query}\n\n`;
    prompt += `Provide a comprehensive, accurate, and actionable answer in clean Markdown.`;
  }

  const provider = getAIProvider();
  const startTime = Date.now();
  try {
    const result = await provider.generateText({
      prompt,
      systemInstruction: ADMIN_ASSISTANT_SYSTEM_INSTRUCTION,
      temperature: 0.3,
    });

    costTracker.trackUsage({
      endpoint: "/api/ai/chat/admin",
      provider: provider.name,
      model: result.model,
      promptTokens: result.tokenUsage?.promptTokens,
      completionTokens: result.tokenUsage?.completionTokens,
      latencyMs: result.latencyMs,
      userId,
      userRole: "admin",
      success: true,
    });

    return {
      reply: result.text,
      model: result.model,
      remainingDailyQuota: quota.remainingDaily,
    };
  } catch (err: any) {
    costTracker.trackUsage({
      endpoint: "/api/ai/chat/admin",
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
