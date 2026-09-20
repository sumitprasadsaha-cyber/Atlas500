import {
  ParsedAssessmentQuestion,
  AssessmentQuestionType,
  ComprehensionPassage,
  AssessmentCaseStudy,
  TestSectionConfig,
} from "../types";

export interface ParsedMetadata {
  chapter?: string;
  topic?: string;
  theme?: string;
  classGrade?: string;
  subject?: string;
}

export interface UniversalParseContext {
  classGrade: string;
  subject: string;
  chapterNo: number;
  chapterName: string;
  topicName: string;
  defaultMarks?: number;
}

export interface UniversalParseReport {
  totalDetected: number;
  successfullyParsed: number;
  flaggedForReview: number;
  sectionsDetected: Array<{ id: string; title: string; count: number; totalMarks: number }>;
  comprehensionCount: number;
  caseStudyCount: number;
  totalMarks: number;
  warnings: string[];
  questionsByType: Record<string, number>;
}

export interface UniversalParseResult {
  success: boolean;
  questions: ParsedAssessmentQuestion[];
  passages: Record<string, ComprehensionPassage>;
  caseStudies: Record<string, AssessmentCaseStudy>;
  sections: TestSectionConfig[];
  report: UniversalParseReport;
  errors: string[];
  metadata?: ParsedMetadata;
}

// ----------------------------------------------------
// HELPER REGEX PATTERNS
// ----------------------------------------------------

const QUESTION_START_REGEX = /^(?:(?:Q(?:uestion)?\.?\s*(\d+)|\b(\d+))[\.\)\:\-]\s*|\((\d+|\b(?:i|ii|iii|iv|v|vi|vii|viii|ix|x)\b)\)\s*|\[(\d+|\b(?:i|ii|iii|iv|v|vi|vii|viii|ix|x)\b)\]\s*)/i;

const OPTION_LINE_REGEX = /^(?:(?:Option|Opt|Choice)\s*([A-Ea-e1-5])[\.\)\:\-]\s*|([A-Ea-e])[\.\)\:\-]\s*|\(([A-Ea-e])\)\s*|\[([A-Ea-e])\]\s*)(.+)$/i;

const MARKS_REGEX = /(?:\[|\()?\s*(?:Marks?\s*[:\-=]?\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:Marks?|M\b))\s*(?:\]|\))?/i;

const COMMAND_WORDS = [
  "define", "state", "list", "name", "mention", "identify", "give", "write",
  "describe", "explain", "differentiate", "distinguish", "compare", "contrast",
  "illustrate", "justify", "analyze", "evaluate", "discuss", "calculate", "derive"
];

/**
 * Extracts metadata header lines (Chapter, Topic, Theme, Class, Subject)
 */
function extractMetadata(lines: string[]): { metadata: ParsedMetadata; remainingLines: string[] } {
  const metadata: ParsedMetadata = {};
  const remaining: string[] = [];
  let inHeader = true;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (!inHeader) remaining.push(line);
      continue;
    }

    if (inHeader) {
      const chMatch = trimmed.match(/^Chapter\s*[:\-=]\s*(.*)$/i);
      if (chMatch) {
        metadata.chapter = chMatch[1].trim();
        continue;
      }
      const topMatch = trimmed.match(/^Topic\s*[:\-=]\s*(.*)$/i);
      if (topMatch) {
        metadata.topic = topMatch[1].trim();
        continue;
      }
      const thMatch = trimmed.match(/^Theme\s*[:\-=]\s*(.*)$/i);
      if (thMatch) {
        metadata.theme = thMatch[1].trim();
        continue;
      }
      const clMatch = trimmed.match(/^Class\s*[:\-=]\s*(.*)$/i);
      if (clMatch) {
        metadata.classGrade = clMatch[1].trim();
        continue;
      }
      const subMatch = trimmed.match(/^Subject\s*[:\-=]\s*(.*)$/i);
      if (subMatch) {
        metadata.subject = subMatch[1].trim();
        continue;
      }
      if (/^(?:Sample\s+Test|Practice\s+Test|General\s+Instructions?|Time\s*:|Max\s*Marks\s*:|Total\s*Marks\s*:)/i.test(trimmed)) {
        continue;
      }
    }

    inHeader = false;
    remaining.push(line);
  }

  return { metadata, remainingLines: remaining };
}

