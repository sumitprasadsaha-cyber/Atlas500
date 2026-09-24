import {
  AssessmentQuestionType,
  ParsedAssessmentQuestion,
  ComprehensionPassage,
  CaseStudy
} from "../types";

/**
 * Convert Devanagari numerals or ASCII digits into standard numbers
 */
export function parseNumberOrDevanagari(raw: string | number): number | null {
  if (typeof raw === "number") return isNaN(raw) ? null : raw;
  if (!raw) return null;
  const devanagariDigits = "०१२३४५६७८९";
  let asciiStr = "";
  for (const ch of String(raw).trim()) {
    const idx = devanagariDigits.indexOf(ch);
    if (idx !== -1) {
      asciiStr += idx;
    } else if (/[0-9]/.test(ch)) {
      asciiStr += ch;
    }
  }
  if (!asciiStr) return null;
  const parsed = parseInt(asciiStr, 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Maps Devanagari, numeric, or ASCII option symbols to standardized uppercase letters ('A', 'B', 'C', 'D', 'E')
 */
export function mapDevanagariOrAsciiOptionLetter(charOrStr: string): string {
  if (!charOrStr) return "A";
  const trimmed = charOrStr.trim();
  const map: Record<string, string> = {
    "क": "A", "ख": "B", "ग": "C", "घ": "D", "ङ": "E",
    "अ": "A", "ब": "B", "स": "C", "द": "D", "य": "E",
    "1": "A", "2": "B", "3": "C", "4": "D", "5": "E",
    "१": "A", "२": "B", "३": "C", "४": "D", "५": "E",
    "A": "A", "B": "B", "C": "C", "D": "D", "E": "E",
    "a": "A", "b": "B", "c": "C", "d": "D", "e": "E"
  };
  return map[trimmed] || (trimmed.length === 1 ? trimmed.toUpperCase() : "A");
}

/**
 * Supported 9+ CBSE-style Question Types and Grouping Types
 */
export type ChapterTestQuestionType =
  | "mcq"
  | "multiple_select"
  | "msq"
  | "assertion_reason"
  | "assertion_reasoning"
  | "comprehension"
  | "true_false"
  | "very_short_answer"
  | "short_answer"
  | "long_answer"
  | "case_based"
  | "fill_blank"
  | "match_following"
  | "unknown";

export interface ParsedOption {
  letter: string; // "A", "B", "C", "D"
  text: string;   // Option text without label
  raw: string;    // Full formatted option string, e.g. "A. Plants and animals"
}

export interface ParsedQuestion {
  id: string;
  questionNumber: number | string;
  displayNumber?: string;
  type: ChapterTestQuestionType;
  sectionId?: string;
  sectionLetter?: string;
  sectionTitle?: string;
  sectionType?: string;
  instruction?: string;
  question: string;
  assertion?: string;
  reason?: string;
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
  parentPassageId?: string;
  caseId?: string;
  parentCaseId?: string;
  isSubQuestion?: boolean;
  passage?: string;
  caseStudy?: string;
  groupId?: string;
  groupType?: string;
  groupTitle?: string;
  groupContent?: string;
  declaredSectionMarks?: number;
  calculatedSectionMarks?: number;
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
  declaredMarks?: number;
  negativeMarks?: number;
  marksInfo?: {
    marks: number;
    negativeMarks?: number;
    source: string;
    confidence: number;
  };
  calculatedSectionMarks?: number;
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
export function getQuestionTypeDisplayName(type: string, isChild = false): string {
  const norm = String(type || "").toLowerCase().trim();
  switch (norm) {
    case "mcq":
      return "Multiple Choice";
    case "multiple_select":
    case "msq":
      return "Multiple Select";
    case "assertion_reason":
    case "assertion_reasoning":
      return "Assertion and Reasoning";
    case "true_false":
      return "True or False";
    case "very_short_answer":
      return "Very Short Answer";
    case "short_answer":
      return "Short Answer";
    case "long_answer":
      return "Long Answer";
    case "case_based":
      return isChild ? "Case-Based Question" : "Case-Based Group";
    case "comprehension":
      return isChild ? "Comprehension Question" : "Comprehension Group";
    case "fill_blank":
    case "fill_in_the_blank":
    case "fill_in_the_blanks":
      return "Fill in the Blanks";
    case "match_following":
      return "Match the Following";
    case "unknown":
      return "Needs Review";
    default:
      return norm ? norm.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Needs Review";
  }
}

/**
 * Extract CBSE section marks formula e.g. "5 × 1 = 5 Marks", "(4 x 1 = 4)", "2 * 5 = 10 Marks", "5 × 1 = 5 अंक"
 */
export function extractSectionMarksFormula(text: string): {
  count: number;
  questionCount: number;
  marksPerQuestion: number;
  declaredSectionMarks: number;
  totalMarks: number;
} | null {
  if (!text) return null;
  const match = text.match(
    /(?:\(|\{|\[)?\s*(\d+|[०-९]+)\s*(?:[×\*xX]|times)\s*(\d+(?:\.\d+)?|[०-९]+)\s*=\s*(\d+(?:\.\d+)?|[०-९]+)\s*(?:marks?|pts?|points?|अंक|मार्क्स)?\s*(?:\)|\}|\])?/i
  );
  if (match) {
    const count = parseNumberOrDevanagari(match[1]);
    const marksPerQuestion = parseFloat(match[2].replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d))));
    const declaredSectionMarks = parseFloat(match[3].replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d))));
    if (count !== null && !isNaN(marksPerQuestion) && !isNaN(declaredSectionMarks)) {
      return {
        count,
        questionCount: count,
        marksPerQuestion,
        declaredSectionMarks,
        totalMarks: declaredSectionMarks
      };
    }
  }
  return null;
}

/**
 * Extract marks and negative marks from string (supports English, Hindi, and Nepali)
 */
