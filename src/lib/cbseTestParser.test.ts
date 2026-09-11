import test from "node:test";
import assert from "node:assert/strict";
import {
  parseChapterTest,
  getQuestionTypeDisplayName,
  extractSectionMarksFormula
} from "./testParser";

const mockContext = {
  classGrade: "Class 10",
  subject: "Science",
  chapterNo: 1,
  chapterName: "Chemical Reactions and Equations",
  topicName: "Chemical Equations"
};

const cbseFullSamplePaper = `
CBSE CLASS 10 CHAPTER TEST
Subject: Science
Chapter 1: Chemical Reactions and Equations
Time Allowed: 3 Hours
Maximum Marks: 34

General Instructions:
1. All questions are compulsory.
2. The question paper contains 7 sections from Section A to Section G.
3. Internal choices are provided in some questions.

Section A — Multiple Choice Questions (5 × 1 = 5 Marks)
1. Which of the following is a displacement reaction?
A. CaO + H2O -> Ca(OH)2
B. Fe + CuSO4 -> FeSO4 + Cu
C. 2H2O -> 2H2 + O2
D. NaOH + HCl -> NaCl + H2O
Answer: B

2. Rusting of iron is an example of:
A. Reduction
B. Oxidation
C. Decomposition
D. Neutralisation
Answer: B

Section B — Assertion and Reasoning (4 × 1 = 4 Marks)
Directions: Read Assertion (A) and Reason (R) carefully.
A. Both Assertion (A) and Reason (R) are true and Reason (R) is the correct explanation of Assertion (A).
B. Both Assertion (A) and Reason (R) are true but Reason (R) is not the correct explanation of Assertion (A).
C. Assertion (A) is true but Reason (R) is false.
D. Assertion (A) is false but Reason (R) is true.

3. Assertion (A): Magnesium ribbon is rubbed with sandpaper before burning in air.
Reason (R): Rubbing removes the protective layer of basic magnesium carbonate from its surface.
Answer: A

4. Assertion (A): Decomposition of vegetable matter into compost is an endothermic reaction.
Reason (R): Decomposition involves breakdown of organic compounds.
Answer: D

Section C — Very Short Answer Questions (3 × 2 = 6 Marks)
5. State the law of conservation of mass in a chemical reaction.
Answer: Mass can neither be created nor destroyed in a chemical reaction; total mass of reactants equals total mass of products.

6. What is observed when lead nitrate powder is heated in a boiling tube?
Answer: Brown fumes of nitrogen dioxide gas (NO2) are evolved and a yellow residue of lead monoxide is formed.

Section D — Short Answer Questions (2 × 3 = 6 Marks)
7. Differentiate between exothermic and endothermic reactions with one example each.
Answer: Exothermic reactions release heat into the surroundings (e.g. burning of natural gas). Endothermic reactions absorb heat from the surroundings (e.g. decomposition of calcium carbonate).

8. Why is respiration considered an exothermic process? Explain.
Answer: During respiration, glucose combines with oxygen in the cells of our body and releases substantial energy for bodily activities.

Section E — Long Answer Questions (1 × 5 = 5 Marks)
9. Explain oxidation and reduction with chemical equations. Define redox reaction with an illustrative balanced equation identifying the oxidised and reduced substances.
Answer: Oxidation is the gain of oxygen or loss of hydrogen. Reduction is the gain of hydrogen or loss of oxygen. In CuO + H2 -> Cu + H2O, CuO is reduced to Cu and H2 is oxidised to H2O.

Section F — Case-Based Questions (2 × 4 = 8 Marks)
Case Study:
Corrosion is a natural process that converts a refined metal into a more chemically stable form such as oxide, hydroxide, or sulfide. Galvanisation is a method of protecting steel and iron from rusting by coating them with a thin layer of zinc.

10. What is the protective coating used in galvanisation?
A. Copper
B. Zinc
C. Silver
D. Aluminum
Answer: B

11. Why does zinc prevent iron from rusting even if the zinc coating is scratched?
Answer: Zinc is more reactive than iron, so it oxidises preferentially and sacrifices itself to protect the underlying iron.

Section G — Comprehension
Read the passage carefully and answer the questions below:
Electrolysis of water is the decomposition of water into oxygen and hydrogen gas due to the passage of an electric current through it. The volume of hydrogen gas collected at the cathode is double the volume of oxygen gas collected at the anode.

12. In the electrolysis of water, which gas is collected at the cathode?
A. Oxygen
B. Hydrogen
C. Nitrogen
D. Chlorine
Answer: B

13. State the ratio by volume in which hydrogen and oxygen are liberated during electrolysis of water.
Answer: Hydrogen and oxygen are liberated in a 2:1 ratio by volume because a water molecule consists of two hydrogen atoms and one oxygen atom.
`;

