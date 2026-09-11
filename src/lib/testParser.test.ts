import test from "node:test";
import assert from "node:assert/strict";
import {
  parseChapterTest,
  convertToAssessmentQuestions,
  getQuestionTypeDisplayName
} from "./testParser";
import { SAMPLE_QUESTION_PAPER } from "../constants/sampleQuestionPaper";

const mockContext = {
  classGrade: "Class 10",
  subject: "Social Science",
  chapterNo: 4,
  chapterName: "Globalisation and the Indian Economy",
  topicName: "Globalisation"
};

test("Chapter Test Parser parses official 9-section CBSE chapter test with 27 questions", () => {
  const parsed = parseChapterTest(SAMPLE_QUESTION_PAPER, mockContext);

  assert.equal(parsed.validation.isValid, true);
  assert.equal(parsed.questions.length, 27);
  assert.equal(parsed.sections.length, 9);

  // Metadata verification
  assert.equal(parsed.metadata.chapterName, "Globalisation and the Indian Economy");
  assert.equal(parsed.metadata.classGrade, "Class 10");
  assert.equal(parsed.metadata.subject, "Social Science");

  // Section 1: MCQs
  const sec1 = parsed.sections[0];
  assert.equal(sec1.type, "mcq");
  assert.equal(sec1.questions.length, 2);
  assert.equal(sec1.questions[0].marks, 2);
  assert.equal(sec1.questions[0].options.length, 4);
  assert.equal(sec1.questions[0].correctAnswer, "B");
  assert.equal(sec1.questions[1].correctAnswer, "B");

  // Section 2: Multiple Select Questions
  const sec2 = parsed.sections[1];
  assert.equal(sec2.type, "multiple_select");
  assert.equal(sec2.questions.length, 2);
  assert.equal(sec2.instructions.length > 0, true);
  assert.ok(sec2.instructions[0].includes("Select all correct options"));
  assert.equal(sec2.questions[0].correctAnswer, "A, B, C");
  assert.equal(sec2.questions[1].correctAnswer, "A, B, C");

  // Section 3: Assertion and Reasoning
  const sec3 = parsed.sections[2];
  assert.ok(sec3.type === "assertion_reason" || sec3.type === "assertion_reasoning");
  assert.equal(sec3.questions.length, 2);
  assert.ok(sec3.questions[0].assertionText?.includes("MNCs play an important role"));
  assert.ok(sec3.questions[0].reasonText?.includes("MNCs organise production"));
  assert.equal(sec3.questions[0].correctAnswer, "A");

  // Section 4: Comprehension
  const sec4 = parsed.sections[3];
  assert.equal(sec4.type, "comprehension");
  assert.equal(sec4.questions.length, 7);
  const passageKeys = Object.keys(parsed.passages);
  assert.ok(passageKeys.length >= 1);
  const passage = parsed.passages[passageKeys[0]];
  assert.ok(passage.text.includes("Globalisation has increased the movement of goods"));

  // Check child questions of comprehension: not merged, have parent passageId
  for (let i = 0; i < 7; i++) {
    assert.ok(sec4.questions[i].passageId);
  }
  // Q1-Q4 are MCQs, Q5-Q7 are short answer
  assert.equal(sec4.questions[0].type, "mcq");
  assert.equal(sec4.questions[0].correctAnswer, "B");
  assert.equal(sec4.questions[4].type, "short_answer");
  assert.equal(sec4.questions[4].isSubjective, true);
  assert.ok(sec4.questions[4].modelAnswer?.includes("movement of goods"));

  // Section 5: True and False
  const sec5 = parsed.sections[4];
  assert.equal(sec5.type, "true_false");
  assert.equal(sec5.questions.length, 4);
  assert.equal(sec5.questions[0].correctAnswer, "False");
  assert.equal(sec5.questions[1].correctAnswer, "True");
  assert.equal(sec5.questions[2].correctAnswer, "False");
  assert.equal(sec5.questions[3].correctAnswer, "True");

  // Section 6: Very Short Answer Questions
  const sec6 = parsed.sections[5];
  assert.equal(sec6.type, "very_short_answer");
  assert.equal(sec6.questions.length, 2);
  assert.equal(sec6.questions[0].isSubjective, true);
  assert.ok(sec6.questions[0].modelAnswer?.includes("multinational corporation"));

  // Section 7: Short Answer Questions
  const sec7 = parsed.sections[6];
  assert.equal(sec7.type, "short_answer");
  assert.equal(sec7.questions.length, 2);
  assert.equal(sec7.questions[0].isSubjective, true);
  assert.ok(sec7.questions[0].modelAnswer?.includes("MNCs may set up factories"));

  // Section 8: Long Answer Questions
  const sec8 = parsed.sections[7];
  assert.equal(sec8.type, "long_answer");
  assert.equal(sec8.questions.length, 2);
  assert.equal(sec8.questions[0].isSubjective, true);
  assert.ok(sec8.questions[0].modelAnswer?.includes("Three major factors that have enabled globalisation"));

  // Section 9: Case-Based Questions
  const sec9 = parsed.sections[8];
  assert.equal(sec9.type, "case_based");
  assert.equal(sec9.questions.length, 4);
  const caseKeys = Object.keys(parsed.cases);
  assert.ok(caseKeys.length >= 1);
  const caseItem = parsed.cases[caseKeys[0]];
  assert.ok(caseItem.text.includes("A multinational company based in Country A"));
  for (let i = 0; i < 4; i++) {
    assert.ok(sec9.questions[i].caseId);
    assert.equal(sec9.questions[i].isSubjective, true);
  }

  // Marks validation
  assert.equal(parsed.validation.totalCalculatedMarks > 0, true);
});

