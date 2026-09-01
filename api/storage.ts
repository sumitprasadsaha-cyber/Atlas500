import { pipeline } from "stream";
import { handleOptions, sendSuccess, sendError, setCorsHeaders } from "./_lib/responses.js";
import { validateAction } from "./_lib/validation.js";
import { NotFoundError, ValidationError, StorageError } from "./_lib/errors.js";
import { sanitizeKey, getMimeType, parseRequestBody, extractUploadPayload } from "./_lib/utils.js";
import { verifyUserAuth } from "./_lib/auth.js";
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
import { getHierarchyLineage, type HierarchyPathContext } from "../src/utils/canonicalStorageKey.js";

export const runtime = "nodejs";

const ALLOWED_ACTIONS = [
  "upload",
  "download",
  "signed-url",
  "delete",
  "delete-multiple",
  "delete-node",
  "replace",
  "list",
  "exists",
  "verify",
  "head",
  "create-node",
  "get-node",
  "list-nodes",
  "discover-topics",
  "migrate-hierarchy",
  "health",
  "status",
  "ping",
  "test",
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

    const hasKey = Boolean(
      params.key ||
      params.storageKey ||
      params.storagePath ||
      params.objectKey ||
      params.r2Key ||
      params.path
    );

    // Determine action from query, body, or URL
    const actionParam =
      params.action ||
      (req.method === "GET" && hasKey
        ? "download"
        : req.method === "GET"
        ? "health"
        : "upload");
    const action = validateAction<StorageAction>(actionParam, ALLOWED_ACTIONS, "health");

    const config = getR2ServerConfig();
    const actualBucket = (params.bucket || config.bucket || "academy-connect-files").trim();

    switch (action) {
      // 1. GENERATE SIGNED URL / SECURE RETRIEVAL METADATA
      case "signed-url": {
        const startTime = Date.now();
        const cleanKey = resolveStorageKey(params, actualBucket);
        if (!cleanKey) {
          return sendError(
            res,
            new ValidationError("Storage metadata missing: Missing required 'key' or 'storageKey' parameter.")
          );
        }

        console.log(`[Stage 2: Key Resolution] Storage Key Resolved:`, {
          stage: "2_KEY_RESOLUTION",
          incomingKey: params.key || params.storageKey || params.storagePath || params.r2Key || params.pdfUrl,
          canonicalKey: cleanKey,
          bucket: actualBucket,
          operation: params.operation || "getObject",
        });

        // Verify object existence using HeadObject before generating any signed URL
        const headCheck = await headObjectFromR2({ bucket: actualBucket, key: cleanKey });
        const exists = Boolean(headCheck && headCheck.exists);

        if (!exists && params.operation !== "putObject") {
          console.info(`[Stage 3: R2 Existence Check] Object NOT found: key="${cleanKey}", bucket="${actualBucket}" (${Date.now() - startTime}ms)`);
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
        const expiresIn = Number(params.expiresIn) || 3600;
        const expiryTimestamp = new Date(Date.now() + expiresIn * 1000).toISOString();
        const downloadUrl = `/api/storage?action=download&bucket=${encodeURIComponent(actualBucket)}&key=${encodeURIComponent(effectiveKey)}`;

        try {
          const signedUrl = await generateR2SignedUrl({
            bucket: actualBucket,
            key: effectiveKey,
            expiresIn,
            operation: params.operation === "putObject" ? "putObject" : "getObject",
            contentType: headContentType,
          });

          console.log(`[Stage 4: URL Generation] URL Generated Successfully:`, {
            stage: "4_URL_GENERATION",
            bucket: actualBucket,
            key: effectiveKey,
            signedUrl: signedUrl.substring(0, 80) + "...",
            downloadUrl,
            expiresIn,
            expiryTimestamp,
            contentType: headContentType,
            contentLength: headContentLength,
            durationMs: Date.now() - startTime,
          });

          return sendSuccess(res, {
            signedUrl,
            downloadUrl,
            contentType: headContentType,
            contentLength: headContentLength,
            filename: fileName,
            fileName: fileName,
            bucket: actualBucket,
            key: effectiveKey,
            exists: true,
            expiresIn,
            expiryTimestamp,
            status: 200,
          });
        } catch (signErr: any) {
          console.error("[Stage 4: URL Generation] Signed URL generation failed:", signErr);
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
        const startTime = Date.now();
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

        console.log(`[Storage API] Upload Started:`, {
          bucket: actualBucket,
          key: cleanKey,
          sizeBytes: payload.buffer.length,
          contentType,
          filename: payload.fileName,
        });

        try {
          const result = await uploadObjectToR2({
            bucket: actualBucket,
            key: cleanKey,
            body: payload.buffer,
            contentType,
          });

          console.log(`[Storage API] Upload Finished & Verification Passed:`, {
            bucket: result.bucket,
            key: result.key,
            etag: result.etag,
            size: result.size,
            durationMs: Date.now() - startTime,
          });

          const downloadUrl = `/api/storage?action=download&bucket=${encodeURIComponent(result.bucket)}&key=${encodeURIComponent(cleanKey)}`;
          const publicUrl = config.publicUrl
            ? `${config.publicUrl}/${cleanKey}`
            : downloadUrl;

          console.log(`[Storage API] Returned URL:`, {
            bucket: result.bucket,
            key: result.key,
            downloadUrl,
            publicUrl,
          });

          return sendSuccess(res, {
            bucket: result.bucket,
            key: result.key,
            etag: result.etag,
            url: downloadUrl,
            publicUrl: publicUrl,
            size: result.size,
            mimeType: result.contentType || contentType,
            filename: payload.fileName,
          });
        } catch (uploadErr: any) {
          console.error("[Storage API] Upload execution error:", {
            bucket: actualBucket,
            key: cleanKey,
            error: uploadErr?.message,
            stack: uploadErr?.stack,
          });
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

        // Trace 4: Log incoming backend request & auth verification result
        let authUser: any = null;
        try {
          authUser = await verifyUserAuth(req);
        } catch (authErr: any) {
          authUser = { error: authErr?.message || "Auth error", role: "anonymous" };
        }

        console.log("[Trace 4: Backend Request]", {
          incomingRequest: {
            path: req.path || req.url,
            method: req.method,
            queryParams: req.query || {},
            headers: {
              host: req.headers?.host,
              origin: req.headers?.origin,
              referer: req.headers?.referer,
              "user-agent": req.headers?.["user-agent"],
              authorization: req.headers?.authorization ? "Bearer [REDACTED]" : "None",
              "x-user-id": req.headers?.["x-user-id"],
              "x-user-role": req.headers?.["x-user-role"],
              range: req.headers?.range,
            },
          },
          authVerificationResult: {
            uid: authUser?.uid || "anonymous",
            role: authUser?.role || "student",
            permissions: authUser?.permissions || ["notes:read"],
            isAllowed: true,
          },
          r2S3ClientRequest: {
            bucket: actualBucket,
            key: cleanKey,
            method: req.method === "HEAD" ? "HeadObject" : "GetObject",
          },
        });

        console.log(`[Stage 2: Key Resolution] Storage Key Resolved for Download:`, {
          stage: "2_KEY_RESOLUTION",
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
            res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
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
          console.warn("[Stage 5: Backend Streaming] getObjectFromR2 notice:", getErr?.message || getErr);
          if (getErr?.code === "R2_ACCESS_DENIED" || getErr?.$metadata?.httpStatusCode === 403) {
            return sendError(
              res,
              new StorageError("Cloudflare R2 storage credentials denied access.", "R2_ACCESS_DENIED", 403)
            );
          }
          return sendError(
            res,
            new NotFoundError(`Object not found: "${cleanKey}" does not exist in bucket "${actualBucket}".`)
          );
        }

        if (!obj || !obj.body) {
          console.info(`[Stage 5: Backend Streaming] Download Object Not Found: key="${cleanKey}", bucket="${actualBucket}"`);
          return sendError(
            res,
            new NotFoundError(`Object not found: "${cleanKey}" does not exist in bucket "${actualBucket}".`)
          );
        }

        const contentType = params.mimeType || obj.contentType || getMimeType(cleanKey);
        const fileName = (params.filename as string) || cleanKey.split("/").pop() || (contentType === "application/pdf" ? "note.pdf" : "image.jpg");
        const isAttachment = params.download === "true" || params.download === true;
        const dispositionType = isAttachment ? "attachment" : "inline";

        setCorsHeaders(res);
        res.setHeader("Content-Type", contentType);
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");

        if (obj.etag) res.setHeader("ETag", obj.etag);
        if (obj.contentRange) {
          res.status(206);
          res.setHeader("Content-Range", obj.contentRange);
        }
        if (obj.contentLength) {
          res.setHeader("Content-Length", obj.contentLength);
        }

        // Set Content-Disposition: inline for topic viewing, attachment for download
        res.setHeader("Content-Disposition", `${dispositionType}; filename="${encodeURIComponent(fileName)}"`);

        console.log(`[Stage 5: Backend Streaming] Commencing pipeline stream:`, {
          stage: "5_BACKEND_STREAMING",
          bucket: actualBucket,
          key: cleanKey,
          resolvedKey: obj.resolvedKey,
          contentType,
          contentLength: obj.contentLength || "chunked",
          dispositionType,
          etag: obj.etag,
          headersSent: {
            "Content-Type": contentType,
            "Content-Disposition": `${dispositionType}; filename="${fileName}"`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });

        // Safely stream through pipeline and await completion so serverless lambda does not terminate execution prematurely
        return await new Promise<void>((resolve) => {
          let isFinished = false;

          const finalizeStream = (status: "success" | "error" | "aborted", err?: any) => {
            if (isFinished) return;
            isFinished = true;
            const durationMs = Date.now() - startTime;

            if (status === "success") {
              console.log(`[Stage 6: Client Final Response] Stream completed successfully:`, {
                stage: "6_FINAL_RESPONSE",
                key: cleanKey,
                durationMs,
                status: 200,
              });
            } else if (status === "aborted") {
              console.log(`[Stage 6: Client Final Response] Client aborted stream connection:`, {
                stage: "6_FINAL_RESPONSE",
                key: cleanKey,
                durationMs,
                status: "ABORTED",
              });
            } else {
              console.error(`[Stage 6: Client Final Response] Stream failed:`, {
                stage: "6_FINAL_RESPONSE",
                key: cleanKey,
                durationMs,
                error: err?.message || err,
              });
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

      // 9. CREATE HIERARCHY NODE (Flat Object Storage Architecture)
      // R2 is an object store, not a filesystem. No placeholder files or metadata.json needed.
      case "create-node": {
        const ctx: HierarchyPathContext = {
          category: params.category || (params.className?.toUpperCase() === "UPSC" || params.gsPaper ? "upsc" : "school"),
          type: params.type || params.nodeType,
          nodeType: params.nodeType || params.type,
          className: params.className || params.classGrade || params.class,
          classGrade: params.classGrade || params.className || params.class,
          gsPaper: params.gsPaper || params.generalStudiesPaper,
          generalStudiesPaper: params.generalStudiesPaper || params.gsPaper,
          subject: params.subject || params.subjectName,
          subjectName: params.subjectName || params.subject,
          chapterNumber: params.chapterNumber ?? params.chapterNo,
          chapterNo: params.chapterNo ?? params.chapterNumber,
          chapterName: params.chapterName || params.chapterTitle,
          chapterTitle: params.chapterTitle || params.chapterName,
          moduleNumber: params.moduleNumber ?? params.moduleNo,
          moduleNo: params.moduleNo ?? params.moduleNumber,
          moduleName: params.moduleName || params.moduleTitle,
          moduleTitle: params.moduleTitle || params.moduleName,
          topicNumber: params.topicNumber ?? params.topicNo,
          topicNo: params.topicNo ?? params.topicNumber,
          topicName: params.topicName || params.topicTitle || params.partLabel,
          topicTitle: params.topicTitle || params.topicName,
          partLabel: params.partLabel,
        };

        const lineage = getHierarchyLineage(ctx);
        if (lineage.length === 0) {
          return sendError(
            res,
            new ValidationError("Invalid hierarchy parameters: unable to determine node hierarchy path.")
          );
        }

        const targetNode = lineage[lineage.length - 1];
        console.log(`[Storage API] Hierarchy node registered: type="${targetNode.type}", name="${targetNode.name}", folderPath="${targetNode.folderPath}"`);

        return sendSuccess(res, {
          success: true,
          message: "Hierarchy node registered (flat object storage model)",
          node: targetNode,
          createdCount: 0,
          createdNodes: [],
          storageKey: targetNode.metadataKey,
          folderPath: targetNode.folderPath,
        });
      }

      // 10. GET NODE METADATA
      case "get-node": {
        const cleanKey = resolveStorageKey(params, actualBucket);
        let metadataKey = cleanKey;
        if (!metadataKey.endsWith("/metadata.json")) {
          metadataKey = metadataKey ? `${metadataKey.replace(/\/+$/, "")}/metadata.json` : "";
        }

        if (!metadataKey) {
          return sendError(
            res,
            new ValidationError("Missing required 'key' or 'storageKey' for metadata retrieval.")
          );
        }

        try {
          const obj = await getObjectFromR2({ bucket: actualBucket, key: metadataKey });
          if (obj && obj.body) {
            const chunks: Buffer[] = [];
            for await (const chunk of obj.body) {
              chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
            }
            const rawText = Buffer.concat(chunks).toString("utf-8");
            const metadata = JSON.parse(rawText);

            return sendSuccess(res, {
              success: true,
              storageKey: metadataKey,
              node: metadata,
            });
          }
        } catch (err) {
          // In flat object storage, metadata.json is optional; return synthesized node
        }

        const folderPath = metadataKey.replace(/\/metadata\.json$/, "");
        const pathParts = folderPath.split("/").filter(Boolean);
        const nodeName = pathParts[pathParts.length - 1] || "Node";
        const cleanNodeTitle = nodeName
          .replace(/^[\(\[\{-]?\s*(?:chapter|ch|module|mod|topic|part|pt)\b\.?[\s_]*\d+[\)\]\}]?[\s_.:–\-]*\s*/i, "")
          .replace(/^[\(\[\{-]?\s*(?:chapter|ch|module|mod|topic|part|pt)\b\.?[\)\]\}]?[\s_]*[:–\-]\s*/i, "")
          .replace(/_/g, " ")
          .trim() || nodeName.replace(/_/g, " ");

        return sendSuccess(res, {
          success: true,
          storageKey: metadataKey,
          node: {
            id: folderPath,
            name: cleanNodeTitle,
            folderPath,
            storageKey: metadataKey,
          },
        });
      }

      // 11. LIST ALL HIERARCHY NODES (DISCOVERY)
      // Discovers hierarchy nodes via object prefixes in R2
      case "list-nodes": {
        const category = params.category || "all";
        const customPrefix = params.prefix ? sanitizeKey(params.prefix, actualBucket) : "";

        let prefixesToSearch: string[] = [];
        if (customPrefix) {
          prefixesToSearch = [customPrefix];
        } else if (category === "school") {
          prefixesToSearch = ["class_notes/"];
        } else if (category === "upsc") {
          prefixesToSearch = ["upsc/"];
        } else {
          prefixesToSearch = ["class_notes/", "upsc/"];
        }

        const nodesMap = new Map<string, any>();
        for (const prefix of prefixesToSearch) {
          let token: string | undefined = undefined;
          do {
            const listRes = await listObjectsFromR2({
              bucket: actualBucket,
              prefix,
              maxKeys: 1000,
              continuationToken: token,
            });

            for (const item of listRes.objects || []) {
              const cleanItemKey = item.key.replace(/^\/+/, "").replace(/\/+$/, "");
              const parts = cleanItemKey.split("/").filter(Boolean);

              // Enumerate all ancestor folder levels
              for (let i = 1; i <= parts.length; i++) {
                const isLeaf = i === parts.length;
                const isFile = isLeaf && /\.[a-z0-9]+$/i.test(parts[parts.length - 1]);
                if (isFile) continue; // files are not folder nodes

                const currentFolderParts = parts.slice(0, i);
                const folderPath = currentFolderParts.join("/");
                const segment = currentFolderParts[currentFolderParts.length - 1];

                if (!nodesMap.has(folderPath)) {
                  let cleanName = segment
                    .replace(/^[\(\[\{-]?\s*(?:chapter|ch|module|mod|topic|part|pt)\b\.?[\s_]*\d+[\)\]\}]?[\s_.:–\-]*\s*/i, "")
                    .replace(/^[\(\[\{-]?\s*(?:chapter|ch|module|mod|topic|part|pt)\b\.?[\)\]\}]?[\s_]*[:–\-]\s*/i, "")
                    .replace(/_/g, " ")
                    .trim();
                  if (!cleanName) cleanName = segment.replace(/_/g, " ");

                  nodesMap.set(folderPath, {
                    id: folderPath,
                    folderPath,
                    storageKey: `${folderPath}/metadata.json`,
                    name: cleanName,
                    rawName: segment,
                    lastModified: item.lastModified,
                  });
                }
              }
            }

            token = listRes.nextContinuationToken;
          } while (token);
        }

        const nodes = Array.from(nodesMap.values());
        return sendSuccess(res, {
          success: true,
          category,
          count: nodes.length,
          nodes,
        });
      }

      // 12. DISCOVER TOPICS (Direct Topic Enumeration for Chapter/Module from R2 Authoritative Storage)
      case "discover-topics": {
        const category = params.category || "all";
        const classGrade = params.classGrade || params.className || "";
        const gsPaper = params.gsPaper || params.generalStudiesPaper || "";
        const subject = params.subject || "";
        const chapterNo = params.chapterNo !== undefined ? Number(params.chapterNo) : undefined;
        const moduleNo = params.moduleNo !== undefined ? Number(params.moduleNo) : undefined;
        const requestedPrefix = params.prefix ? sanitizeKey(params.prefix, actualBucket) : "";

        // Build candidate search prefixes
        const searchPrefixes: string[] = [];
        if (requestedPrefix) {
          searchPrefixes.push(requestedPrefix);
        } else if (category === "upsc" || (gsPaper && !classGrade)) {
          const gsFolder = gsPaper ? (gsPaper.includes("4") ? "GS4" : gsPaper.includes("3") ? "GS3" : gsPaper.includes("2") ? "GS2" : "GS1") : "";
          if (gsFolder && subject) {
            searchPrefixes.push(`upsc/${gsFolder}/${subject.replace(/\s+/g, "_")}/`);
            searchPrefixes.push(`upsc/${gsFolder}/${subject}/`);
            searchPrefixes.push(`${gsFolder}/${subject.replace(/\s+/g, "_")}/`);
          } else if (gsFolder) {
            searchPrefixes.push(`upsc/${gsFolder}/`);
            searchPrefixes.push(`${gsFolder}/`);
          } else {
            searchPrefixes.push("upsc/", "GS1/", "GS2/", "GS3/", "GS4/");
          }
        } else if (category === "school" || (classGrade && !gsPaper)) {
          const classFolder = classGrade ? `Class_${String(classGrade).replace(/\D/g, "").padStart(2, "0")}` : "";
          if (classFolder && subject) {
            searchPrefixes.push(`class_notes/${classFolder}/${subject.replace(/\s+/g, "_")}/`);
            searchPrefixes.push(`class_notes/${classFolder}/${subject}/`);
            searchPrefixes.push(`${classFolder}/${subject.replace(/\s+/g, "_")}/`);
          } else if (classFolder) {
            searchPrefixes.push(`class_notes/${classFolder}/`);
            searchPrefixes.push(`${classFolder}/`);
          } else {
            searchPrefixes.push("class_notes/");
          }
        } else {
          // "all" or unspecified - comprehensive search across all prefixes
          searchPrefixes.push("class_notes/", "upsc/", "Class_09/", "Class_10/", "Class_11/", "Class_12/", "GS1/", "GS2/", "GS3/", "GS4/");
        }

        const discoveredTopicsMap = new Map<string, any>();
        for (const prefix of searchPrefixes) {
          let token: string | undefined = undefined;
          do {
            const listRes = await listObjectsFromR2({
              bucket: actualBucket,
              prefix,
              maxKeys: 1000,
              continuationToken: token,
            });

            for (const item of listRes.objects || []) {
              const cleanKey = item.key.replace(/^\/+/, "");
              if (cleanKey.endsWith("/metadata.json")) continue;

              const parts = cleanKey.split("/").filter(Boolean);
              // Expected structures:
              // class_notes/Class_10/History/Chapter_02_Nationalism_in_India/Topic_01_Rise_of_Mass_Nationalism/file.pdf
              // upsc/GS1/History/Module_01_Ancient_India/Topic_01_Harappan_Civilization/file.pdf
              let foundTopicSegment = "";
              let foundChapterSegment = "";
              let foundClassSegment = "";
              let foundSubjectSegment = "";
              let isUpscDetected = false;
              let detectedGsPaper = "";

              for (const part of parts) {
                if (/^Topic[_.\s-]/i.test(part)) {
                  foundTopicSegment = part;
                } else if (/^(?:Chapter|Ch|Module|Mod)[_.\s-]/i.test(part)) {
                  foundChapterSegment = part;
                } else if (/^Class[_.\s-]/i.test(part)) {
                  foundClassSegment = part;
                } else if (/^(?:GS[1-4]|General_Studies_Paper_[1-4]|Essay|CSAT)/i.test(part)) {
                  isUpscDetected = true;
                  foundClassSegment = "UPSC";
                  const m = part.match(/GS([1-4])/i) || part.match(/Paper_([1-4])/i);
                  detectedGsPaper = m ? `GS Paper ${m[1]}` : (part.toLowerCase().includes("essay") ? "Essay" : part.toLowerCase().includes("csat") ? "CSAT" : "GS Paper 1");
                } else if (part.toLowerCase() === "upsc") {
                  isUpscDetected = true;
                  foundClassSegment = "UPSC";
                } else if (part !== "class_notes" && !foundSubjectSegment && !/\.[a-z0-9]+$/i.test(part)) {
                  foundSubjectSegment = part;
                }
              }

              if (foundTopicSegment) {
                const topicNoMatch = foundTopicSegment.match(/^(?:Topic|Part|Pt)[_.\s-]*(\d+)/i);
                const parsedTopicNo = topicNoMatch ? parseInt(topicNoMatch[1], 10) : undefined;
                const cleanTopicName = foundTopicSegment
                  .replace(/^[\(\[\{-]?\s*(?:topic|part|pt)\b\.?[\s_]*\d+[\)\]\}]?[\s_.:–\-]*\s*/i, "")
                  .replace(/^[\(\[\{-]?\s*(?:topic|part|pt)\b\.?[\)\]\}]?[\s_]*[:–\-]\s*/i, "")
                  .replace(/_/g, " ")
                  .trim();

                const chNoMatch = foundChapterSegment.match(/^(?:Chapter|Ch|Module|Mod)[_.\s-]*(\d+)/i);
                const parsedChNo = chNoMatch ? parseInt(chNoMatch[1], 10) : undefined;
                const cleanChName = foundChapterSegment
                  .replace(/^[\(\[\{-]?\s*(?:chapter|ch|module|mod)\b\.?[\s_]*\d+[\)\]\}]?[\s_.:–\-]*\s*/i, "")
                  .replace(/^[\(\[\{-]?\s*(?:chapter|ch|module|mod)\b\.?[\)\]\}]?[\s_]*[:–\-]\s*/i, "")
                  .replace(/_/g, " ")
                  .trim();

                const isFile = /\.[a-z0-9]+$/i.test(parts[parts.length - 1]);
                const fileName = isFile ? parts[parts.length - 1] : "note.pdf";
                const fileType = isFile ? (/\.(jpg|jpeg|png|webp)$/i.test(fileName) ? "image" : "pdf") : "pdf";

                const topicKey = `${foundClassSegment || "School"}/${foundSubjectSegment || "Subject"}/${foundChapterSegment || "Chapter"}/${foundTopicSegment}`;
                const existing = discoveredTopicsMap.get(topicKey);

                if (!existing || (!existing.storagePath && isFile) || (existing.storagePath && !existing.storagePath.includes(".") && isFile)) {
                  discoveredTopicsMap.set(topicKey, {
                    id: topicKey.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase(),
                    isUPSC: isUpscDetected,
                    type: isUpscDetected ? "upsc" : "school",
                    category: isUpscDetected ? "upsc" : "school",
                    topicFolder: foundTopicSegment,
                    topicNo: parsedTopicNo,
                    topicNumber: parsedTopicNo,
                    topicName: cleanTopicName,
                    topicTitle: cleanTopicName,
                    topicLabel: parsedTopicNo && cleanTopicName ? `Topic ${parsedTopicNo} : ${cleanTopicName}` : (cleanTopicName || `Topic ${parsedTopicNo || 1}`),
                    partLabel: parsedTopicNo && cleanTopicName ? `Topic ${parsedTopicNo} : ${cleanTopicName}` : (cleanTopicName || `Topic ${parsedTopicNo || 1}`),
                    chapterNo: parsedChNo,
                    chapterNumber: parsedChNo,
                    chapterName: cleanChName,
                    chapterTitle: cleanChName,
                    chapterFolder: foundChapterSegment,
                    moduleNo: isUpscDetected ? parsedChNo : undefined,
                    moduleNumber: isUpscDetected ? parsedChNo : undefined,
                    moduleName: isUpscDetected ? cleanChName : undefined,
                    moduleTitle: isUpscDetected ? cleanChName : undefined,
                    moduleFolder: isUpscDetected ? foundChapterSegment : undefined,
                    gsPaper: detectedGsPaper || (isUpscDetected ? "GS Paper 1" : undefined),
                    generalStudiesPaper: detectedGsPaper || (isUpscDetected ? "GS Paper 1" : undefined),
                    paper: detectedGsPaper || (isUpscDetected ? "GS Paper 1" : undefined),
                    classGrade: isUpscDetected ? "UPSC" : (foundClassSegment.replace(/_/g, " ") || "Class 10"),
                    className: isUpscDetected ? "UPSC" : (foundClassSegment.replace(/_/g, " ") || "Class 10"),
                    subject: foundSubjectSegment.replace(/_/g, " ") || "General",
                    subjectName: foundSubjectSegment.replace(/_/g, " ") || "General",
                    storagePath: cleanKey,
                    storageKey: cleanKey,
                    objectKey: cleanKey,
                    fileName,
                    fileSize: item.size || 0,
                    fileType,
                    lastModified: item.lastModified,
                    downloadUrl: `/api/storage?action=download&bucket=${encodeURIComponent(actualBucket)}&key=${encodeURIComponent(cleanKey)}`,
                  });
                }
              }
            }

            token = listRes.nextContinuationToken;
          } while (token);
        }

        const topics = Array.from(discoveredTopicsMap.values());
        return sendSuccess(res, {
          success: true,
          count: topics.length,
          topics,
        });
      }

      // 13. DELETE HIERARCHY NODE
      case "delete-node": {
        const cleanKey = resolveStorageKey(params, actualBucket);
        const folderPrefix = params.folderPath ? sanitizeKey(params.folderPath, actualBucket) : "";
        const targetPrefix = folderPrefix || (cleanKey ? cleanKey.replace(/\/metadata\.json$/, "") : "");

        if (!targetPrefix) {
          return sendError(
            res,
            new ValidationError("Missing required 'key', 'storageKey', or 'folderPath' for node deletion.")
          );
        }

        const sanitizedPrefix = targetPrefix.endsWith("/") ? targetPrefix : `${targetPrefix}/`;
        console.log(`[Storage API] Deleting node prefix: "${sanitizedPrefix}" in bucket "${actualBucket}"`);

        // List all objects under prefix
        let token: string | undefined = undefined;
        const keysToDelete: string[] = [];

        do {
          const listRes = await listObjectsFromR2({
            bucket: actualBucket,
            prefix: sanitizedPrefix,
            maxKeys: 1000,
            continuationToken: token,
          });

          if (listRes.objects && listRes.objects.length > 0) {
            keysToDelete.push(...listRes.objects.map((o) => o.key));
          }
          token = listRes.nextContinuationToken;
        } while (token);

        if (keysToDelete.length > 0) {
          await deleteObjectsFromR2({ bucket: actualBucket, keys: keysToDelete });
        }

        return sendSuccess(res, {
          success: true,
          deletedPrefix: sanitizedPrefix,
          deletedCount: keysToDelete.length,
          deletedKeys: keysToDelete,
        });
      }

      // 13. MIGRATE / GENERATE MISSING HIERARCHY METADATA (NO-OP in flat object store)
      case "migrate-hierarchy": {
        console.log("[Storage API] Flat object storage active: No metadata.json files needed.");
        return sendSuccess(res, {
          success: true,
          message: "Flat object storage model active: All objects are uploaded directly without folder/metadata creation.",
          totalChecked: 0,
          totalCreated: 0,
          createdKeys: [],
        });
      }

      // 14. HEALTH / STATUS / PING / TEST
      case "health":
      case "status":
      case "ping":
      case "test": {
        return sendSuccess(res, {
          success: true,
          status: "ok",
          service: "storage",
          action,
          isConfigured: isR2Configured(),
          bucket: actualBucket,
        });
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
