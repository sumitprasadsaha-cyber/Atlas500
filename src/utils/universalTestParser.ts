import {
  ParsedAssessmentQuestion,
  AssessmentQuestionType,
  ComprehensionPassage,
  AssessmentCaseStudy,
  TestSectionConfig,
} from "../types";
import {
  parseNumberOrDevanagari,
  mapDevanagariOrAsciiOptionLetter,
  matchQuestionNumber,
  matchOptionLine,
  identifySectionHeader,
  extractMarks
} from "../lib/testParser";

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
// HELPER REGEX PATTERNS WITH DEVANAGARI UNICODE SUPPORT
// ----------------------------------------------------

const QUESTION_START_REGEX = /^(?:(?:Q(?:uestion)?\.?\s*(\d+|[०-९]+)|\b(\d+|[०-९]+)|(?:प्रश्न(?:\s*संख्या|\s*नं[\.]?)?|प्र[\.०]?)\s*[:\.\-—–।]?\s*(\d+|[०-९]+))[\.\)\:\-—–।]?\s*|\((\d+|[०-९]+|\b(?:i|ii|iii|iv|v|vi|vii|viii|ix|x)\b)\)\s*|\[(\d+|[०-९]+|\b(?:i|ii|iii|iv|v|vi|vii|viii|ix|x)\b)\]\s*)/i;

const OPTION_LINE_REGEX = /^(?:(?:Option|Opt|Choice|विकल्प)\s*(?:[\(\[]([A-Ea-e1-5क-ङअ-द१-५])[\)\]]|([A-Ea-e1-5क-ङअ-द१-५]))[\.\)\:\-—–।\s]*|[\(\[]([A-Ea-e1-5क-ङअ-द१-५])[\)][\.\:\-—–।\s]*|\[([A-Ea-e1-5क-ङअ-द१-५])\][\.\:\-—–।\s]*|([A-Ea-eक-ङअ-द])[\.\)\:\-—–।]\s*)(.+)$/i;

