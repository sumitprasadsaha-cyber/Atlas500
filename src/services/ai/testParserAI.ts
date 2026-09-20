import { getAIProvider } from "./provider";
import { costTracker } from "./costTracker";
import { usageLimitManager } from "./usageLimits";
import {
  parseUniversalTestText,
  UniversalParseContext,
  UniversalParseResult
} from "../../utils/universalTestParser";
import { ParsedAssessmentQuestion } from "../../types";

export interface AIParseTestParams {
  rawText: string;
  context: UniversalParseContext;
  enrichMissingAnswers?: boolean;
  generateRubrics?: boolean;
  userId?: string;
  userRole?: string;
}

const AI_TEST_PARSER_SYSTEM_INSTRUCTION = `
You are an expert curriculum test analyzer and parsing engine for K-12 academic curricula.
Your task is to analyze test questions, verify question types, supply missing answer keys where obvious from the question, and generate concise model answers and evaluation rubrics for subjective questions.
Ensure all outputs are mathematically valid and pedagogically sound.
Never alter the original meaning of questions.
Always respond in strict JSON matching the requested schema.
`;

export async function handleAITestParsing(
  params: AIParseTestParams
): Promise<UniversalParseResult> {
  const userId = params.userId || "admin-tests";
  const userRole = params.userRole || "admin";

  // First run deterministic Universal Parser to extract base structure and questions
  const baseResult = parseUniversalTestText(params.rawText, params.context);

  if (!params.enrichMissingAnswers && !params.generateRubrics) {
    return baseResult;
  }

  // If enrichment is requested, check quota and process subjective/missing answer questions with Gemini
  const quota = usageLimitManager.checkAndIncrementQuota(userId, userRole);
  if (!quota.allowed) {
    // Gracefully fallback to deterministic base result without failing
    baseResult.report.warnings.push("AI enrichment quota exceeded; returned deterministic parse results.");
    return baseResult;
  }

  // Find questions needing answer keys or rubrics
  const questionsNeedingEnrichment = baseResult.questions.filter((q) => {
    const isSubjective = ["very_short_answer", "short_answer", "long_answer"].includes(q.type);
    const missingObjectiveAnswer = !isSubjective && !q.correctAnswer;
    const missingSubjectiveModel = isSubjective && !q.modelAnswer;
    const missingRubrics = isSubjective && params.generateRubrics && (!q.evaluationCriteria || q.evaluationCriteria.length === 0);
    return missingObjectiveAnswer || missingSubjectiveModel || missingRubrics;
  });

  if (questionsNeedingEnrichment.length === 0) {
    return baseResult;
  }

  const provider = getAIProvider();
  const startTime = Date.now();

  try {
    // Process in batches of up to 15 questions
    const batch = questionsNeedingEnrichment.slice(0, 15);
    const enrichmentPayload = batch.map((q) => ({
      id: q.id,
      type: q.type,
      question: q.question,
      options: q.options,
      marks: q.marks || 1,
      commandWord: q.commandWord
    }));

    const prompt = `
Curriculum: Class ${params.context.classGrade} | Subject: ${params.context.subject} | Chapter: ${params.context.chapterName}
Analyze the following questions and provide missing correct answers for objective questions, or concise model answers and 2-4 key rubric points for subjective questions:

${JSON.stringify(enrichmentPayload, null, 2)}

Respond with JSON:
{
  "enriched": [
    {
      "id": "question id",
      "correctAnswer": "A/B/C/D or True/False (if objective)",
      "modelAnswer": "Concise model answer (if subjective)",
      "evaluationCriteria": ["Key point 1", "Key point 2"] (if subjective),
      "explanation": "Brief explanation"
    }
  ]
}
`;

    const aiRes = await provider.generateStructured<{
      enriched: Array<{
        id: string;
        correctAnswer?: string;
        modelAnswer?: string;
        evaluationCriteria?: string[];
        explanation?: string;
      }>;
    }>({
      prompt,
      systemInstruction: AI_TEST_PARSER_SYSTEM_INSTRUCTION,
      temperature: 0.2
    });

    costTracker.trackUsage({
      endpoint: "/api/ai/test-parser/parse",
      provider: provider.name,
      model: aiRes.model,
      promptTokens: aiRes.tokenUsage?.promptTokens,
      completionTokens: aiRes.tokenUsage?.completionTokens,
      latencyMs: Date.now() - startTime,
      userId,
      userRole,
      success: true
    });

    const enrichedMap = new Map<string, any>();
    (aiRes.data?.enriched || []).forEach((e) => {
      if (e.id) enrichedMap.set(e.id, e);
    });

    // Merge enriched answers back into questions
    baseResult.questions = baseResult.questions.map((q) => {
      const enrichment = enrichedMap.get(q.id);
      if (!enrichment) return q;

      const updated: ParsedAssessmentQuestion = { ...q };
      if (!updated.correctAnswer && enrichment.correctAnswer) {
        updated.correctAnswer = enrichment.correctAnswer;
      }
      if (!updated.modelAnswer && enrichment.modelAnswer) {
        updated.modelAnswer = enrichment.modelAnswer;
      }
      if ((!updated.evaluationCriteria || updated.evaluationCriteria.length === 0) && enrichment.evaluationCriteria) {
        updated.evaluationCriteria = enrichment.evaluationCriteria;
      }
      if (!updated.explanation && enrichment.explanation) {
        updated.explanation = enrichment.explanation;
      }
      return updated;
    });

    return baseResult;
  } catch (err: any) {
    console.warn("[AITestParser] Enrichment error, falling back to base results:", err);
    baseResult.report.warnings.push("AI enrichment warning: " + (err.message || String(err)));
    return baseResult;
  }
}
