import { handleOptions, sendSuccess, sendError } from "./_lib/responses.js";
import { validateAction } from "./_lib/validation.js";
import { checkFirestoreHealth } from "./_lib/firestore.js";
import { StudentsAction } from "./_shared/types.js";

export const runtime = "nodejs";

const ALLOWED_ACTIONS = [
  "profile",
  "attendance",
  "fees",
  "homework",
  "progress",
  "dashboard",
  "service-status",
] as const;

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;

  try {
    const actionParam = req.query.action || req.body?.action || "service-status";
    const action = validateAction<StudentsAction>(actionParam, ALLOWED_ACTIONS, "service-status");

    switch (action) {
      case "service-status": {
        const firestoreStatus = await checkFirestoreHealth();
        return sendSuccess(res, {
          service: "Students Service",
          database: "Firestore",
          status: "ready",
          firestore: firestoreStatus,
        });
      }

      case "profile":
      case "attendance":
      case "fees":
      case "homework":
      case "progress":
      case "dashboard": {
        // Returns status confirmation; client syncs via direct Firestore connection for offline capability
        return sendSuccess(res, {
          action,
          status: "active",
          storageBackend: "Firestore",
          timestamp: new Date().toISOString(),
        });
      }

      default:
        return res.status(400).json({ error: `Unsupported students action: ${action}` });
    }
  } catch (err: any) {
    return sendError(res, err, "Students operation failed.");
  }
}