const MARKS_REGEX = /(?:\[|\()?\s*(?:(?:Marks?|अंक|मार्क्स|गुण)\s*[:\-=]?\s*(\d+(?:\.\d+)?|[०-९]+)|(\d+(?:\.\d+)?|[०-९]+)\s*(?:Marks?|M\b|अंक|मार्क्स|गुण))\s*(?:\]|\))?/i;

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
      const chMatch = trimmed.match(/^(?:Chapter|पाठ|अध्याय)\s*[:\-=—–।]\s*(.*)$/i);
      if (chMatch) {
        metadata.chapter = chMatch[1].trim();
        continue;
      }
      const topMatch = trimmed.match(/^(?:Topic|शीर्षक|प्रकरण)\s*[:\-=—–।]\s*(.*)$/i);
      if (topMatch) {
        metadata.topic = topMatch[1].trim();
        continue;
      }
      const thMatch = trimmed.match(/^Theme\s*[:\-=—–।]\s*(.*)$/i);
      if (thMatch) {
        metadata.theme = thMatch[1].trim();
        continue;
      }
      const clMatch = trimmed.match(/^(?:Class|कक्षा)\s*[:\-=—–।]\s*(.*)$/i);
      if (clMatch) {
        metadata.classGrade = clMatch[1].trim();
        continue;
      }
      const subMatch = trimmed.match(/^(?:Subject|विषय)\s*[:\-=—–।]\s*(.*)$/i);
      if (subMatch) {
        metadata.subject = subMatch[1].trim();
        continue;
      }
      if (/^(?:Sample\s+Test|Practice\s+Test|General\s+Instructions?|Time\s*:|Max\s*Marks\s*:|Total\s*Marks\s*:|समय\s*[:—–।]|पूर्णांक\s*[:—–।]|कुल\s*अंक\s*[:—–।]|सामान्य\s*निर्देश\s*[:—–।])/i.test(trimmed)) {
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
    if (/^(?:Answer\s*Key|Solutions?|Answers?|Marking\s+Scheme|Answer\s+Sheet|उत्तर\s*कुंजी|उत्तरमाला|समाधान|हल)\s*[:\-=—–।]?$/i.test(trimmed)) {
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

    // e.g. "1. B", "Q2: (A, C)", "3) True", "4. Photosynthesis is the...", "प्रश्न 1. B", "1. कुरूप"
    const match = trimmed.match(/^(?:(?:Q(?:uestion)?\.?|प्रश्न(?:\s*संख्या|\s*नं[\.]?)?|प्र[\.०]?)\s*)?(\d+|[०-९]+|[A-Za-z]\b)[\.\)\:\-—–।]\s*(.+)$/i);
    if (match) {
      const parsedNum = parseNumberOrDevanagari(match[1]);
      const qNum = parsedNum !== null ? String(parsedNum) : match[1].trim().toLowerCase();
      const ansVal = match[2].trim();

      // Check if it's an objective letter/choice or full subjective text
      const isObjLetter = /^(?:(?:Option|Opt|Choice|विकल्प)\s*)?[A-Ea-eक-ङअ-द1-5१-५](?:\s*[,औरतथा]\s*[A-Ea-eक-ङअ-द1-5१-५])?$/i.test(ansVal);
      const isTF = /^(?:True|False|T|F|सही|गलत|सत्य|असत्य|ठीक|बेठीक)$/i.test(ansVal);

      if (isObjLetter || isTF) {
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
 * Checks if a line is a section header (Section A, B, Section: Short Answer, खण्ड क, etc.)
 */
function detectSectionHeader(line: string): { isSection: boolean; title: string; defaultType?: AssessmentQuestionType } | null {
  const trimmed = line.trim().replace(/^[\*\#\_\-\s]+|[\*\#\_\-\s]+$/g, "");
  if (!trimmed) return null;

  // Lines that start with directions, instructions, alternatives are NOT section headers
  if (/^(?:Directions?|Instructions?|Note|निर्देश|सूचना|अथवा|वा|या)\b/i.test(trimmed)) {
    return null;
  }

  // 1. Try unified CBSE/Devanagari section header identification
  const identified = identifySectionHeader(trimmed);
  if (identified && identified.isSection) {
    let defaultType: AssessmentQuestionType | undefined = undefined;
    if (identified.type === "assertion_reason" || identified.type === "assertion_reasoning") defaultType = "assertion_reason";
    else if (identified.type === "multiple_select" || identified.type === "msq") defaultType = "multiple_select";
    else if (identified.type === "true_false") defaultType = "true_false";
    else if (identified.type === "very_short_answer") defaultType = "very_short_answer";
    else if (identified.type === "short_answer") defaultType = "short_answer";
    else if (identified.type === "long_answer") defaultType = "long_answer";
    else if (identified.type === "case_based") defaultType = "case_based";
    else if (identified.type === "comprehension") defaultType = "comprehension";
    else defaultType = "mcq";

    const secLetter = identified.sectionLetter;
    const fullTitle = secLetter ? `Section ${secLetter}: ${identified.sectionTitle}` : identified.sectionTitle;
    return { isSection: true, title: fullTitle, defaultType };
  }

  // 2. Legacy English/Hindi section regex fallback
  const secMatch = trimmed.match(/^(?:Section|Part|खण्ड|खंड|भाग|विभाग)\s+([A-Za-z0-9क-घअ-द]+)[\s\:\-]+(.+)?$/i);
  if (secMatch) {
    const partName = secMatch[1].toUpperCase();
    const rest = (secMatch[2] || "").trim();
    const fullTitle = rest ? `Section ${partName}: ${rest}` : `Section ${partName}`;

    let defaultType: AssessmentQuestionType | undefined = undefined;
    const lower = trimmed.toLowerCase();
    if (lower.includes("multiple choice") || lower.includes("mcq") || lower.includes("बहुविकल्प")) defaultType = "mcq";
    else if ((lower.includes("assertion") && lower.includes("reason")) || lower.includes("कथन") || lower.includes("अभिकथन")) defaultType = "assertion_reason";
    else if ((lower.includes("true") && lower.includes("false")) || lower.includes("सही") || lower.includes("सत्य")) defaultType = "true_false";
    else if (lower.includes("very short") || lower.includes("अति लघु")) defaultType = "very_short_answer";
    else if (lower.includes("short answer") || lower.includes("लघु") || lower.includes("संवाद")) defaultType = "short_answer";
    else if (lower.includes("long answer") || lower.includes("दीर्घ") || lower.includes("पत्र") || lower.includes("अनुच्छेद")) defaultType = "long_answer";
    else if (lower.includes("case") || lower.includes("source") || lower.includes("केस")) defaultType = "case_based";
    else if (lower.includes("comprehension") || lower.includes("गद्यांश")) defaultType = "comprehension";

    return { isSection: true, title: fullTitle, defaultType };
  }

  // 3. Standalone Type Headers (only if line DOES NOT start with a question number)
  if (!matchQuestionNumber(trimmed) && !QUESTION_START_REGEX.test(trimmed)) {
    if (/^(?:MCQs?|Multiple\s+Choice(?:\s+Questions?)?|बहुविकल्पीय(?:\s*प्रश्न)?|वस्तुनिष्ठ(?:\s*प्रश्न)?)$/i.test(trimmed)) {
      return { isSection: true, title: "Multiple Choice Questions", defaultType: "mcq" };
    }
    if (/^(?:Assertion\s*(?:&|and|-)\s*Reasoning|Assertion\s*&\s*Reasoning|कथन\s*(?:एवं|और|तथा)\s*कारण|अभिकथन\s*(?:एवं|और|तथा)\s*कारण)$/i.test(trimmed)) {
      return { isSection: true, title: "Assertion & Reasoning", defaultType: "assertion_reason" };
    }
    if (/^(?:True\s*[\/\\]\s*False|True[\/\\]False|True\s+or\s+False|सही\s*(?:या|\/|अथवा|वा)\s*गलत|सत्य\s*(?:या|\/|अथवा|वा)\s*असत्य|ठीक\s*(?:वा|\/)\s*बेठीक)$/i.test(trimmed)) {
      return { isSection: true, title: "True / False Questions", defaultType: "true_false" };
    }
    if (/^(?:Very\s+Short\s+Answer(?:\s+Questions?)?|VSA|अति\s*लघु(?:\s*उत्तरीय)?(?:\s*प्रश्न)?)$/i.test(trimmed)) {
      return { isSection: true, title: "Very Short Answer Questions", defaultType: "very_short_answer" };
    }
    if (/^(?:Short\s+Answer(?:\s+Questions?)?|SA|लघु(?:\s*उत्तरीय)?(?:\s*प्रश्न)?|संवाद\s*लेखन)$/i.test(trimmed)) {
      return { isSection: true, title: "Short Answer Questions", defaultType: "short_answer" };
    }
    if (/^(?:Long\s+Answer(?:\s+Questions?)?|LA|दीर्घ(?:\s*उत्तरीय)?(?:\s*प्रश्न)?|पत्र\s*लेखन|अनुच्छेद\s*लेखन|निबंध\s*लेखन)$/i.test(trimmed)) {
      return { isSection: true, title: "Long Answer Questions", defaultType: "long_answer" };
    }
    if (/^(?:Case\s*Study|Case\s+Based(?:\s+Questions?)?|Source\s+Based|केस\s*(?:आधारित|अध्ययन))$/i.test(trimmed)) {
      return { isSection: true, title: "Case Study / Source Based", defaultType: "case_based" };
    }
    if (/^(?:(?:Reading\s+)?Comprehension(?:\s+(?:Passage|Section))?|अपठित\s*गद्यांश|पठित\s*गद्यांश|गद्यांश)$/i.test(trimmed)) {
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
  const isComprehensionPhrase = /^(?:Read|Study|Examine|निम्नलिखित|दिएको|तलको)\s+(?:the\s+)?(?:following\s+)?(?:passage|text|excerpt|poem|story|गद्यांश|अनुच्छेद|पाठ|काव्यांश|पद्यांश)(?:\s+carefully)?(?:\s*(?:below|given\s+below|and\s+answer|to\s+answer|questions?|that\s+follow|ध्यानपूर्वक|पढ़कर|पढेर)[\w\s\.,\:\-\(\)]*)?[\.\:\-—–]?$/i.test(trimmed);
  const isCaseStudyPhrase = /^(?:Read|Study|Examine|निम्नलिखित|दिएको|तलको)\s+(?:the\s+)?(?:following\s+)?(?:case\s*study|case|source|scenario|situation|केस|घटना|स्थिति)(?:\s+carefully)?(?:\s*(?:below|given\s+below|and\s+answer|to\s+answer|questions?|that\s+follow|ध्यानपूर्वक)[\w\s\.,\:\-\(\)]*)?[\.\:\-—–]?$/i.test(trimmed);

  if (isCaseStudyPhrase || /^(?:Case\s*Study(?:\s*(?:\d+|[०-९]+))?|Case\s+Based\s+Question(?:\s*(?:\d+|[०-९]+))?|Source\s+Based\s+Study(?:\s*(?:\d+|[०-९]+))?|केस\s*(?:आधारित|अध्ययन))[\:\.\-—–]?$/i.test(trimmed)) {
    return { type: "case_based", title: trimmed };
  }

  if (isComprehensionPhrase || /^(?:Comprehension\s+Passage(?:\s*(?:\d+|[०-९]+))?|Reading\s+Passage(?:\s*(?:\d+|[०-९]+))?|अपठित\s*गद्यांश|पठित\s*गद्यांश|गद्यांश|अपठित\s*काव्यांश)[\:\.\-—–]?$/i.test(trimmed)) {
    return { type: "comprehension", title: trimmed };
  }

  // Inline passage: "Read the following passage carefully: In 1859, Charles Darwin published..."
  const inlinePassage = trimmed.match(/^((?:Read|Study|निम्नलिखित|दिएको)\s+(?:the\s+)?(?:following\s+)?(?:passage|case\s*study|case|text|गद्यांश|अनुच्छेद)?[\w\s\.,\:\-\(\)]*?[\:\-—–])\s+(.+)$/i);
  if (inlinePassage) {
    const isCase = inlinePassage[1].toLowerCase().includes("case") || inlinePassage[1].includes("केस");
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

    // If inside a question block and line is an option (A., B., C., D., (क), etc.), append to block
    if (currentBlock && OPTION_LINE_REGEX.test(trimmed)) {
      currentBlock.lines.push(line);
      continue;
    }

    // Check for Question start
    const qMatchNum = matchQuestionNumber(trimmed);
    const qMatch = qMatchNum ? null : trimmed.match(QUESTION_START_REGEX);
    if (qMatchNum || qMatch) {
      // Determine question identifier string
      const matchedNum = qMatchNum
        ? String(qMatchNum.qNum)
        : (qMatch ? (qMatch[1] || qMatch[2] || qMatch[3] || qMatch[4] || qMatch[5] || "").trim() : "");
      
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
      const restOfLine = qMatchNum ? qMatchNum.remainder : (qMatch ? trimmed.substring(qMatch[0].length).trim() : "");

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

    // Extract Marks if present: e.g. "[2 Marks]", "(5M)", "[1 अंक]", "(2 अंक)"
    let allocatedMarks: number | undefined = undefined;
    let fullQuestionText = cleanLines.join("\n");
    const marksMatch = fullQuestionText.match(MARKS_REGEX);
    if (marksMatch) {
      const rawM = marksMatch[1] || marksMatch[2] || "1";
      allocatedMarks = parseNumberOrDevanagari(rawM) ?? parseFloat(rawM);
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
      const caMatch = l.match(/^(?:Correct\s+Answer|Ans(?:wer)?|Key|सही\s*उत्तर|उत्तर\s*कुंजी|उत्तरमाला|उत्तर|समाधान|हल|उ०|उ\.)\s*[:\-=—–।]?\s*(.+)$/i);
      const modelMatch = l.match(/^(?:Model\s+Answer|Expected\s+Answer|Solution|मॉडल\s*उत्तर|अपेक्षित\s*उत्तर)\s*[:\-=—–।]?\s*(.+)$/i);

      if (caMatch) {
        inlineAnswer = caMatch[1].trim();
      } else if (modelMatch) {
        inlineModelAnswer = modelMatch[1].trim();
      } else if (OPTION_LINE_REGEX.test(l) || matchOptionLine(l)) {
        optionLines.push(l);
      } else {
        cleanQuestionLines.push(l);
      }
    });

    // Check for True/False detection
    const hasTFLines = optionLines.some((o) => /^(?:(?:Option\s+)?[A-Bक-ख][\.\)\:\-—–।]\s*)?(?:True|False|सही|गलत|सत्य|असत्य|ठीक|बेठीक)\s*[✅❌]?$/i.test(o));
    const isExplicitTF = (block.sectionTitle?.toLowerCase().includes("true") && block.sectionTitle?.toLowerCase().includes("false")) ||
      /सही\s*(?:या|\/)\s*गलत|सत्य\s*(?:या|\/)\s*असत्य|ठीक\s*(?:वा|\/)\s*बेठीक/i.test(block.sectionTitle || "");
    const lowerAns = (inlineAnswer || endKeyAnswer || "").toLowerCase().trim();
    const isTrueHindi = lowerAns === "सही" || lowerAns === "सत्य" || lowerAns === "ठीक" || lowerAns.startsWith("सही") || lowerAns.startsWith("सत्य") || lowerAns.startsWith("ठीक");
    const isFalseHindi = lowerAns === "गलत" || lowerAns === "असत्य" || lowerAns === "बेठीक" || lowerAns.startsWith("गलत") || lowerAns.startsWith("असत्य") || lowerAns.startsWith("बेठीक");
    const isAnswerTF = lowerAns === "true" || lowerAns === "false" || lowerAns === "t" || lowerAns === "f" || isTrueHindi || isFalseHindi;

    if (hasTFLines || isExplicitTF || isAnswerTF) {
      isTrueFalse = true;
    }

    // Check for Assertion & Reasoning
    const isAssertionExplicit = block.sectionTitle?.toLowerCase().includes("assertion") || /कथन\s*(?:एवं|और|तथा)\s*कारण|अभिकथन/i.test(block.sectionTitle || "");
    const hasAssertionKeywords = /(?:Assertion|अभिकथन|कथन)\s*(?:\([A-Za-zक-ङ]\)|:|\-)|(?:Reason|तर्क|कारण)\s*(?:\([A-Za-zक-ङ]\)|:|\-)/i.test(fullQuestionText);
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
      if (isTrueHindi) resolvedCorrectAnswer = "True";
      else if (isFalseHindi) resolvedCorrectAnswer = "False";
      else if (resolvedCorrectAnswer.toLowerCase() === "t" || resolvedCorrectAnswer.toLowerCase().startsWith("true")) resolvedCorrectAnswer = "True";
      else if (resolvedCorrectAnswer.toLowerCase() === "f" || resolvedCorrectAnswer.toLowerCase().startsWith("false")) resolvedCorrectAnswer = "False";
      else if (!resolvedCorrectAnswer) {
        if (cleanLines.some((l) => l.includes("True ✅") || l.includes("सही ✅") || l.includes("— सही") || l.includes("- सही"))) resolvedCorrectAnswer = "True";
        else if (cleanLines.some((l) => l.includes("False ✅") || l.includes("गलत ✅") || l.includes("गलत ❌") || l.includes("— गलत") || l.includes("- गलत"))) resolvedCorrectAnswer = "False";
      }
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
        if (resolvedCorrectAnswer) {
          const letterMatch = resolvedCorrectAnswer.match(
            /^(?:(?:Option|Opt|Choice|विकल्प)\s*[\(\[]?([A-Ea-e1-5क-ङअ-द१-५])[\)\]]?|[\(\[]([A-Ea-e1-5क-ङअ-द१-५])[\)\]]|([A-Ea-e1-5क-ङअ-द१-५])[\.\)\:\-—–।]\s*|([A-Ea-e1-5क-ङअ-द१-५])$)/i
          );
          if (letterMatch) {
            const sym = letterMatch[1] || letterMatch[2] || letterMatch[3] || letterMatch[4];
            resolvedCorrectAnswer = mapDevanagariOrAsciiOptionLetter(sym);
          } else {
            const cleanAnswer = resolvedCorrectAnswer.trim().toLowerCase();
            const matchedOpt = finalOptions.find((opt) => {
              const optText = opt.replace(/^[A-Ea-e1-5क-ङअ-द१-५][\.\)\:\-—–।]\s*/i, "").trim().toLowerCase();
              return optText && (optText === cleanAnswer || (cleanAnswer.length > 1 && optText.includes(cleanAnswer)));
            });
            if (matchedOpt) {
              resolvedCorrectAnswer = matchedOpt.charAt(0);
            } else {
              resolvedCorrectAnswer = extractOptionLetter(resolvedCorrectAnswer || "A");
            }
          }
        } else {
          resolvedCorrectAnswer = "A";
        }
        if (!allocatedMarks) allocatedMarks = 1;
      }
    } else {
      // Subjective Question (Very Short Answer, Short Answer, Long Answer)
      const cleanQText = cleanQuestionLines.join("\n").trim();
      const wordCount = cleanQText.split(/\s+/).length;

      const secTitle = block.sectionTitle || "";
      const secTitleLower = secTitle.toLowerCase();
      const isVSA = secTitleLower.includes("very short") || /अति\s*लघु|अति\s*संक्षिप्त/i.test(secTitle) || (allocatedMarks && allocatedMarks === 1);
      const isLA = secTitleLower.includes("long answer") || /दीर्घ\s*उत्तरीय|विस्तृत|निबंधात्मक|पत्र\s*लेखन|अनुच्छेद\s*लेखन|परिच्छेद\s*लेखन|निबंध\s*लेखन/i.test(secTitle) || (allocatedMarks && allocatedMarks >= 5);
      const isSA = secTitleLower.includes("short answer") || /लघु\s*उत्तरीय|संक्षिप्त|संवाद\s*लेखन/i.test(secTitle) || (allocatedMarks && allocatedMarks >= 2 && allocatedMarks <= 4);

      if (isVSA) {
        qType = "very_short_answer";
        if (!allocatedMarks) allocatedMarks = 1;
      } else if (isLA) {
        qType = "long_answer";
        if (!allocatedMarks) allocatedMarks = 5;
      } else if (isSA) {
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
      .replace(/—\s*(True|False|सही|गलत|सत्य|असत्य)\s*[✅❌]?/gi, "")
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
  const match = raw.match(/([A-Ea-e1-5क-ङअ-द१-५])/);
  if (!match) return "A";
  return mapDevanagariOrAsciiOptionLetter(match[1]);
}

function normalizeOptions(optionLines: string[]): string[] {
  const letters = ["A", "B", "C", "D", "E"];
  return optionLines.map((line, idx) => {
    const match = line.match(OPTION_LINE_REGEX);
    const rawLetter = match ? (match[1] || match[2] || match[3] || match[4] || match[5] || match[6]) : null;
    const letter = rawLetter ? mapDevanagariOrAsciiOptionLetter(rawLetter) : letters[idx] || "A";
    let text = match ? (match[7] || line) : line;
    text = text
      .replace(/^[A-Ea-e1-5क-ङअ-द१-५][\.\)\:\-—–।]\s*/i, "")
      .replace(/[✅❌]/g, "")
      .replace(/\s*\(trap\)/gi, "")
      .replace(/\s*\(correct\)/gi, "")
      .replace(/\s*\(answer\)/gi, "")
      .trim();
    return `${letter}. ${text}`;
  });
}
