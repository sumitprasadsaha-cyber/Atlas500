import { ParsedAssessmentQuestion, ComprehensionPassage, CaseStudy } from "../types";

export interface ResolvedPassage {
  id: string;
  title: string;
  text: string;
  isCaseStudy: boolean;
  type: "case_based" | "comprehension";
}

/**
 * Robust helper to resolve complete case-study or comprehension passage for a question.
 *
 * Supports:
 * - Direct question properties: `passage`, `caseStudy`, `groupContent`, `rawPassage`
 * - ID lookups (`caseId`, `passageId`, `groupId`, `parentCaseId`, `parentPassageId`)
 *   in `testContext.cases`, `testContext.passages`, and `testContext.groups`
 * - Normalized question variants: "CASE_BASED", "CASE_STUDY", "COMPREHENSION", "case", "case_based", etc.
 * - Legacy parent question format with `children`
 */
export function resolveQuestionPassage(
  question?: Partial<ParsedAssessmentQuestion> & {
    questionType?: string;
    passage?: string;
    caseStudy?: string;
    groupContent?: string;
    groupTitle?: string;
    rawPassage?: string;
    children?: any[];
  } | null,
  testContext?: {
    passages?: Record<string, ComprehensionPassage | { id?: string; title?: string; text?: string }>;
    cases?: Record<string, CaseStudy | { id?: string; title?: string; text?: string }>;
    groups?: Record<string, { id?: string; title?: string; content?: string; text?: string; type?: string }>;
  } | null
): ResolvedPassage | null {
  if (!question) return null;

  // Determine whether this is a case study or a general comprehension passage
  const qType = String(question.type || question.questionType || "").toLowerCase();
  const qSecType = String(question.sectionType || question.section || "").toLowerCase();
  const qGrpType = String(question.groupType || "").toLowerCase();
  const qSecTitle = String(question.sectionTitle || "").toLowerCase();
  const qGrpTitle = String(question.groupTitle || "").toLowerCase();

  const isCaseStudy = Boolean(
    question.caseId ||
    question.parentCaseId ||
    (typeof question.caseStudy === "string" && question.caseStudy.trim() !== "") ||
    qType.includes("case") ||
    qSecType.includes("case") ||
    qGrpType.includes("case") ||
    qSecTitle.includes("case") ||
    qGrpTitle.includes("case")
  );

  const isComprehension = Boolean(
    question.passageId ||
    question.parentPassageId ||
    (typeof question.passage === "string" && question.passage.trim() !== "") ||
    qType.includes("comprehension") ||
    qSecType.includes("comprehension") ||
    qGrpType.includes("comprehension") ||
    qSecTitle.includes("comprehension") ||
    qGrpTitle.includes("comprehension")
  );

  const targetId =
    question.caseId ||
    question.parentCaseId ||
    question.passageId ||
    question.parentPassageId ||
    question.groupId;

  // 1. Direct text on question
  const directText = (
    (typeof question.passage === "string" ? question.passage : "") ||
    (typeof question.caseStudy === "string" ? question.caseStudy : "") ||
    (typeof question.groupContent === "string" ? question.groupContent : "") ||
    (typeof question.rawPassage === "string" ? question.rawPassage : "")
  ).trim();

  // Strict boundary: Questions without direct passage text, target IDs, or explicit case/comprehension
  // metadata MUST NEVER be associated with any passage or labelled as a sub-question.
  const isEligibleForPassage = Boolean(
    directText ||
    targetId ||
    isCaseStudy ||
    isComprehension ||
    question.isSubQuestion === true
  );

  if (!isEligibleForPassage) {
    return null;
  }

  const defaultTitle = isCaseStudy ? "Case Study" : "Comprehension Passage";

  let lookupText = "";
  let lookupTitle = "";

  if (targetId && testContext) {
    // Check in cases
    const fromCases = testContext.cases?.[targetId];
    if (fromCases && fromCases.text) {
      lookupText = fromCases.text.trim();
      lookupTitle = (fromCases.title || "").trim();
    }

    // Check in passages
    if (!lookupText && testContext.passages) {
      const fromPassages = testContext.passages[targetId];
      if (fromPassages && fromPassages.text) {
        lookupText = fromPassages.text.trim();
        lookupTitle = (fromPassages.title || "").trim();
      }
    }

    // Check in groups
    if (!lookupText && testContext.groups) {
      const fromGroups = testContext.groups[targetId];
      if (fromGroups) {
        lookupText = (fromGroups.content || fromGroups.text || "").trim();
        lookupTitle = (fromGroups.title || "").trim();
      }
    }

    // Fallback: cross lookup if ID was prefixed or flipped
    if (!lookupText && testContext.passages) {
      for (const [k, p] of Object.entries(testContext.passages)) {
        if (p?.text && (k.toLowerCase() === targetId.toLowerCase() || targetId.toLowerCase().includes(k.toLowerCase()))) {
          lookupText = p.text.trim();
          lookupTitle = (p.title || "").trim();
          break;
        }
      }
    }
    if (!lookupText && testContext.cases) {
      for (const [k, c] of Object.entries(testContext.cases)) {
        if (c?.text && (k.toLowerCase() === targetId.toLowerCase() || targetId.toLowerCase().includes(k.toLowerCase()))) {
          lookupText = c.text.trim();
          lookupTitle = (c.title || "").trim();
          break;
        }
      }
    }
  }

  // 3. Fallback: ONLY if the question is explicitly a case or comprehension sub-question without an ID
  if (!directText && !lookupText && testContext) {
    if (isCaseStudy && testContext.cases) {
      const caseKeys = Object.keys(testContext.cases);
      if (caseKeys.length === 1) {
        const singleCase = testContext.cases[caseKeys[0]];
        if (singleCase?.text) {
          lookupText = singleCase.text.trim();
          lookupTitle = (singleCase.title || "").trim();
        }
      }
    } else if (isComprehension && testContext.passages) {
      const passageKeys = Object.keys(testContext.passages);
      if (passageKeys.length === 1) {
        const singlePassage = testContext.passages[passageKeys[0]];
        if (singlePassage?.text) {
          lookupText = singlePassage.text.trim();
          lookupTitle = (singlePassage.title || "").trim();
        }
      }
    }
  }

  const finalText = (directText || lookupText).trim();
  if (!finalText) return null;

  const rawTitle = lookupTitle || question.groupTitle || question.sectionTitle || "";
  const finalTitle = rawTitle && !/^(?:section|part)\s+[a-z0-9]+$/i.test(rawTitle)
    ? rawTitle
    : defaultTitle;

  return {
    id: targetId || (isCaseStudy ? "case_study" : "comprehension_passage"),
    title: finalTitle,
    text: finalText,
    isCaseStudy,
    type: isCaseStudy ? "case_based" : "comprehension"
  };
}

/**
 * Normalizes question type safely across legacy formats:
 * "CASE_BASED", "CASE_STUDY", "COMPREHENSION", "case", "case_based", etc.
 */
export function normalizeAssessmentQuestionType(
  rawType?: string
): "case_based" | "comprehension" | string {
  const norm = String(rawType || "").toLowerCase().trim();
  if (norm === "case_based" || norm === "case_study" || norm === "case" || norm === "case-based") {
    return "case_based";
  }
  if (norm === "comprehension" || norm === "reading_comprehension" || norm === "passage") {
    return "comprehension";
  }
  return norm;
}
