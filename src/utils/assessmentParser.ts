import { 
  ParsedAssessmentQuestion, 
  TopicPracticeTest, 
  TestAttemptRecord, 
  ComprehensionPassage, 
  CaseStudy,
  AssessmentTestType,
  AssessmentQuestionType
} from "../types";
import { SAMPLE_QUESTION_PAPER } from "../constants/sampleQuestionPaper";

export { SAMPLE_QUESTION_PAPER };

import {
  parseChapterTest,
  convertToAssessmentQuestions,
  getQuestionTypeDisplayName,
  type ParsedChapterTest,
  type ParsedSection,
  type ParsedQuestion,
  type ParsedPassage,
  type ParsedTestMetadata,
  type TestValidationResult,
  type ChapterTestQuestionType
} from "../lib/testParser";

export {
  parseChapterTest,
  convertToAssessmentQuestions,
  getQuestionTypeDisplayName,
  type ParsedChapterTest,
  type ParsedSection,
  type ParsedQuestion,
  type ParsedPassage,
  type ParsedTestMetadata,
  type TestValidationResult,
  type ChapterTestQuestionType
};

export const getAssessmentQuestionTypeLabel = (type: string, passageIdOrIsChild?: boolean | string): string => {
  const isChild = typeof passageIdOrIsChild === "boolean" ? passageIdOrIsChild : false;
  return getQuestionTypeDisplayName(type, isChild);
};

export interface ParsedMetadata {
  chapter?: string;
  topic?: string;
  theme?: string;
  classGrade?: string;
  subject?: string;
}

export interface ParseResult {
  success: boolean;
  questions: ParsedAssessmentQuestion[];
  passages?: Record<string, ComprehensionPassage>;
  cases?: Record<string, CaseStudy>;
  errors: string[];
  metadata?: ParsedMetadata;
}

/**
 * Normalizes test ID for topic practice tests
 */
export function buildTopicTestId(
  classGrade: string = "",
  subject: string = "",
  chapterNo: number = 0,
  topicName: string = ""
): string {
  const normClass = (classGrade || "").toLowerCase().replace(/\s+/g, "_");
  const normSubj = (subject || "").toLowerCase().replace(/\s+/g, "_");
  const normTopic = (topicName || "").toLowerCase().replace(/[^a-z0-9]/g, "_");
  return `${normClass}__${normSubj}__ch${chapterNo}__${normTopic}`;
}

export function buildChapterTestId(
  classGrade: string = "",
  subject: string = "",
  chapterNo: number = 0
): string {
  const normClass = (classGrade || "").toLowerCase().replace(/\s+/g, "_");
  const normSubj = (subject || "").toLowerCase().replace(/\s+/g, "_");
  return `${normClass}__${normSubj}__ch${chapterNo}__chapter_test`;
}

export function buildSubjectTestId(
  classGrade: string = "",
  subject: string = ""
): string {
  const normClass = (classGrade || "").toLowerCase().replace(/\s+/g, "_");
  const normSubj = (subject || "").toLowerCase().replace(/\s+/g, "_");
  return `${normClass}__${normSubj}__subject_test`;
}

export function buildAssessmentTestId(
  classGrade: string = "",
  subject: string = "",
  chapterNo: number = 0,
  topicName: string = "",
  testType: AssessmentTestType = "TOPIC"
): string {
  const t = String(testType || "TOPIC").toUpperCase();
  if (t === "SUBJECT") return buildSubjectTestId(classGrade, subject);
  if (t === "CHAPTER" || t === "FULL_CHAPTER") return buildChapterTestId(classGrade, subject, chapterNo);
  return buildTopicTestId(classGrade, subject, chapterNo, topicName);
}

/**
 * Helper to extract metadata markers from line
 */
function extractMetadataLine(line: string, metadata: ParsedMetadata): boolean {
  const trimmed = line.trim();
  const chMatch = trimmed.match(/^Chapter\s*:\s*(.*)$/i);
  if (chMatch) {
    if (chMatch[1].trim()) metadata.chapter = chMatch[1].trim();
    return true;
  }
  const topMatch = trimmed.match(/^Topic\s*:\s*(.*)$/i);
  if (topMatch) {
    if (topMatch[1].trim()) metadata.topic = topMatch[1].trim();
    return true;
  }
  const thMatch = trimmed.match(/^Theme\s*:\s*(.*)$/i);
  if (thMatch) {
    if (thMatch[1].trim()) metadata.theme = thMatch[1].trim();
    return true;
  }
  // Also recognize "Class 10 — Social Science | Economics"
  const classSubMatch = trimmed.match(/^(Class\s+\d+|UPSC[^\—\-]*)\s*[—\-]\s*([^\|]+)(?:\|\s*(.*))?$/i);
  if (classSubMatch) {
    metadata.classGrade = classSubMatch[1].trim();
    metadata.subject = classSubMatch[2].trim();
    return true;
  }
  return false;
}

/**
 * Extract marks and negative marks from text (question line or section header)
 */