/**
 * Extracts any separate "Answer Key" block at the end of the text
 */
function extractEndAnswerKey(lines: string[]): {
  filteredLines: string[];
  answerKeyMap: Record<string, string>;
  modelAnswerMap: Record<string, string>;
} {
  const answerKeyMap: Record<string, string> = {};
  const modelAnswerMap: Record<string, string> = {};
  let keyStartIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^(?:Answer\s*Key|Solutions?|Answers?|Marking\s+Scheme|Answer\s+Sheet)\s*[:\-=]?$/i.test(trimmed)) {
      keyStartIndex = i;
      break;
    }
  }

  if (keyStartIndex === -1) {
    return { filteredLines: lines, answerKeyMap, modelAnswerMap };
  }

  const keyLines = lines.slice(keyStartIndex + 1);
  const contentLines = lines.slice(0, keyStartIndex);

  for (const line of keyLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // e.g. "1. B", "Q2: (A, C)", "3) True", "4. Photosynthesis is the..."
    const match = trimmed.match(/^(?:Q(?:uestion)?\.?\s*)?(\d+|[A-Za-z]\b)[\.\)\:\-]\s*(.+)$/i);
    if (match) {
      const qNum = match[1].trim().toLowerCase();
      const ansVal = match[2].trim();

      // Check if it's an objective letter/choice or full subjective text
      if (/^(?:Option\s*)?[A-Ea-e](?:\s*,\s*[A-Ea-e])?$/i.test(ansVal) || /^(?:True|False|T|F)$/i.test(ansVal)) {
        answerKeyMap[qNum] = ansVal;
      } else {
        modelAnswerMap[qNum] = ansVal;
      }
    }
  }

  return {
    filteredLines: contentLines,
    answerKeyMap,
    modelAnswerMap
  };
}

/**
 * Checks if a line is a section header (Section A, B, Section: Short Answer, etc.)
 */
