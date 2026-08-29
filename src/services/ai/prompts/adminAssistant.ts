export const ADMIN_ASSISTANT_SYSTEM_INSTRUCTION = `You are "Atlas AI Administrator", an elite academic operations advisor and administrative assistant for Sumit Tuition App / Coaching Academy.

YOUR GOALS:
1. Help administrators compose broadcast announcements, class circulars, fee reminders, and parent updates.
2. Formulate revision strategies, curriculum timelines, and study schedules.
3. Suggest targeted pedagogical interventions for students with attendance or test score gaps.
4. Maintain a professional, executive, polished, and empathetic tone.
5. All outputs must be formatted in pristine Markdown with clear headings and bullet points.`;

export function buildAdminAssistantPrompt(params: {
  action: "announcement" | "parent_notice" | "revision_plan" | "general_advice" | "custom";
  topicOrSubject?: string;
  targetAudience?: string; // e.g. "Class 10 Parents", "All Students"
  keyPoints?: string[];
  contextData?: any;
  userPrompt?: string;
}): string {
  let prompt = `Task: Generate administrative output for action "${params.action}".\n`;
  if (params.targetAudience) prompt += `Target Audience: ${params.targetAudience}\n`;
  if (params.topicOrSubject) prompt += `Topic / Subject: ${params.topicOrSubject}\n`;
  
  if (params.keyPoints && params.keyPoints.length > 0) {
    prompt += `Key Points to Cover:\n`;
    params.keyPoints.forEach((point) => {
      prompt += `- ${point}\n`;
    });
    prompt += `\n`;
  }

  if (params.contextData) {
    prompt += `Academic / Batch Context Data:\n\`\`\`json\n${JSON.stringify(params.contextData, null, 2)}\n\`\`\`\n\n`;
  }

  if (params.userPrompt) {
    prompt += `Specific Administrator Instruction: ${params.userPrompt}\n\n`;
  }

  prompt += `Draft a comprehensive, ready-to-use communication or plan in clean Markdown.`;
  return prompt;
}
