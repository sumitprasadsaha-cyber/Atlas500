/**
 * Application Version & Runtime Configuration
 * Automatically computed from build environment, Git commit, and deployment metadata.
 */

export interface AppVersionData {
  version: string;
  gitCommit: string;
  gitCommitShort: string;
  gitBranch: string;
  buildTime: string;
  deploymentEnvironment: string;
  baseVersion: string;
}

// Clean public application version
export const APP_VERSION: string = "6.1.0";

export const GIT_COMMIT: string = "production";

export const GIT_COMMIT_SHORT: string = "prod";

export const GIT_BRANCH: string = "main";

export const BUILD_TIME: string = "";

export const DEPLOYMENT_ENV: string = "production";

export const BASE_VERSION: string = "6.1.0";

/**
 * Fetches the dynamic runtime version directly from the live /api/version endpoint.
 * Strictly bypasses all caches so users always receive the freshest deployment state.
 */
export async function fetchLiveAppVersion(): Promise<AppVersionData | null> {
  try {
    const res = await fetch(`/api/version?t=${Date.now()}`, {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
      },
    });

    if (!res.ok) return {
      version: APP_VERSION,
      gitCommit: "",
      gitCommitShort: "",
      gitBranch: "",
      buildTime: "",
      deploymentEnvironment: "production",
      baseVersion: BASE_VERSION,
    };
    const json = await res.json();
    return {
      version: json?.version || APP_VERSION,
      gitCommit: "",
      gitCommitShort: "",
      gitBranch: "",
      buildTime: "",
      deploymentEnvironment: "production",
      baseVersion: json?.baseVersion || BASE_VERSION,
    };
  } catch (err) {
    return {
      version: APP_VERSION,
      gitCommit: "",
      gitCommitShort: "",
      gitBranch: "",
      buildTime: "",
      deploymentEnvironment: "production",
      baseVersion: BASE_VERSION,
    };
  }
}
