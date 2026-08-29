export interface UserQuotaConfig {
  dailyLimit: number;
  monthlyLimit: number;
}

const DEFAULT_ROLE_QUOTAS: Record<string, UserQuotaConfig> = {
  student: {
    dailyLimit: 60,
    monthlyLimit: 1200,
  },
  teacher: {
    dailyLimit: 300,
    monthlyLimit: 6000,
  },
  admin: {
    dailyLimit: 2000,
    monthlyLimit: 40000,
  },
};

interface UserUsageBucket {
  dailyCount: number;
  dailyResetDate: string; // YYYY-MM-DD
  monthlyCount: number;
  monthlyResetMonth: string; // YYYY-MM
}

class UsageLimitManager {
  private userBuckets: Map<string, UserUsageBucket> = new Map();

  private getTodayKey(): string {
    return new Date().toISOString().split("T")[0];
  }

  private getMonthKey(): string {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  }

  public checkAndIncrementQuota(userId: string, role: string = "student"): { allowed: boolean; remainingDaily: number; reason?: string } {
    const roleKey = (role || "student").toLowerCase();
    const config = DEFAULT_ROLE_QUOTAS[roleKey] || DEFAULT_ROLE_QUOTAS.student;

    const today = this.getTodayKey();
    const currentMonth = this.getMonthKey();

    let bucket = this.userBuckets.get(userId);
    if (!bucket) {
      bucket = {
        dailyCount: 0,
        dailyResetDate: today,
        monthlyCount: 0,
        monthlyResetMonth: currentMonth,
      };
      this.userBuckets.set(userId, bucket);
    }

    // Reset daily if day changed
    if (bucket.dailyResetDate !== today) {
      bucket.dailyCount = 0;
      bucket.dailyResetDate = today;
    }

    // Reset monthly if month changed
    if (bucket.monthlyResetMonth !== currentMonth) {
      bucket.monthlyCount = 0;
      bucket.monthlyResetMonth = currentMonth;
    }

    if (bucket.dailyCount >= config.dailyLimit) {
      return {
        allowed: false,
        remainingDaily: 0,
        reason: `Daily AI quota of ${config.dailyLimit} requests reached for ${role}. Please try again tomorrow.`,
      };
    }

    if (bucket.monthlyCount >= config.monthlyLimit) {
      return {
        allowed: false,
        remainingDaily: 0,
        reason: `Monthly AI quota of ${config.monthlyLimit} requests reached for ${role}.`,
      };
    }

    // Increment
    bucket.dailyCount += 1;
    bucket.monthlyCount += 1;

    return {
      allowed: true,
      remainingDaily: config.dailyLimit - bucket.dailyCount,
    };
  }

  public getUserQuotaStatus(userId: string, role: string = "student") {
    const roleKey = (role || "student").toLowerCase();
    const config = DEFAULT_ROLE_QUOTAS[roleKey] || DEFAULT_ROLE_QUOTAS.student;
    const bucket = this.userBuckets.get(userId);

    const dailyUsed = bucket ? bucket.dailyCount : 0;
    const monthlyUsed = bucket ? bucket.monthlyCount : 0;

    return {
      userId,
      role: roleKey,
      dailyLimit: config.dailyLimit,
      dailyUsed,
      dailyRemaining: Math.max(0, config.dailyLimit - dailyUsed),
      monthlyLimit: config.monthlyLimit,
      monthlyUsed,
      monthlyRemaining: Math.max(0, config.monthlyLimit - monthlyUsed),
    };
  }
}

export const usageLimitManager = new UsageLimitManager();
