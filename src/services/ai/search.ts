import { getAIProvider } from "./provider";
import { costTracker } from "./costTracker";
import { usageLimitManager } from "./usageLimits";

export interface SearchItem {
  id: string;
  type: "note" | "test" | "homework" | "chapter";
  title: string;
  subject: string;
  chapterNo?: number;
  chapterName?: string;
  topicName?: string;
  classGrade?: string;
  summaryOrKeywords?: string;
  urlOrKey?: string;
}

export interface SemanticSearchParams {
  query: string;
  items: SearchItem[];
  classFilter?: string;
  subjectFilter?: string;
  userId?: string;
  userRole?: string;
}

export interface SearchResultItem extends SearchItem {
  relevanceScore: number; // 0 to 100
  matchReason: string;
}

export async function handleSemanticSearch(
  params: SemanticSearchParams
): Promise<{ query: string; results: SearchResultItem[] }> {
  const userId = params.userId || "user-search";
  const userRole = params.userRole || "student";

  const quota = usageLimitManager.checkAndIncrementQuota(userId, userRole);
  if (!quota.allowed) {
    throw new Error(quota.reason || "Search quota exceeded.");
  }

  // Fast pre-filter
  let candidateItems = params.items;
  if (params.classFilter && params.classFilter !== "All") {
    candidateItems = candidateItems.filter((i) => !i.classGrade || i.classGrade === params.classFilter);
  }
  if (params.subjectFilter && params.subjectFilter !== "All") {
    candidateItems = candidateItems.filter((i) => !i.subject || i.subject.toLowerCase() === params.subjectFilter!.toLowerCase());
  }

  if (candidateItems.length === 0) {
    return { query: params.query, results: [] };
  }

  // Limit candidates to top 40 for optimal latency
  const truncatedList = candidateItems.slice(0, 40).map((item) => ({
    id: item.id,
    type: item.type,
    title: item.title,
    subject: item.subject,
    chapter: item.chapterName || `Chapter ${item.chapterNo || ""}`,
    topic: item.topicName || "",
    keywords: item.summaryOrKeywords || "",
  }));

  const prompt = `Given user search query: "${params.query}"
Rank the following study materials by semantic relevance to the query.

Study Materials List:
\`\`\`json
${JSON.stringify(truncatedList, null, 2)}
\`\`\`

Return a JSON array of matched items with relevance scores (1-100) and brief match reasons:
{
  "matches": [
    {
      "id": "id-from-list",
      "relevanceScore": 95,
      "matchReason": "Direct match for Indian Constitution Fundamental Rights concepts."
    }
  ]
}`;

  const provider = getAIProvider();
  const startTime = Date.now();

  try {
    const result = await provider.generateStructured<{ matches: Array<{ id: string; relevanceScore: number; matchReason: string }> }>({
      prompt,
      systemInstruction: "You are an intelligent academic search engine and indexer. Rank materials by semantic relevance accurately.",
      temperature: 0.1,
    });

    const matchesMap = new Map<string, { relevanceScore: number; matchReason: string }>();
    (result.data.matches || []).forEach((m) => {
      matchesMap.set(m.id, {
        relevanceScore: m.relevanceScore || 50,
        matchReason: m.matchReason || "Semantically relevant topic match.",
      });
    });

    // Merge and sort
    const rankedResults: SearchResultItem[] = [];
    candidateItems.forEach((item) => {
      const match = matchesMap.get(item.id);
      if (match && match.relevanceScore >= 30) {
        rankedResults.push({
          ...item,
          relevanceScore: match.relevanceScore,
          matchReason: match.matchReason,
        });
      }
    });

    rankedResults.sort((a, b) => b.relevanceScore - a.relevanceScore);

    costTracker.trackUsage({
      endpoint: "/api/ai/search",
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
      query: params.query,
      results: rankedResults,
    };
  } catch (err: any) {
    costTracker.trackUsage({
      endpoint: "/api/ai/search",
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
