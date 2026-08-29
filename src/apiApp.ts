import express from "express";
import { pipeline } from "stream";
import { GoogleGenAI } from "@google/genai";
import {
  uploadObjectToR2,
  getObjectFromR2,
  generateR2SignedUrl,
  deleteObjectFromR2,
  deleteObjectsFromR2,
  listObjectsFromR2,
  headObjectFromR2,
  getR2ServerConfig,
  isR2Configured,
} from "./lib/r2Server";

export const apiApp = express();

// Enable CORS for all API routes so direct browser fetches / downloads work smoothly
apiApp.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range, Authorization, X-Requested-With");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Type, ETag, Content-Disposition");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// Enable raw binary and multipart upload parsing for R2 uploads and JSON for API requests
apiApp.use(
  express.raw({
    type: (req) => {
      const ct = (req.headers["content-type"] || "").toLowerCase();
      return (
        ct.startsWith("application/octet-stream") ||
        ct.startsWith("multipart/form-data") ||
        ct.startsWith("image/") ||
        ct.startsWith("application/pdf")
      );
    },
    limit: "100mb",
  })
);
apiApp.use(express.json({ limit: "50mb" }));
apiApp.use(express.urlencoded({ extended: true, limit: "50mb" }));

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
  cleanAIErrorMessage,
} from "./services/ai";

const router = express.Router();

// ========================================================
// PHASE 7: MODULAR AI API ROUTES
// ========================================================

// 1. AI Chat (Student & Admin)
router.post("/ai/chat", async (req, res) => {
  try {
    const { role, query, studentId, studentName, classGrade, enrolledSubjects, notesContext, recentTestTopic, action, dataContext, history } = req.body;

    if (!query) {
      return res.status(400).json({ error: "Missing query in request body" });
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
      return res.json({ success: true, reply: result.reply, model: result.model, remainingDailyQuota: result.remainingDailyQuota });
    } else {
      const result = await handleAdminChat({
        query,
        action,
        dataContext,
        history,
      });
      return res.json({ success: true, reply: result.reply, model: result.model, remainingDailyQuota: result.remainingDailyQuota });
    }
  } catch (err: any) {
    console.error("Error in AI Chat endpoint:", err);
    return res.status(500).json({
      error: cleanAIErrorMessage(err) || "AI Chat failed. Please check network or API setup.",
    });
  }
});

// 2. AI Reports Generation
router.post("/ai/report", async (req, res) => {
  try {
    const { reportType, dataPayload, promptExtra, userId, userRole } = req.body;

    if (!dataPayload) {
      return res.status(400).json({ error: "Missing dataPayload in request body" });
    }

    const result = await handleReportGeneration({
      reportType: reportType || "institution_overview",
      dataPayload,
      promptExtra,
      userId,
      userRole,
    });

    return res.json({
      success: true,
      markdown: result.markdown,
      model: result.model,
      timestamp: result.timestamp,
    });
  } catch (err: any) {
    console.error("Error generating AI report:", err);
    return res.status(500).json({
      error: cleanAIErrorMessage(err) || "Failed to generate AI report.",
    });
  }
});

// 3. AI Note Processing & Metadata Extraction
router.post("/ai/notes/analyze", async (req, res) => {
  try {
    const { textSnippet, originalFileName, suggestedSubject, suggestedGrade, userId } = req.body;

    if (!textSnippet) {
      return res.status(400).json({ error: "Missing textSnippet in request body" });
    }

    const result = await handleNoteAnalysis({
      textSnippet,
      originalFileName,
      suggestedSubject,
      suggestedGrade,
      userId,
    });

    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error("Error analyzing note with AI:", err);
    return res.status(500).json({ error: cleanAIErrorMessage(err) || "Failed to analyze note." });
  }
});