export function extractMarks(text: string): {
  marks: number;
  negativeMarks?: number;
  source: string;
  confidence: number;
} | null {
  if (!text) return null;

  // Formula check first: "5 × 1 = 5 Marks", "5 x 1 = 5", "5 × 1 = 5 अंक"
  const formula = extractSectionMarksFormula(text);
  if (formula) {
    return {
      marks: formula.marksPerQuestion,
      source: "section_instruction",
      confidence: 1.0
    };
  }

  let negativeMarks: number | undefined;
  const negMatch =
    text.match(/(?:negative|minus|deduction|ऋणात्मक)\s*(?:marking|marks?|अंक)?[\:\s]+-?(\d+(?:\.\d+)?|[०-९]+)/i) ||
    text.match(/\[\s*-(?:mark|marks|अंक)?\s*(\d+(?:\.\d+)?|[०-९]+)\s*\]/i) ||
    text.match(/\(\s*-(\d+(?:\.\d+)?|[०-९]+)\s*(?:marks?|pts?|अंक)?\s*\)/i);
  if (negMatch) {
    const parsedNeg = parseFloat(negMatch[1].replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d))));
    if (!isNaN(parsedNeg)) negativeMarks = parsedNeg;
  }

  // 1. Explicit "(2 marks each)", "[3 Marks]", "(1 mark)", "(2 Marks)", "[1 अंक]", "(2 अंक)", "[5 अंक]"
  const eachMatch = text.match(
    /(?:\(|\{|\[)\s*(?:mark|marks|अंक|मार्क्स)?\s*(\d+(?:\.\d+)?|[०-९]+)\s*(?:marks?|pts?|points?|अंक|मार्क्स)?\s*(?:each|प्रत्येक)?\s*(?:\)|\}|\])/i
  );
  if (eachMatch) {
    const val = parseFloat(eachMatch[1].replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d))));
    if (!isNaN(val) && val > 0 && val <= 50) {
      return {
        marks: val,
        negativeMarks,
        source: /each|प्रत्येक/i.test(eachMatch[0]) ? "section_instruction" : "question_label",
        confidence: 0.99
      };
    }
  }

  // 2. Dash / separator followed by marks: "— 3 marks", "- 2 marks", "– 5 Marks", "— 3 अंक", "– 5 अंक"
  const dashMatch = text.match(
    /(?:[\—\–\-]|\,\s*)\s*(\d+(?:\.\d+)?|[०-९]+)\s*(?:marks?|pts?|points?|अंक|मार्क्स)(?:\s+(?:each|प्रत्येक))?(?:\s*$|\s*[\r\n])/i
  );
  if (dashMatch) {
    const val = parseFloat(dashMatch[1].replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d))));
    if (!isNaN(val) && val > 0 && val <= 50) {
      return {
        marks: val,
        negativeMarks,
        source: /each|प्रत्येक/i.test(dashMatch[0]) ? "section_instruction" : "question_label",
        confidence: 0.99
      };
    }
  }

  // 3. Marks label: "Marks: 5", "Mark: 2", "अंक: 2", "अंक : 5", "[Marks: 3]"
  const labelMatch = text.match(/(?:marks?|pts?|points?|score|अंक|मार्क्स)[\:\s]+(\d+(?:\.\d+)?|[०-९]+)/i);
  if (labelMatch) {
    const val = parseFloat(labelMatch[1].replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d))));
    if (!isNaN(val) && val > 0 && val <= 50) {
      return {
        marks: val,
        negativeMarks,
        source: "question_label",
        confidence: 1.0
      };
    }
  }

  // 4. "carries 2 marks", "carry 1 mark each", "worth 5 marks"
  const carryMatch = text.match(/(?:carries|carry|worth)\s+(\d+(?:\.\d+)?|[०-९]+)\s*(?:marks?|pts?|अंक)/i);
  if (carryMatch) {
    const val = parseFloat(carryMatch[1].replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d))));
    if (!isNaN(val) && val > 0 && val <= 50) {
      return {
        marks: val,
        negativeMarks,
        source: /each|प्रत्येक/i.test(carryMatch[0]) ? "section_instruction" : "question_label",
        confidence: 0.98
      };
    }
  }

  // 5. Standalone bracketed/parenthesized number at end of string e.g. "(5)", "[3]", "(1)", "(२)"
  const bracketMatch = text.match(/(?:^|\s)[\(\[]\s*(\d+(?:\.\d+)?|[०-९]+)\s*[\)\]](?:\s*$|\s*[\r\n])/);
  if (bracketMatch) {
    const val = parseFloat(bracketMatch[1].replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d))));
    if (!isNaN(val) && val > 0 && val <= 50) {
      return {
        marks: val,
        negativeMarks,
        source: "question_label",
        confidence: 0.96
      };
    }
  }

  // 6. Parenthesized marks right after question number: "1. (2) Explain...", "Q1. (5) Explain...", "प्रश्न 1. [1 अंक] ..."
  const inlineAfterNumMatch = text.match(
    /^(?:Q(?:uestion)?\s*\d+|\d+|[ivxlcdm]+|\([ivxlcdm]+\)|(?:प्रश्न(?:\s*संख्या|\s*नं[\.]?)?|प्र[\.०]?)\s*[:\.\-—–।]?\s*(?:\d+|[०-९]+))\s*[\.\)\:\-—–।]?\s*[\(\[]\s*(?:mark|marks|अंक|मार्क्स)?\s*(\d+(?:\.\d+)?|[०-९]+)\s*(?:marks?|pts?|अंक|मार्क्स)?\s*[\)\]]/i
  );
  if (inlineAfterNumMatch) {
    const val = parseFloat(inlineAfterNumMatch[1].replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d))));
    if (!isNaN(val) && val > 0 && val <= 50) {
      return {
        marks: val,
        negativeMarks,
        source: "question_label",
        confidence: 0.98
      };
    }
  }

  // 7. Dash followed by standalone number at end of line: "Q1. Explain photosynthesis — 3", "प्रश्न 1. ... — 1"
  const dashNumMatch = text.match(/(?:[\—\–\-])\s*(\d+(?:\.\d+)?|[०-९]+)\s*$/);
  if (dashNumMatch) {
    const val = parseFloat(dashNumMatch[1].replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d))));
    if (!isNaN(val) && val > 0 && val <= 50) {
      return {
        marks: val,
        negativeMarks,
        source: "question_label",
        confidence: 0.94
      };
    }
  }

  // 8. General "X marks" or "X marks each", "X अंक"
  const generalMarksMatch = text.match(/\b(\d+(?:\.\d+)?|[०-९]+)\s*(?:marks?|pts?|points?|अंक|मार्क्स)(?:\s+(?:each|प्रत्येक))?/i);
  if (generalMarksMatch) {
    const val = parseFloat(generalMarksMatch[1].replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d))));
    if (!isNaN(val) && val > 0 && val <= 50) {
      return {
        marks: val,
        negativeMarks,
        source: /each|प्रत्येक/i.test(generalMarksMatch[0]) ? "section_instruction" : "question_label",
        confidence: 0.92
      };
    }
  }

  return null;
}

/**
 * Strips marks tags from question text so question labels and prompts display cleanly.
 * e.g. "Explain photosynthesis. (2 Marks)" -> "Explain photosynthesis."
 * e.g. "‘सुंदर’ शब्द का विलोम क्या है? [1 अंक]" -> "‘सुंदर’ शब्द का विलोम क्या है?"
 */
export function stripMarksFromQuestionText(text: string): string {
  if (!text) return text;
  let cleaned = text;

  // 1. Trailing dash/separator with marks: " — 3 marks", " — 1 अंक", " – 5 Marks", " — 5"
  cleaned = cleaned.replace(/\s*(?:[\—\–\-]|\,\s*)\s*(?:\d+(?:\.\d+)?|[०-९]+)\s*(?:marks?|pts?|points?|अंक|मार्क्स)?\s*$/i, "");

  // 2. Trailing bracketed/parenthesized marks: " [1 अंक]", " (2 Marks)", " [3 Marks]", " (5)", " [1]"
  cleaned = cleaned.replace(/\s*[\(\[]\s*(?:mark|marks|अंक|मार्क्स)?\s*(?:\d+(?:\.\d+)?|[०-९]+)\s*(?:marks?|pts?|points?|अंक|मार्क्स)?\s*[\)\]]\s*$/i, "");

  // 3. Leading bracketed marks: "(2 Marks) Explain...", "[1 अंक] सुंदर..."
  cleaned = cleaned.replace(/^[\(\[]\s*(?:mark|marks|अंक|मार्क्स)?\s*(?:\d+(?:\.\d+)?|[०-९]+)\s*(?:marks?|pts?|points?|अंक|मार्क्स)?\s*[\)\]]\s*/i, "");

  // 4. Inline "(2 Marks)", "[1 अंक]"
  cleaned = cleaned.replace(/\s*[\(\[]\s*(?:mark|marks|अंक|मार्क्स)?\s*(?:\d+(?:\.\d+)?|[०-९]+)\s*(?:marks?|pts?|points?|अंक|मार्क्स)\s*[\)\]]/gi, "");

  // 5. Trailing label format: " Marks: 3", " Score: 5", " अंक: 1"
  cleaned = cleaned.replace(/\s*(?:marks?|pts?|score|अंक|मार्क्स)[\:\s]+(?:\d+(?:\.\d+)?|[०-९]+)\s*$/i, "");

  return cleaned.trim();
}

