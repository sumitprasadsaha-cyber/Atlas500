import {
  AssessmentQuestionType,
  ParsedAssessmentQuestion,
  ComprehensionPassage,
  CaseStudy
} from "../types";

/**
 * Supported 9 CBSE-style Question Types
 */
export type ChapterTestQuestionType =
  | "mcq"
  | "multiple_select"
  | "assertion_reasoning"
  | "comprehension"
  | "true_false"
  | "very_short_answer"
  | "short_answer"
  | "long_answer"
  | "case_based";

export interface ParsedOption {
  letter: string; // "A", "B", "C", "D"
  text: string;   // Option text without label
  raw: string;    // Full formatted option string, e.g. "A. Plants and animals"
}

export interface ParsedQuestion {
  id: string;
  questionNumber: number | string;
  type: ChapterTestQuestionType;
  sectionId?: string;
  sectionLetter?: string;
  sectionTitle?: string;
  instruction?: string;
  question: string;
  assertionText?: string;
  reasonText?: string;
  options: string[];
  parsedOptions: ParsedOption[];
  correctAnswer: string;
  modelAnswer?: string;
  explanation?: string;
  isSubjective: boolean;
  marks: number;
  negativeMarks?: number;
  marksSource: string;
  marksConfidence: number;
  marksPending: boolean;
  passageId?: string;
  caseId?: string;
  imageUrl?: string;
  imageLabel?: string;
  imagePosition?: "above" | "below";
  rawText?: string;
}

export interface ParsedPassage {
  id: string;
  title: string;
  instruction?: string;
  text: string;
  questionIds: string[];
  isCaseStudy?: boolean;
}

export interface ParsedSection {
  id: string;
  sectionLetter?: string; // "A", "B", "C", or numeric "1", "2"
  heading: string;        // Raw heading: "Section A — Multiple Choice Questions (2 marks each)"
  title: string;          // Clean title: "Multiple Choice Questions"
  type: ChapterTestQuestionType;
  instructions: string[];
  marksPerQuestion?: number;
  negativeMarks?: number;
  questions: ParsedQuestion[];
  passages?: ParsedPassage[];
  totalMarks: number;
}

export interface ParsedTestMetadata {
  title?: string;
  classGrade?: string;
  subject?: string;
  chapterNo?: number;
  chapterName?: string;
  topicName?: string;
  theme?: string;
  timeAllowed?: string;
  declaredTotalMarks?: number;
  generalInstructions?: string[];
}

export interface TestValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  totalCalculatedMarks: number;
  declaredTotalMarks?: number;
  marksMatch: boolean;
  questionCount: number;
  sectionCount: number;
  questionTypeBreakdown: Record<ChapterTestQuestionType, number>;
}

export interface ParsedChapterTest {
  metadata: ParsedTestMetadata;
  sections: ParsedSection[];
  questions: ParsedQuestion[];
  passages: Record<string, ParsedPassage>;
  cases: Record<string, ParsedPassage>;
  validation: TestValidationResult;
  rawText: string;
}

export interface ParseContext {
  classGrade?: string;
  subject?: string;
  chapterNo?: number;
  chapterName?: string;
  topicName?: string;
}

/**
 * Standard readable labels for each question type
 */
export function getQuestionTypeDisplayName(type: ChapterTestQuestionType, isChild = false): string {
  if (isChild && type === "comprehension") return "Comprehension Question";
  if (isChild && type === "case_based") return "Case-Based Question";
  switch (type) {
    case "mcq":
      return "Multiple Choice Question (MCQ)";
    case "multiple_select":
      return "Multiple Select Question";
    case "assertion_reasoning":
      return "Assertion & Reasoning";
    case "true_false":
      return "True / False";
    case "very_short_answer":
      return "Very Short Answer (VSA)";
    case "short_answer":
      return "Short Answer (SA)";
    case "long_answer":
      return "Long Answer (LA)";
    case "case_based":
      return "Case-Based Questions";
    case "comprehension":
      return "Comprehension";
    default:
      return type;
  }
}

/**
 * Extract marks and negative marks from string
 */
export function extractMarks(text: string): {
  marks: number;
  negativeMarks?: number;
  source: string;
  confidence: number;
} | null {
  if (!text) return null;

  let negativeMarks: number | undefined;
  const negMatch =
    text.match(/(?:negative|minus|deduction)\s*(?:marking|marks?)?[\:\s]+-?(\d+(?:\.\d+)?)/i) ||
    text.match(/\[\s*-(?:mark|marks)?\s*(\d+(?:\.\d+)?)\s*\]/i) ||
    text.match(/\(\s*-(\d+(?:\.\d+)?)\s*(?:marks?|pts?)?\s*\)/i);
  if (negMatch) {
    negativeMarks = parseFloat(negMatch[1]);
  }

  // 1. (2 marks each), [3 marks], (1 mark), 2 marks each
  const eachMatch = text.match(
    /(?:\(|\{|\[)?\s*(\d+(?:\.\d+)?)\s*(?:marks?|pts?|points?)\s*(?:each)?\s*(?:\)|\}|\])?/i
  );
  if (eachMatch) {
    const val = parseFloat(eachMatch[1]);
    if (!isNaN(val) && val > 0 && val <= 100) {
      return {
        marks: val,
        negativeMarks,
        source: eachMatch[0].toLowerCase().includes("each") ? "section_instruction" : "question_label",
        confidence: 0.98
      };
    }
  }

  // 2. Marks: 5, Mark: 2, Points: 3
  const labelMatch = text.match(/(?:marks?|pts?|points?|score)[\:\s]+(\d+(?:\.\d+)?)/i);
  if (labelMatch) {
    const val = parseFloat(labelMatch[1]);
    if (!isNaN(val) && val > 0 && val <= 100) {
      return {
        marks: val,
        negativeMarks,
        source: "question_label",
        confidence: 0.99
      };
    }
  }

  // 3. carries 2 marks, carry 1 mark each
  const carryMatch = text.match(/(?:carries|carry|worth)\s+(\d+(?:\.\d+)?)\s*(?:marks?|pts?)/i);
  if (carryMatch) {
    const val = parseFloat(carryMatch[1]);
    if (!isNaN(val) && val > 0 && val <= 100) {
      return {
        marks: val,
        negativeMarks,
        source: "section_instruction",
        confidence: 0.98
      };
    }
  }

  // 4. Standalone bracketed number at end of line like [2]
  const bracketMatch = text.match(/(?:^|\s)\[\s*(\d+(?:\.\d+)?)\s*\](?:\s*$)/);
  if (bracketMatch) {
    const val = parseFloat(bracketMatch[1]);
    if (!isNaN(val) && val > 0 && val <= 50) {
      return {
        marks: val,
        negativeMarks,
        source: "question_label",
        confidence: 0.95
      };
    }
  }

  return null;
}