test("Chapter Test Parser handles Section A through Section I format with all 9 distinct categories", () => {
  const customNineSectionPaper = `
Time Allowed: 3 Hours
Maximum Marks: 36
General Instructions:
1. All questions are compulsory.
2. The question paper contains 9 sections from Section A to Section I.

Section A — Multiple Choice Questions (1 mark each)
1. Which layer of the atmosphere contains the ozone layer?
A. Troposphere
B. Stratosphere
C. Mesosphere
D. Thermosphere
Answer: B

Section B — Multiple Select Questions (2 marks each)
Directions: Select all correct options.
2. Which of the following are greenhouse gases?
A. Carbon dioxide
B. Methane
C. Water vapour
D. Argon
Answer: A, B, C

Section C — Assertion and Reasoning (1 mark each)
Directions: Read Assertion (A) and Reason (R).
3. Assertion (A): Photosynthesis releases oxygen into the atmosphere.
Reason (R): Plants split water molecules in the light reaction.
A. Both A and R are true and R is correct explanation of A.
B. Both A and R are true but R is not correct explanation of A.
C. A is true but R is false.
D. A is false but R is true.
Answer: A

Section D — Comprehension (2 marks each)
Read the passage carefully.
Renewable energy sources such as solar and wind power provide clean alternatives to fossil fuels. They produce little to no greenhouse gases during operation.
Answer the following questions.

4. What is a primary benefit of solar and wind power?
A. Higher greenhouse gas emissions
B. Clean alternatives to fossil fuels
C. Infinite storage capacity
D. Zero manufacturing cost
Answer: B

5. Why are renewable energy sources vital for mitigating climate change?
Answer: They produce little to no greenhouse gases during operation.

Section E — True and False (1 mark each)
Directions: State True or False.
6. Sound waves can travel through a perfect vacuum.
Answer: False

7. Light travels faster in air than in glass.
Answer: True

Section F — Very Short Answer Questions (1 mark each)
8. Define inertia in one sentence.
Answer: Inertia is the inherent property of an object to resist changes in its state of rest or uniform motion.

Section G — Short Answer Questions (3 marks each)
9. State two differences between transverse and longitudinal waves.
Answer: In transverse waves particles oscillate perpendicular to propagation; in longitudinal waves particles oscillate parallel.

Section H — Long Answer Questions (5 marks each)
10. Describe the steps involved in the Nitrogen cycle.
Answer: The nitrogen cycle includes nitrogen fixation, nitrification, assimilation, ammonification, and denitrification.

Section I — Case-Based Questions (4 marks each)
Read the case carefully.
A solar power station was set up in a rural village with high solar irradiance. Over two years, the village witnessed a 40% decrease in reliance on diesel generators.

11. What caused the reduction in diesel generator usage in the village?
Answer: The installation and operation of the rural solar power station.
`;

  const parsed = parseChapterTest(customNineSectionPaper, {
    classGrade: "Class 10",
    subject: "Science",
    chapterNo: 14,
    chapterName: "Sources of Energy"
  });

  assert.equal(parsed.validation.isValid, true);
  assert.equal(parsed.sections.length, 9);
  assert.equal(parsed.questions.length, 11);

  // Check section letters A through I
  const expectedLetters = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
  const expectedTypes = [
    "mcq",
    "multiple_select",
    "assertion_reason",
    "comprehension",
    "true_false",
    "very_short_answer",
    "short_answer",
    "long_answer",
    "case_based"
  ];

  parsed.sections.forEach((sec, idx) => {
    assert.equal(sec.sectionLetter, expectedLetters[idx]);
    assert.ok(sec.type === expectedTypes[idx] || (expectedTypes[idx] === "assertion_reason" && sec.type === "assertion_reasoning"));
    assert.ok(sec.questions.length > 0);
  });

  // Verify options are NOT omitted for MCQ and MSQ
  assert.equal(parsed.sections[0].questions[0].options.length, 4);
  assert.equal(parsed.sections[1].questions[0].options.length, 4);
  assert.equal(parsed.sections[2].questions[0].options.length, 4);

  // Verify adapter convertToAssessmentQuestions maintains compatibility
  const adapterResult = convertToAssessmentQuestions(parsed, mockContext);
  assert.equal(adapterResult.questions.length, 11);
  assert.ok(Object.keys(adapterResult.passages).length >= 1);
  assert.ok(Object.keys(adapterResult.cases).length >= 1);
});