test("CBSE Assertion 1 & 9: Section marks formula extraction", () => {
  const f1 = extractSectionMarksFormula("Section A — Multiple Choice Questions (5 × 1 = 5 Marks)");
  assert.ok(f1);
  assert.equal(f1.questionCount, 5);
  assert.equal(f1.marksPerQuestion, 1);
  assert.equal(f1.totalMarks, 5);

  const f2 = extractSectionMarksFormula("Section B (4 × 1 = 4 Marks)");
  assert.ok(f2);
  assert.equal(f2.marksPerQuestion, 1);
  assert.equal(f2.totalMarks, 4);

  const f3 = extractSectionMarksFormula("3 x 2 = 6 Marks");
  assert.ok(f3);
  assert.equal(f3.marksPerQuestion, 2);
  assert.equal(f3.totalMarks, 6);

  const f4 = extractSectionMarksFormula("2 x 3 = 6 Marks");
  assert.ok(f4);
  assert.equal(f4.marksPerQuestion, 3);
  assert.equal(f4.totalMarks, 6);

  const f5 = extractSectionMarksFormula("1 x 5 = 5 Marks");
  assert.ok(f5);
  assert.equal(f5.marksPerQuestion, 5);
  assert.equal(f5.totalMarks, 5);

  const f6 = extractSectionMarksFormula("2 × 4 = 8 Marks");
  assert.ok(f6);
  assert.equal(f6.marksPerQuestion, 4);
  assert.equal(f6.totalMarks, 8);
});