/**
 * Inferred fallback marks by question type
 */
export function inferDefaultMarks(type: ChapterTestQuestionType): {
  marks: number;
  source: string;
  confidence: number;
  pending: boolean;
} {
  switch (type) {
    case "mcq":
    case "true_false":
    case "assertion_reasoning":
    case "very_short_answer":
      return { marks: 1, source: "default_inferred", confidence: 0.5, pending: true };
    case "multiple_select":
    case "short_answer":
      return { marks: 2, source: "default_inferred", confidence: 0.5, pending: true };
    case "long_answer":
      return { marks: 5, source: "default_inferred", confidence: 0.5, pending: true };
    case "case_based":
    case "comprehension":
      return { marks: 4, source: "default_inferred", confidence: 0.5, pending: true };
    default:
      return { marks: 1, source: "default_inferred", confidence: 0.5, pending: true };
  }
}

/**
 * Matches option lines like "A. ...", "B) ...", "(A) ...", "Option A: ..."
 */
export function matchOptionLine(line: string): { letter: string; text: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Don't treat Assertion (A) or Reason (R) as an option
  if (/^(?:Assertion|Reason)\b/i.test(trimmed)) return null;
  if (/^[\(\[]?(?:A|R)[\)\]]?\s*[:\-]?\s*(?:Assertion|Reason)\b/i.test(trimmed)) return null;
  if (/^Options?\s*[\:\-]?$/i.test(trimmed)) return null;

  const match = trimmed.match(
    /^(?:Option\s+([A-Ea-e1-5])[\.\)\:\-\s]*|[\(\[]([A-Ea-e1-5])[\)][\.\:\s]*|([A-Ea-e1-5])[\.\)\:\-]\s*)(.*)$/i
  );
  if (match) {
    let rawLetter = (match[1] || match[2] || match[3] || "A").toUpperCase();
    if (["1", "2", "3", "4", "5"].includes(rawLetter)) {
      const numMap: Record<string, string> = { "1": "A", "2": "B", "3": "C", "4": "D", "5": "E" };
      rawLetter = numMap[rawLetter] || "A";
    }
    return {
      letter: rawLetter,
      text: (match[4] || "").trim()
    };
  }
  return null;
}

/**
 * Normalizes options into standard format: "A. Option Text"
 */
export function normalizeOptions(options: string[]): {
  normalized: string[];
  parsed: ParsedOption[];
} {
  if (!Array.isArray(options) || options.length === 0) {
    return { normalized: [], parsed: [] };
  }

  const rawList = options.map((opt) => String(opt || "").trim()).filter(Boolean);
  if (rawList.length === 0) return { normalized: [], parsed: [] };

  const merged: string[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    const isIsolatedLabel = /^[A-Ea-e1-5][\.\)]?$/.test(item);

    if (isIsolatedLabel && i + 1 < rawList.length) {
      const nextItem = rawList[i + 1];
      const cleanLabel = item.replace(/[\.\)]/g, "").toUpperCase();
      const cleanNext = nextItem.replace(/^[A-Ea-e1-5][\.\)]\s*/i, "").trim();
      merged.push(`${cleanLabel}. ${cleanNext}`);
      i++;
    } else {
      merged.push(item);
    }
  }

  const letters = ["A", "B", "C", "D", "E"];
  const parsed: ParsedOption[] = [];
  const normalized: string[] = [];

  merged.forEach((opt, idx) => {
    const expectedLetter = letters[idx] || String.fromCharCode(65 + idx);
    const match = opt.match(/^(?:Option\s+([A-Ea-e1-5])|([A-Ea-e1-5]))[\.\)\:\-]?\s*(.*)$/i);
    let letter = expectedLetter;
    let optText = opt;

    if (match) {
      letter = (match[1] || match[2] || expectedLetter).toUpperCase();
      optText = (match[3] || "").trim();
    }

    const cleanFormatted = `${letter}. ${optText}`;
    normalized.push(cleanFormatted);
    parsed.push({
      letter,
      text: optText,
      raw: cleanFormatted
    });
  });

  return { normalized, parsed };
}

/**
 * Identifies CBSE section headers and classifies them into one of the 9 types.
 *
 * Supported formats:
 * - "Section A — Multiple Choice Questions"
 * - "Section B: Multiple Select Questions (2 marks each)"
 * - "Section C — Assertion and Reasoning"
 * - "Section D — Comprehension (2 marks each)"
 * - "Section E — True and False"
 * - "Section F — Very Short Answer Questions"
 * - "Section G — Short Answer Questions"
 * - "Section H — Long Answer Questions"
 * - "Section I — Case-Based Questions"
 * - "1. MCQs (2 marks each)", "2. Multiple Select Questions", etc.
 */
