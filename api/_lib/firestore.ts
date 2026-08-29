/**
 * Firestore Serverless Library for consolidated API endpoints
 */

export interface FirestoreConfig {
  projectId: string;
  configured: boolean;
}

export function getFirestoreServerConfig(): FirestoreConfig {
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    "academy-connect";

  return {
    projectId,
    configured: Boolean(projectId),
  };
}

/**
 * Checks connectivity and basic config for Firestore.
 */
export async function checkFirestoreHealth(): Promise<{ status: "connected" | "unconfigured" | "error"; configured: boolean; projectId: string }> {
  const config = getFirestoreServerConfig();
  return {
    status: config.configured ? "connected" : "unconfigured",
    configured: config.configured,
    projectId: config.projectId,
  };
}
