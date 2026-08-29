import { ValidationError } from "./errors.js";

/**
 * Validates that an action string is provided and belongs to the allowed set.
 */
export function validateAction<T extends string>(action: any, allowedActions: readonly T[], defaultAction?: T): T {
  const normAction = (action ? String(action).toLowerCase().trim() : defaultAction) as T;
  if (!normAction || !allowedActions.includes(normAction)) {
    throw new ValidationError(
      `Invalid or missing 'action' parameter. Allowed actions: ${allowedActions.join(", ")}`,
      { action, allowedActions }
    );
  }
  return normAction;
}

/**
 * Validates that required fields are present and non-empty in a payload object.
 */
export function validateRequiredFields(obj: Record<string, any>, fields: string[]): void {
  const missing: string[] = [];
  for (const field of fields) {
    if (obj[field] === undefined || obj[field] === null || obj[field] === "") {
      missing.push(field);
    }
  }
  if (missing.length > 0) {
    throw new ValidationError(`Missing required field(s): ${missing.join(", ")}`, { missing });
  }
}