test("Chapter Test Parser detects marks mismatch and logs warning without dropping questions", () => {
  const mismatchPaper = `
Maximum Marks: 100

Section A — Multiple Choice Questions (2 marks each)
1. Capital of France?
A. Berlin
B. Paris
C. Madrid
D. Rome
Answer: B

2. Capital of Japan?
A. Seoul
B. Tokyo
C. Beijing
D. Bangkok
Answer: B
`;

  const parsed = parseChapterTest(mismatchPaper, mockContext);
  assert.equal(parsed.validation.isValid, true);
  assert.equal(parsed.questions.length, 2);
  assert.equal(parsed.validation.totalCalculatedMarks, 4);
  assert.equal(parsed.validation.declaredTotalMarks, 100);
  assert.equal(parsed.validation.marksMatch, false);
  assert.ok(parsed.validation.warnings.some((w) => w.includes("Declared test total marks (100)")));
});

test("Question Type display names are clear and complete", () => {
  assert.equal(getQuestionTypeDisplayName("mcq"), "Multiple Choice");
  assert.equal(getQuestionTypeDisplayName("multiple_select"), "Multiple Select");
  assert.equal(getQuestionTypeDisplayName("msq"), "Multiple Select");
  assert.equal(getQuestionTypeDisplayName("assertion_reason"), "Assertion and Reasoning");
  assert.equal(getQuestionTypeDisplayName("assertion_reasoning"), "Assertion and Reasoning");
  assert.equal(getQuestionTypeDisplayName("comprehension", false), "Comprehension Group");
  assert.equal(getQuestionTypeDisplayName("comprehension", true), "Comprehension Question");
  assert.equal(getQuestionTypeDisplayName("true_false"), "True or False");
  assert.equal(getQuestionTypeDisplayName("very_short_answer"), "Very Short Answer");
  assert.equal(getQuestionTypeDisplayName("short_answer"), "Short Answer");
  assert.equal(getQuestionTypeDisplayName("long_answer"), "Long Answer");
  assert.equal(getQuestionTypeDisplayName("case_based", false), "Case-Based Group");
  assert.equal(getQuestionTypeDisplayName("case_based", true), "Case-Based Question");
  assert.equal(getQuestionTypeDisplayName("unknown"), "Needs Review");
});