export function extractMarksInfo(text: string): { marks: number; negativeMarks?: number; source: string; confidence: number } | null {
  if (!text) return null;

  let negativeMarks: number | undefined;
  const negMatch = text.match(/(?:negative|minus|deduction)\s*(?:marking|marks?)?[\:\s]+-?(\d+(?:\.\d+)?)/i) ||
                   text.match(/\[\s*-(?:mark|marks)?\s*(\d+(?:\.\d+)?)\s*\]/i) ||
                   text.match(/\(\s*-(\d+(?:\.\d+)?)\s*(?:marks?|pts?)?\s*\)/i);
  if (negMatch) {
    negativeMarks = parseFloat(negMatch[1]);
  }

  // 1. Explicit pattern: "(2 marks each)", "[3 marks]", "(1 mark)", "2 marks each", "1 mark each"
  const eachMatch = text.match(/(?:\(|\{|\[)?\s*(\d+(?:\.\d+)?)\s*(?:marks?|pts?|points?)\s*(?:each)?\s*(?:\)|\}|\])?/i);
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

  // 2. "Marks: 5", "Mark: 2", "Points: 3"
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

  // 3. "carries 2 marks", "carry 1 mark each"
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

  // 4. Standalone bracketed number like "[2]" or "[5]" at the end of line
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
 * Infer default fallback marks by question type when not explicitly provided
 */
export function inferDefaultMarksForType(type: AssessmentQuestionType): { marks: number; source: string; confidence: number; pending: boolean } {
  switch (type) {
    case "mcq":
    case "true_false":
    case "assertion_reasoning":
    case "assertion_reason":
    case "very_short_answer":
      return { marks: 1, source: "default_inferred", confidence: 0.50, pending: true };
    case "multiple_select":
    case "short_answer":
      return { marks: 2, source: "default_inferred", confidence: 0.50, pending: true };
    case "long_answer":
      return { marks: 5, source: "default_inferred", confidence: 0.50, pending: true };
    case "case_based":
    case "comprehension":
      return { marks: 4, source: "default_inferred", confidence: 0.50, pending: true };
    default:
      return { marks: 1, source: "default_inferred", confidence: 0.50, pending: true };
  }
}

/**
 * Helper to recognize section headers across all supported question categories
 */
function matchSectionHeader(line: string): { type: AssessmentQuestionType; marks?: number; negativeMarks?: number; source?: string } | null {
  const trimmed = line.trim().replace(/^[\*\#\_\-\s]+|[\*\#\_\-\s]+$/g, "");
  if (!trimmed) return null;

  const marksInfo = extractMarksInfo(trimmed);

  // Strip leading numbering like "1. ", "2. ", "Part 1: ", "Section A: "
  const stripped = trimmed
    .replace(/^(?:(?:Part|Section)\s+[A-Za-z0-9]+[\s\:\-]+|\d+[\.\):\-]\s*)/i, "")
    .replace(/^[\*\#\_\-\s]+|[\*\#\_\-\s]+$/g, "")
    .trim();

  for (const candidate of [trimmed, stripped]) {
    if (!candidate) continue;

    // 1. Multiple Select Questions
    if (
      /^(?:Multiple\s+Select(?:\s+Questions?)?|MSQs?|Multi[\s\-]select(?:\s+questions?)?)/i.test(candidate) ||
      /^Section\s+[A-Za-z0-9]+[\s\:\-]+Multiple\s+Select/i.test(candidate)
    ) {
      return { type: "multiple_select", ...marksInfo };
    }

    // 2. MCQs
    if (
      /^(?:MCQs?|Multiple\s+Choice(?:\s+Questions?)?|Standalone\s+Questions?|General\s+Questions?|Independent\s+Questions?)/i.test(candidate) ||
      /^Section\s+[A-Za-z0-9]+[\s\:\-]+(?:MCQs?|Multiple\s+Choice)/i.test(candidate)
    ) {
      return { type: "mcq", ...marksInfo };
    }

    // 3. Assertion & Reasoning
    if (
      /^Assertion\s*(?:&|and)\s*Reason(?:ing)?/i.test(candidate) ||
      /^Assertion\s*-\s*Reason(?:ing)?/i.test(candidate)
    ) {
      return { type: "assertion_reasoning", ...marksInfo };
    }

    // 4. True / False
    if (
      /^(?:True\s*[\/\\]\s*False|True[\/\\]False|True\s+and\s+False|True\s+or\s+False|T\/F)$/i.test(candidate) ||
      /^Section\s+[A-Za-z0-9]+[\s\:\-]+(?:True\s*[\/\\]\s*False|True[\/\\]False)$/i.test(candidate)
    ) {
      return { type: "true_false", ...marksInfo };
    }

    // 5. Very Short Answer
    if (
      /^(?:Very\s+Short\s+Answer(?:\s+Questions?)?|VSA(?:\s+Questions?)?|1\s*Mark\s+Questions?)/i.test(candidate) ||
      /^Section\s+[A-Za-z0-9]+[\s\:\-]+Very\s+Short\s+Answer/i.test(candidate)
    ) {
      return { type: "very_short_answer", ...marksInfo };
    }

    // 6. Short Answer
    if (
      /^(?:Short\s+Answer(?:\s+Questions?)?|SA(?:\s+Questions?)?|Short\s+Questions?)/i.test(candidate) ||
      /^Section\s+[A-Za-z0-9]+[\s\:\-]+Short\s+Answer/i.test(candidate)
    ) {
      return { type: "short_answer", ...marksInfo };
    }

    // 7. Long Answer
    if (
      /^(?:Long\s+Answer(?:\s+Questions?)?|LA(?:\s+Questions?)?|Essay(?:\s+Questions?)?)/i.test(candidate) ||
      /^Section\s+[A-Za-z0-9]+[\s\:\-]+Long\s+Answer/i.test(candidate)
    ) {
      return { type: "long_answer", ...marksInfo };
    }

    // 8. Case-Based Questions
    if (
      /^(?:Case[\s\-]Based(?:\s+Questions?)?|Case\s+Study(?:\s+Questions?)?)/i.test(candidate) ||
      /^Section\s+[A-Za-z0-9]+[\s\:\-]+Case[\s\-]Based/i.test(candidate)
    ) {
      return { type: "case_based", ...marksInfo };
    }

    // 9. Comprehension
    if (
      /^(?:(?:Reading\s+)?Comprehension(?:\s+(?:Passage|Section|Questions?))?|Passage(?:\s+Based)?(?:\s+Questions?)?)(?:\s*\d+)?[\:\.]?/i.test(candidate) ||
      /^Section\s+[A-Za-z0-9]+[\s\:\-]+(?:Reading\s+)?Comprehension/i.test(candidate)
    ) {
      return { type: "comprehension", ...marksInfo };
    }
  }

  return null;
}

/**
 * Distinguishes between a section header and a numbered question
 */
function isSectionHeaderWithLookahead(
  line: string,
  lines: string[],
  currentIndex: number
): { type: AssessmentQuestionType; marks?: number; negativeMarks?: number; source?: string } | null {
  const trimmed = line.trim().replace(/^[\*\#\_\-\s]+|[\*\#\_\-\s]+$/g, "");
  if (!trimmed) return null;

  const hasLeadingDigit = /^\d+[\.\):\-]\s*/.test(trimmed);
  if (!hasLeadingDigit) {
    return matchSectionHeader(trimmed);
  }

  const secInfo = matchSectionHeader(trimmed);
  if (!secInfo) return null;

  if (secInfo.type === "comprehension" || secInfo.type === "case_based") {
    return secInfo;
  }

  // If there is significant question text on the same line after the section name, it's a question
  const afterSection = trimmed
    .replace(/^\d+[\.\):\-]\s*/, "")
    .replace(
      /^(?:Multiple\s+Select(?:\s+Questions?)?|MCQs?|Multiple\s+Choice(?:\s+Questions?)?|Assertion\s*(?:&|and|-)\s*Reason(?:ing)?|True\s*[\/\\]\s*False|True[\/\\]False|True\s+and\s+False|True\s+or\s+False|T\/F|Very\s+Short\s+Answer(?:\s+Questions?)?|Short\s+Answer(?:\s+Questions?)?|Long\s+Answer(?:\s+Questions?)?|Case[\s\-]Based(?:\s+Questions?)?)[\:\.\-\s]*/i,
      ""
    )
    .trim();
  if (afterSection.length > 0 && !afterSection.startsWith("(") && !afterSection.startsWith("[")) {
    return null;
  }

  // Look ahead for the next non-empty, non-divider line
  for (let j = currentIndex + 1; j < lines.length; j++) {
    const nextLine = lines[j].trim();
    if (!nextLine || isIgnoredMarkerOrDivider(nextLine) || extractMetadataLine(nextLine, {})) {
      continue;
    }
    // If the next line is a numbered question or directions line or another header
    if (matchQuestionHeader(nextLine) || /^Directions\s*[\:\-]/i.test(nextLine) || matchSectionHeader(nextLine)) {
      return secInfo;
    }
    return null;
  }

  return secInfo;
}

/**
 * Detects whether a line is the beginning of a comprehension reading passage or case study
 */
export function detectComprehensionStart(line: string): { title: string; firstLine?: string; isCase?: boolean } | null {
  const trimmed = line.trim().replace(/^[\*\#\_\-\s]+|[\*\#\_\-\s]+$/g, "");
  if (!trimmed) return null;

  const isCase = /case/i.test(trimmed);

  const stripped = trimmed
    .replace(/^(?:(?:Part|Section)\s+[A-Za-z0-9]+[\s\:\-]+|\d+[\.\):\-]\s*)/i, "")
    .replace(/^[\*\#\_\-\s]+|[\*\#\_\-\s]+$/g, "")
    .trim();

  // Standalone comprehension headers
  for (const candidate of [trimmed, stripped]) {
    if (!candidate) continue;
    if (
      /^(?:(?:Section\s+[A-Za-z0-9]+[\s\:\-]+)?(?:Reading\s+)?Comprehension(?:\s+(?:Passage|Section|Questions?))?(?:\s*\d+)?|Passage(?:\s*\d+)?|Case\s+Study(?:\s*\d+)?)[\:\.]?$/i.test(
        candidate
      )
    ) {
      return { title: trimmed, isCase };
    }

    const phrasePattern =
      /^(?:(?:Section\s+[A-Za-z0-9]+[\s\:\-]+)?(?:Directions?\s*[\:\-]\s*)?)?(?:Read|Study|Examine|Consider)\s+(?:carefully\s+)?(?:the\s+)?(?:following\s+)?(?:passage|text|excerpt|story|poem|paragraph|case|information)?(?:\s+carefully)?(?:\s*(?:below|given\s+below|and\s+answer|and\s+choose|to\s+answer|questions?|that\s+follow)[\w\s\.,\:\-\(\)]*)?[\.\:\-]?$/i;

    if (phrasePattern.test(candidate)) {
      return { title: trimmed, isCase };
    }
  }

  // Heading with inline passage text on the same line
  const inlineMatch = trimmed.match(
    /^(?:(?:Section\s+[A-Za-z0-9]+[\s\:\-]+)?(?:Directions?\s*[\:\-]\s*)?)?((?:Read|Study|Examine|Consider)\s+(?:carefully\s+)?(?:the\s+)?(?:following\s+)?(?:passage|text|excerpt|story|poem|paragraph|case|information)?(?:\s+carefully)?(?:\s*(?:below|given\s+below|and\s+answer|and\s+choose|to\s+answer|questions?|that\s+follow)[\w\s\.,\:\-\(\)]*)?[\.\:\-])\s+(.+)$/i
  );

  if (inlineMatch) {
    const title = inlineMatch[1].trim();
    const firstLine = inlineMatch[2].trim();
    return { title, firstLine, isCase };
  }

  return null;
}

/**
 * Helper to detect parser markers, headers, and dividers to ignore
 */
function isIgnoredMarkerOrDivider(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^[⸻\-\=\_\*]{2,}$/.test(trimmed) || trimmed === "⸻") return true;
  if (
    /^(?:Sample\s+Test|Practice\s+Test|General\s+Instructions?|Time\s*:|Max\s*Marks\s*:|Total\s*Marks\s*:)/i.test(
      trimmed
    )
  ) {
    return true;
  }
  // Ignore "Answer the following questions." or "Directions: ..." lines when matching block boundaries
  if (
    /^(?:Answer\s+the\s+following\s+questions?[\.\:\-]?|Questions?\s+that\s+follow[\.\:\-]?)$/i.test(trimmed) ||
    /^Directions\s*[\:\-]\s*(?:Select\s+all\s+correct|Read\s+the\s+Assertion|State\s+whether)[\w\s\.,\:\-\(\)]*$/i.test(trimmed)
  ) {
    return true;
  }
  return false;
}

/**
 * Helper to detect question start lines (e.g. "Q1.", "Q2.", "1.", "2)", "15:", "30.", "Q1")
 */
function matchQuestionHeader(line: string): { qNum: number; remainder: string; hasExplicitQPrefix: boolean } | null {
  const trimmed = line.trim();
  // Match "Q1. ", "Q.1 ", "Q1) ", "Question 1: ", "Q1: ", "Q1"
  const qMatch = trimmed.match(/^(?:Q(?:uestion)?[\.\:\-]?\s*|\bQ\b\s*)(\d+)[\.\):\-]?\s*(.*)$/i);
  if (qMatch) {
    const num = parseInt(qMatch[1], 10);
    if (!isNaN(num)) {
      return {
        qNum: num,
        remainder: qMatch[2] ? qMatch[2].trim() : "",
        hasExplicitQPrefix: true
      };
    }
  }

  // Match plain digits "1. ", "2) ", "15: "
  const plainMatch = trimmed.match(/^(\d+)[\.\):\-]\s+(.*)$/);
  if (plainMatch) {
    const num = parseInt(plainMatch[1], 10);
    if (!isNaN(num)) {
      return {
        qNum: num,
        remainder: plainMatch[2] ? plainMatch[2].trim() : "",
        hasExplicitQPrefix: false
      };
    }
  }
  return null;
}

/**
 * Helper to match an MCQ or Multiple Select option line
 */
function matchOptionLine(line: string): { letter: string; text: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  // Ensure Assertion (A) or Reason (R) are not treated as option lines
  if (/^(?:Assertion|Reason)\b/i.test(trimmed)) {
    return null;
  }
  if (/^[\(\[]?(?:A|R)[\)\]]?\s*[:\-]?\s*(?:Assertion|Reason)\b/i.test(trimmed)) {
    return null;
  }
  if (/^Options?\s*[\:\-]?$/i.test(trimmed)) {
    return null;
  }
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
 * Normalizes question options so labels remain attached as complete strings
 */
export function normalizeQuestionOptions(options: string[]): string[] {
  if (!Array.isArray(options) || options.length === 0) return [];

  const rawList = options.map((opt) => String(opt || "").trim()).filter(Boolean);
  if (rawList.length === 0) return [];

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
  return merged.map((opt, idx) => {
    const expectedLetter = letters[idx] || String.fromCharCode(65 + idx);
    const match = opt.match(/^(?:Option\s+([A-Ea-e1-5])|([A-Ea-e1-5]))[\.\)\:\-]?\s*(.*)$/i);
    if (match) {
      const rawLetter = (match[1] || match[2] || expectedLetter).toUpperCase();
      const optText = (match[3] || "").trim();
      return `${rawLetter}. ${optText}`;
    } else {
      return `${expectedLetter}. ${opt}`;
    }
  });
}

/**
 * Parses raw pasted text into structured questions supporting all 9 question types,
 * dynamic marks detection, child-question relationships, and unlimited question counts.
 */
export function parseAssessmentText(
  rawText: string,
  context: {
    classGrade: string;
    subject: string;
    chapterNo: number;
    chapterName: string;
    topicName: string;
  }
): ParseResult {
  const errors: string[] = [];
  const questions: ParsedAssessmentQuestion[] = [];
  const metadata: ParsedMetadata = {};

  const text = rawText ? rawText.trim() : "";
  if (!text) {
    return {
      success: false,
      questions: [],
      errors: ["Please enter or paste questions text into the editor."],
      metadata
    };
  }

  // Normalize newlines
  const normalizedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Pre-process inline options if multiple options were pasted on a single line
  const processedText = normalizedText
    .replace(
      /(?<!\b(?:of|for|is|and|to|with|in|on|from|by|explanation|reason|assertion|both|neither|either|than))\s+([\(]?[B-Eb-e2-5][\.\)\:\-]\s+[^\n]+)/gi,
      (match, p1) => "\n" + p1.trim()
    )
    .replace(
      /([?:])\s+([\(]?[Aa1][\.\)\:\-]\s+[^\n]+)/g,
      (match, p1, p2) => p1 + "\n" + p2.trim()
    );

  const rawLines = processedText.split("\n");

  let currentSection: AssessmentQuestionType = "mcq";
  let currentSectionMarks: { marks: number; negativeMarks?: number; source: string; confidence: number } | null = null;

  let activePassage: {
    id: string;
    title: string;
    textLines: string[];
    questionCount: number;
    isCase?: boolean;
    sectionMarks?: { marks: number; negativeMarks?: number; source: string; confidence: number } | null;
  } | null = null;

  const allPassages: Map<string, { id: string; title: string; textLines: string[]; questionCount: number; isCase?: boolean }> = new Map();
  let passageCounter = 1;
  let caseCounter = 1;

  interface RawQuestionBlock {
    qNum: number;
    hasExplicitQPrefix?: boolean;
    section: AssessmentQuestionType;
    passageId?: string;
    caseId?: string;
    sectionMarks?: { marks: number; negativeMarks?: number; source: string; confidence: number } | null;
    lines: string[];
    rawBlockLines: string[];
  }

  const rawBlocks: RawQuestionBlock[] = [];
  let activeBlock: RawQuestionBlock | null = null;

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const trimmed = rawLine.trim();

    // Skip empty lines when no active block
    if (!trimmed) {
      if (activePassage && activePassage.questionCount === 0) {
        if (activePassage.textLines.length > 0 && activePassage.textLines[activePassage.textLines.length - 1] !== "") {
          activePassage.textLines.push("");
        }
      } else if (activeBlock && activeBlock.lines.length > 0) {
        activeBlock.lines.push("");
      }
      continue;
    }

    // 1. Check for metadata line
    if (extractMetadataLine(trimmed, metadata)) {
      continue;
    }

    // 2. Check for comprehension / case start heading
    const compMatch = detectComprehensionStart(trimmed);
    if (compMatch) {
      if (activeBlock) {
        rawBlocks.push(activeBlock);
        activeBlock = null;
      }
      // If we already have an activePassage with no questions and no text yet, update it instead of creating a second one
      if (activePassage && activePassage.questionCount === 0 && activePassage.textLines.length === 0) {
        activePassage.title = compMatch.title || activePassage.title;
        if (compMatch.firstLine) {
          activePassage.textLines.push(compMatch.firstLine);
        }
        continue;
      }
      const isCase = compMatch.isCase || currentSection === "case_based";
      const pId = isCase ? `case_${caseCounter++}` : `passage_${passageCounter++}`;
      activePassage = {
        id: pId,
        title: compMatch.title,
        textLines: compMatch.firstLine ? [compMatch.firstLine] : [],
        questionCount: 0,
        isCase,
        sectionMarks: currentSectionMarks
      };
      allPassages.set(pId, activePassage);
      continue;
    }

    // 3. Check for section headers (e.g. "1. MCQs (2 marks each)", "2. Multiple Select Questions", "5. True and False", "6. Very Short Answer Questions")
    const secInfo = isSectionHeaderWithLookahead(trimmed, rawLines, i);
    if (secInfo) {
      if (activeBlock) {
        rawBlocks.push(activeBlock);
        activeBlock = null;
      }

      currentSection = secInfo.type;
      currentSectionMarks = secInfo.marks ? {
        marks: secInfo.marks,
        negativeMarks: secInfo.negativeMarks,
        source: secInfo.source || "section_instruction",
        confidence: 0.98
      } : null;

      if (secInfo.type === "comprehension" || secInfo.type === "case_based") {
        if (activePassage && activePassage.questionCount === 0 && activePassage.textLines.length === 0) {
          activePassage.title = trimmed;
          activePassage.sectionMarks = currentSectionMarks;
          continue;
        }
        const isCase = secInfo.type === "case_based";
        const pId = isCase ? `case_${caseCounter++}` : `passage_${passageCounter++}`;
        activePassage = {
          id: pId,
          title: trimmed,
          textLines: [],
          questionCount: 0,
          isCase,
          sectionMarks: currentSectionMarks
        };
        allPassages.set(pId, activePassage);
      } else {
        activePassage = null;
      }
      continue;
    }

    // 4. Check for divider or other parser markers
    if (isIgnoredMarkerOrDivider(trimmed)) {
      continue;
    }

    // 5. Check if line starts a new numbered question
    const qHeader = matchQuestionHeader(trimmed);
    if (qHeader) {
      // If we are currently inside an active question block that has already seen an "Answer:" line:
      // A line starting with a plain number (e.g. "1. Improvement in...", "2. Faster transport...") without an explicit "Q" prefix
      // is a numbered list item inside the answer, NOT a new question, if the question started with "Q" or if the number <= activeBlock.qNum!
      const activeHasAnswer = activeBlock && activeBlock.lines.some((l) => /^(?:Correct\s*)?Ans(?:wer)?\s*[\:\-]/i.test(l));
      const isListItemInsideAnswer =
        activeBlock &&
        activeHasAnswer &&
        !qHeader.hasExplicitQPrefix &&
        (activeBlock.hasExplicitQPrefix || qHeader.qNum <= activeBlock.qNum);

      if (isListItemInsideAnswer) {
        activeBlock.lines.push(trimmed);
        activeBlock.rawBlockLines.push(rawLine);
        continue;
      }

      if (activeBlock) {
        rawBlocks.push(activeBlock);
      }
      if (activePassage) {
        activePassage.questionCount++;
      }

      let qSection = activePassage ? (activePassage.isCase ? "case_based" : "comprehension") : currentSection;

      // Inline type checks if specified in question text
      if (!activePassage && /^(?:True\s*[\/\\]\s*False|True[\/\\]False|T\/F|True\s+or\s+False)\b/i.test(qHeader.remainder)) {
        qSection = "true_false";
      } else if (!activePassage && /^(?:Assertion\s*(?:&|and|-)\s*Reason(?:ing)?)\b/i.test(qHeader.remainder)) {
        qSection = "assertion_reasoning";
      }

      activeBlock = {
        qNum: qHeader.qNum,
        hasExplicitQPrefix: qHeader.hasExplicitQPrefix,
        section: qSection,
        passageId: activePassage && !activePassage.isCase ? activePassage.id : undefined,
        caseId: activePassage && activePassage.isCase ? activePassage.id : undefined,
        sectionMarks: activePassage?.sectionMarks || currentSectionMarks,
        lines: qHeader.remainder ? [qHeader.remainder] : [],
        rawBlockLines: [rawLine]
      };
      continue;
    }

    // 6. If currently reading passage/case body before the first question
    if (activePassage && activePassage.questionCount === 0) {
      activePassage.textLines.push(trimmed);
      continue;
    }

    // 7. If we have an active question block, append line
    if (activeBlock) {
      activeBlock.lines.push(trimmed);
      activeBlock.rawBlockLines.push(rawLine);
    }
  }

  if (activeBlock) {
    rawBlocks.push(activeBlock);
  }

  console.log(`[AssessmentParser] Found ${rawBlocks.length} raw question candidate blocks and ${allPassages.size} passages/cases.`);

  // Consolidate comprehension passages and cases
  const passagesResult: Record<string, ComprehensionPassage> = {};
  const casesResult: Record<string, CaseStudy> = {};

  allPassages.forEach((pass) => {
    const cleanPassageText = pass.textLines.join("\n").trim();
    if (!cleanPassageText) {
      errors.push(`Section ("${pass.title}"): Missing reading passage/case text.`);
    } else if (pass.questionCount === 0) {
      errors.push(`Section ("${pass.title}"): Must contain at least one linked question.`);
    } else {
      const record = {
        id: pass.id,
        title: pass.title,
        text: cleanPassageText
      };
      if (pass.isCase) {
        casesResult[pass.id] = record;
      } else {
        passagesResult[pass.id] = record;
      }
      // Also register in passagesResult for unified parent lookup
      passagesResult[pass.id] = record;
    }
  });

  // Process each block individually
  rawBlocks.forEach((block) => {
    const cleanLines = block.lines
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !isIgnoredMarkerOrDivider(l) && !extractMetadataLine(l, metadata));

    const blockTypeLabel = block.passageId ? " (Comprehension)" : block.caseId ? " (Case-Based)" : "";

    if (cleanLines.length === 0) {
      errors.push(`Question #${block.qNum}${blockTypeLabel}: Skipped - empty question block.`);
      return;
    }

    // Extract explicit "Answer: ..." line if present
    let explicitCorrectAnswer = "";
    const remainingLines: string[] = [];
    let isReadingMultiLineAnswer = false;
    const multiLineAnswerParts: string[] = [];

    cleanLines.forEach((l) => {
      const caMatch = l.match(/^(?:Correct\s*)?Ans(?:wer)?\s*[:\-]\s*(.*)$/i);
      if (caMatch) {
        isReadingMultiLineAnswer = true;
        const inlineAns = caMatch[1].trim();
        if (inlineAns) {
          multiLineAnswerParts.push(inlineAns);
        }
      } else if (isReadingMultiLineAnswer) {
        multiLineAnswerParts.push(l);
      } else {
        remainingLines.push(l);
      }
    });

    if (multiLineAnswerParts.length > 0) {
      explicitCorrectAnswer = multiLineAnswerParts.join("\n").trim();
    }

    // Extract image labels if present
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

    if (linesAfterImage.length === 0) {
      errors.push(`Question #${block.qNum}${blockTypeLabel}: Skipped - missing question text.`);
      return;
    }

    const fullBlockText = linesAfterImage.join("\n");

    // Dynamic Marks Detection for this question:
    // Priority: Question-level explicit marks > Group/Section instructions > Type-inferred default
    let questionMarks = 1;
    let questionNegMarks: number | undefined;
    let marksSource = "default_inferred";
    let marksConfidence = 0.50;
    let marksPending = true;

    // Check Question-level explicit marks
    const qMarks = extractMarksInfo(cleanLines[0]) || extractMarksInfo(fullBlockText);
    if (qMarks) {
      questionMarks = qMarks.marks;
      questionNegMarks = qMarks.negativeMarks;
      marksSource = "question_label";
      marksConfidence = qMarks.confidence;
      marksPending = false;
    } else if (block.sectionMarks) {
      questionMarks = block.sectionMarks.marks;
      questionNegMarks = block.sectionMarks.negativeMarks;
      marksSource = block.sectionMarks.source;
      marksConfidence = block.sectionMarks.confidence;
      marksPending = false;
    }

    // Determine Question Type
    const optionIndices: number[] = [];
    linesAfterImage.forEach((l, i) => {
      if (matchOptionLine(l)) {
        optionIndices.push(i);
      }
    });

    const hasOptions = optionIndices.length >= 2;

    const isExplicitTF = block.section === "true_false";
    const hasTFAnswer =
      (explicitCorrectAnswer.toLowerCase() === "true" ||
        explicitCorrectAnswer.toLowerCase() === "false" ||
        explicitCorrectAnswer.toLowerCase() === "t" ||
        explicitCorrectAnswer.toLowerCase() === "f");
    const isTFQuestion = isExplicitTF || (!hasOptions && hasTFAnswer);

    const isAssertion =
      block.section === "assertion_reasoning" ||
      block.section === "assertion_reason" ||
      /Assertion\s*\([A-Za-z]\)/i.test(fullBlockText) ||
      /Reason\s*\([A-Za-z]\)/i.test(fullBlockText);

    const isMultipleSelect =
      block.section === "multiple_select" ||
      (/^[A-E]\s*,\s*[A-E]/i.test(explicitCorrectAnswer) || /^[A-E]\s*,\s*[A-E]\s*(?:and|&)\s*[A-E]/i.test(explicitCorrectAnswer));

    // Handle True / False
    if (isTFQuestion) {
      const statementLines = linesAfterImage.filter(
        (l) =>
          !/^(?:True|False)\s*[✅❌]?$/i.test(l) &&
          !/^[A-B][\.\)]\s*(?:True|False)/i.test(l) &&
          !/^(?:Option\s+[A-B]|[A-B][\.\)\:\-])$/i.test(l) &&
          !/^(?:True\s*[\/\\]\s*False|True[\/\\]False|T\/F|True\s+or\s+False)[\:\.]?$/i.test(l)
      );

      let cleanQuestion = statementLines
        .join(" ")
        .replace(/^(?:True\s*[\/\\]\s*False|True[\/\\]False|T\/F|True\s+or\s+False)[\:\.\-\s]*/gi, "")
        .replace(/—\s*(True|False)\s*[✅❌]?/gi, "")
        .replace(/-\s*(True|False)\s*[✅❌]?/gi, "")
        .replace(/\b(True|False)\s*[✅❌]?$/gi, "")
        .replace(/[✅❌]/g, "")
        .trim();

      let resolvedAnswer = "";
      if (hasTFAnswer) {
        const ca = explicitCorrectAnswer.toLowerCase();
        resolvedAnswer = ca.startsWith("true") || ca === "t" ? "True" : "False";
      } else if (fullBlockText.includes("True ✅") || fullBlockText.includes("— True") || fullBlockText.includes("- True")) {
        resolvedAnswer = "True";
      } else if (fullBlockText.includes("False ❌") || fullBlockText.includes("False ✅") || fullBlockText.includes("— False") || fullBlockText.includes("- False")) {
        resolvedAnswer = "False";
      }

      if (!cleanQuestion) {
        errors.push(`Question #${block.qNum} (True/False): Empty True/False statement.`);
        return;
      }
      if (!resolvedAnswer) {
        errors.push(`Question #${block.qNum} (True/False): Missing valid answer (True or False).`);
        return;
      }

      questions.push({
        id: `q_tf_${block.qNum}_${Math.random().toString(36).substring(2, 7)}`,
        classGrade: context.classGrade,
        subject: context.subject,
        chapterNo: context.chapterNo,
        chapterName: context.chapterName,
        topicName: context.topicName,
        type: "true_false",
        question: cleanQuestion,
        options: ["True", "False"],
        correctAnswer: resolvedAnswer,
        marks: questionMarks,
        negativeMarks: questionNegMarks,
        marksSource,
        marksConfidence,
        marksPending,
        imageLabel: extractedImageLabel || undefined,
        rawText: block.rawBlockLines.join("\n")
      });
      return;
    }

    // Handle Subjective Questions (No options found, or explicitly VSA / SA / LA / Subjective Comprehension / Case-Based)
    if (!hasOptions) {
      let subjectiveType: AssessmentQuestionType = "short_answer";
      if (block.section === "very_short_answer") {
        subjectiveType = "very_short_answer";
      } else if (block.section === "long_answer") {
        subjectiveType = "long_answer";
      } else if (block.caseId || block.section === "case_based") {
        subjectiveType = "short_answer"; // Subjective case-based child question
      } else if (block.passageId) {
        subjectiveType = "short_answer"; // Subjective comprehension child question
      }

      const questionText = linesAfterImage
        .filter((l) => 
          l.toLowerCase() !== "question:" &&
          !/^Options?\s*[\:\-]?$/i.test(l) &&
          !/^(?:Very\s+Short|Short|Long)\s+Answer[\:\.]?$/i.test(l)
        )
        .join("\n")
        .trim();

      if (!questionText) {
        errors.push(`Question #${block.qNum}${blockTypeLabel}: Empty question text.`);
        return;
      }

      if (!explicitCorrectAnswer) {
        errors.push(`Question #${block.qNum}${blockTypeLabel}: Missing answer text. Include 'Answer: [model answer]'.`);
        return;
      }

      questions.push({
        id: `q_${subjectiveType}_${block.qNum}_${Math.random().toString(36).substring(2, 7)}`,
        classGrade: context.classGrade,
        subject: context.subject,
        chapterNo: context.chapterNo,
        chapterName: context.chapterName,
        topicName: context.topicName,
        type: subjectiveType,
        question: questionText,
        options: [],
        correctAnswer: explicitCorrectAnswer,
        modelAnswer: explicitCorrectAnswer,
        isSubjective: true,
        marks: questionMarks,
        negativeMarks: questionNegMarks,
        marksSource,
        marksConfidence,
        marksPending,
        passageId: block.passageId,
        parentPassageId: block.passageId,
        caseId: block.caseId,
        parentCaseId: block.caseId,
        imageLabel: extractedImageLabel || undefined,
        rawText: block.rawBlockLines.join("\n")
      });
      return;
    }

    // Objective Questions with Options (MCQ, Multiple Select, Assertion & Reasoning)
    const firstOptIdx = optionIndices[0];
    const rawQLines = linesAfterImage
      .slice(0, firstOptIdx)
      .filter((l) => 
        l.toLowerCase() !== "question:" &&
        !/^Options?\s*[\:\-]?$/i.test(l) &&
        !/^(?:Assertion\s*(?:&|and|-)\s*Reason(?:ing)?|Multiple\s+Choice(?:\s+Questions?)?|MCQs?|Multiple\s+Select)[\:\.]?$/i.test(l.trim())
      );
    const questionText = rawQLines.join("\n").trim();

    if (!questionText) {
      errors.push(`Question #${block.qNum}${blockTypeLabel}: Empty question text.`);
      return;
    }

    const optLines = linesAfterImage.slice(firstOptIdx);
    const rawParsedOptions: string[] = [];
    const markedCheckmarkLetters: string[] = [];

    optLines.forEach((optLine) => {
      const optMatch = matchOptionLine(optLine);
      if (optMatch) {
        const letter = optMatch.letter;
        let optVal = optMatch.text;

        const isCheckMark =
          optVal.includes("✅") ||
          /\(correct\)/i.test(optVal) ||
          /\(answer\)/i.test(optVal);

        optVal = optVal
          .replace(/[✅❌]/g, "")
          .replace(/\s*\(trap\)/gi, "")
          .replace(/\s*\(correct\)/gi, "")
          .replace(/\s*\(answer\)/gi, "")
          .trim();

        if (isCheckMark) {
          markedCheckmarkLetters.push(letter);
        }

        if (optVal) {
          rawParsedOptions.push(`${letter}. ${optVal}`);
        } else {
          rawParsedOptions.push(`${letter}.`);
        }
      } else if (optLine.trim() && !/^Options?\s*[\:\-]?$/i.test(optLine.trim())) {
        if (rawParsedOptions.length > 0) {
          const lastIdx = rawParsedOptions.length - 1;
          const lastOpt = rawParsedOptions[lastIdx];
          if (lastOpt.endsWith(".")) {
            rawParsedOptions[lastIdx] = `${lastOpt} ${optLine.trim()}`;
          } else {
            rawParsedOptions[lastIdx] += " " + optLine.trim();
          }
        }
      }
    });

    const parsedOptions = normalizeQuestionOptions(rawParsedOptions);

    if (parsedOptions.length < 2) {
      errors.push(`Question #${block.qNum}${blockTypeLabel}: Requires at least two valid options.`);
      return;
    }

    // Resolve Multiple Select vs Single MCQ vs Assertion
    let resolvedType: AssessmentQuestionType = "mcq";
    if (isMultipleSelect) {
      resolvedType = "multiple_select";
    } else if (isAssertion) {
      resolvedType = "assertion_reasoning";
    }

    let resolvedAnswer = "";
    if (resolvedType === "multiple_select") {
      // Multiple Select resolution
      if (explicitCorrectAnswer) {
        // Match letters like "A, B and C" or "A, B, C" or "A, B"
        const letters = Array.from(new Set(
          (explicitCorrectAnswer.match(/\b([A-Ea-e])\b/g) || []).map((l) => l.toUpperCase())
        )).sort();
        if (letters.length > 0) {
          resolvedAnswer = letters.join(", ");
        }
      }
      if (!resolvedAnswer && markedCheckmarkLetters.length > 0) {
        resolvedAnswer = Array.from(new Set(markedCheckmarkLetters)).sort().join(", ");
      }
      if (!resolvedAnswer) {
        errors.push(`Question #${block.qNum}${blockTypeLabel}: Missing valid answers for Multiple Select question.`);
        return;
      }
    } else {
      // Single MCQ / Assertion resolution
      if (markedCheckmarkLetters.length > 1) {
        // If multiple checkmarks, convert to multiple_select
        resolvedType = "multiple_select";
        resolvedAnswer = Array.from(new Set(markedCheckmarkLetters)).sort().join(", ");
      } else {
        if (explicitCorrectAnswer) {
          const letterMatch = explicitCorrectAnswer.match(/(?:Option\s*)?([A-Ea-e1-5])/i);
          if (letterMatch) {
            let letter = letterMatch[1].toUpperCase();
            if (["1", "2", "3", "4", "5"].includes(letter)) {
              const numMap: Record<string, string> = { "1": "A", "2": "B", "3": "C", "4": "D", "5": "E" };
              letter = numMap[letter] || "A";
            }
            resolvedAnswer = letter;
          }
        }

        const inlineCorrectAnswer = markedCheckmarkLetters.length === 1 ? markedCheckmarkLetters[0] : "";
        if (resolvedAnswer && inlineCorrectAnswer && resolvedAnswer !== inlineCorrectAnswer) {
          errors.push(`Question #${block.qNum}${blockTypeLabel}: Conflicting correct answers found (Option ${inlineCorrectAnswer} marked with ✅, but Correct Answer specifies Option ${resolvedAnswer}).`);
          return;
        }

        if (!resolvedAnswer && inlineCorrectAnswer) {
          resolvedAnswer = inlineCorrectAnswer;
        }

        if (!resolvedAnswer) {
          errors.push(`Question #${block.qNum}${blockTypeLabel}: Missing valid Correct Answer. Include 'Answer: [Option]' or mark with ✅.`);
          return;
        }

        const availableLetters = parsedOptions.map((o) => o.charAt(0));
        if (!availableLetters.includes(resolvedAnswer)) {
          errors.push(`Question #${block.qNum}${blockTypeLabel}: Correct Answer '${resolvedAnswer}' does not match available options.`);
          return;
        }
      }
    }

    questions.push({
      id: `q_${resolvedType}_${block.qNum}_${Math.random().toString(36).substring(2, 7)}`,
      classGrade: context.classGrade,
      subject: context.subject,
      chapterNo: context.chapterNo,
      chapterName: context.chapterName,
      topicName: context.topicName,
      type: resolvedType,
      question: questionText,
      options: parsedOptions,
      correctAnswer: resolvedAnswer,
      explanation: explicitCorrectAnswer.length > 5 ? explicitCorrectAnswer : undefined,
      marks: questionMarks,
      negativeMarks: questionNegMarks,
      marksSource,
      marksConfidence,
      marksPending,
      passageId: block.passageId,
      parentPassageId: block.passageId,
      caseId: block.caseId,
      parentCaseId: block.caseId,
      imageLabel: extractedImageLabel || undefined,
      rawText: block.rawBlockLines.join("\n")
    });
  });

  console.log(`[AssessmentParser] Successfully processed ${questions.length} questions. Passages: ${Object.keys(passagesResult).length}. Cases: ${Object.keys(casesResult).length}. Errors: ${errors.length}`);

  return {
    success: questions.length > 0,
    questions,
    passages: passagesResult,
    cases: casesResult,
    errors,
    metadata
  };
}