export function identifySectionHeader(line: string): {
  isSection: boolean;
  sectionLetter?: string;
  sectionTitle: string;
  rawHeading: string;
  type: ChapterTestQuestionType;
  marksInfo?: { marks: number; negativeMarks?: number; source: string; confidence: number };
} | null {
  const trimmed = line.trim().replace(/^[\*\#\_\-\s]+|[\*\#\_\-\s]+$/g, "");
  if (!trimmed) return null;

  // Lines that start with directions, instructions, notes, reading cues or questions are NOT section headers
  if (/^(?:Directions?|Instructions?|Note|Read|Study|Examine|Consider|Answer|State\s+whether|Choose)\b/i.test(trimmed)) {
    return null;
  }

  // Check for Section Letter prefix: "Section A — ...", "Section 1: ...", "Part A - ..."
  const secLetterMatch = trimmed.match(/^(?:Section|Part)\s+([A-Za-z0-9]+)\s*[\—\-\:\.]\s*(.*)$/i);
  let sectionLetter: string | undefined;
  let candidateTitle = trimmed;

  if (secLetterMatch) {
    sectionLetter = secLetterMatch[1].toUpperCase();
    candidateTitle = (secLetterMatch[2] || "").trim();
  } else {
    // Numbered header: "1. Multiple Choice Questions", "4. Comprehension"
    const numPrefixMatch = trimmed.match(/^(\d+)[\.\):\-]\s*(.*)$/);
    if (numPrefixMatch) {
      sectionLetter = numPrefixMatch[1];
      candidateTitle = (numPrefixMatch[2] || "").trim();
    }
  }

  const marksInfo = extractMarks(trimmed) || extractMarks(candidateTitle);

  // Clean candidate title of bracketed marks for category detection
  const cleanTitle = candidateTitle
    .replace(/\([\w\s\.\,\-\:]+\)/g, "")
    .replace(/\[[\w\s\.\,\-\:]+\]/g, "")
    .trim();

  // Guard against full sentences
  if (cleanTitle.length > 80 && !secLetterMatch) {
    return null;
  }

  // Test against 9 distinct categories
  const testPhrases = [cleanTitle, candidateTitle];

  for (const str of testPhrases) {
    if (!str) continue;

    // 1. Multiple Select Questions
    if (
      /^(?:Multiple\s+Select(?:\s+Questions?)?|MSQs?|Multi[\s\-]select(?:\s+questions?)?)$/i.test(str)
    ) {
      return {
        isSection: true,
        sectionLetter,
        sectionTitle: candidateTitle,
        rawHeading: trimmed,
        type: "multiple_select",
        marksInfo: marksInfo || undefined
      };
    }

    // 2. MCQs / Multiple Choice
    if (
      /^(?:MCQs?|Multiple\s+Choice(?:\s+Questions?)?|Standalone\s+Questions?|General\s+Questions?|Independent\s+Questions?)$/i.test(str)
    ) {
      return {
        isSection: true,
        sectionLetter,
        sectionTitle: candidateTitle,
        rawHeading: trimmed,
        type: "mcq",
        marksInfo: marksInfo || undefined
      };
    }

    // 3. Assertion & Reasoning
    if (
      /^(?:Assertion\s*(?:&|and|-)\s*Reason(?:ing)?|Assertion\s*Reason)(?:\s+Questions?)?$/i.test(str)
    ) {
      return {
        isSection: true,
        sectionLetter,
        sectionTitle: candidateTitle,
        rawHeading: trimmed,
        type: "assertion_reasoning",
        marksInfo: marksInfo || undefined
      };
    }

    // 4. True and False
    if (
      /^(?:True\s*[\/\\]\s*False|True[\/\\]False|True\s+and\s+False|True\s+or\s+False|T\/F)$/i.test(str)
    ) {
      return {
        isSection: true,
        sectionLetter,
        sectionTitle: candidateTitle,
        rawHeading: trimmed,
        type: "true_false",
        marksInfo: marksInfo || undefined
      };
    }

    // 5. Very Short Answer Questions
    if (
      /^(?:Very\s+Short\s+Answer(?:\s+Questions?)?|VSA(?:\s+Questions?)?|1\s*Mark\s+Questions?)$/i.test(str)
    ) {
      return {
        isSection: true,
        sectionLetter,
        sectionTitle: candidateTitle,
        rawHeading: trimmed,
        type: "very_short_answer",
        marksInfo: marksInfo || undefined
      };
    }

    // 6. Short Answer Questions
    if (
      /^(?:Short\s+Answer(?:\s+Questions?)?|SA(?:\s+Questions?)?|Short\s+Questions?)$/i.test(str)
    ) {
      return {
        isSection: true,
        sectionLetter,
        sectionTitle: candidateTitle,
        rawHeading: trimmed,
        type: "short_answer",
        marksInfo: marksInfo || undefined
      };
    }

    // 7. Long Answer Questions
    if (
      /^(?:Long\s+Answer(?:\s+Questions?)?|LA(?:\s+Questions?)?|Essay(?:\s+Questions?)?)$/i.test(str)
    ) {
      return {
        isSection: true,
        sectionLetter,
        sectionTitle: candidateTitle,
        rawHeading: trimmed,
        type: "long_answer",
        marksInfo: marksInfo || undefined
      };
    }

    // 8. Case-Based Questions
    if (
      /^(?:Case[\s\-]Based(?:\s+Questions?)?|Case\s+Study(?:\s+Questions?)?)$/i.test(str)
    ) {
      return {
        isSection: true,
        sectionLetter,
        sectionTitle: candidateTitle,
        rawHeading: trimmed,
        type: "case_based",
        marksInfo: marksInfo || undefined
      };
    }

    // 9. Comprehension
    if (
      /^(?:(?:Reading\s+)?Comprehension(?:\s+(?:Passage|Section|Questions?))?|Passage(?:\s+Based)?(?:\s+Questions?)?)$/i.test(str)
    ) {
      return {
        isSection: true,
        sectionLetter,
        sectionTitle: candidateTitle,
        rawHeading: trimmed,
        type: "comprehension",
        marksInfo: marksInfo || undefined
      };
    }
  }

  return null;
}

/**
 * Detect passage start line for comprehension or case-study
 */
export function detectPassageOrCaseStart(line: string): {
  title: string;
  isCase: boolean;
  inlineText?: string;
} | null {
  const trimmed = line.trim().replace(/^[\*\#\_\-\s]+|[\*\#\_\-\s]+$/g, "");
  if (!trimmed) return null;

  const isCase = /case/i.test(trimmed);

  // Standalone phrases:
  // "Read the following passage carefully."
  // "Read the passage carefully."
  // "Read the case carefully."
  // "Study the case given below."
  if (
    /^(?:Read|Study|Examine|Consider)\s+(?:carefully\s+)?(?:the\s+)?(?:following\s+)?(?:passage|text|excerpt|case|case\s+study|information)?(?:\s+carefully)?(?:\s*(?:below|given\s+below|and\s+answer|to\s+answer|questions?|that\s+follow)[\w\s\.,\:\-\(\)]*)?[\.\:\-]?$/i.test(
      trimmed
    )
  ) {
    return { title: trimmed, isCase };
  }

  // Inline passage: "Read the passage carefully. Water is one of the most..."
  const inlineMatch = trimmed.match(
    /^((?:Read|Study|Examine|Consider)\s+(?:carefully\s+)?(?:the\s+)?(?:following\s+)?(?:passage|text|case)?(?:\s+carefully)?[\.\:\-])\s+(.+)$/i
  );
  if (inlineMatch) {
    return {
      title: inlineMatch[1].trim(),
      isCase,
      inlineText: inlineMatch[2].trim()
    };
  }

  return null;
}

/**
 * Question numbering matcher: Q1., Q.1, Question 1:, 1., 2)
 */
export function matchQuestionNumber(line: string): {
  qNum: number;
  label: string;
  remainder: string;
  hasExplicitQPrefix: boolean;
} | null {
  const trimmed = line.trim();

  // "Q1. ", "Q1) ", "Question 1: ", "Q.1 "
  const qMatch = trimmed.match(/^(?:Q(?:uestion)?[\.\:\-]?\s*|\bQ\b\s*)(\d+)[\.\):\-]?\s*(.*)$/i);
  if (qMatch) {
    const num = parseInt(qMatch[1], 10);
    if (!isNaN(num)) {
      return {
        qNum: num,
        label: `Q${num}`,
        remainder: qMatch[2] ? qMatch[2].trim() : "",
        hasExplicitQPrefix: true
      };
    }
  }

  // "1. ", "2) ", "15: "
  const plainMatch = trimmed.match(/^(\d+)[\.\):\-]\s+(.*)$/);
  if (plainMatch) {
    const num = parseInt(plainMatch[1], 10);
    if (!isNaN(num)) {
      return {
        qNum: num,
        label: `Q${num}`,
        remainder: plainMatch[2] ? plainMatch[2].trim() : "",
        hasExplicitQPrefix: false
      };
    }
  }

  return null;
}

/**
 * Check if line is a divider or purely structural marker
 */
function isDivider(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  return /^[⸻\-\=\_\*]{2,}$/.test(trimmed) || trimmed === "⸻";
}

/**
 * Main Chapter Test Parser:
 * Preserves meaning, structures sections, validates marks, handles comprehension/case parent-child trees.
 */
export function parseChapterTest(
  rawText: string,
  context: ParseContext = {}
): ParsedChapterTest {
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = rawText ? rawText.trim() : "";

  const metadata: ParsedTestMetadata = {
    classGrade: context.classGrade,
    subject: context.subject,
    chapterNo: context.chapterNo,
    chapterName: context.chapterName,
    topicName: context.topicName,
    generalInstructions: []
  };

  if (!text) {
    return {
      metadata,
      sections: [],
      questions: [],
      passages: {},
      cases: {},
      validation: {
        isValid: false,
        errors: ["Test text is empty. Please provide question paper content."],
        warnings: [],
        totalCalculatedMarks: 0,
        marksMatch: true,
        questionCount: 0,
        sectionCount: 0,
        questionTypeBreakdown: {
          mcq: 0,
          multiple_select: 0,
          assertion_reasoning: 0,
          comprehension: 0,
          true_false: 0,
          very_short_answer: 0,
          short_answer: 0,
          long_answer: 0,
          case_based: 0
        }
      },
      rawText: ""
    };
  }

  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rawLines = normalized.split("\n");

  // State machine variables
  let currentSectionInfo: ReturnType<typeof identifySectionHeader> = null;
  let sectionList: ParsedSection[] = [];
  let currentSectionObj: ParsedSection | null = null;
  let currentInstructions: string[] = [];

  // Active Passage/Case
  interface ActivePassageState {
    id: string;
    title: string;
    instruction?: string;
    textLines: string[];
    isCase: boolean;
    questionIds: string[];
    sectionMarks?: { marks: number; negativeMarks?: number; source: string; confidence: number };
  }
  let activePassage: ActivePassageState | null = null;
  const passagesMap: Record<string, ParsedPassage> = {};
  const casesMap: Record<string, ParsedPassage> = {};

  let passageIndex = 1;
  let caseIndex = 1;

  // Active Question Accumulator
  interface RawQuestionCandidate {
    qNum: number;
    label: string;
    hasExplicitQPrefix: boolean;
    sectionType: ChapterTestQuestionType;
    sectionId?: string;
    sectionLetter?: string;
    sectionTitle?: string;
    sectionMarks?: { marks: number; negativeMarks?: number; source: string; confidence: number };
    passageId?: string;
    caseId?: string;
    lines: string[];
    rawBlockLines: string[];
  }

  const questionCandidates: RawQuestionCandidate[] = [];
  let activeCandidate: RawQuestionCandidate | null = null;

  let isInGeneralInstructions = false;

  const finalizeActivePassage = () => {
    if (activePassage && activePassage.textLines.length > 0) {
      const cleanText = activePassage.textLines.join("\n").trim();
      const passageObj: ParsedPassage = {
        id: activePassage.id,
        title: activePassage.title,
        instruction: activePassage.instruction,
        text: cleanText,
        questionIds: [...activePassage.questionIds],
        isCaseStudy: activePassage.isCase
      };
      if (activePassage.isCase) {
        casesMap[passageObj.id] = passageObj;
      } else {
        passagesMap[passageObj.id] = passageObj;
      }
      if (currentSectionObj) {
        currentSectionObj.passages = currentSectionObj.passages || [];
        currentSectionObj.passages.push(passageObj);
      }
    }
  };

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      if (activePassage && activePassage.questionIds.length === 0 && activePassage.textLines.length > 0) {
        if (activePassage.textLines[activePassage.textLines.length - 1] !== "") {
          activePassage.textLines.push("");
        }
      } else if (activeCandidate && activeCandidate.lines.length > 0) {
        activeCandidate.lines.push("");
      }
      continue;
    }

    if (isDivider(trimmed)) {
      continue;
    }

    // Metadata & Title Extraction (Top of Test)
    if (!currentSectionObj && questionCandidates.length === 0) {
      // "Class 10 — Social Science | Economics"
      const classMatch = trimmed.match(/^(Class\s+\d+|UPSC[^\—\-]*)\s*[—\-]\s*([^\|]+)(?:\|\s*(.*))?$/i);
      if (classMatch) {
        metadata.classGrade = metadata.classGrade || classMatch[1].trim();
        metadata.subject = metadata.subject || classMatch[2].trim();
        metadata.title = metadata.title || trimmed;
        continue;
      }

      // "Chapter: Globalisation and the Indian Economy" or "Chapter 4: ..."
      const chMatch = trimmed.match(/^Chapter(?:\s+(\d+))?\s*[\:\-]\s*(.*)$/i);
      if (chMatch) {
        if (chMatch[1]) metadata.chapterNo = parseInt(chMatch[1], 10);
        if (chMatch[2]) metadata.chapterName = chMatch[2].trim();
        continue;
      }

      // "Topic: ..."
      const topMatch = trimmed.match(/^Topic\s*[\:\-]\s*(.*)$/i);
      if (topMatch) {
        metadata.topicName = topMatch[1].trim();
        continue;
      }

      // "Theme: ..."
      const thMatch = trimmed.match(/^Theme\s*[\:\-]\s*(.*)$/i);
      if (thMatch) {
        metadata.theme = thMatch[1].trim();
        continue;
      }

      // "Time Allowed: 3 Hours", "Time: 90 Minutes"
      const timeMatch = trimmed.match(/(?:Time\s+Allowed|Time)\s*[\:\-]\s*(.*)$/i);
      if (timeMatch) {
        metadata.timeAllowed = timeMatch[1].trim();
        continue;
      }

      // "Maximum Marks: 80", "Max. Marks: 50", "Total Marks: 50"
      const maxMarksMatch = trimmed.match(/(?:Max(?:imum)?\s*Marks|Total\s*Marks)\s*[\:\-]\s*(\d+(?:\.\d+)?)/i);
      if (maxMarksMatch) {
        metadata.declaredTotalMarks = parseFloat(maxMarksMatch[1]);
        continue;
      }

      // "General Instructions:"
      if (/^General\s+Instructions?\s*[\:\-]?$/i.test(trimmed)) {
        isInGeneralInstructions = true;
        continue;
      }

      if (isInGeneralInstructions) {
        // If this line is a section header, exit general instructions
        if (identifySectionHeader(trimmed)) {
          isInGeneralInstructions = false;
        } else {
          metadata.generalInstructions = metadata.generalInstructions || [];
          metadata.generalInstructions.push(trimmed);
          continue;
        }
      }
    }

    // Section Header Identification
    const secDetected = identifySectionHeader(trimmed);
    if (secDetected) {
      isInGeneralInstructions = false;
      if (activeCandidate) {
        questionCandidates.push(activeCandidate);
        activeCandidate = null;
      }

      finalizeActivePassage();

      // Create new section object
      currentSectionInfo = secDetected;
      const secLetter = secDetected.sectionLetter || String.fromCharCode(65 + sectionList.length);
      const secId = `section_${secLetter.toLowerCase()}`;

      currentSectionObj = {
        id: secId,
        sectionLetter: secLetter,
        heading: secDetected.rawHeading,
        title: secDetected.sectionTitle,
        type: secDetected.type,
        instructions: [],
        marksPerQuestion: secDetected.marksInfo?.marks,
        negativeMarks: secDetected.marksInfo?.negativeMarks,
        questions: [],
        passages: [],
        totalMarks: 0
      };
      sectionList.push(currentSectionObj);

      // If comprehension or case-based, prepare active passage
      if (secDetected.type === "comprehension" || secDetected.type === "case_based") {
        const isCase = secDetected.type === "case_based";
        const pId = isCase ? `case_${caseIndex++}` : `passage_${passageIndex++}`;
        activePassage = {
          id: pId,
          title: secDetected.sectionTitle,
          textLines: [],
          isCase,
          questionIds: [],
          sectionMarks: secDetected.marksInfo
        };
      } else {
        activePassage = null;
      }
      continue;
    }

    // Section-level instructions / Directions:
    // e.g. "Directions: Select all correct options. There may be more than one correct answer."
    // e.g. "Directions: Read the Assertion (A) and Reason (R) carefully."
    if (
      /^Directions?\s*[\:\-]/i.test(trimmed) ||
      /^(?:Instructions?|Note)\s*[\:\-]/i.test(trimmed) ||
      /^(?:Answer\s+all\s+the\s+questions|Choose\s+the\s+correct\s+option|State\s+whether\s+each\s+statement\s+is\s+True\s+or\s+False)/i.test(trimmed)
    ) {
      if (currentSectionObj && !activeCandidate && (!activePassage || activePassage.questionIds.length === 0)) {
        currentSectionObj.instructions.push(trimmed);
        continue;
      }
    }

    // Passage / Case Study Detection (e.g. "Read the passage carefully.", "Read the case carefully.")
    const passDetected = detectPassageOrCaseStart(trimmed);
    if (passDetected) {
      if (activeCandidate) {
        questionCandidates.push(activeCandidate);
        activeCandidate = null;
      }

      // If active passage is already initialized without text, adopt this instruction/title
      if (activePassage && activePassage.textLines.length === 0) {
        activePassage.title = passDetected.title;
        activePassage.instruction = passDetected.title;
        if (passDetected.inlineText) {
          activePassage.textLines.push(passDetected.inlineText);
        }
      } else {
        finalizeActivePassage();

        const isCase = passDetected.isCase || (currentSectionObj?.type === "case_based");
        const pId = isCase ? `case_${caseIndex++}` : `passage_${passageIndex++}`;

        activePassage = {
          id: pId,
          title: passDetected.title,
          instruction: passDetected.title,
          textLines: passDetected.inlineText ? [passDetected.inlineText] : [],
          isCase,
          questionIds: [],
          sectionMarks: currentSectionObj?.marksPerQuestion ? {
            marks: currentSectionObj.marksPerQuestion,
            negativeMarks: currentSectionObj.negativeMarks,
            source: "section_instruction",
            confidence: 0.98
          } : undefined
        };
      }
      continue;
    }

    // Question Numbering Match (e.g. "Q1. What is meant...", "1. Which organisation...")
    const qMatch = matchQuestionNumber(trimmed);
    if (qMatch) {
      // Disambiguate: is this a numbered list item inside the Answer of the previous question?
      // e.g. inside "Answer:\n 1. Improvement in technology\n 2. Faster transport"
      const activeHasAnswer = activeCandidate && activeCandidate.lines.some((l) => /^(?:Correct\s*)?Ans(?:wer)?\s*[\:\-]/i.test(l));
      const isListItemInsideAnswer =
        activeCandidate &&
        activeHasAnswer &&
        !qMatch.hasExplicitQPrefix &&
        (activeCandidate.hasExplicitQPrefix || qMatch.qNum <= activeCandidate.qNum);

      if (isListItemInsideAnswer) {
        activeCandidate.lines.push(trimmed);
        activeCandidate.rawBlockLines.push(rawLine);
        continue;
      }

      // Check if we need to close the current active candidate
      if (activeCandidate) {
        questionCandidates.push(activeCandidate);
        activeCandidate = null;
      }

      // Default section if none has been encountered yet
      if (!currentSectionObj) {
        currentSectionObj = {
          id: "section_a",
          sectionLetter: "A",
          heading: "Section A — Multiple Choice Questions",
          title: "Multiple Choice Questions",
          type: "mcq",
          instructions: [],
          questions: [],
          totalMarks: 0
        };
        sectionList.push(currentSectionObj);
      }

      let qSectionType = activePassage
        ? (activePassage.isCase ? "case_based" : "comprehension")
        : currentSectionObj.type;

      // Inline type checks
      if (!activePassage && /^(?:True\s*[\/\\]\s*False|T\/F|True\s+or\s+False)\b/i.test(qMatch.remainder)) {
        qSectionType = "true_false";
      } else if (!activePassage && /^(?:Assertion\s*(?:&|and|-)\s*Reason(?:ing)?)\b/i.test(qMatch.remainder)) {
        qSectionType = "assertion_reasoning";
      }

      const candId = `q_${qMatch.qNum}_${Math.random().toString(36).substring(2, 7)}`;
      if (activePassage) {
        activePassage.questionIds.push(candId);
      }

      activeCandidate = {
        qNum: qMatch.qNum,
        label: qMatch.label,
        hasExplicitQPrefix: qMatch.hasExplicitQPrefix,
        sectionType: qSectionType,
        sectionId: currentSectionObj.id,
        sectionLetter: currentSectionObj.sectionLetter,
        sectionTitle: currentSectionObj.title,
        sectionMarks: currentSectionObj.marksPerQuestion ? {
          marks: currentSectionObj.marksPerQuestion,
          negativeMarks: currentSectionObj.negativeMarks,
          source: "section_instruction",
          confidence: 0.98
        } : undefined,
        passageId: activePassage && !activePassage.isCase ? activePassage.id : undefined,
        caseId: activePassage && activePassage.isCase ? activePassage.id : undefined,
        lines: qMatch.remainder ? [qMatch.remainder] : [],
        rawBlockLines: [rawLine]
      };
      continue;
    }

    // If we are currently reading the text of a passage before its child questions begin:
    if (activePassage && activePassage.questionIds.length === 0) {
      // Ignore directions like "Answer the following questions."
      if (/^(?:Answer\s+the\s+following\s+questions?[\.\:\-]?|Questions?\s+that\s+follow[\.\:\-]?)$/i.test(trimmed)) {
        continue;
      }
      activePassage.textLines.push(trimmed);
      continue;
    }

    // If active question candidate exists, append line
    if (activeCandidate) {
      activeCandidate.lines.push(trimmed);
      activeCandidate.rawBlockLines.push(rawLine);
    }
  }

  // Push final active question
  if (activeCandidate) {
    questionCandidates.push(activeCandidate);
    activeCandidate = null;
  }

  // Register final passage/case
  finalizeActivePassage();

  // Process all Question Candidates into ParsedQuestion
  const allParsedQuestions: ParsedQuestion[] = [];
  const typeBreakdown: Record<ChapterTestQuestionType, number> = {
    mcq: 0,
    multiple_select: 0,
    assertion_reasoning: 0,
    comprehension: 0,
    true_false: 0,
    very_short_answer: 0,
    short_answer: 0,
    long_answer: 0,
    case_based: 0
  };

  questionCandidates.forEach((candidate, idx) => {
    const cleanLines = candidate.lines
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !isDivider(l));

    if (cleanLines.length === 0) {
      warnings.push(`Question ${candidate.label}: Skipped empty question block.`);
      return;
    }

    // Extract Answer line
    let explicitAnswer = "";
    const remainingLines: string[] = [];
    let isReadingMultiLineAnswer = false;
    const answerParts: string[] = [];

    cleanLines.forEach((l) => {
      const caMatch = l.match(/^(?:Correct\s*)?Ans(?:wer)?\s*[:\-]\s*(.*)$/i);
      if (caMatch) {
        isReadingMultiLineAnswer = true;
        const inlineAns = caMatch[1].trim();
        if (inlineAns) answerParts.push(inlineAns);
      } else if (isReadingMultiLineAnswer) {
        answerParts.push(l);
      } else {
        remainingLines.push(l);
      }
    });

    if (answerParts.length > 0) {
      explicitAnswer = answerParts.join("\n").trim();
    }

    // Extract diagram/image tag if present: [Image: Ocean-floor diagram]
    let extractedImageLabel = "";
    const linesAfterImage: string[] = [];
    remainingLines.forEach((l) => {
      const imgMatch = l.match(/\[Image(?:\s+Upload)?:\s*([^\]]+)\]/i);
      if (imgMatch) {
        extractedImageLabel = imgMatch[1].trim();
        const stripped = l.replace(/\[Image(?:\s+Upload)?:\s*([^\]]+)\]/gi, "").trim();
        if (stripped) linesAfterImage.push(stripped);
      } else {
        linesAfterImage.push(l);
      }
    });

    const fullBlockText = linesAfterImage.join("\n");

    // Marks Calculation for Question
    let questionMarks = 1;
    let questionNegMarks: number | undefined;
    let marksSource = "default_inferred";
    let marksConfidence = 0.5;
    let marksPending = true;

    // Check Question-level explicit marks
    const qMarks = extractMarks(cleanLines[0]) || extractMarks(fullBlockText);
    if (qMarks) {
      questionMarks = qMarks.marks;
      questionNegMarks = qMarks.negativeMarks;
      marksSource = qMarks.source;
      marksConfidence = qMarks.confidence;
      marksPending = false;
    } else if (candidate.sectionMarks) {
      questionMarks = candidate.sectionMarks.marks;
      questionNegMarks = candidate.sectionMarks.negativeMarks;
      marksSource = candidate.sectionMarks.source;
      marksConfidence = candidate.sectionMarks.confidence;
      marksPending = false;
    } else {
      const def = inferDefaultMarks(candidate.sectionType);
      questionMarks = def.marks;
      marksSource = def.source;
      marksConfidence = def.confidence;
      marksPending = def.pending;
    }

    // Locate Option Lines
    const optionIndices: number[] = [];
    linesAfterImage.forEach((l, i) => {
      if (matchOptionLine(l)) {
        optionIndices.push(i);
      }
    });

    const hasOptions = optionIndices.length >= 2;

    // Assertion & Reasoning Specific Parsing
    const isAssertion =
      candidate.sectionType === "assertion_reasoning" ||
      /Assertion\s*\([A-Za-z]\)/i.test(fullBlockText) ||
      /Reason\s*\([A-Za-z]\)/i.test(fullBlockText);

    let assertionText = "";
    let reasonText = "";
    if (isAssertion) {
      const aMatch = fullBlockText.match(/Assertion\s*\([A-Za-z]\)\s*[\:\-]\s*([^\n]+)/i);
      if (aMatch) assertionText = aMatch[1].trim();
      const rMatch = fullBlockText.match(/Reason\s*\([A-Za-z]\)\s*[\:\-]\s*([^\n]+)/i);
      if (rMatch) reasonText = rMatch[1].trim();
    }

    // True/False Checking
    const hasTFAnswer =
      explicitAnswer.toLowerCase() === "true" ||
      explicitAnswer.toLowerCase() === "false" ||
      explicitAnswer.toLowerCase() === "t" ||
      explicitAnswer.toLowerCase() === "f";
    const isTFQuestion = candidate.sectionType === "true_false" || (!hasOptions && hasTFAnswer);

    // Multiple Select Checking
    const isMultipleSelect =
      candidate.sectionType === "multiple_select" ||
      /^[A-E]\s*,\s*[A-E]/i.test(explicitAnswer) ||
      /^[A-E]\s*,\s*[A-E]\s*(?:and|&)\s*[A-E]/i.test(explicitAnswer);

    // Subjective Checking (VSA, SA, LA, or subjective comprehension child question)
    const isSubjectiveType =
      candidate.sectionType === "very_short_answer" ||
      candidate.sectionType === "short_answer" ||
      candidate.sectionType === "long_answer" ||
      (!hasOptions && !isTFQuestion && !isAssertion);

    let resolvedType: ChapterTestQuestionType = candidate.sectionType;
    if (isTFQuestion) resolvedType = "true_false";
    else if (isAssertion) resolvedType = "assertion_reasoning";
    else if (isMultipleSelect) resolvedType = "multiple_select";
    else if (isSubjectiveType) {
      if (candidate.sectionType === "very_short_answer") resolvedType = "very_short_answer";
      else if (candidate.sectionType === "long_answer") resolvedType = "long_answer";
      else resolvedType = "short_answer";
    } else {
      resolvedType = "mcq";
    }

    typeBreakdown[resolvedType] = (typeBreakdown[resolvedType] || 0) + 1;

    // Build Question Object
    let questionText = "";
    let optionsList: string[] = [];
    let parsedOptions: ParsedOption[] = [];
    let finalAnswer = "";
    let modelAnswerText: string | undefined;
    let isSubjective = false;

    if (resolvedType === "true_false") {
      const statementLines = linesAfterImage.filter(
        (l) =>
          !/^(?:True|False)\s*[✅❌]?$/i.test(l) &&
          !/^[A-B][\.\)]\s*(?:True|False)/i.test(l) &&
          !/^(?:Option\s+[A-B]|[A-B][\.\)\:\-])$/i.test(l) &&
          !/^(?:True\s*[\/\\]\s*False|True[\/\\]False|T\/F|True\s+or\s+False)[\:\.]?$/i.test(l)
      );
      questionText = statementLines
        .join(" ")
        .replace(/^(?:True\s*[\/\\]\s*False|True[\/\\]False|T\/F|True\s+or\s+False)[\:\.\-\s]*/gi, "")
        .replace(/—\s*(True|False)\s*[✅❌]?/gi, "")
        .replace(/-\s*(True|False)\s*[✅❌]?/gi, "")
        .replace(/\b(True|False)\s*[✅❌]?$/gi, "")
        .replace(/[✅❌]/g, "")
        .trim();

      if (hasTFAnswer) {
        const ca = explicitAnswer.toLowerCase();
        finalAnswer = ca.startsWith("true") || ca === "t" ? "True" : "False";
      } else if (fullBlockText.includes("True ✅") || fullBlockText.includes("— True") || fullBlockText.includes("- True")) {
        finalAnswer = "True";
      } else if (fullBlockText.includes("False ❌") || fullBlockText.includes("False ✅") || fullBlockText.includes("— False") || fullBlockText.includes("- False")) {
        finalAnswer = "False";
      } else {
        warnings.push(`Question ${candidate.label} (True/False): Missing explicit True or False answer.`);
        finalAnswer = "True"; // fallback
      }

      optionsList = ["True", "False"];
      parsedOptions = [
        { letter: "True", text: "True", raw: "True" },
        { letter: "False", text: "False", raw: "False" }
      ];
    } else if (isSubjectiveType) {
      isSubjective = true;
      questionText = linesAfterImage
        .filter(
          (l) =>
            l.toLowerCase() !== "question:" &&
            !/^Options?\s*[\:\-]?$/i.test(l) &&
            !/^(?:Very\s+Short|Short|Long)\s+Answer[\:\.]?$/i.test(l)
        )
        .join("\n")
        .trim();

      finalAnswer = explicitAnswer;
      modelAnswerText = explicitAnswer;

      if (!explicitAnswer) {
        warnings.push(`Question ${candidate.label} (${getQuestionTypeDisplayName(resolvedType)}): Missing model answer.`);
      }
    } else {
      // Objective Question with Options (MCQ, MSQ, Assertion & Reason)
      const firstOptIdx = optionIndices[0];
      const rawQLines = linesAfterImage
        .slice(0, firstOptIdx)
        .filter(
          (l) =>
            l.toLowerCase() !== "question:" &&
            !/^Options?\s*[\:\-]?$/i.test(l) &&
            !/^(?:Assertion\s*(?:&|and|-)\s*Reason(?:ing)?|Multiple\s+Choice(?:\s+Questions?)?|MCQs?|Multiple\s+Select)[\:\.]?$/i.test(
              l.trim()
            )
        );

      questionText = rawQLines.join("\n").trim();

      const optLines = linesAfterImage.slice(firstOptIdx);
      const rawParsedOpts: string[] = [];
      const markedCheckmarks: string[] = [];

      optLines.forEach((optLine) => {
        const optMatch = matchOptionLine(optLine);
        if (optMatch) {
          const letter = optMatch.letter;
          let optVal = optMatch.text;

          const isCheck =
            optVal.includes("✅") ||
            /\(correct\)/i.test(optVal) ||
            /\(answer\)/i.test(optVal);

          optVal = optVal
            .replace(/[✅❌]/g, "")
            .replace(/\s*\(trap\)/gi, "")
            .replace(/\s*\(correct\)/gi, "")
            .replace(/\s*\(answer\)/gi, "")
            .trim();

          if (isCheck) markedCheckmarks.push(letter);
          rawParsedOpts.push(optVal ? `${letter}. ${optVal}` : `${letter}.`);
        } else if (optLine.trim() && !/^Options?\s*[\:\-]?$/i.test(optLine.trim())) {
          if (rawParsedOpts.length > 0) {
            const lastIdx = rawParsedOpts.length - 1;
            rawParsedOpts[lastIdx] += " " + optLine.trim();
          }
        }
      });

      const { normalized, parsed } = normalizeOptions(rawParsedOpts);
      optionsList = normalized;
      parsedOptions = parsed;

      if (resolvedType === "multiple_select") {
        if (explicitAnswer) {
          const letters = Array.from(
            new Set((explicitAnswer.match(/\b([A-Ea-e])\b/g) || []).map((l) => l.toUpperCase()))
          ).sort();
          if (letters.length > 0) finalAnswer = letters.join(", ");
        }
        if (!finalAnswer && markedCheckmarks.length > 0) {
          finalAnswer = Array.from(new Set(markedCheckmarks)).sort().join(", ");
        }
        if (!finalAnswer) {
          warnings.push(`Question ${candidate.label} (Multiple Select): Missing correct answers.`);
        }
      } else {
        // Single Answer MCQ or Assertion & Reason
        if (markedCheckmarks.length > 1) {
          resolvedType = "multiple_select";
          finalAnswer = Array.from(new Set(markedCheckmarks)).sort().join(", ");
        } else {
          if (explicitAnswer) {
            const letterMatch = explicitAnswer.match(/(?:Option\s*)?([A-Ea-e1-5])/i);
            if (letterMatch) {
              let letter = letterMatch[1].toUpperCase();
              if (["1", "2", "3", "4", "5"].includes(letter)) {
                const numMap: Record<string, string> = { "1": "A", "2": "B", "3": "C", "4": "D", "5": "E" };
                letter = numMap[letter] || "A";
              }
              finalAnswer = letter;
            }
          }
          if (!finalAnswer && markedCheckmarks.length === 1) {
            finalAnswer = markedCheckmarks[0];
          }
          if (!finalAnswer) {
            warnings.push(`Question ${candidate.label} (${getQuestionTypeDisplayName(resolvedType)}): Missing correct answer.`);
          }
        }
      }
    }

    if (!questionText) {
      questionText = `Question ${candidate.label}`;
      warnings.push(`Question ${candidate.label}: Question text was empty or incomplete.`);
    }

    const questionObj: ParsedQuestion = {
      id: `q_${resolvedType}_${candidate.qNum}_${Math.random().toString(36).substring(2, 7)}`,
      questionNumber: candidate.qNum,
      type: resolvedType,
      sectionId: candidate.sectionId,
      sectionLetter: candidate.sectionLetter,
      sectionTitle: candidate.sectionTitle,
      question: questionText,
      assertionText: assertionText || undefined,
      reasonText: reasonText || undefined,
      options: optionsList,
      parsedOptions,
      correctAnswer: finalAnswer,
      modelAnswer: modelAnswerText,
      explanation: explicitAnswer.length > 5 ? explicitAnswer : undefined,
      isSubjective,
      marks: questionMarks,
      negativeMarks: questionNegMarks,
      marksSource,
      marksConfidence,
      marksPending,
      passageId: candidate.passageId,
      caseId: candidate.caseId,
      imageLabel: extractedImageLabel || undefined,
      rawText: candidate.rawBlockLines.join("\n")
    };

    allParsedQuestions.push(questionObj);

    // Assign question to its section
    const parentSection = sectionList.find((s) => s.id === candidate.sectionId);
    if (parentSection) {
      parentSection.questions.push(questionObj);
      parentSection.totalMarks += questionMarks;
    }
  });

  // Calculate total marks across all questions
  const totalCalculatedMarks = allParsedQuestions.reduce((sum, q) => sum + (q.marks || 0), 0);

  // Validate consistency of declared total marks vs calculated marks
  let marksMatch = true;
  if (metadata.declaredTotalMarks !== undefined) {
    if (metadata.declaredTotalMarks !== totalCalculatedMarks) {
      marksMatch = false;
      warnings.push(
        `Declared test total marks (${metadata.declaredTotalMarks}) does not match sum of individual question marks (${totalCalculatedMarks}).`
      );
    }
  }

  // Check that all sections have questions
  sectionList.forEach((sec) => {
    if (sec.questions.length === 0) {
      warnings.push(`Section "${sec.title}" has no questions parsed.`);
    }
  });

  if (allParsedQuestions.length === 0) {
    errors.push("No valid questions could be identified from the provided test text.");
  }

  const validation: TestValidationResult = {
    isValid: errors.length === 0 && allParsedQuestions.length > 0,
    errors,
    warnings,
    totalCalculatedMarks,
    declaredTotalMarks: metadata.declaredTotalMarks,
    marksMatch,
    questionCount: allParsedQuestions.length,
    sectionCount: sectionList.length,
    questionTypeBreakdown: typeBreakdown
  };

  return {
    metadata,
    sections: sectionList,
    questions: allParsedQuestions,
    passages: passagesMap,
    cases: casesMap,
    validation,
    rawText: text
  };
}

