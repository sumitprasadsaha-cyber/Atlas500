import test from "node:test";
import assert from "node:assert/strict";
import { parseUniversalTestText } from "./universalTestParser";

const mockContext = {
  classGrade: "Class 10",
  subject: "Science",
  chapterNo: 6,
  chapterName: "Life Processes",
  topicName: "Nutrition & Respiration"
};

test("Universal Parser: Parses mixed question paper with Sections A to E and Marks", () => {
  const mixedPaper = `
Chapter: Life Processes
Topic: Nutrition & Respiration
Theme: Biology

Section A: Multiple Choice Questions (1 Mark each)

1. Which is the first enzyme to mix with food in the digestive tract? [1 Mark]
A. Pepsin
B. Cellulase
C. Amylase
D. Trypsin
Correct Answer: C

2. Which part of the alimentary canal receives bile from the liver? [1 Mark]
A. Stomach
B. Small intestine
C. Large intestine
D. Oesophagus
Correct Answer: B

Section B: Assertion & Reasoning (1 Mark each)

3. Assertion (A): In human beings, the respiratory pigment is haemoglobin. [1 Mark]
Reason (R): Haemoglobin has a very high affinity for oxygen.
A. Both A and R are true and R is the correct explanation of A.
B. Both A and R are true but R is not the correct explanation of A.
C. A is true but R is false.
D. A is false but R is true.
Correct Answer: A

Section C: Very Short Answer (1 Mark each)

4. Define peristaltic movements. [1 Mark]
Model Answer: The rhythmic contraction and relaxation of muscles lining the alimentary canal to push food forward.

Section D: Short Answer (3 Marks each)

5. Differentiate between autotrophic nutrition and heterotrophic nutrition. [3 Marks]
Model Answer: Autotrophic nutrition involves organisms synthesizing their own food from simple inorganic substances like CO2 and water. Heterotrophic nutrition involves organisms depending on other organisms for food.

Section E: Long Answer (5 Marks)

6. Explain the process of digestion in the human stomach and small intestine with relevant enzymes. [5 Marks]
Model Answer: In the stomach, gastric glands secrete HCl, pepsin, and mucus... In the small intestine, bile emulsifies fats, pancreatic lipase breaks down fats...
`;

  const res = parseUniversalTestText(mixedPaper, mockContext);

  assert.equal(res.success, true);
  assert.equal(res.questions.length, 6);

  // Metadata
  assert.equal(res.metadata?.chapter, "Life Processes");
  assert.equal(res.metadata?.topic, "Nutrition & Respiration");

  // Sections
  assert.equal(res.sections.length, 5);

  // Q1: MCQ
  assert.equal(res.questions[0].type, "mcq");
  assert.equal(res.questions[0].correctAnswer, "C");
  assert.equal(res.questions[0].marks, 1);

  // Q3: Assertion Reason
  assert.equal(res.questions[2].type, "assertion_reason");
  assert.equal(res.questions[2].correctAnswer, "A");

  // Q4: Very Short Answer
  assert.equal(res.questions[3].type, "very_short_answer");
  assert.equal(res.questions[3].commandWord, "Define");
  assert.equal(res.questions[3].marks, 1);
  assert.ok(res.questions[3].modelAnswer?.includes("rhythmic contraction"));

  // Q5: Short Answer
  assert.equal(res.questions[4].type, "short_answer");
  assert.equal(res.questions[4].commandWord, "Differentiate");
  assert.equal(res.questions[4].marks, 3);

  // Q6: Long Answer
  assert.equal(res.questions[5].type, "long_answer");
  assert.equal(res.questions[5].commandWord, "Explain");
  assert.equal(res.questions[5].marks, 5);

  // Total marks calculation
  assert.equal(res.report.totalMarks, 12);
});

test("Universal Parser: Resolves separate Answer Key at the end of the text", () => {
  const paperWithEndKey = `
1. What is the unit of electric current?
A. Volt
B. Ampere
C. Ohm
D. Watt

2. Photosynthesis occurs in chloroplasts.
True
False

3. Name the universal donor blood group.

Answer Key:
1. B
2. True
3. O Negative
`;

  const res = parseUniversalTestText(paperWithEndKey, mockContext);

  assert.equal(res.success, true);
  assert.equal(res.questions.length, 3);

  assert.equal(res.questions[0].correctAnswer, "B");
  assert.equal(res.questions[1].type, "true_false");
  assert.equal(res.questions[1].correctAnswer, "True");
  assert.equal(res.questions[2].type, "very_short_answer");
  assert.equal(res.questions[2].modelAnswer, "O Negative");
});

test("Universal Parser: Parses Case Study with child questions", () => {
  const casePaper = `
Case Study 1:
Read the following case study carefully:
Photosynthesis is an anabolic endergonic process occurring in chloroplasts. Light reactions produce ATP and NADPH which are subsequently utilized in the Calvin cycle to assimilate carbon dioxide into sugars.

1. Where do the light-dependent reactions take place?
A. Stroma
B. Thylakoid membrane
C. Outer membrane
D. Matrix
Correct Answer: B

2. Name the two energy-rich products generated in the light reactions.
Model Answer: ATP and NADPH
`;

  const res = parseUniversalTestText(casePaper, mockContext);

  assert.equal(res.success, true);
  assert.equal(res.questions.length, 2);
  assert.equal(res.report.caseStudyCount, 1);

  const caseId = Object.keys(res.caseStudies)[0];
  assert.ok(caseId);
  assert.ok(res.caseStudies[caseId].text.includes("Calvin cycle"));

  assert.equal(res.questions[0].caseId, caseId);
  assert.equal(res.questions[1].caseId, caseId);
});

test("Universal Parser: Dynamic 60 questions test without truncation", () => {
  let batchText = "MCQs\n\n";
  for (let i = 1; i <= 60; i++) {
    batchText += `${i}. Question number ${i} about science concepts?\nA. Option Alpha\nB. Option Beta\nC. Option Gamma\nD. Option Delta\nCorrect Answer: ${i % 2 === 0 ? "A" : "B"}\n\n`;
  }

  const res = parseUniversalTestText(batchText, mockContext);

  assert.equal(res.success, true);
  assert.equal(res.questions.length, 60);
  assert.equal(res.report.totalDetected, 60);
  assert.equal(res.report.successfullyParsed, 60);
});
