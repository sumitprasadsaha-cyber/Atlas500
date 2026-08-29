import path from "path";
import { handleOptions, sendSuccess, sendError } from "./_lib/responses.js";
import { sanitizeKey, getMimeType, extractUploadPayload, parseRequestBody, buildCanonicalFilename, extractCleanExtension } from "./_lib/utils.js";
import { uploadObjectToR2, deleteObjectFromR2, headObjectFromR2, getR2ServerConfig } from "./_lib/r2.js";
import { buildCanonicalNoteMetadata, validateCanonicalNoteMetadata, NoteMetadata } from "../src/domain/notes/types.js";

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

        // 6. Upload to Cloudflare R2
        const r2Config = getR2ServerConfig();
        const bucket = payload.bucket || fields.bucket || parsedBody.bucket || r2Config.bucket;

        try {
          // Upload note file to canonical R2 key
          await uploadObjectToR2({
            bucket,
            key: canonicalMeta.storagePath,
            body: payload.buffer,
            contentType: mimeType,
          });

          // Upload metadata.json to the canonical folder
          const metadataKey = `${canonicalMeta.folderPath}/metadata.json`;
          await uploadObjectToR2({
            bucket,
            key: metadataKey,
            body: Buffer.from(JSON.stringify(canonicalMeta, null, 2)),
            contentType: "application/json",
          }).catch((err) => {
            console.warn("[API Notes] Warning writing metadata.json:", err);
          });

          // Strict verification check: confirm object presence in R2 before acknowledging success
          const headResult = await headObjectFromR2({ bucket, key: canonicalMeta.storagePath });
          if (!headResult || !headResult.exists) {
            console.error(`[API Notes] HeadObject verification failed for uploaded key "${canonicalMeta.storagePath}".`);
            return res.status(500).json({
              success: false,
              code: "UPLOAD_VERIFICATION_FAILED",
              error: `Upload verification failed: HeadObject confirmed object does not exist in R2 for key "${canonicalMeta.storagePath}".`,
            });
          }
        } catch (storageErr: any) {
          console.error("[API Notes] R2 upload error:", storageErr);
          return res.status(500).json({
            success: false,
            error: "Failed to upload file to Cloudflare R2 storage.",
            details: storageErr?.message,
          });
        }

        // Generate download URL
        const downloadUrl = `/api/storage?action=download&bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(canonicalMeta.storagePath)}`;
        const noteResult: NoteMetadata = {
          ...canonicalMeta,
          pdfUrl: downloadUrl,
        };

        return res.status(200).json({
          success: true,
          message: "Note uploaded successfully",
          note: noteResult,
          documentId: canonicalMeta.id,
          r2Key: canonicalMeta.storagePath,
          storageKey: canonicalMeta.storagePath,
          storagePath: canonicalMeta.storagePath,
          downloadKey: canonicalMeta.storagePath,
          folderPath: canonicalMeta.folderPath,
          downloadUrl,
          pdfUrl: downloadUrl,
        });
      }

      // ========================================================
      // 2. NOTE REPLACEMENT (In-Place Canonical Update)
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

        try {
          // Upload new file directly replacing existing object
          await uploadObjectToR2({
            bucket,
            key: targetStorageKey,
            body: payload.buffer,
            contentType: mimeType,
          });

          // Strict verification check: confirm object presence in R2 before acknowledging success
          const headResult = await headObjectFromR2({ bucket, key: targetStorageKey });
          if (!headResult || !headResult.exists) {
            console.error(`[API Notes] HeadObject verification failed for replaced key "${targetStorageKey}".`);
            return res.status(500).json({
              success: false,
              code: "REPLACE_VERIFICATION_FAILED",
              error: `Replacement verification failed: HeadObject confirmed object does not exist in R2 for key "${targetStorageKey}".`,
            });
          }

          // Update folder metadata.json if exists
          const folderPath = path.dirname(targetStorageKey);
          const metadataKey = `${folderPath}/metadata.json`;
          const nowIso = new Date().toISOString();

          const updateMetadata = {
            storagePath: targetStorageKey,
            r2Key: targetStorageKey,
            storageKey: targetStorageKey,
            downloadKey: targetStorageKey,
            fileName: newFileName,
            originalFilename: newFileName,
            fileSize: payload.size,
            mimeType,
            updatedAt: nowIso,
          };

          await uploadObjectToR2({
            bucket,
            key: metadataKey,
            body: Buffer.from(JSON.stringify(updateMetadata, null, 2)),
            contentType: "application/json",
          }).catch(() => {});
        } catch (replaceErr: any) {
          console.error("[API Notes] R2 replacement error:", replaceErr);
          return res.status(500).json({
            success: false,
            error: "Failed to replace note in storage.",
            details: replaceErr?.message,
          });
        }

        const downloadUrl = `/api/storage?action=download&bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(targetStorageKey)}`;

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
          publicUrl: downloadUrl,
          updatedAt: new Date().toISOString(),
        });
      }

      // ========================================================
      // 3. NOTE DELETE
      // Clean up PDF, metadata.json, and practice-test.json from R2
      // ========================================================
      case "delete": {
        const parsedBody = parseRequestBody(req.body) || {};
        const storageKey = sanitizeKey(parsedBody.storageKey || parsedBody.storagePath || query.storageKey || query.storagePath || "");
        const targetId = noteIdFromUrl || parsedBody.id || query.id;

        const r2Config = getR2ServerConfig();
        const bucket = parsedBody.bucket || query.bucket || r2Config.bucket;

        if (storageKey) {
          try {
            await deleteObjectFromR2({ bucket, key: storageKey });

            const folderPath = path.dirname(storageKey);
            await deleteObjectFromR2({ bucket, key: `${folderPath}/metadata.json` }).catch(() => {});
            await deleteObjectFromR2({ bucket, key: `${folderPath}/practice-test.json` }).catch(() => {});
          } catch (delErr: any) {
            console.warn("[API Notes] R2 delete warning (proceeding with DB deletion):", delErr);
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