/**
 * Adapter converting ParsedChapterTest questions to ParsedAssessmentQuestion array
 * to maintain complete compatibility with existing TopicPracticeTest and AdminPracticeTestModal
 */
export function convertToAssessmentQuestions(
  chapterTest: ParsedChapterTest,
  context: ParseContext
): {
  questions: ParsedAssessmentQuestion[];
  passages: Record<string, ComprehensionPassage>;
  cases: Record<string, CaseStudy>;
} {
  const passages: Record<string, ComprehensionPassage> = {};
  const cases: Record<string, CaseStudy> = {};

  Object.values(chapterTest.passages).forEach((p) => {
    passages[p.id] = { id: p.id, title: p.title, text: p.text };
  });

  Object.values(chapterTest.cases).forEach((c) => {
    cases[c.id] = { id: c.id, title: c.title, text: c.text };
  });

  const questions: ParsedAssessmentQuestion[] = chapterTest.questions.map((q, idx) => ({
    id: q.id,
    classGrade: chapterTest.metadata.classGrade || context.classGrade || "Class 10",
    subject: chapterTest.metadata.subject || context.subject || "General",
    chapterNo: chapterTest.metadata.chapterNo || context.chapterNo || 1,
    chapterName: chapterTest.metadata.chapterName || context.chapterName || "Chapter",
    topicName: chapterTest.metadata.topicName || context.topicName || "Full Chapter Test",
    type: q.type as AssessmentQuestionType,
    question: q.question,
    options: q.options,
    correctAnswer: q.correctAnswer,
    modelAnswer: q.modelAnswer,
    explanation: q.explanation,
    isSubjective: q.isSubjective,
    marks: q.marks,
    negativeMarks: q.negativeMarks,
    marksSource: q.marksSource,
    marksConfidence: q.marksConfidence,
    marksPending: q.marksPending,
    passageId: q.passageId,
    parentPassageId: q.passageId,
    caseId: q.caseId,
    parentCaseId: q.caseId,
    imageLabel: q.imageLabel,
    orderIndex: idx,
    rawText: q.rawText
  }));

  return { questions, passages, cases };
}