// ----------------------------------------------------
// LOCAL STORAGE & PERSISTENCE HELPERS
// ----------------------------------------------------

import { 
  getLocalTestBank as getAllPracticeTests,
  getTopicPracticeTestSync as getTopicPracticeTest,
  getTopicPracticeTestSync,
  getTopicPracticeTest as getTopicPracticeTestAsync,
  saveTopicPracticeTest as saveServiceTopicTest,
  deleteTopicPracticeTest as deleteServiceTopicTest,
  getFullChapterQuestionsSync as getFullChapterQuestions,
  fetchAllPracticeTests
} from "../lib/practiceTestService";

export { 
  getAllPracticeTests, 
  getTopicPracticeTest, 
  getTopicPracticeTestSync,
  getTopicPracticeTestAsync,
  getFullChapterQuestions, 
  fetchAllPracticeTests
};

export function saveTopicPracticeTest(test: TopicPracticeTest): void {
  saveServiceTopicTest(
    {
      classGrade: test.classGrade,
      subject: test.subject,
      chapterNo: test.chapterNo,
      chapterName: test.chapterName,
      topicName: test.topicName,
      rawText: test.rawText
    },
    test.questions
  );
}

export function deleteTopicPracticeTest(testIdOrTopic: string): void {
  const parts = testIdOrTopic.split("__");
  if (parts.length >= 4) {
    const classGrade = parts[0].replace(/_/g, " ");
    const subject = parts[1].replace(/_/g, " ");
    const chapterNo = parseInt(parts[2].replace("ch", ""), 10) || 1;
    const topicName = parts.slice(3).join("__");
    deleteServiceTopicTest(classGrade, subject, chapterNo, topicName);
  } else {
    const all = getAllPracticeTests();
    delete all[testIdOrTopic];
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("practice-tests-updated"));
    }
  }
}

