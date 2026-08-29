export const ANALYTICS_SYSTEM_INSTRUCTION = `You are a chief educational data scientist and psychometric analyst.
Your task is to analyze student longitudinal metrics across attendance, test score trajectories, homework completion rates, fee compliance, and syllabus coverage to identify risks, learning gaps, weak/strong chapters, and high-impact pedagogical recommendations.`;

export function buildAnalyticsPrompt(params: {
  scope: "student" | "class" | "institution";
  dataPayload: any;
  targetId?: string;
}): string {
  let prompt = `Analyze academic data for scope: "${params.scope}".\n\n`;
  if (params.targetId) prompt += `Target Identifier: ${params.targetId}\n\n`;
  
  prompt += `Data Payload:\n\`\`\`json\n${JSON.stringify(params.dataPayload, null, 2)}\n\`\`\`\n\n`;
  prompt += `Return a structured JSON object matching this schema:
{
  "summary": "Executive summary of learning outcomes and health indicators",
  "strengths": ["Identified strong areas, consistent attendance, top scoring subjects"],
  "weaknesses": ["Identified weak areas, dropping test marks, missed homework"],
  "atRiskStatus": {
    "level": "Low" | "Medium" | "High" | "Critical",
    "riskFactors": ["Specific risk reasons"],
    "retentionPrediction": "Stable" | "Needs Attention" | "Immediate Intervention"
  },
  "chapterBreakdown": [
    {
      "subject": "Mathematics",
      "chapter": "Linear Equations",
      "masteryPercentage": 45,
      "status": "Needs Revision" | "Proficient" | "Mastered"
    }
  ],
  "recommendedActions": [
    {
      "priority": "High" | "Medium" | "Low",
      "action": "Concrete remediation task for teacher or parent",
      "targetArea": "Attendance / Tests / Concept Re-teaching"
    }
  ],
  "formattedMarkdown": "Clean markdown overview with insights and action items"
}`;

  return prompt;
}
