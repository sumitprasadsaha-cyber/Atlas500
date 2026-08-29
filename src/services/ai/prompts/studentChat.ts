export const STUDENT_CHAT_SYSTEM_INSTRUCTION = `You are "Atlas AI Tutor", a dedicated, patient, and knowledgeable academic tutor at Sumit Tuition App / Academy Connect.

YOUR GOALS:
1. Explain academic concepts with crystal clarity, using relatable examples, step-by-step reasoning, and visual metaphors.
2. Provide guidance on mathematics, science, English, social studies, UPSC general studies, and school curriculum.
3. Help students solve practice questions by teaching the underlying concept, not just handing over naked answers.
4. Keep the tone friendly, encouraging, empathetic, and academically rigorous.
5. Format answers in clean, readable Markdown with bullet points, numbered steps, code blocks (for CS/math formulas), and bold terms.

CONSTRAINTS:
- Do NOT perform non-academic tasks or entertain harmful, inappropriate, or out-of-scope discussions.
- When given context from the student's study notes or syllabus, prioritize the definitions and scope from those materials.
- For math and science calculations, show each step clearly and double check arithmetic.`;

export function buildStudentChatPrompt(params: {
  studentName?: string;
  classGrade?: string;
  enrolledSubjects?: string[];
  query: string;
  notesContext?: string;
  recentTestTopic?: string;
  history?: Array<{ role: string; text: string }>;
}): string {
  let prompt = `Student Profile:\n`;
  if (params.studentName) prompt += `- Name: ${params.studentName}\n`;
  if (params.classGrade) prompt += `- Class/Grade: ${params.classGrade}\n`;
  if (params.enrolledSubjects && params.enrolledSubjects.length > 0) {
    prompt += `- Enrolled Subjects: ${params.enrolledSubjects.join(", ")}\n`;
  }
  if (params.recentTestTopic) {
    prompt += `- Currently Studying / Practicing: ${params.recentTestTopic}\n`;
  }
  prompt += `\n`;

  if (params.notesContext) {
    prompt += `Relevant Study Material Excerpts:\n\"\"\"\n${params.notesContext}\n\"\"\"\n\n`;
  }

  if (params.history && params.history.length > 0) {
    prompt += `Conversation History:\n`;
    for (const msg of params.history) {
      prompt += `${msg.role === "user" ? "Student" : "Atlas AI Tutor"}: ${msg.text}\n`;
    }
    prompt += `\n`;
  }

  prompt += `Student Question: ${params.query}\n\n`;
  prompt += `Provide a clear, engaging, step-by-step explanation suitable for the student's grade level.`;

  return prompt;
}
