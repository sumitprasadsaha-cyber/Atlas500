import { handleOptions, sendSuccess, sendError } from "./_lib/responses.js";
import { getR2ServerConfig, isR2Configured, verifyR2ReadWrite } from "./_lib/r2.js";
import { checkFirestoreHealth } from "./_lib/firestore.js";
import { getAppVersionInfo } from "./_lib/version.js";
import { HealthStatusReport } from "./_shared/types.js";

export const runtime = "nodejs";

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;

  try {
    const rawUrl = (req.url || req.originalUrl || "").split("?")[0];
    const action = req.query?.action || (rawUrl.includes("debug-env") ? "debug-env" : "health");

    if (action === "debug-env") {
      const data = {
        VERCEL: process.env.VERCEL,
        NODE_ENV: process.env.NODE_ENV,
        R2_ACCOUNT_ID: !!process.env.R2_ACCOUNT_ID,
        R2_ACCESS_KEY_ID: !!process.env.R2_ACCESS_KEY_ID,
        R2_SECRET_ACCESS_KEY: !!process.env.R2_SECRET_ACCESS_KEY,
        R2_ENDPOINT: !!process.env.R2_ENDPOINT,
        R2_BUCKET: !!process.env.R2_BUCKET,
        R2_PUBLIC_URL: !!process.env.R2_PUBLIC_URL,
      };
      res.setHeader("Content-Type", "application/json");
      return res.status(200).json(data);
    }

    const r2Config = getR2ServerConfig();
    const r2Configured = isR2Configured();
    const isDeepCheck = req.query?.deep === "true" || req.query?.verify === "true";

    let r2ReadWrite = false;
    let r2Error: string | undefined;

    if (isDeepCheck && r2Configured) {
      try {
        const rwResult = await verifyR2ReadWrite();
        r2ReadWrite = rwResult.canRead && rwResult.canWrite;
      } catch (err: any) {
        r2Error = err.message;
      }
    }

    const firestoreStatus = await checkFirestoreHealth();
    const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);
    const versionInfo = getAppVersionInfo();

    const report: any = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: versionInfo.version,
      gitCommit: versionInfo.gitCommitShort,
      environment: {
        nodeEnv: process.env.NODE_ENV || "development",
        runtime: "nodejs",
        isVercel: Boolean(process.env.VERCEL),
        deploymentEnvironment: versionInfo.deploymentEnvironment,
        buildTime: versionInfo.buildTime,
      },
      services: {
        cloudflareR2: {
          status: r2Configured ? "connected" : "fallback_local",
          configured: r2Configured,
          bucket: r2Config.bucket,
          hasEndpoint: Boolean(r2Config.endpoint),
          hasCredentials: Boolean(r2Config.accessKeyId && r2Config.secretAccessKey),
          readWriteVerified: isDeepCheck ? r2ReadWrite : undefined,
          error: r2Error,
        },
        firestore: {
          status: firestoreStatus.status,
          configured: firestoreStatus.configured,
          projectId: firestoreStatus.projectId,
        },
        geminiAI: {
          status: hasGeminiKey ? "configured" : "missing_key",
          hasApiKey: hasGeminiKey,
        },
      },
    };

    return sendSuccess(res, report);
  } catch (err: any) {
    return sendError(res, err, "Health check failed.");
  }
}