// ----------------------------------------------------
// TEST ATTEMPTS HELPERS
// ----------------------------------------------------

import { 
  getLocalTestAttempts, 
  subscribeToTestAttempts,
  saveLocalTestAttemptsCache
} from "../lib/firestoreService";
import {
  savePracticeTestAttempt,
  fetchStudentTestAttempts,
  getCachedAttemptsFromMemory,
  mergeAttemptsIntoMemoryAndCache,
  notifyScoreUpdate,
  fetchTestAttemptsFromR2Storage
} from "../lib/testScorePersistence";

export { subscribeToTestAttempts, fetchStudentTestAttempts };

if (typeof window !== "undefined") {
  (async () => {
    try {
      const remote = await fetchTestAttemptsFromR2Storage();
      if (remote && remote.length > 0) {
        const local = getLocalTestAttempts();
        const mergedMap = new Map<string, TestAttemptRecord>();
        for (const item of remote) {
          if (item && item.id) mergedMap.set(item.id, item);
        }
        for (const item of local) {
          if (item && item.id) mergedMap.set(item.id, item);
        }
        const mergedList = Array.from(mergedMap.values());
        mergedList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        saveLocalTestAttemptsCache(mergedList);
      }
    } catch (e) {
      console.warn("[AssessmentParser] Bootstrapping attempts from R2 storage warning:", e);
    }
  })();
}