// 4. AI Practice Test Generator
router.post("/ai/practice-test/generate", async (req, res) => {
  try {
    const { classGrade, subject, chapterNo, chapterName, topicName, questionCount, questionType, difficulty, language, syllabusContext, userId, userRole } = req.body;

    if (!classGrade || !subject || !chapterName) {
      return res.status(400).json({ error: "Missing required curriculum fields (classGrade, subject, chapterName)" });
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

    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error("Error generating practice test with AI:", err);
    return res.status(500).json({ error: cleanAIErrorMessage(err) || "Failed to generate practice test." });
  }
});

// 5. AI Homework Generator
router.post("/ai/homework/generate", async (req, res) => {
  try {
    const { classGrade, subject, chapterName, topicName, difficulty, learningObjectives, estimatedDurationMinutes, userId, userRole } = req.body;

    if (!classGrade || !subject || !chapterName) {
      return res.status(400).json({ error: "Missing required curriculum fields (classGrade, subject, chapterName)" });
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

    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error("Error generating homework with AI:", err);
    return res.status(500).json({ error: cleanAIErrorMessage(err) || "Failed to generate homework." });
  }
});

// 6. AI Deep Performance Analytics
router.post("/ai/analytics/insights", async (req, res) => {
  try {
    const { scope, dataPayload, targetId, userId, userRole } = req.body;

    if (!dataPayload) {
      return res.status(400).json({ error: "Missing dataPayload in request body" });
    }

    const result = await handleAnalyticsGeneration({
      scope: scope || "institution",
      dataPayload,
      targetId,
      userId,
      userRole,
    });

    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error("Error generating AI analytics:", err);
    return res.status(500).json({ error: cleanAIErrorMessage(err) || "Failed to generate analytics." });
  }
});

// 7. AI Semantic Smart Search
router.post("/ai/search", async (req, res) => {
  try {
    const { query, items, classFilter, subjectFilter, userId, userRole } = req.body;

    if (!query) {
      return res.status(400).json({ error: "Missing query parameter" });
    }

    const result = await handleSemanticSearch({
      query,
      items: items || [],
      classFilter,
      subjectFilter,
      userId,
      userRole,
    });

    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error("Error performing AI semantic search:", err);
    return res.status(500).json({ error: cleanAIErrorMessage(err) || "Failed to perform semantic search." });
  }
});

// 8. AI Content Moderation
router.post("/ai/moderation", async (req, res) => {
  try {
    const { text, userId } = req.body;
    const result = await moderationService.checkContent(text || "", userId);
    return res.json({ success: true, moderation: result });
  } catch (err: any) {
    return res.status(500).json({ error: cleanAIErrorMessage(err) || "Moderation check failed." });
  }
});

// 9. AI Usage & Cost Metrics
router.get("/ai/metrics", (req, res) => {
  const summary = costTracker.getMetrics();
  return res.json({ success: true, metrics: summary });
});

// 10. AI User Quota Status
router.get("/ai/limits", (req, res) => {
  const userId = (req.query.userId as string) || "anonymous";
  const role = (req.query.role as string) || "student";
  const status = usageLimitManager.getUserQuotaStatus(userId, role);
  return res.json({ success: true, quota: status });
});

// ========================================================
// CLOUDFLARE R2 STORAGE API ROUTES
// ========================================================

// 1. Health check & configuration status
router.get("/r2/health", (req, res) => {
  const config = getR2ServerConfig();
  const configured = isR2Configured();
  return res.json({
    status: "ok",
    storageBackend: configured ? "Cloudflare R2" : "Local Storage (R2 Fallback)",
    configured,
    bucket: config.bucket,
    hasEndpoint: Boolean(config.endpoint),
    hasPublicUrl: Boolean(config.publicUrl),
  });
});

// 2. Generate Pre-signed URL (GET or PUT)
router.post("/r2/signed-url", async (req, res) => {
  try {
    const { bucket, key, expiresIn, operation, contentType } = req.body;
    if (!key) {
      return res.status(400).json({ error: "Missing required 'key' parameter." });
    }

    const cleanKey = key.replace(/^\/+/, "");
    const config = getR2ServerConfig();
    const actualBucket = (bucket || config.bucket || "academy-connect-files").trim();

    console.log("=== [BACKEND R2 RETRIEVAL PIPELINE] ===");
    console.log("incoming storageKey:", key);
    console.log("incoming bucket:", bucket);
    console.log("bucket actually used:", actualBucket);
    console.log("object key actually used:", cleanKey);

    let headStatus = 200;
    let headContentType = contentType || "application/octet-stream";
    let headContentLength = 0;
    let exists = true;
    let effectiveKey = cleanKey;

    try {
      const headCheck = await headObjectFromR2({ bucket: actualBucket, key: cleanKey });
      exists = headCheck.exists;
      headStatus = headCheck.exists ? 200 : 404;
      if (headCheck.contentType) headContentType = headCheck.contentType;
      if (headCheck.contentLength) headContentLength = headCheck.contentLength;
      if (headCheck.resolvedKey) effectiveKey = headCheck.resolvedKey;

      console.log("=== [VALIDATE SIGNED URL / OBJECT] ===");
      console.log("HTTP status from R2:", headStatus);
      console.log("content-type:", headContentType);
      console.log("content-length:", headContentLength);
      console.log("effective resolved key:", effectiveKey);
      if (!exists) {
        console.error("Requested key:", key);
        console.error("Bucket:", actualBucket);
        console.error("Exact key sent to R2:", cleanKey);
      }
      console.log("==============================================");
    } catch (headErr: any) {
      console.warn("[Server R2] Head verification warning:", headErr?.message || headErr);
    }

    const signedUrl = await generateR2SignedUrl({
      bucket: actualBucket,
      key: effectiveKey,
      expiresIn: Number(expiresIn) || 3600,
      operation: operation === "putObject" ? "putObject" : "getObject",
      contentType: headContentType,
    });

    console.log("signed URL generated:", signedUrl);

    return res.json({
      success: true,
      signedUrl,
      exists,
      status: headStatus,
      contentType: headContentType,
      contentLength: headContentLength,
      bucket: actualBucket,
      key: effectiveKey,
    });
  } catch (err: any) {
    console.error("[Server R2] Error generating signed URL:", err);
    return res.status(500).json({
      error: err.message || "Failed to generate Cloudflare R2 signed URL.",
      stack: process.env.NODE_ENV !== "production" ? err.stack : undefined,
    });
  }
});

// 3. Upload File directly via Backend Proxy
router.post("/r2/upload", async (req, res) => {
  try {
    const bucket = (req.query.bucket as string) || req.body?.bucket;
    const key = (req.query.key as string) || req.body?.key;
    let contentType = (req.query.mimeType as string) || req.headers["content-type"] || "application/octet-stream";

    if (!key) {
      return res.status(400).json({ error: "Missing required 'key' query parameter or body property." });
    }

    let buffer: Buffer;
    if (Buffer.isBuffer(req.body)) {
      const reqContentType = req.headers["content-type"] || "";
      if (reqContentType.includes("application/json")) {
        try {
          const parsed = JSON.parse(req.body.toString("utf8"));
          if (parsed.base64) {
            buffer = Buffer.from(parsed.base64, "base64");
            if (parsed.mimeType) contentType = parsed.mimeType;
          } else {
            buffer = req.body;
          }
        } catch {
          buffer = req.body;
        }
      } else {
        buffer = req.body;
      }
    } else if (req.body && typeof req.body === "object" && req.body.base64) {
      buffer = Buffer.from(req.body.base64, "base64");
      if (req.body.mimeType) contentType = req.body.mimeType;
    } else if (typeof req.body === "string") {
      buffer = Buffer.from(req.body, "utf-8");
    } else {
      return res.status(400).json({ error: "No upload body data received." });
    }

    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: "Upload buffer is empty." });
    }

    console.log(`[Server R2] Uploading object key="${key}", size=${buffer.length} bytes, contentType="${contentType}"`);

    const result = await uploadObjectToR2({
      bucket,
      key,
      body: buffer,
      contentType,
    });

    const config = getR2ServerConfig();
    const downloadUrl = `/api/r2/download?bucket=${encodeURIComponent(result.bucket)}&key=${encodeURIComponent(key)}`;
    const publicUrl = config.publicUrl
      ? `${config.publicUrl}/${key.replace(/^\/+/, "")}`
      : downloadUrl;

    return res.json({
      success: true,
      bucket: result.bucket,
      key: result.key,
      etag: result.etag,
      url: downloadUrl,
      publicUrl: publicUrl,
      size: buffer.length,
      mimeType: contentType,
    });
  } catch (err: any) {
    console.error("[Server R2] Upload error:", {
      endpoint: "/api/r2/upload",
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({
      error: err.message || "Failed to upload file to Cloudflare R2.",
      endpoint: "/api/r2/upload",
      stack: err.stack,
    });
  }
});

// 4. Download / Stream File from R2 - HEAD
router.head("/r2/download", async (req, res) => {
  try {
    const bucket = req.query.bucket as string | undefined;
    const key = req.query.key as string | undefined;

    if (!key) {
      return res.status(400).end();
    }

    const cleanKey = key.replace(/^\/+/, "");
    const config = getR2ServerConfig();
    const actualBucket = bucket || config.bucket || "academy-connect-files";
    const head = await headObjectFromR2({ bucket: actualBucket, key: cleanKey });

    if (!head.exists) {
      console.error("=== [BACKEND R2 HEAD 404] ===", { key, actualBucket, cleanKey });
      return res.status(404).end();
    }

    let contentType = (req.query.mimeType as string) || head.contentType || "application/octet-stream";
    if (contentType === "application/octet-stream" || !contentType) {
      if (cleanKey.toLowerCase().endsWith(".pdf")) contentType = "application/pdf";
      else if (cleanKey.toLowerCase().endsWith(".png")) contentType = "image/png";
      else if (cleanKey.toLowerCase().endsWith(".jpg") || cleanKey.toLowerCase().endsWith(".jpeg")) contentType = "image/jpeg";
      else if (cleanKey.toLowerCase().endsWith(".webp")) contentType = "image/webp";
      else if (cleanKey.toLowerCase().endsWith(".gif")) contentType = "image/gif";
      else if (cleanKey.toLowerCase().endsWith(".svg")) contentType = "image/svg+xml";
      else if (cleanKey.toLowerCase().endsWith(".json")) contentType = "application/json";
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type, Authorization, Accept");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Type, ETag, Content-Disposition");
    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    if (head.etag) res.setHeader("ETag", head.etag);
    if (head.contentLength) res.setHeader("Content-Length", head.contentLength);

    return res.status(200).end();
  } catch (err: any) {
    return res.status(404).end();
  }
});

// Download / Stream file - GET
router.get("/r2/download", async (req, res) => {
  try {
    const bucket = req.query.bucket as string | undefined;
    const key = req.query.key as string | undefined;

    if (!key) {
      return res.status(400).send("Missing required 'key' query parameter.");
    }

    const cleanKey = key.replace(/^\/+/, "");
    const config = getR2ServerConfig();
    const actualBucket = bucket || config.bucket || "academy-connect-files";

    console.log("=== [BACKEND R2 DOWNLOAD / STREAM] ===");
    console.log("incoming storageKey:", key);
    console.log("incoming bucket:", bucket);
    console.log("bucket actually used:", actualBucket);
    console.log("object key actually used:", cleanKey);

    const range = req.headers.range;
    const obj = await getObjectFromR2({ bucket: actualBucket, key: cleanKey, range });

    if (!obj.body) {
      console.info("=== [BACKEND R2 DOWNLOAD 404] ===", { key, actualBucket, cleanKey });
      return res.status(404).send("File not found in Cloudflare R2.");
    }

    let contentType = (req.query.mimeType as string) || obj.contentType || "application/octet-stream";
    if (contentType === "application/octet-stream" || !contentType) {
      if (cleanKey.toLowerCase().endsWith(".pdf")) contentType = "application/pdf";
      else if (cleanKey.toLowerCase().endsWith(".png")) contentType = "image/png";
      else if (cleanKey.toLowerCase().endsWith(".jpg") || cleanKey.toLowerCase().endsWith(".jpeg")) contentType = "image/jpeg";
      else if (cleanKey.toLowerCase().endsWith(".webp")) contentType = "image/webp";
      else if (cleanKey.toLowerCase().endsWith(".gif")) contentType = "image/gif";
      else if (cleanKey.toLowerCase().endsWith(".svg")) contentType = "image/svg+xml";
      else if (cleanKey.toLowerCase().endsWith(".json")) contentType = "application/json";
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type, Authorization, Accept");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Type, ETag, Content-Disposition");
    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    if (obj.etag) {
      res.setHeader("ETag", obj.etag);
    }

    if (obj.contentRange) {
      res.status(206);
      res.setHeader("Content-Range", obj.contentRange);
    }

    if (obj.contentLength) {
      res.setHeader("Content-Length", obj.contentLength);
    }

    const isAttachment = req.query.download === "true";
    const dispositionType = isAttachment ? "attachment" : "inline";
    const downloadFilename = (req.query.filename as string) || cleanKey.split("/").pop() || "note.pdf";
    res.setHeader("Content-Disposition", `${dispositionType}; filename="${encodeURIComponent(downloadFilename)}"`);

    pipeline(obj.body, res, (err) => {
      if (err) {
        console.warn("[Server R2] Stream pipeline notice:", err?.message || err);
      }
    });
  } catch (err: any) {
    console.error("[Server R2] Download error:", {
      endpoint: "/api/r2/download",
      error: err.message,
      stack: err.stack,
    });
    if (err.name === "NoSuchKey" || err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      return res.status(404).json({ success: false, error: "Object not found", message: "File not found in Cloudflare R2." });
    }
    return res.status(500).json({ success: false, error: "Download failed", message: err.message || String(err) });
  }
});

// 4b. Verify Object Existence
router.all("/r2/verify", async (req, res) => {
  try {
    const bucket = (req.query.bucket as string) || req.body?.bucket;
    const key = (req.query.key as string) || req.body?.key || req.body?.storageKey || req.body?.storagePath;

    if (!key) {
      return res.status(400).json({ exists: false, error: "Missing required 'key' parameter." });
    }

    const cleanKey = key.replace(/^\/+/, "");
    const head = await headObjectFromR2({ bucket, key: cleanKey });

    return res.json({
      exists: head.exists,
      bucket: bucket || getR2ServerConfig().bucket,
      key: cleanKey,
      contentLength: head.contentLength,
      contentType: head.contentType,
      etag: head.etag,
      lastModified: head.lastModified,
    });
  } catch (err: any) {
    return res.status(500).json({
      exists: false,
      error: err.message || "Verification failed",
    });
  }
});

// 5. Delete Single Object
const handleDeleteSingleObject = async (req: express.Request, res: express.Response) => {
  try {
    const bucket = req.body?.bucket || (req.query.bucket as string);
    const key =
      req.body?.key ||
      req.body?.storagePath ||
      req.body?.path ||
      (req.query.key as string) ||
      (req.query.storagePath as string) ||
      (req.query.path as string);

    if (!key) {
      return res.status(400).json({ error: "Missing required 'key' parameter." });
    }

    const cleanKey = String(key).replace(/^\/+/, "");
    console.log(`[Server R2] Executing delete for object: bucket="${bucket || "default"}", key="${cleanKey}" (Method: ${req.method})`);

    const result = await deleteObjectFromR2({ bucket, key: cleanKey });
    return res.status(200).json(result);
  } catch (err: any) {
    console.error("[Server R2] Delete error:", {
      endpoint: req.originalUrl,
      method: req.method,
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({
      error: err.message || "Failed to delete file from Cloudflare R2.",
      endpoint: req.originalUrl,
      stack: err.stack,
    });
  }
};

router.post("/r2/delete", handleDeleteSingleObject);
router.delete("/r2/delete", handleDeleteSingleObject);
router.delete("/r2/file", handleDeleteSingleObject);
router.delete("/storage/delete", handleDeleteSingleObject);
router.post("/storage/delete", handleDeleteSingleObject);
router.delete("/files", handleDeleteSingleObject);
router.post("/files/delete", handleDeleteSingleObject);

// 6. Delete Multiple Objects
const handleDeleteMultipleObjects = async (req: express.Request, res: express.Response) => {
  try {
    const bucket = req.body?.bucket || (req.query.bucket as string);
    let keys = req.body?.keys || req.query?.keys;
    if (typeof keys === "string") {
      try {
        keys = JSON.parse(keys);
      } catch {
        keys = keys.split(",").map((k: string) => k.trim());
      }
    }

    if (!keys || !Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: "Missing or invalid 'keys' array parameter." });
    }

    const result = await deleteObjectsFromR2({ bucket, keys });
    return res.status(200).json(result);
  } catch (err: any) {
    console.error("[Server R2] Multiple delete error:", {
      endpoint: req.originalUrl,
      method: req.method,
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({
      error: err.message || "Failed to delete files from Cloudflare R2.",
      endpoint: req.originalUrl,
      stack: err.stack,
    });
  }
};

router.post("/r2/delete-multiple", handleDeleteMultipleObjects);
router.delete("/r2/delete-multiple", handleDeleteMultipleObjects);

// 7. Atomic Replace Endpoint
const handleReplaceObject = async (req: express.Request, res: express.Response) => {
  try {
    const bucket = (req.query.bucket as string) || req.body?.bucket;
    const oldKey = req.body?.oldKey || req.body?.oldStoragePath || (req.query.oldKey as string);
    const newKey = req.body?.newKey || req.body?.newStoragePath || req.body?.key || (req.query.key as string);
    const base64 = req.body?.base64;
    const mimeType = req.body?.mimeType || (req.query.mimeType as string) || "application/octet-stream";

    console.log(`[Server R2] Processing Replace request: oldKey="${oldKey}", newKey="${newKey}"`);

    if (oldKey) {
      try {
        await deleteObjectFromR2({ bucket, key: oldKey });
        console.log(`[Server R2] Old object deleted during replace: ${oldKey}`);
      } catch (delErr) {
        console.warn(`[Server R2] Notice: Old object was not present or already deleted: ${oldKey}`, delErr);
      }
    }

    if (newKey && base64) {
      const buffer = Buffer.from(base64, "base64");
      const uploadRes = await uploadObjectToR2({
        bucket,
        key: newKey,
        body: buffer,
        contentType: mimeType,
      });

      const config = getR2ServerConfig();
      const downloadUrl = `/api/r2/download?bucket=${encodeURIComponent(uploadRes.bucket)}&key=${encodeURIComponent(newKey)}`;
      const publicUrl = config.publicUrl
        ? `${config.publicUrl}/${newKey.replace(/^\/+/, "")}`
        : downloadUrl;

      return res.status(200).json({
        success: true,
        bucket: uploadRes.bucket,
        key: uploadRes.key,
        etag: uploadRes.etag,
        url: downloadUrl,
        publicUrl,
        size: buffer.length,
        mimeType,
        replaced: true,
      });
    }

    return res.status(200).json({
      success: true,
      oldKeyDeleted: Boolean(oldKey),
      message: "Replace processed successfully.",
    });
  } catch (err: any) {
    console.error("[Server R2] Replace error:", err);
    return res.status(500).json({
      error: err.message || "Failed to execute replacement in Cloudflare R2.",
      stack: err.stack,
    });
  }
};

router.post("/r2/replace", handleReplaceObject);
router.put("/r2/replace", handleReplaceObject);

// 8. List objects
router.post("/r2/list", async (req, res) => {
  try {
    const { bucket, prefix, limit, continuationToken } = req.body;
    const result = await listObjectsFromR2({
      bucket,
      prefix,
      maxKeys: Number(limit) || 1000,
      continuationToken,
    });
    return res.json(result);
  } catch (err: any) {
    console.error("[Server R2] List error:", {
      endpoint: "/api/r2/list",
      error: err.message,
      stack: err.stack,
    });
    return res.status(500).json({
      error: err.message || "Failed to list files from Cloudflare R2.",
      endpoint: "/api/r2/list",
      stack: err.stack,
    });
  }
});

import storageHandler from "../api/storage";
import notesHandler from "../api/notes";
import practiceTestsHandler from "../api/practice-tests";
import authHandler from "../api/auth";
import healthHandler from "../api/health";
import studentsHandler from "../api/students";
import aiHandler from "../api/ai";
import versionHandler from "../api/version";

// Mount API route handlers for /storage, /notes, /practice-tests, /auth, /health, /students, /ai, /debug-env, /version
router.all("/version", (req, res) => versionHandler(req, res));
router.all("/version.ts", (req, res) => versionHandler(req, res));
router.all("/api/version", (req, res) => versionHandler(req, res));
router.all("/api/version.ts", (req, res) => versionHandler(req, res));
router.all("/debug-env", (req, res) => {
  if (!req.query) req.query = {};
  req.query.action = "debug-env";
  return healthHandler(req, res);
});
router.all("/debug-env.ts", (req, res) => {
  if (!req.query) req.query = {};
  req.query.action = "debug-env";
  return healthHandler(req, res);
});
router.all("/storage", (req, res) => storageHandler(req, res));
router.all("/storage.ts", (req, res) => storageHandler(req, res));
router.all("/files/download", (req, res) => {
  req.query.action = "download";
  return storageHandler(req, res);
});
router.all("/files/*", (req, res) => storageHandler(req, res));
router.all("/download", (req, res) => {
  req.query.action = "download";
  return storageHandler(req, res);
});
router.all("/r2/download", (req, res) => {
  req.query.action = "download";
  return storageHandler(req, res);
});
router.all("/r2/*", (req, res) => storageHandler(req, res));
router.all("/notes", (req, res) => notesHandler(req, res));
router.all("/notes.ts", (req, res) => notesHandler(req, res));
router.all("/notes/upload", (req, res) => notesHandler(req, res));
router.all("/notes/:id/replace", (req, res) => notesHandler(req, res));
router.all("/notes/:id", (req, res) => notesHandler(req, res));
router.all("/notes/*", (req, res) => notesHandler(req, res));
router.all("/admin/notes", (req, res) => notesHandler(req, res));
router.all("/student/notes", (req, res) => notesHandler(req, res));
router.all("/practice-tests", (req, res) => practiceTestsHandler(req, res));
router.all("/practice-tests.ts", (req, res) => practiceTestsHandler(req, res));
router.all("/auth", (req, res) => authHandler(req, res));
router.all("/auth.ts", (req, res) => authHandler(req, res));
router.all("/health", (req, res) => healthHandler(req, res));
router.all("/health.ts", (req, res) => healthHandler(req, res));
router.all("/students", (req, res) => studentsHandler(req, res));
router.all("/students.ts", (req, res) => studentsHandler(req, res));
router.all("/ai", (req, res) => aiHandler(req, res));
router.all("/ai.ts", (req, res) => aiHandler(req, res));

// Mount router on both /api and / to handle both direct and rewritten paths safely
apiApp.use("/api", router);
apiApp.use("/", router);

// Explicitly handle any remaining /api/* requests so unhandled API endpoints return 404 JSON instead of falling through to Vite
apiApp.all(/^\/api(\/.*)?$/, (req, res) => {
  res.status(404).json({
    success: false,
    error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
  });
});
