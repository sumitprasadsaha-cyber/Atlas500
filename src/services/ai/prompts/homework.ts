export const HOMEWORK_SYSTEM_INSTRUCTION = `You are an expert curriculum designer.
Your task is to generate structured homework assignments with instructions, problem sets, rubrics, hints, and expected solutions.`;

export function buildHomeworkPrompt(params: {
  classGrade: string;
  subject: string;
  chapterName: string;
  topicName?: string;
  difficulty: "Easy" | "Medium" | "Hard" | "Mixed";
  learningObjectives?: string[];
  estimatedDurationMinutes?: number;
}): string {
  let prompt = `Generate a comprehensive homework assignment for students.\n\n`;
  prompt += `Specifications:\n`;
  prompt += `- Class / Grade: ${params.classGrade}\n`;
  prompt += `- Subject: ${params.subject}\n`;
  prompt += `- Chapter: ${params.chapterName}\n`;
  if (params.topicName) prompt += `- Topic: ${params.topicName}\n`;
  prompt += `- Difficulty: ${params.difficulty}\n`;
  if (params.estimatedDurationMinutes) prompt += `- Estimated Time: ${params.estimatedDurationMinutes} minutes\n`;

  if (params.learningObjectives && params.learningObjectives.length > 0) {
    prompt += `- Targeted Learning Objectives: ${params.learningObjectives.join(", ")}\n`;
  }

  prompt += `\nReturn a valid JSON object matching the following structure:
{
  "title": "Homework Assignment Title",
  "subject": "${params.subject}",
  "chapter": "${params.chapterName}",
  "instructions": "Clear step-by-step instructions for the student",
  "dueDateSuggestionDays": 3,
  "estimatedMinutes": 30,
  "problems": [
    {
      "id": "hw-1",
      "section": "Concept Application" | "Problem Solving" | "Critical Thinking",
      "question": "Detailed question or assignment task",
      "points": 5,
      "hint": "Helpful hint without giving away the complete solution",
      "rubric": "Evaluation criteria for 5 full marks",
      "expectedSolution": "Step-by-step model answer for teacher grading"
    }
  ],
  "formattedMarkdown": "Formatted markdown text ready to display or print as a worksheet"
}`;

  return prompt;
}