export function getAllTestAttempts(): TestAttemptRecord[] {
  return getCachedAttemptsFromMemory();
}

export function saveTestAttempt(attempt: TestAttemptRecord): void {
  try {
    mergeAttemptsIntoMemoryAndCache([attempt]);
    notifyScoreUpdate();
  } catch (localErr) {
    console.warn("[AssessmentParser] Local attempt cache error:", localErr);
  }

  savePracticeTestAttempt(attempt).catch((err) => {
    console.warn("[AssessmentParser] saveTestAttempt error:", err);
  });
}

export function getStudentTestAttempts(
  studentIdentifier: string = "",
  classGrade?: string,
  subject?: string,
  chapterNo?: number,
  topicName?: string,
  testType?: AssessmentTestType
): TestAttemptRecord[] {
  const all = getAllTestAttempts();
  const normIdent = (studentIdentifier || "").toLowerCase().trim();
  const normClass = (classGrade || "").toLowerCase().trim();
  const normSubj = (subject || "").toLowerCase().trim();
  const normTopic = (topicName || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");
  const normType = String(testType || "").toLowerCase().trim();

  if (studentIdentifier && all.length === 0) {
    fetchStudentTestAttempts(studentIdentifier).catch(() => {});
  }

  return all.filter((a) => {
    if (studentIdentifier) {
      const matchId = (a.studentId || "").toLowerCase().trim() === normIdent;
      const matchName = (a.studentName || "").toLowerCase().trim() === normIdent;
      if (!matchId && !matchName) return false;
    }
    if (normType) {
      const aType = String(a.testType || "").toLowerCase().trim();
      const isBothChapter = (normType === "chapter" || normType === "full_chapter") && (aType === "chapter" || aType === "full_chapter");
      if (aType !== normType && !isBothChapter) return false;
    }
    if (classGrade) {
      const aClass = (a.classGrade || "").toLowerCase().trim();
      if (aClass && normClass && aClass !== normClass && !aClass.includes(normClass) && !normClass.includes(aClass)) return false;
    }
    if (subject) {
      const aSubj = (a.subject || "").toLowerCase().trim();
      if (aSubj && normSubj && aSubj !== normSubj && !aSubj.includes(normSubj) && !normSubj.includes(aSubj)) return false;
    }
    if (chapterNo !== undefined && normType !== "subject" && Number(a.chapterNo) !== Number(chapterNo)) return false;
    if (topicName && (normType === "topic" || !normType)) {
      const aTopic = (a.topicName || "").toLowerCase().trim().replace(/[^a-z0-9]/g, "");
      return aTopic === normTopic || aTopic.includes(normTopic) || normTopic.includes(aTopic);
    }
    return true;
  });
}

export function getStudentNextAttemptNumber(
  studentId: string,
  classGrade: string,
  subject: string,
  chapterNo: number,
  topicName: string,
  testType: AssessmentTestType = "topic"
): number {
  const existing = getStudentTestAttempts(
    studentId,
    classGrade,
    subject,
    chapterNo,
    topicName,
    testType
  );
  return existing.length + 1;
}