function detectSectionHeader(line: string): { isSection: boolean; title: string; defaultType?: AssessmentQuestionType } | null {
  const trimmed = line.trim().replace(/^[\*\#\_\-\s]+|[\*\#\_\-\s]+$/g, "");
  if (!trimmed) return null;

  // e.g. "Section A: Multiple Choice Questions (1 Mark each)"
  // "Section B - Short Answer Type"
  // "PART 1: MCQs"
  // "Section C (Long Answer)"
  const secMatch = trimmed.match(/^(?:Section|Part)\s+([A-Za-z0-9]+)[\s\:\-]+(.+)?$/i);
  if (secMatch) {
    const partName = secMatch[1].toUpperCase();
    const rest = (secMatch[2] || "").trim();
    const fullTitle = rest ? `Section ${partName}: ${rest}` : `Section ${partName}`;

    let defaultType: AssessmentQuestionType | undefined = undefined;
    const lower = trimmed.toLowerCase();
    if (lower.includes("multiple choice") || lower.includes("mcq")) defaultType = "mcq";
    else if (lower.includes("assertion") && lower.includes("reason")) defaultType = "assertion_reason";
    else if (lower.includes("true") && lower.includes("false")) defaultType = "true_false";
    else if (lower.includes("very short")) defaultType = "very_short_answer";
    else if (lower.includes("short answer")) defaultType = "short_answer";
    else if (lower.includes("long answer")) defaultType = "long_answer";
    else if (lower.includes("case") || lower.includes("source")) defaultType = "case_based";
    else if (lower.includes("comprehension")) defaultType = "comprehension";

    return { isSection: true, title: fullTitle, defaultType };
  }

  // Standalone Type Headers (only if line DOES NOT start with a question number)
  if (!QUESTION_START_REGEX.test(trimmed)) {
    const lower = trimmed.toLowerCase();
    if (/^(?:MCQs?|Multiple\s+Choice(?:\s+Questions?)?)$/i.test(trimmed)) {
      return { isSection: true, title: "Multiple Choice Questions", defaultType: "mcq" };
    }
    if (/^Assertion\s*(?:&|and|-)\s*Reasoning$/i.test(trimmed)) {
      return { isSection: true, title: "Assertion & Reasoning", defaultType: "assertion_reason" };
    }
    if (/^(?:True\s*[\/\\]\s*False|True[\/\\]False|True\s+or\s+False)$/i.test(trimmed)) {
      return { isSection: true, title: "True / False Questions", defaultType: "true_false" };
    }
    if (/^(?:Very\s+Short\s+Answer(?:\s+Questions?)?|VSA)$/i.test(trimmed)) {
      return { isSection: true, title: "Very Short Answer Questions", defaultType: "very_short_answer" };
    }
    if (/^(?:Short\s+Answer(?:\s+Questions?)?|SA)$/i.test(trimmed)) {
      return { isSection: true, title: "Short Answer Questions", defaultType: "short_answer" };
    }
    if (/^(?:Long\s+Answer(?:\s+Questions?)?|LA)$/i.test(trimmed)) {
      return { isSection: true, title: "Long Answer Questions", defaultType: "long_answer" };
    }
    if (/^(?:Case\s*Study|Case\s+Based(?:\s+Questions?)?|Source\s+Based)$/i.test(trimmed)) {
      return { isSection: true, title: "Case Study / Source Based", defaultType: "case_based" };
    }
    if (/^(?:Reading\s+)?Comprehension(?:\s+(?:Passage|Section))?$/i.test(trimmed)) {
      return { isSection: true, title: "Reading Comprehension", defaultType: "comprehension" };
    }
  }

  return null;
}

/**
 * Detects whether a line starts a Comprehension Passage or Case Study
 */
function detectParentGroupStart(line: string): { type: "comprehension" | "case_based"; title: string; initialText?: string } | null {
  const trimmed = line.trim().replace(/^[\*\#\_\-\s]+|[\*\#\_\-\s]+$/g, "");
  if (!trimmed) return null;

  // Passage: "Read the following passage and answer the questions that follow:"
  const isComprehensionPhrase = /^(?:Read|Study|Examine)\s+(?:the\s+)?(?:following\s+)?(?:passage|text|excerpt|poem|story)(?:\s+carefully)?(?:\s*(?:below|given\s+below|and\s+answer|to\s+answer|questions?|that\s+follow)[\w\s\.,\:\-\(\)]*)?[\.\:\-]?$/i.test(trimmed);
  const isCaseStudyPhrase = /^(?:Read|Study|Examine)\s+(?:the\s+)?(?:following\s+)?(?:case\s*study|case|source|scenario|situation)(?:\s+carefully)?(?:\s*(?:below|given\s+below|and\s+answer|to\s+answer|questions?|that\s+follow)[\w\s\.,\:\-\(\)]*)?[\.\:\-]?$/i.test(trimmed);

  if (isCaseStudyPhrase || /^(?:Case\s*Study(?:\s*\d+)?|Case\s+Based\s+Question(?:\s*\d+)?|Source\s+Based\s+Study(?:\s*\d+)?)[\:\.]?$/i.test(trimmed)) {
    return { type: "case_based", title: trimmed };
  }

  if (isComprehensionPhrase || /^(?:Comprehension\s+Passage(?:\s*\d+)?|Reading\s+Passage(?:\s*\d+)?)[\:\.]?$/i.test(trimmed)) {
    return { type: "comprehension", title: trimmed };
  }

  // Inline passage: "Read the following passage carefully: In 1859, Charles Darwin published..."
  const inlinePassage = trimmed.match(/^((?:Read|Study)\s+(?:the\s+)?(?:following\s+)?(?:passage|case\s*study|case|text)[\w\s\.,\:\-\(\)]*?[\:\-])\s+(.+)$/i);
  if (inlinePassage) {
    const isCase = inlinePassage[1].toLowerCase().includes("case");
    return {
      type: isCase ? "case_based" : "comprehension",
      title: inlinePassage[1].trim(),
      initialText: inlinePassage[2].trim()
    };
  }

  return null;
}

/**
 * Parses raw text into structured questions, sections, and parent groups with zero artificial limits.
 */
export function parseUniversalTestText(
  rawInput: string,
  context: UniversalParseContext
): UniversalParseResult {
  const lines = rawInput.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Extract metadata headers
  const { metadata, remainingLines: linesAfterMeta } = extractMetadata(lines);

  // 2. Extract end answer key if present
  const { filteredLines, answerKeyMap, modelAnswerMap } = extractEndAnswerKey(linesAfterMeta);

  // 3. Scan lines and segment into Sections, Passages/Cases, and Question Blocks
  const sections: TestSectionConfig[] = [];
  const passages: Record<string, ComprehensionPassage> = {};
  const caseStudies: Record<string, AssessmentCaseStudy> = {};

  let currentSection: TestSectionConfig | null = null;
  let currentGroup: { id: string; type: "comprehension" | "case_based"; title: string; lines: string[] } | null = null;

  interface RawQuestionBlock {
    qNumStr: string;
    qNumIndex: number;
    sectionId?: string;
    sectionTitle?: string;
    groupId?: string;
    groupType?: "comprehension" | "case_based";
    defaultType?: AssessmentQuestionType;
    lines: string[];
  }

  const rawBlocks: RawQuestionBlock[] = [];
  let currentBlock: RawQuestionBlock | null = null;

  for (let i = 0; i < filteredLines.length; i++) {
    const line = filteredLines[i];
    const trimmed = line.trim();

    // Check for dividers
    if (/^[⸻\-\=\_\*]{2,}$/.test(trimmed) || trimmed === "⸻") {
      if (currentBlock) {
        rawBlocks.push(currentBlock);
        currentBlock = null;
      }
      continue;
    }

    // Check for Section Header
    const sectionInfo = detectSectionHeader(trimmed);
    if (sectionInfo) {
      if (currentBlock) {
        rawBlocks.push(currentBlock);
        currentBlock = null;
      }
      if (currentGroup) {
        // Finalize group
        const groupText = currentGroup.lines.join("\n").trim();
        if (currentGroup.type === "comprehension") {
          passages[currentGroup.id] = { id: currentGroup.id, title: currentGroup.title, text: groupText };
        } else {
          caseStudies[currentGroup.id] = { id: currentGroup.id, title: currentGroup.title, text: groupText };
        }
        currentGroup = null;
      }

      const secId = `sec_${sections.length + 1}_${Math.random().toString(36).substring(2, 6)}`;
      currentSection = {
        id: secId,
        title: sectionInfo.title,
        marksPerQuestion: sectionInfo.defaultType === "long_answer" ? 5 : sectionInfo.defaultType === "short_answer" ? 2 : 1
      };
      sections.push(currentSection);
      continue;
    }

    // Check for Comprehension Passage / Case Study Group start
    const groupInfo = detectParentGroupStart(trimmed);
    if (groupInfo) {
      if (currentGroup && currentGroup.lines.length === 0 && !currentBlock) {
        // If we already opened a group without text yet, merge headers
        currentGroup.title = `${currentGroup.title} - ${groupInfo.title}`;
        if (groupInfo.initialText) {
          currentGroup.lines.push(groupInfo.initialText);
        }
        continue;
      }

      if (currentBlock) {
        rawBlocks.push(currentBlock);
        currentBlock = null;
      }
      if (currentGroup) {
        const groupText = currentGroup.lines.join("\n").trim();
        if (currentGroup.type === "comprehension") {
          passages[currentGroup.id] = { id: currentGroup.id, title: currentGroup.title, text: groupText };
        } else {
          caseStudies[currentGroup.id] = { id: currentGroup.id, title: currentGroup.title, text: groupText };
        }
      }

      const groupId = `${groupInfo.type}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      currentGroup = {
        id: groupId,
        type: groupInfo.type,
        title: groupInfo.title,
        lines: groupInfo.initialText ? [groupInfo.initialText] : []
      };
      continue;
    }

    // If inside a question block and line is an option (A., B., C., D.), append to block
    if (currentBlock && OPTION_LINE_REGEX.test(trimmed)) {
      currentBlock.lines.push(line);
      continue;
    }

    // Check for Question start
    const qMatch = trimmed.match(QUESTION_START_REGEX);
    if (qMatch) {
      // Determine question identifier string
      const matchedNum = (qMatch[1] || qMatch[2] || qMatch[3] || qMatch[4] || qMatch[5] || "").trim();
      
      // If we were collecting group lines and haven't hit questions yet, finalize the reading passage text
      if (currentGroup && currentGroup.lines.length > 0 && !currentBlock) {
        const groupText = currentGroup.lines.join("\n").trim();
        if (currentGroup.type === "comprehension") {
          passages[currentGroup.id] = { id: currentGroup.id, title: currentGroup.title, text: groupText };
        } else {
          caseStudies[currentGroup.id] = { id: currentGroup.id, title: currentGroup.title, text: groupText };
        }
      }

      if (currentBlock) {
        rawBlocks.push(currentBlock);
      }

      // Strip leading number from question line if it has question text on same line
      const restOfLine = trimmed.substring(qMatch[0].length).trim();

      currentBlock = {
        qNumStr: matchedNum || String(rawBlocks.length + 1),
        qNumIndex: rawBlocks.length + 1,
        sectionId: currentSection?.id,
        sectionTitle: currentSection?.title,
        groupId: currentGroup?.id,
        groupType: currentGroup?.type,
        defaultType: currentSection?.title.toLowerCase().includes("assertion") ? "assertion_reason" : undefined,
        lines: restOfLine ? [restOfLine] : []
      };
      continue;
    }

    // If inside a question block, append line
    if (currentBlock) {
      currentBlock.lines.push(line);
      continue;
    }

    // If inside a group passage, append line
    if (currentGroup) {
      currentGroup.lines.push(line);
      continue;
    }
  }

  // Finalize last block
  if (currentBlock) {
    rawBlocks.push(currentBlock);
  }

  // Finalize last group if open
  if (currentGroup && !passages[currentGroup.id] && !caseStudies[currentGroup.id]) {
    const groupText = currentGroup.lines.join("\n").trim();
    if (currentGroup.type === "comprehension") {
      passages[currentGroup.id] = { id: currentGroup.id, title: currentGroup.title, text: groupText };
    } else {
      caseStudies[currentGroup.id] = { id: currentGroup.id, title: currentGroup.title, text: groupText };
    }
  }

  // 4. Parse each raw block into a ParsedAssessmentQuestion
  const questions: ParsedAssessmentQuestion[] = [];
  const questionsByType: Record<string, number> = {};

  rawBlocks.forEach((block, bIdx) => {
    const rawText = block.lines.join("\n").trim();
    const cleanLines = block.lines.map((l) => l.trim()).filter((l) => l.length > 0);

    if (cleanLines.length === 0) {
      warnings.push(`Question #${block.qNumStr}: Empty question block skipped.`);
      return;
    }

    // Extract Marks if present: e.g. "[2 Marks]", "(5M)"
    let allocatedMarks: number | undefined = undefined;
    let fullQuestionText = cleanLines.join("\n");
    const marksMatch = fullQuestionText.match(MARKS_REGEX);
    if (marksMatch) {
      allocatedMarks = parseFloat(marksMatch[1] || marksMatch[2] || "1");
      fullQuestionText = fullQuestionText.replace(marksMatch[0], "").trim();
    }

    // Extract Command Word
    let detectedCommandWord: string | undefined = undefined;
    const firstWord = cleanLines[0].split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "");
    if (firstWord && COMMAND_WORDS.includes(firstWord)) {
      detectedCommandWord = firstWord.charAt(0).toUpperCase() + firstWord.slice(1);
    }

    // Check for inline Correct Answer / Model Answer
    let inlineAnswer = "";
    let inlineModelAnswer = "";
    let cleanQuestionLines: string[] = [];
    const optionLines: string[] = [];
    let isAssertionReason = false;
    let isTrueFalse = false;
    let isMultipleSelect = false;

    // Check for end answer key lookup
    const qKey = block.qNumStr.toLowerCase();
    const endKeyAnswer = answerKeyMap[qKey] || answerKeyMap[String(bIdx + 1)];
    const endKeyModel = modelAnswerMap[qKey] || modelAnswerMap[String(bIdx + 1)];

    // Separate question text, options, and inline answers
    cleanLines.forEach((l) => {
      const caMatch = l.match(/^(?:Correct\s+Answer|Ans(?:wer)?|Key)\s*[:\-=]\s*(.+)$/i);
      const modelMatch = l.match(/^(?:Model\s+Answer|Expected\s+Answer|Solution)\s*[:\-=]\s*(.+)$/i);

      if (caMatch) {
        inlineAnswer = caMatch[1].trim();
      } else if (modelMatch) {
        inlineModelAnswer = modelMatch[1].trim();
      } else if (OPTION_LINE_REGEX.test(l)) {
        optionLines.push(l);
      } else {
        cleanQuestionLines.push(l);
      }
    });

    // Check for True/False detection
    const joinedText = cleanQuestionLines.join(" ");
    const hasTFLines = optionLines.some((o) => /^(?:(?:Option\s+)?[A-B][\.\)\:\-]\s*)?(?:True|False)\s*[✅❌]?$/i.test(o));
    const isExplicitTF = block.sectionTitle?.toLowerCase().includes("true") && block.sectionTitle?.toLowerCase().includes("false");
    const isAnswerTF = inlineAnswer.toLowerCase() === "true" || inlineAnswer.toLowerCase() === "false" || endKeyAnswer?.toLowerCase() === "true" || endKeyAnswer?.toLowerCase() === "false";

    if (hasTFLines || isExplicitTF || isAnswerTF) {
      isTrueFalse = true;
    }

    // Check for Assertion & Reasoning
    const isAssertionExplicit = block.sectionTitle?.toLowerCase().includes("assertion");
    const hasAssertionKeywords = /Assertion\s*\([A-Za-z]\)|Reason\s*\([A-Za-z]\)|^Assertion\s*:|^Reason\s*:/i.test(fullQuestionText);
    if (isAssertionExplicit || hasAssertionKeywords) {
      isAssertionReason = true;
    }

    // Check for Multiple Select
    const isExplicitMulti = block.sectionTitle?.toLowerCase().includes("multiple select") || block.sectionTitle?.toLowerCase().includes("more than one");
    if (isExplicitMulti || (inlineAnswer && inlineAnswer.includes(",")) || (endKeyAnswer && endKeyAnswer.includes(","))) {
      isMultipleSelect = true;
    }

    // ----------------------------------------------------
    // TYPE SPECIFIC HANDLING
    // ----------------------------------------------------

    let qType: AssessmentQuestionType = "mcq";
    let finalOptions: string[] = [];
    let resolvedCorrectAnswer = inlineAnswer || endKeyAnswer || "";
    let resolvedModelAnswer = inlineModelAnswer || endKeyModel || "";
    let correctAnswersList: string[] | undefined = undefined;

    if (isTrueFalse) {
      qType = "true_false";
      finalOptions = ["True", "False"];
      if (!resolvedCorrectAnswer) {
        // Try finding checkmarks in options
        if (cleanLines.some((l) => l.includes("True ✅"))) resolvedCorrectAnswer = "True";
        else if (cleanLines.some((l) => l.includes("False ✅"))) resolvedCorrectAnswer = "False";
      }
      if (resolvedCorrectAnswer.toLowerCase() === "t") resolvedCorrectAnswer = "True";
      if (resolvedCorrectAnswer.toLowerCase() === "f") resolvedCorrectAnswer = "False";
      if (!resolvedCorrectAnswer) resolvedCorrectAnswer = "True"; // fallback
      if (!allocatedMarks) allocatedMarks = 1;
    } else if (isAssertionReason) {
      qType = "assertion_reason";
      if (optionLines.length >= 2) {
        finalOptions = normalizeOptions(optionLines);
      } else {
        // Standard Assertion & Reasoning 4 Options
        finalOptions = [
          "A. Both Assertion (A) and Reason (R) are true and Reason (R) is the correct explanation of Assertion (A).",
          "B. Both Assertion (A) and Reason (R) are true but Reason (R) is not the correct explanation of Assertion (A).",
          "C. Assertion (A) is true but Reason (R) is false.",
          "D. Assertion (A) is false but Reason (R) is true."
        ];
      }
      resolvedCorrectAnswer = extractOptionLetter(resolvedCorrectAnswer || "A");
      if (!allocatedMarks) allocatedMarks = 1;
    } else if (optionLines.length >= 2) {
      // It has options: MCQ or Multiple Select
      finalOptions = normalizeOptions(optionLines);
      if (isMultipleSelect || resolvedCorrectAnswer.includes(",")) {
        qType = "multiple_select";
        correctAnswersList = resolvedCorrectAnswer
          .split(/[,;&]/)
          .map((s) => extractOptionLetter(s.trim()))
          .filter(Boolean);
        if (correctAnswersList.length === 0) correctAnswersList = ["A"];
        resolvedCorrectAnswer = correctAnswersList.join(", ");
        if (!allocatedMarks) allocatedMarks = 2;
      } else {
        qType = "mcq";
        // Check for checkmarks in optionLines
        if (!resolvedCorrectAnswer) {
          const checked = optionLines.find((o) => o.includes("✅") || /\(correct\)/i.test(o));
          if (checked) {
            resolvedCorrectAnswer = extractOptionLetter(checked);
          }
        }
        resolvedCorrectAnswer = extractOptionLetter(resolvedCorrectAnswer || "A");
        if (!allocatedMarks) allocatedMarks = 1;
      }
    } else {
      // Subjective Question (Very Short Answer, Short Answer, Long Answer)
      const cleanQText = cleanQuestionLines.join("\n").trim();
      const wordCount = cleanQText.split(/\s+/).length;

      const secTitleLower = (block.sectionTitle || "").toLowerCase();
      if (secTitleLower.includes("very short") || (allocatedMarks && allocatedMarks === 1)) {
        qType = "very_short_answer";
        if (!allocatedMarks) allocatedMarks = 1;
      } else if (secTitleLower.includes("long answer") || (allocatedMarks && allocatedMarks >= 5)) {
        qType = "long_answer";
        if (!allocatedMarks) allocatedMarks = 5;
      } else if (secTitleLower.includes("short answer") || (allocatedMarks && allocatedMarks >= 2 && allocatedMarks <= 4)) {
        qType = "short_answer";
        if (!allocatedMarks) allocatedMarks = 2;
      } else if (wordCount < 10) {
        qType = "very_short_answer";
        if (!allocatedMarks) allocatedMarks = 1;
      } else {
        qType = "short_answer";
        if (!allocatedMarks) allocatedMarks = 2;
      }

      // In subjective questions, answer is the model answer
      if (!resolvedModelAnswer && resolvedCorrectAnswer) {
        resolvedModelAnswer = resolvedCorrectAnswer;
        resolvedCorrectAnswer = "";
      }
    }

    // Clean question text (remove inline tags, answer markers, checkmarks)
    let finalQuestionText = cleanQuestionLines
      .join("\n")
      .replace(/—\s*(True|False)\s*[✅❌]?/gi, "")
      .replace(/[✅❌]/g, "")
      .replace(/\s*\(trap\)/gi, "")
      .replace(/\s*\(correct\)/gi, "")
      .replace(/\s*\(answer\)/gi, "")
      .trim();

    if (!finalQuestionText) {
      finalQuestionText = `Question ${block.qNumStr}`;
      warnings.push(`Question #${block.qNumStr}: Inferred question text.`);
    }

    // Add question
    const qId = `q_${qType}_${block.qNumIndex}_${Math.random().toString(36).substring(2, 7)}`;
    const questionObj: ParsedAssessmentQuestion = {
      id: qId,
      classGrade: context.classGrade,
      subject: context.subject,
      chapterNo: context.chapterNo,
      chapterName: context.chapterName,
      topicName: context.topicName,
      type: qType,
      question: finalQuestionText,
      options: finalOptions,
      correctAnswer: resolvedCorrectAnswer,
      correctAnswers: correctAnswersList,
      scoringMode: isMultipleSelect ? "exact" : undefined,
      modelAnswer: resolvedModelAnswer || undefined,
      marks: allocatedMarks,
      commandWord: detectedCommandWord,
      sectionId: block.sectionId,
      sectionTitle: block.sectionTitle,
      questionNumber: block.qNumStr,
      displayNumber: `Q${block.qNumStr}`,
      passageId: block.groupId,
      parentPassageId: block.groupId,
      caseId: block.groupId,
      parentGroupId: block.groupId,
      parentGroupType: block.groupType,
      rawText: rawText,
      parseConfidence: 0.95,
      reviewStatus: "approved"
    };

    questions.push(questionObj);
    questionsByType[qType] = (questionsByType[qType] || 0) + 1;
  });

  // 5. Compile Summary Report
  const totalMarks = questions.reduce((sum, q) => sum + (q.marks || 1), 0);
  const sectionsDetected = sections.map((s) => {
    const qCount = questions.filter((q) => q.sectionId === s.id).length;
    const sMarks = questions.filter((q) => q.sectionId === s.id).reduce((sum, q) => sum + (q.marks || 1), 0);
    return {
      id: s.id,
      title: s.title,
      count: qCount,
      totalMarks: sMarks
    };
  });

  const report: UniversalParseReport = {
    totalDetected: rawBlocks.length,
    successfullyParsed: questions.length,
    flaggedForReview: warnings.length,
    sectionsDetected,
    comprehensionCount: Object.keys(passages).length,
    caseStudyCount: Object.keys(caseStudies).length,
    totalMarks,
    warnings,
    questionsByType
  };

  return {
    success: questions.length > 0,
    questions,
    passages,
    caseStudies,
    sections,
    report,
    errors,
    metadata
  };
}

// ----------------------------------------------------
// UTILITY FUNCTIONS
// ----------------------------------------------------

function extractOptionLetter(raw: string): string {
  const match = raw.match(/([A-Ea-e1-5])/);
  if (!match) return "A";
  let letter = match[1].toUpperCase();
  const numMap: Record<string, string> = { "1": "A", "2": "B", "3": "C", "4": "D", "5": "E" };
  return numMap[letter] || letter;
}

function normalizeOptions(optionLines: string[]): string[] {
  const letters = ["A", "B", "C", "D", "E"];
  return optionLines.map((line, idx) => {
    const match = line.match(OPTION_LINE_REGEX);
    const letter = match ? extractOptionLetter(match[1] || match[2] || match[3] || match[4] || letters[idx] || "A") : letters[idx] || "A";
    let text = match ? (match[5] || line) : line;
    text = text
      .replace(/[✅❌]/g, "")
      .replace(/\s*\(trap\)/gi, "")
      .replace(/\s*\(correct\)/gi, "")
      .replace(/\s*\(answer\)/gi, "")
      .trim();
    return `${letter}. ${text}`;
  });
}
