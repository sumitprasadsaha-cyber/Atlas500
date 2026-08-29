import { getAIProvider, ModerationResult } from "./provider";

export interface ModerationLog {
  id: string;
  timestamp: string;
  userId?: string;
  textSnippet: string;
  flagged: boolean;
  reason?: string;
}

class ModerationService {
  private logs: ModerationLog[] = [];

  public async checkContent(text: string, userId?: string): Promise<ModerationResult> {
    if (!text || text.trim().length === 0) {
      return {
        flagged: false,
        categories: {
          hate: false,
          harassment: false,
          sexual: false,
          violence: false,
          promptInjection: false,
          spam: false,
        },
      };
    }

    const provider = getAIProvider();
    const result = await provider.moderateContent(text);

    if (result.flagged) {
      this.logs.unshift({
        id: `mod-${Date.now()}`,
        timestamp: new Date().toISOString(),
        userId,
        textSnippet: text.slice(0, 100),
        flagged: true,
        reason: result.reason,
      });
      if (this.logs.length > 100) this.logs = this.logs.slice(0, 100);
    }

    return result;
  }

  public getModerationLogs(): ModerationLog[] {
    return this.logs;
  }
}

export const moderationService = new ModerationService();
