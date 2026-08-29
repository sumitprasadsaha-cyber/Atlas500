import { handleOptions, sendSuccess, sendError, setCorsHeaders } from "./_lib/responses.js";
import { validateAction } from "./_lib/validation.js";
import { verifyUserAuth, requireAdmin } from "./_lib/auth.js";
import { AuthAction } from "./_shared/types.js";

export const runtime = "nodejs";

const ALLOWED_ACTIONS = ["session", "verify-admin", "verify-token", "permissions"] as const;

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;

  try {
    const action = validateAction<AuthAction>(
      req.query.action || req.body?.action,
      ALLOWED_ACTIONS,
      "session"
    );

    switch (action) {
      case "session":
      case "verify-token": {
        const user = await verifyUserAuth(req);
        return sendSuccess(res, { valid: true, user });
      }

      case "verify-admin": {
        const user = await requireAdmin(req);
        return sendSuccess(res, { isAdmin: true, user });
      }

      case "permissions": {
        const user = await verifyUserAuth(req);
        return sendSuccess(res, { permissions: user.permissions, role: user.role });
      }

      default:
        return sendError(res, new Error("Unhandled auth action"), "Invalid action");
    }
  } catch (err: any) {
    return sendError(res, err);
  }
}
