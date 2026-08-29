import { pipeline } from "stream";
import { handleOptions, sendSuccess, sendError, setCorsHeaders } from "./_lib/responses.js";
import { validateAction } from "./_lib/validation.js";
import { NotFoundError, ValidationError, StorageError } from "./_lib/errors.js";
import { sanitizeKey, getMimeType, parseRequestBody, extractUploadPayload } from "./_lib/utils.js";
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
} from "./_lib/r2.js";
import { StorageAction } from "./_shared/types.js";

export const runtime = "nodejs";

const ALLOWED_ACTIONS = [
  "upload",
  "download",
  "signed-url",
  "delete",
  "delete-multiple",
  "replace",
  "list",
  "exists",
  "verify",
  "head",
] as const;

/**
 * Extracts and merges parameters from query string, parsed body, and raw body.
 */
function extractCombinedParams(req: any, parsedBody: any): Record<string, any> {
  const query = req.query && typeof req.query === "object" ? req.query : {};
  const body = req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) ? req.body : {};
  const parsed = parsedBody && typeof parsedBody === "object" && !Buffer.isBuffer(parsedBody) ? parsedBody : {};
  return { ...query, ...body, ...parsed };
}

/**
 * Resolves the target storage key from any candidate property or query string.
 */
function resolveStorageKey(params: Record<string, any>, actualBucket: string): string {
  const rawKey =
    params.key ||
    params.storageKey ||
    params.storagePath ||
    params.storage_key ||
    params.storage_path ||
    params.objectKey ||
    params.r2Key ||
    params.path ||
    params.fileUrl ||
    params.url ||
    "";

  if (!rawKey) return "";
  return sanitizeKey(String(rawKey), actualBucket);
}

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;

  try {
    const parsedBody = parseRequestBody(req.body);
    const params = extractCombinedParams(req, parsedBody);

    // Determine action from query, body, or URL
    const actionParam =
      params.action ||
      (req.method === "GET" && (params.key || params.storageKey || params.storagePath) ? "download" : "upload");
    const action = validateAction<StorageAction>(actionParam, ALLOWED_ACTIONS, "download");

    const config = getR2ServerConfig();
    const actualBucket = (params.bucket || config.bucket || "academy-connect-files").trim();

    switch (action) {
      // 1. GENERATE SIGNED URL
      case "signed-url": {
        const startTime = Date.now();
        const cleanKey = resolveStorageKey(params, actualBucket);
        if (!cleanKey) {
          return sendError(
            res,
            new ValidationError("Storage metadata missing: Missing required 'key' or 'storageKey' parameter.")
          );
        }

        console.log("[Storage API] Signed URL Request:", {
          incomingKey: params.key || params.storageKey || params.storagePath || params.r2Key || params.pdfUrl,
          canonicalKey: cleanKey,
          bucket: actualBucket,
          operation: params.operation || "getObject",
          isR2Configured: isR2Configured(),
          envDetected: {
            R2_ACCOUNT_ID: Boolean(process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_R2_ACCOUNT_ID || process.env.VITE_R2_ACCOUNT_ID),
            R2_ACCESS_KEY_ID: Boolean(process.env.R2_ACCESS_KEY_ID || process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || process.env.VITE_R2_ACCESS_KEY_ID),
            R2_SECRET_ACCESS_KEY: Boolean(process.env.R2_SECRET_ACCESS_KEY || process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || process.env.VITE_R2_SECRET_ACCESS_KEY),
            R2_ENDPOINT: Boolean(process.env.R2_ENDPOINT || process.env.CLOUDFLARE_R2_ENDPOINT || process.env.VITE_R2_ENDPOINT || process.env.R2_ACCOUNT_ID),
            R2_BUCKET: Boolean(process.env.R2_BUCKET || process.env.CLOUDFLARE_R2_BUCKET || process.env.VITE_R2_BUCKET),
            R2_PUBLIC_URL: Boolean(process.env.R2_PUBLIC_URL || process.env.CLOUDFLARE_R2_PUBLIC_URL || process.env.VITE_R2_PUBLIC_URL),
          },
        });

        // Verify object existence using HeadObject before generating any signed URL
        const headCheck = await headObjectFromR2({ bucket: actualBucket, key: cleanKey });
        const exists = Boolean(headCheck && headCheck.exists);

        if (!exists && params.operation !== "putObject") {
          console.info(`[Storage API] HeadObject check: Object NOT found: key="${cleanKey}", bucket="${actualBucket}" (${Date.now() - startTime}ms)`);
          setCorsHeaders(res);
          return res.status(404).json({
            success: false,
            code: "OBJECT_NOT_FOUND",
            error: `Object not found: "${cleanKey}" does not exist in bucket "${actualBucket}".`,
          });
        }

        const effectiveKey = headCheck.resolvedKey || cleanKey;
        const headContentType = headCheck.contentType || params.contentType || getMimeType(cleanKey);
        const headContentLength = headCheck.contentLength || 0;
        const fileName = cleanKey.split("/").pop() || "document.pdf";

        try {
          const signedUrl = await generateR2SignedUrl({
            bucket: actualBucket,
            key: effectiveKey,
            expiresIn: Number(params.expiresIn) || 3600,
            operation: params.operation === "putObject" ? "putObject" : "getObject",
            contentType: headContentType,
          });

          console.log(`[Storage API] Signed URL generated: key="${effectiveKey}", mime="${headContentType}", size=${headContentLength}, duration=${Date.now() - startTime}ms`);

          return sendSuccess(res, {
            signedUrl,
            contentType: headContentType,
            contentLength: headContentLength,
            filename: fileName,
            fileName: fileName,
            bucket: actualBucket,
            key: effectiveKey,
            exists: true,
            status: 200,
          });
        } catch (signErr: any) {
          console.error("[Storage API] Signed URL generation failed:", signErr);
          return sendError(
            res,
            signErr,
            "Signed URL generation failed",
            "SIGNED_URL_FAILED"
          );
        }
      }

      // 2. UPLOAD FILE
      case "upload": {
        let payload;
        try {
          payload = await extractUploadPayload(req);
        } catch (extractErr: any) {
          console.error("[Storage API] Error extracting upload payload:", extractErr);
          return sendError(
            res,
            extractErr,
            "Failed to parse upload request body or multipart data.",
            "INVALID_UPLOAD_PAYLOAD"
          );
        }

        const rawKey = payload.key || params.key || params.storageKey || params.storagePath;
        const cleanKey = rawKey ? sanitizeKey(String(rawKey), actualBucket) : "";
        const contentType =
          payload.contentType ||
          params.mimeType ||
          params.contentType ||
          getMimeType(cleanKey || payload.fileName || "file.pdf");

        if (!cleanKey) {
          return sendError(
            res,
            new ValidationError("Storage metadata missing: Missing required 'key' or 'storageKey'.")
          );
        }

        if (!payload.buffer || payload.buffer.length === 0) {
          return sendError(
            res,
            new ValidationError("Upload buffer is empty or no valid file data received.")
          );
        }

        // File size limit (50MB)
        const MAX_STORAGE_SIZE = 50 * 1024 * 1024;
        if (payload.buffer.length > MAX_STORAGE_SIZE) {
          return sendError(
            res,
            new ValidationError("File size exceeds limit. Maximum allowed size is 50 MB.")
          );
        }

        try {
          const result = await uploadObjectToR2({
            bucket: actualBucket,
            key: cleanKey,
            body: payload.buffer,
            contentType,
          });

          // Verify with HeadObject in Cloudflare R2 before reporting success
          const headCheck = await headObjectFromR2({ bucket: actualBucket, key: cleanKey });
          if (!headCheck.exists) {
            console.error(`[Storage API] HeadObject verification failed immediately after upload: key="${cleanKey}"`);
            return sendError(
              res,
              new StorageError(`Upload verification failed: object "${cleanKey}" could not be confirmed in Cloudflare R2 after PutObject.`, "R2_VERIFICATION_FAILED")
            );
          }

          const downloadUrl = `/api/storage?action=download&bucket=${encodeURIComponent(result.bucket)}&key=${encodeURIComponent(cleanKey)}`;
          const publicUrl = config.publicUrl
            ? `${config.publicUrl}/${cleanKey}`
            : downloadUrl;

          return sendSuccess(res, {
            bucket: result.bucket,
            key: result.key,
            etag: result.etag,
            url: downloadUrl,
            publicUrl: publicUrl,
            size: payload.buffer.length,
            mimeType: contentType,
            filename: payload.fileName,
          });
        } catch (uploadErr: any) {
          console.error("[Storage API] Upload execution error:", uploadErr);
          return sendError(
            res,
            new StorageError(uploadErr?.message || "Cloudflare R2 unavailable or bucket upload failed.", "R2_UNAVAILABLE")
          );
        }
      }

      // 3. DOWNLOAD / STREAM FILE INLINE OR ATTACHMENT
      case "download": {
        const startTime = Date.now();
        const cleanKey = resolveStorageKey(params, actualBucket);
        if (!cleanKey) {
          return sendError(
            res,
            new ValidationError("Invalid storage key: Missing or empty 'key' parameter.")
          );
        }

        console.log("[Storage API] Download Request:", {
          incomingKey: params.key || params.storageKey || params.storagePath || params.r2Key || params.pdfUrl,
          canonicalKey: cleanKey,
          bucket: actualBucket,
          method: req.method,
          isHead: req.method === "HEAD",
        });

        // Handle HEAD request
        if (req.method === "HEAD") {
          try {
            const head = await headObjectFromR2({ bucket: actualBucket, key: cleanKey });
            if (!head.exists) {
              setCorsHeaders(res);
              return res.status(404).end();
            }

            const contentType = params.mimeType || head.contentType || getMimeType(cleanKey);
            const fileName = (params.filename as string) || cleanKey.split("/").pop() || "document.pdf";
            const isAttachment = params.download === "true" || params.download === true;

            setCorsHeaders(res);
            res.setHeader("Content-Type", contentType);
            res.setHeader("Accept-Ranges", "bytes");
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            res.setHeader("Content-Disposition", `${isAttachment ? "attachment" : "inline"}; filename="${encodeURIComponent(fileName)}"`);
            if (head.etag) res.setHeader("ETag", head.etag);
            if (head.contentLength) res.setHeader("Content-Length", head.contentLength);
            return res.status(200).end();
          } catch (headErr) {
            setCorsHeaders(res);
            return res.status(404).end();
          }
        }

        const range = req.headers.range;
        let obj;
        try {
          obj = await getObjectFromR2({ bucket: actualBucket, key: cleanKey, range });
        } catch (getErr: any) {
          console.warn("[Storage API] getObjectFromR2 notice:", getErr?.message || getErr);
          return sendError(
            res,
            new NotFoundError(`Object not found: "${cleanKey}" does not exist in bucket "${actualBucket}".`)
          );
        }

        if (!obj || !obj.body) {
          console.info(`[Storage API] Download Object Not Found: key="${cleanKey}", bucket="${actualBucket}"`);
          return sendError(
            res,
            new NotFoundError(`Object not found: "${cleanKey}" does not exist in bucket "${actualBucket}".`)
          );
        }

        const contentType = params.mimeType || obj.contentType || getMimeType(cleanKey);
        const fileName = (params.filename as string) || cleanKey.split("/").pop() || (contentType === "application/pdf" ? "note.pdf" : "image.jpg");
        const isAttachment = params.download === "true" || params.download === true;

        setCorsHeaders(res);
        res.setHeader("Content-Type", contentType);
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

        if (obj.etag) res.setHeader("ETag", obj.etag);
        if (obj.contentRange) {
          res.status(206);
          res.setHeader("Content-Range", obj.contentRange);
        }
        if (obj.contentLength) {
          res.setHeader("Content-Length", obj.contentLength);
        }

        // Set Content-Disposition: inline for topic viewing, attachment for download
        const dispositionType = isAttachment ? "attachment" : "inline";
        res.setHeader("Content-Disposition", `${dispositionType}; filename="${encodeURIComponent(fileName)}"`);

        console.log(`[Storage API] Commencing stream: key="${cleanKey}", mime="${contentType}", size=${obj.contentLength || "chunked"}, disposition="${dispositionType}"`);

        // Safely stream through pipeline and await completion so serverless lambda does not terminate execution prematurely
        return await new Promise<void>((resolve) => {
          let isFinished = false;

          const finalizeStream = (status: "success" | "error" | "aborted", err?: any) => {
            if (isFinished) return;
            isFinished = true;
            const durationMs = Date.now() - startTime;

            if (status === "success") {
              console.log(`[Storage API] Stream completed successfully: key="${cleanKey}", duration=${durationMs}ms`);
            } else if (status === "aborted") {
              console.log(`[Storage API] Client aborted stream connection: key="${cleanKey}", duration=${durationMs}ms`);
            } else {
              console.error(`[Storage API] Stream failed: key="${cleanKey}", duration=${durationMs}ms, error=`, err?.message || err);
              if (!res.headersSent) {
                sendError(res, err, "Stream transmission error", "STREAM_ERROR");
              }
            }

            resolve();
          };

          // Handle client disconnect / early abort
          req.on("close", () => {
            if (obj.body && typeof (obj.body as any).destroy === "function" && !(obj.body as any).destroyed) {
              (obj.body as any).destroy();
            }
            if (!res.writableEnded) {
              finalizeStream("aborted");
            }
          });

          // Handle response events
          res.on("finish", () => {
            finalizeStream("success");
          });

          res.on("close", () => {
            if (!res.writableEnded) {
              finalizeStream("aborted");
            }
          });

          res.on("error", (resErr: any) => {
            finalizeStream("error", resErr);
          });

          // Node pipeline streaming
          pipeline(obj.body, res, (err) => {
            if (err) {
              finalizeStream("error", err);
            } else {
              finalizeStream("success");
            }
          });
        });
      }

      // 4. CHECK OBJECT EXISTENCE (EXISTS / VERIFY / HEAD)
      case "exists":
      case "verify":
      case "head": {
        const cleanKey = resolveStorageKey(params, actualBucket);
        if (!cleanKey) {
          return sendSuccess(res, { exists: false, error: "Missing required 'key' parameter." });
        }

        const head = await headObjectFromR2({ bucket: actualBucket, key: cleanKey });
        return sendSuccess(res, {
          exists: head.exists,
          bucket: actualBucket,
          key: cleanKey,
          contentLength: head.contentLength,
          contentType: head.contentType || getMimeType(cleanKey),
          etag: head.etag,
          lastModified: head.lastModified,
        });
      }

      // 5. DELETE SINGLE OBJECT
      case "delete": {
        const cleanKey = resolveStorageKey(params, actualBucket);
        if (!cleanKey) {
          return sendError(
            res,
            new ValidationError("Missing required 'key' parameter for deletion.")
          );
        }

        console.log(`[Storage API] Deleting object from Cloudflare R2: bucket="${actualBucket}", key="${cleanKey}"`);
        const result = await deleteObjectFromR2({ bucket: actualBucket, key: cleanKey });
        return sendSuccess(res, { success: true, deleted: true, ...result });
      }

      // 6. DELETE MULTIPLE OBJECTS
      case "delete-multiple": {
        let keys = params.keys;
        if (typeof keys === "string") {
          try {
            keys = JSON.parse(keys);
          } catch {
            keys = keys.split(",").map((k: string) => k.trim());
          }
        }

        if (!keys || !Array.isArray(keys) || keys.length === 0) {
          return sendError(
            res,
            new ValidationError("Missing or invalid 'keys' array parameter.")
          );
        }

        const cleanKeys = keys.map((k) => sanitizeKey(k, actualBucket)).filter(Boolean);
        console.log(`[Storage API] Deleting multiple objects from Cloudflare R2: bucket="${actualBucket}", count=${cleanKeys.length}`);
        const result = await deleteObjectsFromR2({ bucket: actualBucket, keys: cleanKeys });
        return sendSuccess(res, { success: true, ...result });
      }

      // 7. ATOMIC REPLACE (Upload first -> Verify -> Delete old)
      case "replace": {
        const oldKey = params.oldKey || params.oldStoragePath;
        const newKey = params.newKey || params.newStoragePath || params.key;
        const base64 = params.base64;
        const mimeType = params.mimeType || "application/octet-stream";

        if (!newKey || !base64) {
          return sendError(
            res,
            new ValidationError("Missing required 'newKey' and 'base64' parameters for replacement.")
          );
        }

        const cleanNewKey = sanitizeKey(newKey, actualBucket);
        const cleanOldKey = oldKey ? sanitizeKey(oldKey, actualBucket) : "";
        const buffer = Buffer.from(base64, "base64");

        // 1. Upload new object
        const uploadRes = await uploadObjectToR2({
          bucket: actualBucket,
          key: cleanNewKey,
          body: buffer,
          contentType: mimeType,
        });

        // 2. Verify new object exists in R2
        const headCheck = await headObjectFromR2({ bucket: actualBucket, key: cleanNewKey });
        if (!headCheck.exists) {
          // Rollback newly uploaded object
          if (cleanOldKey && cleanOldKey !== cleanNewKey) {
            await deleteObjectFromR2({ bucket: actualBucket, key: cleanNewKey }).catch(() => {});
          }
          return sendError(
            res,
            new StorageError(`Replace verification failed: Object was not found in R2 after upload: ${cleanNewKey}`, "REPLACE_VERIFY_FAILED")
          );
        }

        // 3. Delete old object only if new object is verified and oldKey is different
        if (cleanOldKey && cleanOldKey !== cleanNewKey) {
          try {
            await deleteObjectFromR2({ bucket: actualBucket, key: cleanOldKey });
          } catch (delErr) {
            console.warn(`[Storage API] Old object cleanup warning during replace: ${cleanOldKey}`, delErr);
          }
        }

        const downloadUrl = `/api/storage?action=download&bucket=${encodeURIComponent(uploadRes.bucket)}&key=${encodeURIComponent(cleanNewKey)}`;
        const publicUrl = config.publicUrl
          ? `${config.publicUrl}/${cleanNewKey}`
          : downloadUrl;

        return sendSuccess(res, {
          bucket: uploadRes.bucket,
          key: uploadRes.key,
          etag: uploadRes.etag,
          url: downloadUrl,
          publicUrl,
          size: buffer.length,
          mimeType,
          replaced: true,
          oldKeyDeleted: Boolean(cleanOldKey && cleanOldKey !== cleanNewKey),
        });
      }

      // 8. LIST OBJECTS
      case "list": {
        const cleanPrefix = params.prefix ? sanitizeKey(params.prefix, actualBucket) : "";
        const result = await listObjectsFromR2({
          bucket: actualBucket,
          prefix: cleanPrefix,
          maxKeys: Number(params.limit) || 1000,
          continuationToken: params.continuationToken,
        });
        return sendSuccess(res, result);
      }

      default:
        return sendError(
          res,
          new Error(`Unsupported storage action: ${action}`),
          "Unsupported storage action",
          "INVALID_ACTION"
        );
    }
  } catch (err: any) {
    return sendError(res, err, "Storage operation failed.", "STORAGE_OPERATION_FAILED");
  }
}
