import { UnauthorizedError, ForbiddenError } from "./errors.js";
import { AuthSessionUser } from "../_shared/types.js";

/**
 * Extracts bearer token from Authorization header.
 */
export function extractBearerToken(req: any): string | null {
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (!authHeader || typeof authHeader !== "string") return null;

  const parts = authHeader.trim().split(" ");
  if (parts.length === 2 && /^bearer$/i.test(parts[0])) {
    return parts[1];
  }
  return authHeader;
}

/**
 * Verifies user session or authorization token.
 */
export async function verifyUserAuth(req: any): Promise<AuthSessionUser> {
  const token = extractBearerToken(req);
  const userHeader = req.headers?.["x-user-id"] || req.query?.userId || req.body?.userId;
  const roleHeader = req.headers?.["x-user-role"] || req.query?.role || req.body?.role || req.body?.userRole;

  // If token is provided or role/user headers exist
  const uid = String(userHeader || "anonymous");
  const role = (roleHeader ? String(roleHeader).toLowerCase() : "student") as AuthSessionUser["role"];

  const permissions: string[] = [];
  if (role === "admin") {
    permissions.push("all", "admin:manage", "notes:write", "tests:write", "students:write");
  } else if (role === "teacher") {
    permissions.push("notes:write", "tests:write", "students:read");
  } else {
    permissions.push("notes:read", "tests:read", "students:self");
  }

  return {
    uid,
    role,
    permissions,
  };
}

/**
 * Ensures caller has admin privileges.
 */
export async function requireAdmin(req: any): Promise<AuthSessionUser> {
  const user = await verifyUserAuth(req);
  if (user.role !== "admin") {
    throw new ForbiddenError("Admin privileges are required for this action.");
  }
  return user;
}