/**
 * Inferred fallback marks by question type when not explicitly stated
 */
export function inferDefaultMarks(type: ChapterTestQuestionType): {
  marks: number;
  source: string;
  confidence: number;
  pending: boolean;
} {
  switch (type) {
    case "very_short_answer":
      return { marks: 1, source: "section_default", confidence: 0.90, pending: false };
    case "short_answer":
      return { marks: 2, source: "section_default", confidence: 0.85, pending: false };
    case "long_answer":
      return { marks: 5, source: "section_default", confidence: 0.90, pending: false };
    case "case_based":
    case "comprehension":
      return { marks: 4, source: "section_default", confidence: 0.85, pending: false };
    case "mcq":
    case "true_false":
    case "assertion_reasoning":
    case "assertion_reason":
      return { marks: 1, source: "section_default", confidence: 0.95, pending: false };
    case "multiple_select":
    case "msq":
      return { marks: 2, source: "section_default", confidence: 0.90, pending: false };
    default:
      return { marks: 1, source: "needs_review", confidence: 0.40, pending: true };
  }
}

/**
 * Matches option lines like "A. ...", "B) ...", "(A) ...", "Option A: ...", "A. अच्छा", "(क) कुरूप", "क. अच्छा"
 */
export function matchOptionLine(line: string): { letter: string; text: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Don't treat Assertion/Reason or keywords as an option
  if (/^(?:Assertion|Reason|अभिकथन|कथन|तर्क|कारण)\b/i.test(trimmed)) return null;
  if (/^[\(\[]?(?:A|R|क|ख)[\)\]]?\s*[:\-—–।]?\s*(?:Assertion|Reason|अभिकथन|कथन|तर्क|कारण)\b/i.test(trimmed)) return null;
  if (/^(?:Options?|विकल्प)\s*[\:\-—–।]?$/i.test(trimmed)) return null;
  if (/^(?:अथवा|वा|या)$/i.test(trimmed)) return null;

  const match = trimmed.match(
    /^(?:(?:Option|Opt|Choice|विकल्प)\s*(?:[\(\[]([A-Ea-e1-5क-ङअ-द१-५])[\)\]]|([A-Ea-e1-5क-ङअ-द१-५]))[\.\)\:\-—–।\s]*|[\(\[]([A-Ea-e1-5क-ङअ-द१-५])[\)][\.\:\-—–।\s]*|\[([A-Ea-e1-5क-ङअ-द१-५])\][\.\:\-—–।\s]*|([A-Ea-eक-ङअ-द])[\.\)\:\-—–।]\s*|([1-5१-५])[\.\)\:\-—–।]\s+)(.*)$/i
  );
  if (match) {
    const rawSym = (match[1] || match[2] || match[3] || match[4] || match[5] || match[6] || "A");
    const rawLetter = mapDevanagariOrAsciiOptionLetter(rawSym);
    return {
      letter: rawLetter,
      text: (match[7] || "").trim()
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
    const isIsolatedLabel = /^[A-Ea-e1-5क-ङअ-द१-५][\.\)]?$/.test(item);

    if (isIsolatedLabel && i + 1 < rawList.length) {
      const nextItem = rawList[i + 1];
      const cleanLabel = mapDevanagariOrAsciiOptionLetter(item.replace(/[\.\)]/g, ""));
      const cleanNext = nextItem.replace(/^[A-Ea-e1-5क-ङअ-द१-५][\.\)\:\-—–।]\s*/i, "").trim();
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
    const match = opt.match(/^(?:(?:Option|Opt|विकल्प)\s*([A-Ea-e1-5क-ङअ-द१-५])|([A-Ea-e1-5क-ङअ-द१-५]))[\.\)\:\-—–।]?\s*(.*)$/i);
    let letter = expectedLetter;
    let optText = opt;

    if (match) {
      letter = mapDevanagariOrAsciiOptionLetter(match[1] || match[2] || expectedLetter);
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
  declaredMarks?: number;
} | null {
  const trimmed = line.trim().replace(/^[\*\#\_\-\s]+|[\*\#\_\-\s]+$/g, "");
  if (!trimmed) return null;

  // Lines that start with directions, instructions, notes, reading cues or alternatives are NOT section headers
  if (/^(?:Directions?|Instructions?|Note|Read|Study|Examine|Consider|Answer|State\s+whether|Choose|निर्देश|सूचना|अथवा|वा|या)\b/i.test(trimmed)) {
    return null;
  }

  // Check for Section Letter prefix: "Section A — ...", "Section 1: ...", "Part A - ...", "खण्ड क — ...", "भाग 1: ..."
  const secLetterMatch = trimmed.match(/^(?:Section|Part|खण्ड|खंड|भाग|विभाग)\s*[\'\"‘“]?\s*([A-Za-z0-9क-घअ-द]+)[\'\"’”]?[\s\—\–\-\:\.\,]*(.*)$/i);
  let sectionLetter: string | undefined;
  let candidateTitle = trimmed;

  if (secLetterMatch) {
    const rawSec = secLetterMatch[1].trim();
    sectionLetter = mapDevanagariOrAsciiOptionLetter(rawSec);
    candidateTitle = (secLetterMatch[2] || "").trim();
  } else {
    // Numbered header: "1. Multiple Choice Questions", "4. Comprehension", "१. बहुविकल्पीय प्रश्न"
    const numPrefixMatch = trimmed.match(/^([A-Z]|\d+|[IVXLCDM]+|[०-९]+|[क-घअ-द])[\.\)\:\-—–।]\s*(.*)$/i);
    if (numPrefixMatch) {
      const rawPrefix = numPrefixMatch[1];
      sectionLetter = mapDevanagariOrAsciiOptionLetter(rawPrefix);
      candidateTitle = (numPrefixMatch[2] || "").trim();
    }
  }

  const formula = extractSectionMarksFormula(candidateTitle) || extractSectionMarksFormula(trimmed);
  let marksInfo = extractMarks(trimmed) || extractMarks(candidateTitle);
  if (formula) {
    marksInfo = {
      marks: formula.marksPerQuestion,
      source: "section_instruction",
      confidence: 1.0
    };
  }

  // Clean candidate title of formulas and bracketed marks for category detection
  const cleanTitle = candidateTitle
    .replace(/(?:[\s\—\–\-])*(?:\(|\{|\[)?\s*(?:\d+|[०-९]+)\s*(?:[×\*xX]|times)\s*(?:\d+(?:\.\d+)?|[०-९]+)\s*=\s*(?:\d+(?:\.\d+)?|[०-९]+)\s*(?:marks?|pts?|points?|अंक|मार्क्स)?\s*(?:\)|\}|\])?/gi, "")
    .replace(/\([^\)]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\{[^\}]*\}/g, "")
    .replace(/(?:[\s\—\–\-])+(?:\d+(?:\.\d+)?|[०-९]+)\s*(?:marks?|pts?|points?|अंक|मार्क्स)(?:\s+(?:each|प्रत्येक))?/gi, "")
    .replace(/\b(?:\d+(?:\.\d+)?|[०-९]+)\s*(?:marks?|pts?|points?|अंक|मार्क्स)(?:\s+(?:each|प्रत्येक))?\b/gi, "")
    .replace(/^[ \t\r\n\—\–\:\.\,\_\#-]+|[ \t\r\n\—\–\:\.\,\_\#-]+$/g, "")
    .trim();

  // Guard against full sentences
  if (cleanTitle.length > 80 && !secLetterMatch) {
    return null;
  }

  const finalTitle = cleanTitle || candidateTitle;
  const declaredMarks = formula ? formula.declaredSectionMarks : undefined;

  const getResolvedMarks = (secType: ChapterTestQuestionType) => {
    if (marksInfo) return marksInfo;
    switch (secType) {
      case "very_short_answer":
        return { marks: 1, source: "section_default", confidence: 0.95 };
      case "short_answer":
        return { marks: 2, source: "section_default", confidence: 0.90 };
      case "long_answer":
        return { marks: 5, source: "section_default", confidence: 0.95 };
      case "case_based":
      case "comprehension":
        return { marks: 4, source: "section_default", confidence: 0.90 };
      case "multiple_select":
        return { marks: 2, source: "section_default", confidence: 0.95 };
      default:
        return { marks: 1, source: "section_default", confidence: 0.95 };
    }
  };

  // Test against distinct categories
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
        sectionTitle: finalTitle,
        rawHeading: trimmed,
        type: "multiple_select",
        marksInfo: getResolvedMarks("multiple_select"),
        declaredMarks
      };
    }

    // 2. MCQs / Multiple Choice / बहुविकल्पीय प्रश्न
    if (
      /^(?:MCQs?|Multiple\s+Choice(?:\s+Questions?)?|Standalone\s+Questions?|General\s+Questions?|Independent\s+Questions?|बहुविकल्पीय(?:\s*प्रश्न)?|बहुविकल्प|वस्तुनिष्ठ(?:\s*प्रश्न)?|सही\s*विकल्प)$/i.test(str)
    ) {
      return {
        isSection: true,
        sectionLetter,
        sectionTitle: finalTitle,
        rawHeading: trimmed,
        type: "mcq",
        marksInfo: getResolvedMarks("mcq"),
        declaredMarks
      };
    }

    // 3. Assertion & Reasoning / कथन एवं कारण
    if (
      /^(?:Assertion\s*(?:&|and|-)\s*Reason(?:ing)?|Assertion\s*Reason|कथन\s*(?:एवं|और|तथा)\s*कारण|अभिकथन\s*(?:एवं|और|तथा)\s*(?:कारण|तर्क))(?:\s+Questions?)?$/i.test(str)
    ) {
      return {
        isSection: true,
        sectionLetter,
        sectionTitle: finalTitle,
        rawHeading: trimmed,
        type: "assertion_reason",
        marksInfo: getResolvedMarks("assertion_reason"),
        declaredMarks
      };
    }

    // 4. True and False / सही या गलत
    if (
      /^(?:True\s*[\/\\]\s*False|True[\/\\]False|True\s+and\s+False|True\s+or\s+False|T\/F|सही\s*(?:या|\/|अथवा|वा)\s*गलत|सत्य\s*(?:या|\/|अथवा|वा)\s*असत्य|ठीक\s*(?:वा|\/)\s*बेठीक)$/i.test(str)
    ) {
      return {
        isSection: true,
        sectionLetter,
        sectionTitle: finalTitle,
        rawHeading: trimmed,
        type: "true_false",
        marksInfo: getResolvedMarks("true_false"),
        declaredMarks
      };
    }

    // 5. Very Short Answer Questions / अति लघु उत्तरीय प्रश्न
    if (
      /^(?:Very\s+Short\s+Answer(?:\s+Questions?)?|VSA(?:\s+Questions?)?|1\s*Mark\s+Questions?|अति\s*लघु(?:\s*उत्तरीय)?(?:\s*प्रश्न)?|अति\s*संक्षिप्त(?:\s*प्रश्न)?|एक\s*अंक\s*(?:वाले\s*)?प्रश्न)$/i.test(str)
    ) {
      return {
        isSection: true,
        sectionLetter,
        sectionTitle: finalTitle,
        rawHeading: trimmed,
        type: "very_short_answer",
        marksInfo: getResolvedMarks("very_short_answer"),
        declaredMarks
      };
    }

    // 6. Short Answer Questions / लघु उत्तरीय प्रश्न / संवाद लेखन
    if (
      /^(?:Short\s+Answer(?:\s+Questions?)?|SA(?:\s+Questions?)?|Short\s+Questions?|लघु(?:\s*उत्तरीय)?(?:\s*प्रश्न)?|संक्षिप्त(?:\s*उत्तर)?(?:\s*प्रश्न)?|लघु\s*प्रश्न|संवाद\s*लेखन)$/i.test(str)
    ) {
      return {
        isSection: true,
        sectionLetter,
        sectionTitle: finalTitle,
        rawHeading: trimmed,
        type: "short_answer",
        marksInfo: getResolvedMarks("short_answer"),
        declaredMarks
      };
    }

    // 7. Long Answer Questions / दीर्घ उत्तरीय प्रश्न / पत्र लेखन / अनुच्छेद लेखन / निबंध लेखन
    if (
      /^(?:Long\s+Answer(?:\s+Questions?)?|LA(?:\s+Questions?)?|Essay(?:\s+Questions?)?|दीर्घ(?:\s*उत्तरीय)?(?:\s*प्रश्न)?|विस्तृत(?:\s*उत्तरीय)?(?:\s*प्रश्न)?|निबंधात्मक(?:\s*प्रश्न)?|दीर्घ\s*प्रश्न|पत्र\s*लेखन|अनुच्छेद\s*लेखन|परिच्छेद\s*लेखन|निबंध\s*लेखन|रचनात्मक\s*लेखन)$/i.test(str)
    ) {
      return {
        isSection: true,
        sectionLetter,
        sectionTitle: finalTitle,
        rawHeading: trimmed,
        type: "long_answer",
        marksInfo: getResolvedMarks("long_answer"),
        declaredMarks
      };
    }

    // 8. Case-Based Questions / केस आधारित प्रश्न
    if (
      /^(?:Case[\s\-]Based(?:\s+Questions?)?|Case\s+Study\s+Questions?|केस\s*(?:आधारित|अध्ययन)|घटना\s*आधारित|स्रोत\s*आधारित)$/i.test(str) ||
      (secLetterMatch && /^(?:Case\s+Study|केस\s+अध्ययन)$/i.test(str))
    ) {
      return {
        isSection: true,
        sectionLetter,
        sectionTitle: finalTitle,
        rawHeading: trimmed,
        type: "case_based",
        marksInfo: getResolvedMarks("case_based"),
        declaredMarks
      };
    }

    // 9. Comprehension / अपठित गद्यांश
    if (
      /^(?:(?:Reading\s+)?Comprehension(?:\s+(?:Passage|Section|Questions?))?|Passage(?:\s+Based)?(?:\s+Questions?)?|अपठित\s*गद्यांश|पठित\s*गद्यांश|गद्यांश(?:\s*पर\s*आधारित)?|अपठित\s*काव्यांश|पद्यांश)$/i.test(str)
    ) {
      return {
        isSection: true,
        sectionLetter,
        sectionTitle: finalTitle,
        rawHeading: trimmed,
        type: "comprehension",
        marksInfo: getResolvedMarks("comprehension"),
        declaredMarks
      };
    }

    // 10. Fill in the Blanks
    if (
      /^(?:Fill\s+(?:in\s+)?(?:the\s+)?(?:Blanks?|Blank)|Blanks?)(?:\s+Questions?)?$/i.test(str)
    ) {
      return {
        isSection: true,
        sectionLetter,
        sectionTitle: finalTitle,
        rawHeading: trimmed,
        type: "fill_blank",
        marksInfo: getResolvedMarks("fill_blank"),
        declaredMarks
      };
    }

    // 11. Match the Following
    if (
      /^(?:Match\s+(?:the\s+)?(?:Following|Columns?)|Matching)(?:\s+Questions?)?$/i.test(str)
    ) {
      return {
        isSection: true,
        sectionLetter,
        sectionTitle: finalTitle,
        rawHeading: trimmed,
        type: "match_following",
        marksInfo: getResolvedMarks("match_following"),
        declaredMarks
      };
    }
  }

  // If Section/Part letter was matched explicitly, treat as section even if title is non-standard
  if (secLetterMatch) {
    return {
      isSection: true,
      sectionLetter,
      sectionTitle: finalTitle || `Section ${sectionLetter}`,
      rawHeading: trimmed,
      type: "mcq",
      marksInfo: getResolvedMarks("mcq"),
      declaredMarks
    };
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

  // Do not match general directions, instructions, alternatives, or assertion & reason directions
  if (
    /^(?:Directions?|Instructions?|Note|निर्देश|सूचना|अथवा|वा|या)\s*[\:\-—–।]/i.test(trimmed) ||
    /^(?:Read|Study|निम्नलिखित|दिएको|तलको)\s+(?:the\s+)?(?:Assertion|Reason|Instructions|Directions|निर्देश|सूचना)/i.test(trimmed)
  ) {
    return null;
  }

  const isCase = /case|केस|घटना|स्थिति/i.test(trimmed);

  // Standalone phrases:
  // "Read the following passage carefully."
  // "Read the passage carefully."
  // "Read the case carefully."
  // "Case Study:" or "Passage:" or "अपठित गद्यांश:"
  if (/^(?:Case\s+Study|Case|केस\s+अध्ययन|केस\s+आधारित)(?:\s*(?:\d+|[०-९]+))?\s*[\:\.\-—–]?$/i.test(trimmed)) {
    return { title: trimmed, isCase: true };
  }
  if (/^(?:Passage|Reading\s+Passage|अपठित\s+गद्यांश|पठित\s+गद्यांश|गद्यांश|अपठित\s+काव्यांश|पद्यांश)(?:\s*(?:\d+|[०-९]+))?\s*[\:\.\-—–]?$/i.test(trimmed)) {
    return { title: trimmed, isCase: false };
  }

  if (
    /^(?:Read|Study|Examine|Consider)\s+(?:carefully\s+)?(?:the\s+)?(?:following\s+)?(?:passage|text|excerpt|case|case\s+study|information)(?:\s+carefully)?(?:\s*(?:below|given\s+below|and\s+answer|to\s+answer|questions?|that\s+follow)[\w\s\.,\:\-\(\)]*)?[\.\:\-]?$/i.test(
      trimmed
    ) ||
    /^(?:निम्नलिखित|दिएको|तलको)\s+(?:गद्यांश|अनुच्छेद|पाठ|काव्यांश|पद्यांश|केस|विवरण)\s*(?:को\s+)?(?:ध्यानपूर्वक|ध्यानदिएर)?\s*(?:पढ़कर|पढेर|अध्ययन\s+गरि)?.*[\.\:\-—–]?$/i.test(
      trimmed
    )
  ) {
    return { title: trimmed, isCase };
  }

  // Inline passage: "Read the passage carefully. Water is one of the most..."
  const inlineMatch = trimmed.match(
    /^((?:Read|Study|Examine|Consider|निम्नलिखित|दिएको)\s+(?:carefully\s+)?(?:the\s+)?(?:following\s+)?(?:passage|text|case|case\s+study|गद्यांश|अनुच्छेद|पाठ)?(?:\s+carefully)?[\.\:\-—–])\s+(.+)$/i
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
 * Question numbering matcher: Q1., Q.1, Question 1:, 1., 2), प्रश्न 1., प्रश्न 10., प्रश्न संख्या 1., प्र. 1.
 */
export function matchQuestionNumber(line: string): {
  qNum: number;
  label: string;
  remainder: string;
  hasExplicitQPrefix: boolean;
} | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Never treat alternatives (अथवा, वा, या) as a question start
  if (/^(?:अथवा|वा|या)(?:\s+|$)/i.test(trimmed)) {
    return null;
  }

  // 1. Explicit Question prefix:
  // English: Q1. , Q1) , Question 1: , Q.1 , Q 1.
  // Hindi/Nepali: प्रश्न 1. , प्रश्न 1: , प्रश्न 1। , प्रश्न 10. , प्रश्न संख्या 1. , प्रश्न नं. 1. , प्रश्न नं 1: , प्र. 1. , प्र० 1. , प्र 1.
  // Supporting both ASCII digits \d+ AND Devanagari digits [०-९]+
  const qExplicitMatch = trimmed.match(
    /^(?:Q(?:uestion)?[\.\:\-]?\s*|\bQ\b\s*|(?:प्रश्न(?:\s*संख्या|\s*नं[\.]?)?|प्र[\.०]?)\s*[:\.\-—–।]?\s*)(\d+|[०-९]+)[\.\):\-—–।]?\s*(.*)$/i
  );
  if (qExplicitMatch) {
    const num = parseNumberOrDevanagari(qExplicitMatch[1]);
    if (num !== null && !isNaN(num)) {
      return {
        qNum: num,
        label: `Q${num}`,
        remainder: qExplicitMatch[2] ? qExplicitMatch[2].trim() : "",
        hasExplicitQPrefix: true
      };
    }
  }

  // 2. Plain digits followed by delimiter: "1. ", "2) ", "15: ", "1। ", "१०. "
  const plainMatch = trimmed.match(/^(\d+|[०-९]+)[\.\):\-—–।]\s+(.*)$/);
  if (plainMatch) {
    const num = parseNumberOrDevanagari(plainMatch[1]);
    if (num !== null && !isNaN(num)) {
      return {
        qNum: num,
        label: `Q${num}`,
        remainder: plainMatch[2] ? plainMatch[2].trim() : "",
        hasExplicitQPrefix: false
      };
    }
  }

  // 3. Parenthesized or bracketed numbers: "(1) ", "[1] ", "(१) ", "[१] "
  const parenNumMatch = trimmed.match(/^[\(\[](\d+|[०-९]+)[\)\]][\.\:\-—–।]?\s+(.*)$/);
  if (parenNumMatch) {
    const num = parseNumberOrDevanagari(parenNumMatch[1]);
    if (num !== null && !isNaN(num)) {
      return {
        qNum: num,
        label: `Q${num}`,
        remainder: parenNumMatch[2] ? parenNumMatch[2].trim() : "",
        hasExplicitQPrefix: false
      };
    }
  }

  // 4. Roman numeral sub-questions: "(i) ", "(ii) ", "i. ", "ii) ", "(iv) "
  const romanMatch = trimmed.match(/^(?:\(?([ivxlcdm]+)\)[\.\:\-—–।]?|([ivxlcdm]+)[\.\):])\s+(.*)$/i);
  if (romanMatch) {
    const romanStr = (romanMatch[1] || romanMatch[2]).toLowerCase();
    const romanMap: Record<string, number> = {
      i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10
    };
    if (romanMap[romanStr]) {
      const num = romanMap[romanStr];
      return {
        qNum: num,
        label: `(${romanStr})`,
        remainder: romanMatch[3] ? romanMatch[3].trim() : "",
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
          msq: 0,
          assertion_reason: 0,
          assertion_reasoning: 0,
          comprehension: 0,
          true_false: 0,
          very_short_answer: 0,
          short_answer: 0,
          long_answer: 0,
          case_based: 0,
          fill_blank: 0,
          match_following: 0,
          unknown: 0
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
        activeCandidate.rawBlockLines.push(rawLine);
      }
      continue;
    }

    if (isDivider(trimmed)) {
      continue;
    }

    // Metadata & Title Extraction (Top of Test)
    if (!currentSectionObj && questionCandidates.length === 0) {
      // "Class 10 — Social Science | Economics"
      const classMatch = trimmed.match(/^(?:Class\s+\d+|UPSC[^\—\-]*|कक्षा\s*(?:\d+|[०-९]+))\s*[—\-]\s*([^\|]+)(?:\|\s*(.*))?$/i);
      if (classMatch) {
        metadata.classGrade = metadata.classGrade || classMatch[1].trim();
        if (classMatch[2]) {
          metadata.subject = metadata.subject || classMatch[2].trim();
        } else {
          metadata.subject = metadata.subject || classMatch[1].trim();
        }
        metadata.title = metadata.title || trimmed;
        continue;
      }

      // "Chapter: Globalisation and the Indian Economy" or "Chapter 4: ..." or "पाठ: ..." or "अध्याय: ..."
      const chMatch = trimmed.match(/^(?:Chapter|पाठ|अध्याय)(?:\s+(\d+|[०-९]+))?\s*[\:\-—–।=]\s*(.*)$/i);
      if (chMatch) {
        if (chMatch[1]) metadata.chapterNo = parseNumberOrDevanagari(chMatch[1]) || undefined;
        if (chMatch[2]) metadata.chapterName = chMatch[2].trim();
        continue;
      }

      // "Subject: Hindi" or "विषय: हिंदी"
      const subMatch = trimmed.match(/^(?:Subject|विषय)\s*[\:\-—–।=]\s*(.*)$/i);
      if (subMatch) {
        metadata.subject = subMatch[1].trim();
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

      // "Time Allowed: 3 Hours", "Time: 90 Minutes", "समय: 1 घंटा"
      const timeMatch = trimmed.match(/^(?:Time\s+Allowed|Time|समय)\s*[\:\-—–।=]\s*(.*)$/i);
      if (timeMatch) {
        metadata.timeAllowed = timeMatch[1].trim();
        continue;
      }

      // "Maximum Marks: 80", "Max. Marks: 50", "Total Marks: 50", "पूर्णांक: 25", "कुल अंक: 25"
      const maxMarksMatch = trimmed.match(/(?:Max(?:imum)?\s*Marks|Total\s*Marks|पूर्णांक|कुल\s*अंक|कुल\s*पूर्णांक)\s*[\:\-—–।=]\s*(\d+(?:\.\d+)?|[०-९]+)/i);
      if (maxMarksMatch) {
        metadata.declaredTotalMarks = parseFloat(maxMarksMatch[1].replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d))));
        continue;
      }

      // "General Instructions:" or "सामान्य निर्देश:"
      if (/^(?:General\s+Instructions?|सामान्य\s+निर्देश|निर्देश)\s*[\:\-—–।]?$/i.test(trimmed)) {
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
      const secId = `section-${secLetter.toLowerCase()}`;

      currentSectionObj = {
        id: secId,
        sectionLetter: secLetter,
        heading: secDetected.rawHeading,
        title: secDetected.sectionTitle,
        type: secDetected.type,
        instructions: [],
        marksPerQuestion: secDetected.marksInfo?.marks,
        declaredMarks: secDetected.declaredMarks,
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

    // Standalone formula line e.g. "4 × 1 = 4 Marks", "5 x 1 = 5" right under section header
    const formulaLine = extractSectionMarksFormula(trimmed);
    if (
      formulaLine &&
      currentSectionObj &&
      (!activeCandidate || activeCandidate.lines.length === 0) &&
      (!activePassage || activePassage.questionIds.length === 0)
    ) {
      currentSectionObj.marksPerQuestion = formulaLine.marksPerQuestion;
      currentSectionObj.declaredMarks = formulaLine.declaredSectionMarks;
      currentSectionObj.marksInfo = {
        marks: formulaLine.marksPerQuestion,
        source: "section_instruction",
        confidence: 1.0
      };
      if (activePassage) {
        activePassage.sectionMarks = currentSectionObj.marksInfo;
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
          sectionMarks: currentSectionObj?.marksInfo || (currentSectionObj?.marksPerQuestion ? {
            marks: currentSectionObj.marksPerQuestion,
            negativeMarks: currentSectionObj.negativeMarks,
            source: "section_instruction",
            confidence: 0.98
          } : undefined)
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
          id: "section-a",
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

      let qSectionType = currentSectionObj.type;

      // Inline type checks
      if (/^(?:True\s*[\/\\]\s*False|T\/F|True\s+or\s+False)\b/i.test(qMatch.remainder)) {
        qSectionType = "true_false";
      } else if (/^(?:Assertion\s*(?:&|and|-)\s*Reason(?:ing)?)\b/i.test(qMatch.remainder)) {
        qSectionType = "assertion_reason";
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
        sectionMarks: currentSectionObj?.marksInfo || (currentSectionObj.marksPerQuestion ? {
          marks: currentSectionObj.marksPerQuestion,
          negativeMarks: currentSectionObj.negativeMarks,
          source: "section_instruction",
          confidence: 0.98
        } : undefined),
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
  const typeBreakdown: Record<string, number> = {
    mcq: 0,
    multiple_select: 0,
    assertion_reason: 0,
    assertion_reasoning: 0,
    comprehension: 0,
    true_false: 0,
    very_short_answer: 0,
    short_answer: 0,
    long_answer: 0,
    case_based: 0,
    fill_blank: 0,
    match_following: 0,
    unknown: 0
  };

  const seenQIds = new Set<string>();

  questionCandidates.forEach((candidate, idx) => {
    const cleanLines = candidate.lines
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !isDivider(l));

    if (cleanLines.length === 0) {
      warnings.push(`Question ${candidate.label}: Skipped empty question block.`);
      return;
    }

    // Extract Answer line directly from candidate.lines so that intentional paragraph breaks are preserved
    let explicitAnswer = "";
    const remainingLines: string[] = [];
    let isReadingMultiLineAnswer = false;
    const answerParts: string[] = [];

    candidate.lines.forEach((l) => {
      const trimmed = l.trim();
      if (trimmed && isDivider(trimmed)) return;

      const caMatch =
        trimmed.match(/^(?:Correct\s*)?Ans(?:wer)?\s*[:\-—–।=]\s*(.*)$/i) ||
        trimmed.match(/^(?:सही\s*उत्तर|उत्तर\s*कुंजी|उत्तरमाला|मॉडल\s*उत्तर|अपेक्षित\s*उत्तर|समाधान|हल|उत्तर|उ०|उ\.)\s*[:\-—–।=]?\s*(.*)$/i);
      if (caMatch) {
        isReadingMultiLineAnswer = true;
        const inlineAns = caMatch[1].trim();
        if (inlineAns) answerParts.push(inlineAns);
      } else if (isReadingMultiLineAnswer) {
        answerParts.push(trimmed);
      } else if (trimmed.length > 0) {
        remainingLines.push(trimmed);
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
      candidate.sectionType === "assertion_reason" ||
      candidate.sectionType === "assertion_reasoning" ||
      /Assertion\s*(?:\([A-Za-z]\)|:|\-)/i.test(fullBlockText) ||
      /Reason\s*(?:\([A-Za-z]\)|:|\-)/i.test(fullBlockText) ||
      /अभिकथन\s*(?:\([A-Za-zक-ङ]\)|:|\-)/i.test(fullBlockText) ||
      /तर्क\s*(?:\([A-Za-zक-ङ]\)|:|\-)/i.test(fullBlockText) ||
      /कथन\s*(?:\([A-Za-zक-ङ]\)|:|\-)/i.test(fullBlockText) ||
      /कारण\s*(?:\([A-Za-zक-ङ]\)|:|\-)/i.test(fullBlockText);

    let assertionText = "";
    let reasonText = "";
    if (isAssertion) {
      const aMatch = fullBlockText.match(/(?:Assertion|अभिकथन|कथन)\s*(?:\([A-Za-zक-ङ]\)|:|\-)\s*[:\-]?\s*([^\n]+)/i);
      if (aMatch) assertionText = aMatch[1].trim();
      const rMatch = fullBlockText.match(/(?:Reason|तर्क|कारण)\s*(?:\([A-Za-zक-ङ]\)|:|\-)\s*[:\-]?\s*([^\n]+)/i);
      if (rMatch) reasonText = rMatch[1].trim();
    }

    // True/False Checking
    const lowerAns = explicitAnswer.toLowerCase().trim();
    const isTrueHindi = lowerAns === "सही" || lowerAns === "सत्य" || lowerAns === "ठीक" || lowerAns.startsWith("सही") || lowerAns.startsWith("सत्य") || lowerAns.startsWith("ठीक");
    const isFalseHindi = lowerAns === "गलत" || lowerAns === "असत्य" || lowerAns === "बेठीक" || lowerAns.startsWith("गलत") || lowerAns.startsWith("असत्य") || lowerAns.startsWith("बेठीक");

    const hasTFAnswer =
      lowerAns === "true" ||
      lowerAns === "false" ||
      lowerAns === "t" ||
      lowerAns === "f" ||
      isTrueHindi ||
      isFalseHindi;
    const isTFQuestion = candidate.sectionType === "true_false" || (!hasOptions && hasTFAnswer);

    // Multiple Select Checking
    const isMultipleSelect =
      candidate.sectionType === "multiple_select" ||
      candidate.sectionType === "msq" ||
      /^[A-Ea-eक-ङ]\s*,\s*[A-Ea-eक-ङ]/i.test(explicitAnswer) ||
      /^[A-Ea-eक-ङ]\s*,\s*[A-Ea-eक-ङ]\s*(?:and|&|और|तथा)\s*[A-Ea-eक-ङ]/i.test(explicitAnswer);

    // Fill in the blanks checking
    const isFillBlank =
      candidate.sectionType === "fill_blank" ||
      (!hasOptions && /_{3,}|\[\s*\.\.\.\s*\]|\.{4,}/.test(fullBlockText));

    // Match the following checking
    const isMatchFollowing =
      candidate.sectionType === "match_following" ||
      ((/Column\s+I\b/i.test(fullBlockText) || /स्तम्भ\s*I\b/i.test(fullBlockText)) && (/Column\s+II\b/i.test(fullBlockText) || /स्तम्भ\s*II\b/i.test(fullBlockText)));

    // Subjective Checking (VSA, SA, LA, or subjective child question)
    const isSubjectiveType =
      candidate.sectionType === "very_short_answer" ||
      candidate.sectionType === "short_answer" ||
      candidate.sectionType === "long_answer" ||
      (!hasOptions && !isTFQuestion && !isAssertion && !isFillBlank && !isMatchFollowing);

    let resolvedType: ChapterTestQuestionType = candidate.sectionType;
    if (isTFQuestion) {
      resolvedType = "true_false";
    } else if (isAssertion) {
      resolvedType = "assertion_reason";
    } else if (isMultipleSelect) {
      resolvedType = "multiple_select";
    } else if (isFillBlank) {
      resolvedType = "fill_blank";
    } else if (isMatchFollowing) {
      resolvedType = "match_following";
    } else if (hasOptions) {
      resolvedType = "mcq";
    } else if (isSubjectiveType) {
      if (candidate.sectionType === "very_short_answer") resolvedType = "very_short_answer";
      else if (candidate.sectionType === "long_answer") resolvedType = "long_answer";
      else resolvedType = "short_answer";
    } else if (cleanLines.length > 0) {
      resolvedType = "short_answer";
    } else {
      resolvedType = "unknown";
    }

    typeBreakdown[resolvedType] = (typeBreakdown[resolvedType] || 0) + 1;

    // Parent group resolution
    const parentSection = sectionList.find((s) => s.id === candidate.sectionId);
    const parentPassage = candidate.passageId ? passagesMap[candidate.passageId] : undefined;
    const parentCase = candidate.caseId ? casesMap[candidate.caseId] : undefined;
    const parentGroup = parentCase || parentPassage;

    const groupId = candidate.caseId || candidate.passageId;
    const groupType: ChapterTestQuestionType | undefined = candidate.caseId
      ? "case_based"
      : candidate.passageId
      ? "comprehension"
      : undefined;
    const groupTitle = parentGroup?.title;
    const groupContent = parentGroup?.text;

    // Question ID generation
    const cleanSectionId = candidate.sectionId || "section";
    let qId = `${cleanSectionId}-q${candidate.qNum}`;
    if (seenQIds.has(qId)) {
      qId = `${cleanSectionId}-q${candidate.qNum}_${idx + 1}`;
    }
    seenQIds.add(qId);

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
          !/^(?:True|False|सही|गलत|सत्य|असत्य|ठीक|बेठीक)\s*[✅❌]?$/i.test(l) &&
          !/^[A-Ba-bक-ख][\.\)]\s*(?:True|False|सही|गलत|सत्य|असत्य|ठीक|बेठीक)/i.test(l) &&
          !/^(?:Option\s+[A-B]|[A-B][\.\)\:\-])$/i.test(l) &&
          !/^(?:True\s*[\/\\]\s*False|True[\/\\]False|T\/F|True\s+or\s+False|सही\s*(?:या|\/)\s*गलत|सत्य\s*(?:या|\/)\s*असत्य)[\:\.]?$/i.test(l)
      );
      questionText = statementLines
        .join(" ")
        .replace(/^(?:True\s*[\/\\]\s*False|True[\/\\]False|T\/F|True\s+or\s+False|सही\s*(?:या|\/)\s*गलत|सत्य\s*(?:या|\/)\s*असत्य)[\:\.\-\s]*/gi, "")
        .replace(/—\s*(True|False|सही|गलत|सत्य|असत्य)\s*[✅❌]?/gi, "")
        .replace(/-\s*(True|False|सही|गलत|सत्य|असत्य)\s*[✅❌]?/gi, "")
        .replace(/\b(True|False|सही|गलत|सत्य|असत्य)\s*[✅❌]?$/gi, "")
        .replace(/[✅❌]/g, "")
        .trim();

      if (hasTFAnswer) {
        finalAnswer = (isTrueHindi || lowerAns.startsWith("true") || lowerAns === "t") ? "True" : "False";
      } else if (fullBlockText.includes("True ✅") || fullBlockText.includes("— True") || fullBlockText.includes("- True") || fullBlockText.includes("सही ✅") || fullBlockText.includes("— सही") || fullBlockText.includes("- सही")) {
        finalAnswer = "True";
      } else if (fullBlockText.includes("False ❌") || fullBlockText.includes("False ✅") || fullBlockText.includes("— False") || fullBlockText.includes("- False") || fullBlockText.includes("गलत ❌") || fullBlockText.includes("— गलत") || fullBlockText.includes("- गलत")) {
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
    } else if (isSubjectiveType || resolvedType === "short_answer" || resolvedType === "long_answer" || resolvedType === "very_short_answer" || (!hasOptions && resolvedType !== "assertion_reason")) {
      isSubjective = true;
      if (candidate.caseId || candidate.sectionType === "case_based") {
        resolvedType = "case_based";
      } else if (candidate.passageId || candidate.sectionType === "comprehension") {
        resolvedType = "comprehension";
      } else if (candidate.sectionType === "very_short_answer") {
        resolvedType = "very_short_answer";
      } else if (candidate.sectionType === "long_answer") {
        resolvedType = "long_answer";
      } else if (candidate.sectionType === "short_answer" || resolvedType === "mcq") {
        resolvedType = "short_answer";
      }

      questionText = linesAfterImage
        .filter(
          (l) =>
            l.toLowerCase() !== "question:" &&
            !/^Options?\s*[\:\-]?$/i.test(l) &&
            !/^(?:Very\s+Short|Short|Long)\s+Answer[\:\.]?$/i.test(l) &&
            !/^(?:अति\s*लघु|लघु|दीर्घ)\s*उत्तरीय[\:\.]?$/i.test(l)
        )
        .join("\n")
        .trim();

      finalAnswer = explicitAnswer;
      modelAnswerText = explicitAnswer;

      if (!explicitAnswer && candidate.sectionType !== "case_based" && candidate.sectionType !== "comprehension") {
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
            new Set((explicitAnswer.match(/\b([A-Ea-eक-ङ])\b/g) || []).map((l) => mapDevanagariOrAsciiOptionLetter(l)))
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
            const letterMatch = explicitAnswer.match(
              /^(?:(?:Option|Opt|Choice|विकल्प)\s*[\(\[]?([A-Ea-e1-5क-ङअ-द१-५])[\)\]]?|[\(\[]([A-Ea-e1-5क-ङअ-द१-५])[\)\]]|([A-Ea-e1-5क-ङअ-द१-५])[\.\)\:\-—–।]\s*|([A-Ea-e1-5क-ङअ-द१-५])$)/i
            );
            if (letterMatch) {
              const matchedSymbol = letterMatch[1] || letterMatch[2] || letterMatch[3] || letterMatch[4];
              finalAnswer = mapDevanagariOrAsciiOptionLetter(matchedSymbol);
            }
            // If letter not resolved directly, match explicitAnswer text against option texts
            if (!finalAnswer && parsedOptions.length > 0) {
              const cleanExp = explicitAnswer.trim().toLowerCase();
              const matchedOpt = parsedOptions.find((opt) => {
                const optText = opt.text.trim().toLowerCase();
                return optText && (optText === cleanExp || cleanExp.includes(optText) || optText.includes(cleanExp));
              });
              if (matchedOpt) {
                finalAnswer = matchedOpt.letter;
              }
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

    if (questionText) {
      questionText = stripMarksFromQuestionText(questionText);
    }

    if (!questionText) {
      questionText = `Question ${candidate.label}`;
      warnings.push(`Question ${candidate.label}: Question text was empty or incomplete.`);
    }

    const questionObj: ParsedQuestion = {
      id: qId,
      questionNumber: candidate.qNum,
      displayNumber: candidate.label || `Q${candidate.qNum}`,
      type: resolvedType,
      sectionId: candidate.sectionId,
      sectionLetter: candidate.sectionLetter,
      sectionTitle: candidate.sectionTitle,
      sectionType: parentSection?.type,
      declaredSectionMarks: parentSection?.declaredMarks,
      calculatedSectionMarks: parentSection?.totalMarks,
      groupId,
      groupType,
      groupTitle,
      groupContent,
      question: questionText,
      assertion: assertionText || undefined,
      reason: reasonText || undefined,
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
      isSubQuestion: Boolean(candidate.caseId || candidate.passageId),
      passageId: candidate.caseId || candidate.passageId,
      parentPassageId: candidate.caseId || candidate.passageId,
      caseId: candidate.caseId,
      parentCaseId: candidate.caseId,
      passage: groupContent,
      caseStudy: candidate.caseId ? groupContent : undefined,
      imageLabel: extractedImageLabel || undefined,
      rawText: candidate.rawBlockLines.join("\n")
    };

    allParsedQuestions.push(questionObj);

    // Assign question to its section
    if (parentSection) {
      parentSection.questions.push(questionObj);
      parentSection.totalMarks += questionMarks;
    }
  });

  // Synchronize final section marks onto section objects and their child questions
  sectionList.forEach((sec) => {
    sec.calculatedSectionMarks = sec.totalMarks;
    sec.questions.forEach((q) => {
      q.calculatedSectionMarks = sec.totalMarks;
    });
  });

  // Calculate total marks across all questions
  const totalCalculatedMarks = allParsedQuestions.reduce((sum, q) => sum + (q.marks || 0), 0);

  // If test-level declared total marks is missing, sum declared section marks
  if (metadata.declaredTotalMarks === undefined) {
    const sumDeclared = sectionList.reduce((sum, s) => sum + (s.declaredMarks || 0), 0);
    if (sumDeclared > 0) {
      metadata.declaredTotalMarks = sumDeclared;
    }
  }

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

  const questions: ParsedAssessmentQuestion[] = chapterTest.questions.map((q, idx) => {
    const isSubQ = Boolean(q.isSubQuestion || q.caseId || (q.passageId && q.passageId !== ""));
    const cleanSectionId = q.sectionLetter || (q.sectionId ? q.sectionId.replace(/^section-/i, "").toUpperCase() : undefined);
    const resolvedType = isSubQ
      ? (q.caseId || q.sectionType === "case_based" || cleanSectionId === "G" ? "case_based" : "comprehension")
      : (q.type as AssessmentQuestionType);
    const num = typeof q.questionNumber === "number" ? q.questionNumber : parseInt(String(q.questionNumber), 10) || (idx + 1);

    return {
      id: q.id,
      classGrade: chapterTest.metadata.classGrade || context.classGrade || "Class 10",
      subject: chapterTest.metadata.subject || context.subject || "General",
      chapterNo: chapterTest.metadata.chapterNo || context.chapterNo || 1,
      chapterName: chapterTest.metadata.chapterName || context.chapterName || "Chapter",
      topicName: chapterTest.metadata.topicName || context.topicName || "Full Chapter Test",
      type: resolvedType,
      questionType: resolvedType,
      sectionId: cleanSectionId,
      sectionTitle: q.sectionTitle,
      sectionType: q.sectionType,
      section: q.sectionTitle,
      questionNumber: num,
      displayNumber: q.displayNumber || `Q${num}`,
      declaredSectionMarks: q.declaredSectionMarks,
      calculatedSectionMarks: q.calculatedSectionMarks,
      groupId: isSubQ ? (q.groupId || q.caseId || q.passageId) : undefined,
      groupType: isSubQ ? (q.groupType || (q.caseId ? "case_based" : "comprehension")) : undefined,
      groupTitle: isSubQ ? q.groupTitle : undefined,
      groupContent: isSubQ ? q.groupContent : undefined,
      passage: isSubQ ? q.passage : undefined,
      caseStudy: isSubQ ? q.caseStudy : undefined,
      question: q.question,
      assertion: q.assertion,
      reason: q.reason,
      assertionText: q.assertionText,
      reasonText: q.reasonText,
      options: q.options,
      parsedOptions: q.parsedOptions?.map(po => ({ label: po.letter, text: po.text })),
      correctAnswer: q.correctAnswer,
      modelAnswer: q.modelAnswer,
      explanation: q.explanation,
      isSubjective: q.isSubjective,
      marks: q.marks,
      negativeMarks: q.negativeMarks,
      marksSource: q.marksSource,
      marksConfidence: q.marksConfidence,
      marksPending: q.marksPending,
      isSubQuestion: isSubQ,
      passageId: isSubQ ? (q.passageId || q.caseId) : undefined,
      parentPassageId: isSubQ ? (q.parentPassageId || q.passageId || q.caseId) : undefined,
      caseId: isSubQ ? q.caseId : undefined,
      parentCaseId: isSubQ ? (q.parentCaseId || q.caseId) : undefined,
      imageLabel: q.imageLabel,
      orderIndex: idx + 1,
      rawText: q.rawText
    };
  });

  return { questions, passages, cases };
}