test("CBSE Test Parser passes all 12 core requirements", () => {
  const parsed = parseChapterTest(cbseFullSamplePaper, mockContext);

  // Assertion 1: Section detection identifies all sections with correct types
  assert.equal(parsed.sections.length, 7);
  assert.equal(parsed.sections[0].type, "mcq");
  assert.ok(parsed.sections[1].type === "assertion_reason" || parsed.sections[1].type === "assertion_reasoning");
  assert.equal(parsed.sections[2].type, "very_short_answer");
  assert.equal(parsed.sections[3].type, "short_answer");
  assert.equal(parsed.sections[4].type, "long_answer");
  assert.equal(parsed.sections[5].type, "case_based");
  assert.equal(parsed.sections[6].type, "comprehension");

  // Assertion 2: Questions are correctly associated with their parent section
  parsed.questions.forEach((q) => {
    assert.ok(q.sectionId, `Question ${q.questionNumber} missing sectionId`);
    assert.ok(q.sectionLetter, `Question ${q.questionNumber} missing sectionLetter`);
    assert.ok(q.sectionTitle, `Question ${q.questionNumber} missing sectionTitle`);
  });

  // Assertion 3: Assertion and Reasoning question fields
  const arQ = parsed.questions.find((q) => q.questionNumber === 3);
  assert.ok(arQ);
  assert.ok(arQ.type === "assertion_reason" || arQ.type === "assertion_reasoning");
  assert.ok(arQ.assertion?.includes("Magnesium ribbon is rubbed") || arQ.assertionText?.includes("Magnesium ribbon is rubbed"));
  assert.ok(arQ.reason?.includes("protective layer") || arQ.reasonText?.includes("protective layer"));
  assert.equal(arQ.correctAnswer, "A");

  // Assertion 4: Very Short Answer questions
  const vsaQ = parsed.questions.find((q) => q.questionNumber === 5);
  assert.ok(vsaQ);
  assert.equal(vsaQ.type, "very_short_answer");
  assert.notEqual(vsaQ.type, "comprehension");
  assert.ok(vsaQ.modelAnswer?.includes("Mass can neither be created nor destroyed"));

  // Assertion 5: Short Answer questions
  const saQ = parsed.questions.find((q) => q.questionNumber === 7);
  assert.ok(saQ);
  assert.equal(saQ.type, "short_answer");
  assert.notEqual(saQ.type, "comprehension");
  assert.ok(saQ.modelAnswer?.includes("Exothermic reactions release heat"));

  // Assertion 6: Long Answer questions
  const laQ = parsed.questions.find((q) => q.questionNumber === 9);
  assert.ok(laQ);
  assert.equal(laQ.type, "long_answer");
  assert.notEqual(laQ.type, "comprehension");
  assert.ok(laQ.modelAnswer?.includes("Oxidation is the gain of oxygen"));

  // Assertion 7: Case-Based parent group
  const caseQ1 = parsed.questions.find((q) => q.questionNumber === 10);
  const caseQ2 = parsed.questions.find((q) => q.questionNumber === 11);
  assert.ok(caseQ1);
  assert.ok(caseQ2);
  assert.ok(caseQ1.groupId);
  assert.equal(caseQ1.groupId, caseQ2.groupId);
  assert.equal(caseQ1.groupType, "case_based");
  assert.ok(caseQ1.groupContent?.includes("Galvanisation is a method of protecting steel"));
  assert.equal(caseQ1.type, "mcq"); // child question type preserved as MCQ
  assert.equal(caseQ2.type, "short_answer"); // child question type preserved as short_answer

  // Assertion 8: Comprehension parent group
  const compQ1 = parsed.questions.find((q) => q.questionNumber === 12);
  const compQ2 = parsed.questions.find((q) => q.questionNumber === 13);
  assert.ok(compQ1);
  assert.ok(compQ2);
  assert.ok(compQ1.groupId);
  assert.equal(compQ1.groupId, compQ2.groupId);
  assert.equal(compQ1.groupType, "comprehension");
  assert.ok(compQ1.groupContent?.includes("Electrolysis of water is the decomposition of water"));
  assert.equal(compQ1.type, "mcq"); // child question preserved as MCQ
  assert.equal(compQ2.type, "short_answer"); // child question preserved as short_answer

  // Assertion 10: Individual question marks inherited from section formulas
  assert.equal(parsed.questions[0].marks, 1); // Section A formula: 1 mark
  assert.equal(arQ.marks, 1); // Section B formula: 1 mark
  assert.equal(vsaQ.marks, 2); // Section C formula: 2 marks
  assert.equal(saQ.marks, 3); // Section D formula: 3 marks
  assert.equal(laQ.marks, 5); // Section E formula: 5 marks
  assert.equal(caseQ1.marks, 4); // Section F formula: 4 marks

  // Assertion 11: Calculated marks
  assert.equal(parsed.sections[0].declaredMarks, 5);
  assert.equal(parsed.sections[1].declaredMarks, 4);
  assert.equal(parsed.sections[2].declaredMarks, 6);
  assert.equal(parsed.sections[3].declaredMarks, 6);
  assert.equal(parsed.sections[4].declaredMarks, 5);
  assert.equal(parsed.sections[5].declaredMarks, 8);
  assert.equal(parsed.metadata.declaredTotalMarks, 34);

  // Assertion 12: UI helper maps every internal type to correct human-readable label
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
