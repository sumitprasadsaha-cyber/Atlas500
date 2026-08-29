import path from "path";
import { handleOptions, sendSuccess, sendError } from "./_lib/responses.js";
import { sanitizeKey, getMimeType, extractUploadPayload, parseRequestBody, buildCanonicalFilename, extractCleanExtension } from "./_lib/utils.js";
import { uploadObjectToR2, deleteObjectFromR2, headObjectFromR2, getR2ServerConfig } from "./_lib/r2.js";
import { buildCanonicalNoteMetadata, validateCanonicalNoteMetadata, NoteMetadata } from "../src/domain/notes/types.js";
import { getHierarchyLineage } from "../src/utils/canonicalStorageKey.js";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

const ALLOWED_EXTENSIONS = new Set(["pdf", "png", "jpg", "jpeg", "webp"]);

function isSupportedFileType(filename: string, mimeType: string): boolean {
  const cleanMime = (mimeType || "").toLowerCase().trim();
  if (ALLOWED_MIME_TYPES.has(cleanMime)) return true;

  const ext = extractCleanExtension(filename, mimeType);
  if (ALLOWED_EXTENSIONS.has(ext)) return true;

  return false;
}

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;

  try {
    const method = req.method?.toUpperCase();
    const query = req.query || {};
    const params = req.params || {};
    const rawUrl = req.url || req.originalUrl || "";
    const cleanUrlPath = rawUrl.split("?")[0].replace(/^\/api/, "");

    // Extract noteId from URL paths like /notes/:id/replace or /notes/:id
    let noteIdFromUrl = params.id || query.id;
    if (!noteIdFromUrl) {
      const replaceMatch = cleanUrlPath.match(/^\/notes\/([^\/?#]+)\/replace/i);
      if (replaceMatch) {
        noteIdFromUrl = decodeURIComponent(replaceMatch[1]);
      } else {
        const directIdMatch = cleanUrlPath.match(/^\/notes\/([^\/?#]+)$/i);
        if (directIdMatch && directIdMatch[1] !== "upload" && directIdMatch[1] !== "admin" && directIdMatch[1] !== "student") {
          noteIdFromUrl = decodeURIComponent(directIdMatch[1]);
        }
      }
    }

    // Detect action based on HTTP method and URL
    let action = (query.action || "").toLowerCase();
    if (!action) {
      if (cleanUrlPath.includes("/replace") || (method === "PUT" && noteIdFromUrl)) {
        action = "replace";
      } else if (cleanUrlPath.includes("/upload") || (method === "POST" && !noteIdFromUrl)) {
        action = "upload";
      } else if (method === "DELETE" || (method === "POST" && query.action === "delete")) {
        action = "delete";
      } else if (cleanUrlPath.includes("/student") || query.type === "student") {
        action = "student";
      } else if (cleanUrlPath.includes("/admin") || query.type === "admin") {
        action = "admin";
      } else if (method === "GET") {
        action = "admin";
      } else {
        action = "upload";
      }
    }

    // Route alias handling
    if (action === "create") action = "upload";
    if (action === "update") action = "replace";

    switch (action) {
      // ========================================================
      // 1. NOTES UPLOAD (Atlas v5.0.8 Production Hardening)
      // Form -> buildCanonicalNoteMetadata() -> validate -> Cloudflare R2 -> Verify -> Response
      // ========================================================
      case "upload": {
        const payload = await extractUploadPayload(req);
        const fields = payload.fields || {};
        const parsedBody = parseRequestBody(req.body) || {};

        // 1. Validate file presence
        if (!payload.buffer || payload.buffer.length === 0) {
          return res.status(400).json({
            success: false,
            error: "Invalid file. Please select a file to upload.",
          });
        }

        // 2. Validate file size (Max 50MB)
        if (payload.size > MAX_FILE_SIZE) {
          return res.status(400).json({
            success: false,
            error: "File exceeds size limit. Maximum allowed size is 50 MB.",
          });
        }

        // 3. Validate file type
        const originalFilename = payload.fileName || fields.fileName || fields.originalFilename || parsedBody.fileName || "note.pdf";
        const mimeType = payload.contentType || getMimeType(originalFilename);

        if (!isSupportedFileType(originalFilename, mimeType)) {
          return res.status(400).json({
            success: false,
            error: "Unsupported file type. Only PDF, PNG, JPG, JPEG, and WebP are allowed.",
          });
        }

        // 4. Build canonical NoteMetadata (School or UPSC)
        const canonicalMeta = buildCanonicalNoteMetadata({
          noteType: (fields.noteType || fields.type || parsedBody.noteType || parsedBody.type || query.noteType || query.type) as any,
          type: (fields.noteType || fields.type || parsedBody.noteType || parsedBody.type || query.noteType || query.type) as any,
          className: fields.className || fields.classGrade || fields.class || parsedBody.className || parsedBody.classGrade || parsedBody.class || query.className || query.classGrade,
          subject: fields.subject || fields.subjectName || parsedBody.subject || parsedBody.subjectName || query.subject,
          gsPaper: fields.gsPaper || fields.generalStudiesPaper || fields.paper || parsedBody.gsPaper || parsedBody.generalStudiesPaper || parsedBody.paper,
          chapterNumber: fields.chapterNumber ?? fields.chapterNo ?? parsedBody.chapterNumber ?? parsedBody.chapterNo,
          chapterName: fields.chapterName || fields.chapterTitle || parsedBody.chapterName || parsedBody.chapterTitle,
          moduleNumber: fields.moduleNumber ?? fields.moduleNo ?? fields.module_number ?? parsedBody.moduleNumber ?? parsedBody.moduleNo,
          moduleName: fields.moduleName || fields.moduleTitle || fields.module_name || parsedBody.moduleName || parsedBody.moduleTitle,
          topicNumber: fields.topicNumber ?? fields.topicNo ?? fields.topic_number ?? parsedBody.topicNumber ?? parsedBody.topicNo ?? query.topicNo,
          topicName: fields.topicName || fields.topicTitle || fields.topic_name || parsedBody.topicName || parsedBody.topicTitle || query.topicName,
          partLabel: fields.partLabel || parsedBody.partLabel || query.partLabel,
          fileName: originalFilename,
          fileSize: payload.size,
          mimeType,
          visibility: fields.visibility || parsedBody.visibility || "all",
          allowedStudentIds: fields.allowedStudentIds || parsedBody.allowedStudentIds,
          allowedClasses: fields.allowedClasses || parsedBody.allowedClasses,
          uploadedBy: fields.uploadedBy || parsedBody.uploadedBy || query.uploadedBy || "Admin",
        });

        // 5. Canonical Validation
        const validation = validateCanonicalNoteMetadata(canonicalMeta);
        if (!validation.isValid) {
          return res.status(400).json({
            success: false,
            error: validation.error || `Missing ${validation.missingField || "metadata"}`,
            missingField: validation.missingField,
          });
        }

        // 6. Upload to Cloudflare R2 directly (flat object storage model)
        const r2Config = getR2ServerConfig();
        const bucket = payload.bucket || fields.bucket || parsedBody.bucket || r2Config.bucket;
        const uploadKey = canonicalMeta.storagePath;
        const startTime = Date.now();

        console.log(`[API Notes] Upload Started:`, {
          bucket,
          key: uploadKey,
          sizeBytes: payload.size,
          mimeType,
          fileName: canonicalMeta.fileName,
        });

        try {
          // 1. Direct Object Upload via PutObjectCommand
          const uploadResult = await uploadObjectToR2({
            bucket,
            key: uploadKey,
            body: payload.buffer,
            contentType: mimeType,
          });

          console.log(`[API Notes] Upload Finished:`, {
            bucket,
            key: uploadKey,
            etag: uploadResult.etag,
            durationMs: Date.now() - startTime,
          });

          // 2. Direct HeadObject verification on the uploaded key itself
          const verifyNote = await headObjectFromR2({ bucket, key: uploadKey });
          if (!verifyNote || !verifyNote.exists) {
            console.error(`[API Notes] HeadObject verification failed for uploaded note "${uploadKey}".`);
            return res.status(500).json({
              success: false,
              code: "UPLOAD_VERIFICATION_FAILED",
              error: `Upload verification failed: HeadObject confirmed object does not exist in R2 for key "${uploadKey}".`,
            });
          }

          console.log(`[API Notes] Verification Passed:`, {
            bucket,
            key: uploadKey,
            contentLength: verifyNote.contentLength,
            contentType: verifyNote.contentType,
          });
        } catch (storageErr: any) {
          console.error("[API Notes] R2 upload error:", {
            bucket,
            key: uploadKey,
            error: storageErr?.message,
            stack: storageErr?.stack,
          });
          return res.status(500).json({
            success: false,
            error: "Failed to upload file to Cloudflare R2 storage.",
            details: storageErr?.message,
            stack: storageErr?.stack,
          });
        }

        // Generate download URL
        const downloadUrl = `/api/storage?action=download&bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(uploadKey)}`;
        const publicUrl = r2Config.publicUrl ? `${r2Config.publicUrl}/${uploadKey}` : downloadUrl;

        console.log(`[API Notes] Returned URL:`, {
          bucket,
          key: uploadKey,
          downloadUrl,
          publicUrl,
        });

        const noteResult: NoteMetadata = {
          ...canonicalMeta,
          pdfUrl: downloadUrl,
        };

        return res.status(200).json({
          success: true,
          message: "Note uploaded successfully",
          note: noteResult,
          documentId: canonicalMeta.id,
          r2Key: uploadKey,
          storageKey: uploadKey,
          storagePath: uploadKey,
          downloadKey: uploadKey,
          folderPath: canonicalMeta.folderPath,
          downloadUrl,
          pdfUrl: downloadUrl,
          publicUrl,
        });
      }

      // ========================================================
      // 2. NOTE REPLACEMENT (Direct Object Update)
      // ========================================================
      case "replace": {
        const payload = await extractUploadPayload(req);
        const fields = payload.fields || {};
        const parsedBody = parseRequestBody(req.body) || {};

        if (!payload.buffer || payload.buffer.length === 0) {
          return res.status(400).json({
            success: false,
            error: "Invalid file. Please select a replacement file.",
          });
        }

        if (payload.size > MAX_FILE_SIZE) {
          return res.status(400).json({
            success: false,
            error: "File exceeds size limit. Maximum allowed size is 50 MB.",
          });
        }

        const newFileName = payload.fileName || fields.newFileName || fields.fileName || "note.pdf";
        const mimeType = payload.contentType || getMimeType(newFileName);

        if (!isSupportedFileType(newFileName, mimeType)) {
          return res.status(400).json({
            success: false,
            error: "Unsupported file type. Only PDF, PNG, JPG, JPEG, and WebP are allowed.",
          });
        }

        const rawTargetKey = (fields.oldStorageKey || fields.storageKey || fields.storagePath || query.storageKey || "").trim();
        const targetStorageKey = sanitizeKey(rawTargetKey);

        if (!targetStorageKey) {
          return res.status(400).json({
            success: false,
            error: "Target storage key is required for note replacement.",
          });
        }

        const r2Config = getR2ServerConfig();
        const bucket = payload.bucket || fields.bucket || parsedBody.bucket || r2Config.bucket;
        const startTime = Date.now();

        console.log(`[API Notes] Replace Started:`, {
          bucket,
          key: targetStorageKey,
          sizeBytes: payload.size,
          mimeType,
          newFileName,
        });

        try {
          // Direct Object Upload replacing key
          const uploadRes = await uploadObjectToR2({
            bucket,
            key: targetStorageKey,
            body: payload.buffer,
            contentType: mimeType,
          });

          console.log(`[API Notes] Replace Finished:`, {
            bucket,
            key: targetStorageKey,
            etag: uploadRes.etag,
            durationMs: Date.now() - startTime,
          });

          // Strict verification check on the replaced key
          const headResult = await headObjectFromR2({ bucket, key: targetStorageKey });
          if (!headResult || !headResult.exists) {
            console.error(`[API Notes] HeadObject verification failed for replaced key "${targetStorageKey}".`);
            return res.status(500).json({
              success: false,
              code: "REPLACE_VERIFICATION_FAILED",
              error: `Replacement verification failed: HeadObject confirmed object does not exist in R2 for key "${targetStorageKey}".`,
            });
          }

          console.log(`[API Notes] Replace Verification Passed:`, {
            bucket,
            key: targetStorageKey,
            contentLength: headResult.contentLength,
          });
        } catch (replaceErr: any) {
          console.error("[API Notes] R2 replacement error:", {
            bucket,
            key: targetStorageKey,
            error: replaceErr?.message,
            stack: replaceErr?.stack,
          });
          return res.status(500).json({
            success: false,
            error: "Failed to replace note in storage.",
            details: replaceErr?.message,
            stack: replaceErr?.stack,
          });
        }

        const downloadUrl = `/api/storage?action=download&bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(targetStorageKey)}`;
        const publicUrl = r2Config.publicUrl ? `${r2Config.publicUrl}/${targetStorageKey}` : downloadUrl;

        console.log(`[API Notes] Replace Returned URL:`, {
          bucket,
          key: targetStorageKey,
          downloadUrl,
          publicUrl,
        });

        return res.status(200).json({
          success: true,
          message: "Note replaced successfully",
          r2Key: targetStorageKey,
          storageKey: targetStorageKey,
          storagePath: targetStorageKey,
          downloadKey: targetStorageKey,
          fileName: newFileName,
          originalFilename: newFileName,
          pdfFileName: newFileName,
          fileSize: payload.size,
          mimeType,
          downloadUrl,
          pdfUrl: downloadUrl,
          publicUrl,
          updatedAt: new Date().toISOString(),
        });
      }

      // ========================================================
      // 3. NOTE DELETE
      // Directly deletes object key from R2
      // ========================================================
      case "delete": {
        const parsedBody = parseRequestBody(req.body) || {};
        const storageKey = sanitizeKey(parsedBody.storageKey || parsedBody.storagePath || query.storageKey || query.storagePath || "");
        const targetId = noteIdFromUrl || parsedBody.id || query.id;

        const r2Config = getR2ServerConfig();
        const bucket = parsedBody.bucket || query.bucket || r2Config.bucket;

        if (storageKey) {
          try {
            console.log(`[API Notes] Deleting note object: key="${storageKey}", bucket="${bucket}"`);
            await deleteObjectFromR2({ bucket, key: storageKey });
          } catch (delErr: any) {
            console.warn("[API Notes] R2 delete warning (proceeding):", delErr?.message);
          }
        }

        return res.status(200).json({
          success: true,
          message: "Note deleted successfully",
          id: targetId,
          deletedKey: storageKey,
        });
      }

      default:
        return res.status(405).json({
          success: false,
          error: `Method or action ${action} not allowed`,
        });
    }
  } catch (err: any) {
    console.error("[API Notes] Unhandled error:", err);
    return res.status(500).json({
      success: false,
      error: err?.message || "Internal server error in Notes API",
    });
  }
}
