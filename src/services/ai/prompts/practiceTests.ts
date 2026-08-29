export const PRACTICE_TEST_SYSTEM_INSTRUCTION = `You are a master academic examiner and test paper author for school and competitive curricula (Classes 6-12, CBSE/ICSE/State Board, UPSC General Studies).
Your task is to generate high-quality, pedagogically sound, and error-free practice test questions with accurate answer keys and crystal-clear explanations.`;

export function buildPracticeTestPrompt(params: {
  classGrade: string;
  subject: string;
  chapterNo?: number;
  chapterName: string;
  topicName?: string;
  questionCount: number;
  questionType: "mcq" | "true_false" | "assertion_reason" | "mixed";
  difficulty: "Easy" | "Medium" | "Hard" | "Mixed";
  language?: string;
  syllabusContext?: string;
}): string {
  let prompt = `Create a rigorous, curriculum-aligned Practice Test with EXACTLY ${params.questionCount} questions.\n\n`;
  prompt += `Curriculum Specifications:\n`;
  prompt += `- Class / Grade: ${params.classGrade}\n`;
  prompt += `- Subject: ${params.subject}\n`;
  if (params.chapterNo) prompt += `- Chapter Number: ${params.chapterNo}\n`;
  prompt += `- Chapter Name: ${params.chapterName}\n`;
  if (params.topicName) prompt += `- Topic Name: ${params.topicName}\n`;
  prompt += `- Question Format: ${params.questionType}\n`;
  prompt += `- Target Difficulty: ${params.difficulty}\n`;
  if (params.language) prompt += `- Language: ${params.language}\n`;

  if (params.syllabusContext) {
    prompt += `\nStudy Material Reference / Source Content:\n\"\"\"\n${params.syllabusContext.slice(0, 10000)}\n\"\"\"\n`;
  }

  prompt += `\nOutput a valid JSON object matching the following structure:
{
  "testTitle": "Title of the test",
  "totalQuestions": ${params.questionCount},
  "estimatedTimeMinutes": ${Math.max(10, params.questionCount * 2)},
  "questions": [
    {
      "id": "q1",
      "type": "mcq", // "mcq" | "true_false" | "assertion_reason"
      "question": "Clear question stem text",
      "options": [
        "A. Option text",
        "B. Option text",
        "C. Option text",
        "D. Option text"
      ],
      "correctAnswer": "A", // "A", "B", "C", "D" or "True", "False"
      "explanation": "Detailed explanation of why this answer is correct and why other options are incorrect.",
      "difficulty": "Easy" // "Easy" | "Medium" | "Hard"
    }
  ],
  "formattedRawText": "Formatted human-readable test text with questions, options, checkmarks on correct options, and explanations matching standard format"
}`;

  return prompt;
}
