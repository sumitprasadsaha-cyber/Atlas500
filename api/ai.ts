import { handleOptions, sendSuccess, sendError } from "./_lib/responses.js";
import { validateAction } from "./_lib/validation.js";
import {
  handleStudentChat,
  handleAdminChat,
  handleReportGeneration,
  handleNoteAnalysis,
  handlePracticeTestGeneration,
  handleHomeworkGeneration,
  handleAnalyticsGeneration,
  handleSemanticSearch,
  moderationService,
  costTracker,
  usageLimitManager,
} from "../src/services/ai/index.js";
import { AIAction } from "./_shared/types.js";

export const runtime = "nodejs";

const ALLOWED_ACTIONS = [
  "chat",
  "report",
  "summary",
  "notes",
  "analysis",
  "analytics",
  "practice-test",
  "practice_test",
  "homework",
  "search",
  "moderation",
  "metrics",
  "limits",
] as const;

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;

  try {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch {}
    }

    const actionParam = req.query.action || body?.action || "chat";
    const action = validateAction<AIAction>(actionParam, ALLOWED_ACTIONS, "chat");

    switch (action) {
      // 1. AI CHAT (STUDENT & ADMIN)
      case "chat": {
        const { role, query, studentId, studentName, classGrade, enrolledSubjects, notesContext, recentTestTopic, action: chatAction, dataContext, history } = body || {};

        if (!query) {
          return res.status(400).json({ error: "Missing query parameter in request body." });
        }

        if (role === "student") {
          const result = await handleStudentChat({
            query,
            studentId,
            studentName,
            classGrade,
            enrolledSubjects,
            notesContext,
            recentTestTopic,
            history,
          });
          return sendSuccess(res, {
            reply: result.reply,
            model: result.model,
            remainingDailyQuota: result.remainingDailyQuota,
          });
        } else {
          const result = await handleAdminChat({
            query,
            action: chatAction,
            dataContext,
            history,
          });
          return sendSuccess(res, {
            reply: result.reply,
            model: result.model,
            remainingDailyQuota: result.remainingDailyQuota,
          });
        }
      }

      // 2. AI REPORTS GENERATION
      case "report": {
        const { reportType, dataPayload, promptExtra, userId, userRole } = body || {};

        if (!dataPayload) {
          return res.status(400).json({ error: "Missing dataPayload in request body." });
        }

        const result = await handleReportGeneration({
          reportType: reportType || "institution_overview",
          dataPayload,
          promptExtra,
          userId,
          userRole,
        });

        return sendSuccess(res, {
          markdown: result.markdown,
          model: result.model,
          timestamp: result.timestamp,
        });
      }

      // 3. AI NOTE PROCESSING & METADATA EXTRACTION
      case "notes":
      case "summary": {
        const { textSnippet, originalFileName, suggestedSubject, suggestedGrade, userId } = body || {};

        if (!textSnippet) {
          return res.status(400).json({ error: "Missing textSnippet in request body." });
        }

        const result = await handleNoteAnalysis({
          textSnippet,
          originalFileName,
          suggestedSubject,
          suggestedGrade,
          userId,
        });

        return sendSuccess(res, { data: result });
      }

      // 4. AI PRACTICE TEST GENERATOR
      case "practice-test":
      case "practice_test": {
        const { classGrade, subject, chapterNo, chapterName, topicName, questionCount, questionType, difficulty, language, syllabusContext, userId, userRole } = body || {};

        if (!classGrade || !subject || !chapterName) {
          return res.status(400).json({ error: "Missing required curriculum fields (classGrade, subject, chapterName)." });
        }

        const result = await handlePracticeTestGeneration({
          classGrade,
          subject,
          chapterNo: Number(chapterNo) || 1,
          chapterName,
          topicName: topicName || "General Topic",
          questionCount: Number(questionCount) || 10,
          questionType: questionType || "mcq",
          difficulty: difficulty || "Medium",
          language,
          syllabusContext,
          userId,
          userRole,
        });

        return sendSuccess(res, { data: result });
      }

      // 5. AI HOMEWORK GENERATOR
      case "homework": {
        const { classGrade, subject, chapterName, topicName, difficulty, learningObjectives, estimatedDurationMinutes, userId, userRole } = body || {};

        if (!classGrade || !subject || !chapterName) {
          return res.status(400).json({ error: "Missing required curriculum fields (classGrade, subject, chapterName)." });
        }

        const result = await handleHomeworkGeneration({
          classGrade,
          subject,
          chapterName,
          topicName,
          difficulty,
          learningObjectives,
          estimatedDurationMinutes,
          userId,
          userRole,
        });

        return sendSuccess(res, { data: result });
      }

      // 6. AI DEEP PERFORMANCE ANALYTICS
      case "analysis":
      case "analytics": {
        const { scope, dataPayload, targetId, userId, userRole } = body || {};

        if (!dataPayload) {
          return res.status(400).json({ error: "Missing dataPayload in request body." });
        }

        const result = await handleAnalyticsGeneration({
          scope: scope || "institution",
          dataPayload,
          targetId,
          userId,
          userRole,
        });

        return sendSuccess(res, { data: result });
      }

      // 7. AI SEMANTIC SMART SEARCH
      case "search": {
        const { query, items, classFilter, subjectFilter, userId, userRole } = body || {};

        if (!query) {
          return res.status(400).json({ error: "Missing query parameter." });
        }

        const result = await handleSemanticSearch({
          query,
          items: items || [],
          classFilter,
          subjectFilter,
          userId,
          userRole,
        });

        return sendSuccess(res, { data: result });
      }

      // 8. AI CONTENT MODERATION
      case "moderation": {
        const { text, userId } = body || {};
        const result = await moderationService.checkContent(text || "", userId);
        return sendSuccess(res, { moderation: result });
      }

      // 9. AI USAGE & COST METRICS
      case "metrics": {
        const summary = costTracker.getMetrics();
        return sendSuccess(res, { metrics: summary });
      }

      // 10. AI USER QUOTA STATUS
      case "limits": {
        const userId = (req.query.userId as string) || body?.userId || "anonymous";
        const role = (req.query.role as string) || body?.role || "student";
        const status = usageLimitManager.getUserQuotaStatus(userId, role);
        return sendSuccess(res, { quota: status });
      }

      default:
        return res.status(400).json({ error: `Unsupported AI action: ${action}` });
    }
  } catch (err: any) {
    return sendError(res, err, "AI service execution failed.");
  }
}
