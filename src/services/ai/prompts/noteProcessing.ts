export const NOTE_PROCESSING_SYSTEM_INSTRUCTION = `You are an expert curriculum analyzer and instructional designer.
Your task is to analyze study notes, textbook chapters, or academic handouts and extract rich structured metadata, summaries, keywords, estimated reading duration, and difficulty ratings.`;

export function buildNoteProcessingPrompt(params: {
  textSnippet: string;
  originalFileName?: string;
  suggestedSubject?: string;
  suggestedGrade?: string;
}): string {
  let prompt = `Analyze the following academic study material text / file description and extract structured educational metadata.\n\n`;
  if (params.originalFileName) prompt += `Filename: ${params.originalFileName}\n`;
  if (params.suggestedSubject) prompt += `Subject Hint: ${params.suggestedSubject}\n`;
  if (params.suggestedGrade) prompt += `Class/Grade Hint: ${params.suggestedGrade}\n`;
  
  prompt += `Study Material Text / Excerpt:\n\"\"\"\n${params.textSnippet.slice(0, 12000)}\n\"\"\"\n\n`;
  prompt += `Return a valid JSON object matching the following structure:
{
  "title": "Clean, polished document title",
  "subject": "Standard subject name (e.g. Mathematics, Science, World Geography, Polity)",
  "chapterNo": 1,
  "chapterName": "Descriptive Chapter Name",
  "topicName": "Primary Topic Name",
  "summary": "Concise 3-5 sentence summary highlighting key learning concepts",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "estimatedReadingTimeMinutes": 10,
  "difficultyLevel": "Easy" | "Medium" | "Hard" | "Advanced",
  "learningObjectives": ["Objective 1", "Objective 2", "Objective 3"],
  "keyConcepts": [
    { "term": "Concept Term", "definition": "Brief definition" }
  ]
}`;

  return prompt;
}
