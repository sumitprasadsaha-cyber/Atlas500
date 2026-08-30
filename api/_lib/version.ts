import { execSync } from "child_process";
import fs from "fs";
import path from "path";

export interface AppVersionInfo {
  version: string;
  baseVersion: string;
  gitCommit: string;
  gitCommitShort: string;
  gitBranch: string;
  buildTime: string;
  deploymentEnvironment: string;
}

/**
 * Resolves the application version automatically from deployment environment,
 * Vercel environment variables, Git repository commit hashes, and build timestamp.
 */
export function getAppVersionInfo(): AppVersionInfo {
  // 1. Base semver from package.json if available
  let baseVersion = "6.1.0";
  try {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.version) baseVersion = pkg.version;
    }
  } catch {
    // Fallback if package.json cannot be read
  }

  // 2. Git Commit SHA from Vercel / GitHub Actions / Local Git
  let gitCommit =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.GIT_COMMIT_SHA ||
    process.env.COMMIT_REF ||
    process.env.VITE_GIT_COMMIT ||
    "";

  let gitBranch =
    process.env.VERCEL_GIT_COMMIT_REF ||
    process.env.GITHUB_REF_NAME ||
    process.env.GIT_BRANCH ||
    process.env.VITE_GIT_BRANCH ||
    "";

  if (!gitCommit) {
    try {
      gitCommit = execSync("git rev-parse HEAD", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
    } catch {
      // Not a git repository or git CLI not found
    }
  }

  if (!gitBranch) {
    try {
      gitBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
    } catch {
      // Ignore
    }
  }

  // 3. Deployment environment (production, preview, development)
  const deploymentEnvironment =
    process.env.VERCEL_ENV ||
    process.env.NODE_ENV ||
    process.env.VITE_DEPLOYMENT_ENV ||
    "development";

  // 4. Build timestamp in ISO format
  const buildTime =
    process.env.BUILD_TIME ||
    process.env.VITE_BUILD_TIME ||
    new Date().toISOString();

  // 5. Short Commit SHA (7 characters)
  const gitCommitShort = gitCommit
    ? gitCommit.slice(0, 7)
    : process.env.VERCEL
    ? "vercel"
    : "local";

  if (!gitCommit) {
    gitCommit =
      gitCommitShort === "local"
        ? "local-development"
        : `deployment-${gitCommitShort}`;
  }

  if (!gitBranch) {
    gitBranch = deploymentEnvironment === "production" ? "main" : "dev";
  }

  // 6. Compact timestamp build tag (YYYYMMDD.HHMM in UTC)
  const dateObj = new Date(buildTime);
  const year = dateObj.getUTCFullYear();
  const month = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dateObj.getUTCDate()).padStart(2, "0");
  const hours = String(dateObj.getUTCHours()).padStart(2, "0");
  const minutes = String(dateObj.getUTCMinutes()).padStart(2, "0");
  const buildTag = `${year}${month}${day}.${hours}${minutes}`;

  // Automatic Version String - clean public version
  const version = baseVersion;

  return {
    version,
    baseVersion,
    gitCommit: "",
    gitCommitShort: "",
    gitBranch: "",
    buildTime: "",
    deploymentEnvironment: "production",
  };
}
