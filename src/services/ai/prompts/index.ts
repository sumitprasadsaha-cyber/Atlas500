export * from "./studentChat";
export * from "./adminAssistant";
export * from "./noteProcessing";
export * from "./practiceTests";
export * from "./homework";
export * from "./analytics";
export * from "./reports";

export interface PromptTemplateMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  roleTarget: "student" | "admin" | "teacher" | "system";
}

export const REGISTERED_PROMPTS: Record<string, PromptTemplateMetadata> = {
  studentChat: {
    id: "studentChat",
    name: "Student AI Study Tutor",
    version: "2.0.0",
    description: "Academic tutoring prompt grounded in syllabus notes and grade curriculum.",
    roleTarget: "student",
  },
  adminAssistant: {
    id: "adminAssistant",
    name: "Admin AI Operations Assistant",
    version: "2.0.0",
    description: "Broadcast announcements, notifications, and curriculum planning.",
    roleTarget: "admin",
  },
  noteProcessing: {
    id: "noteProcessing",
    name: "Automated Note & Material Processor",
    version: "2.0.0",
    description: "Extracts structured metadata, keywords, difficulty, and summaries from study notes.",
    roleTarget: "system",
  },
  practiceTests: {
    id: "practiceTests",
    name: "Smart Practice Test Generator",
    version: "2.0.0",
    description: "Generates MCQs, True/False, and Assertion-Reasoning test papers with explanations.",
    roleTarget: "teacher",
  },
  homework: {
    id: "homework",
    name: "AI Homework & Worksheet Generator",
    version: "2.0.0",
    description: "Creates graded problem sets, rubrics, and solutions.",
    roleTarget: "teacher",
  },
  analytics: {
    id: "analytics",
    name: "Learning Risk & Performance Analytics",
    version: "2.0.0",
    description: "Identifies strengths, weaknesses, and academic retention risks.",
    roleTarget: "admin",
  },
  reports: {
    id: "reports",
    name: "Multi-dimensional Academy Reports",
    version: "2.0.0",
    description: "Generates institutional, batch, and student-level reports.",
    roleTarget: "admin",
  },
};
