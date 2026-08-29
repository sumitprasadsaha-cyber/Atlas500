import { handleOptions, sendSuccess, sendError } from "./_lib/responses.js";
import { getAppVersionInfo } from "./_lib/version.js";

export const runtime = "nodejs";

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;

  try {
    // Strictly prevent browser or intermediate proxy caching
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");

    const info = getAppVersionInfo();

    return sendSuccess(res, {
      version: info.version,
      gitCommit: info.gitCommit,
      gitCommitShort: info.gitCommitShort,
      gitBranch: info.gitBranch,
      buildTime: info.buildTime,
      deploymentEnvironment: info.deploymentEnvironment,
      baseVersion: info.baseVersion,
    });
  } catch (err: any) {
    return sendError(res, err, "Failed to retrieve application version metadata.");
  }
}
