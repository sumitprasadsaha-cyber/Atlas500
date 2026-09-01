/**
 * Production-grade structured diagnostic logging for Session, Cache, Auth, Role, Student, Sync, Resume, Logout, and Validation lifecycles.
 */

export interface StructuredLogContext {
  uid?: string | null;
  studentId?: string | null;
  requestId?: string;
  sessionId?: string;
  cacheOwner?: string | null;
  [key: string]: any;
}

function formatContext(ctx?: StructuredLogContext): string {
  if (!ctx) return "";
  const parts: string[] = [];
  if (ctx.uid) parts.push(`uid=${ctx.uid}`);
  if (ctx.studentId) parts.push(`studentId=${ctx.studentId}`);
  if (ctx.sessionId) parts.push(`sessionId=${ctx.sessionId}`);
  if (ctx.cacheOwner) parts.push(`cacheOwner=${ctx.cacheOwner}`);
  if (ctx.requestId) parts.push(`reqId=${ctx.requestId}`);
  return parts.length > 0 ? ` [${parts.join(" ")}]` : "";
}

export const StructuredLogger = {
  session(action: string, ctx?: StructuredLogContext, details?: any) {
    console.log(`[Session] ${action}${formatContext(ctx)}`, details !== undefined ? details : "");
  },

  cache(action: string, ctx?: StructuredLogContext, details?: any) {
    console.log(`[Cache] ${action}${formatContext(ctx)}`, details !== undefined ? details : "");
  },

  auth(action: string, ctx?: StructuredLogContext, details?: any) {
    console.log(`[Auth] ${action}${formatContext(ctx)}`, details !== undefined ? details : "");
  },

  role(action: string, ctx?: StructuredLogContext, details?: any) {
    console.log(`[Role] ${action}${formatContext(ctx)}`, details !== undefined ? details : "");
  },

  student(action: string, ctx?: StructuredLogContext, details?: any) {
    console.log(`[Student] ${action}${formatContext(ctx)}`, details !== undefined ? details : "");
  },

  sync(action: string, ctx?: StructuredLogContext, details?: any) {
    console.log(`[Sync] ${action}${formatContext(ctx)}`, details !== undefined ? details : "");
  },

  resume(action: string, ctx?: StructuredLogContext, details?: any) {
    console.log(`[Resume] ${action}${formatContext(ctx)}`, details !== undefined ? details : "");
  },

  logout(action: string, ctx?: StructuredLogContext, details?: any) {
    console.log(`[Logout] ${action}${formatContext(ctx)}`, details !== undefined ? details : "");
  },

  validation(action: string, ctx?: StructuredLogContext, details?: any) {
    console.log(`[Validation] ${action}${formatContext(ctx)}`, details !== undefined ? details : "");
  },

  warn(category: string, action: string, ctx?: StructuredLogContext, details?: any) {
    console.warn(`[${category}:WARN] ${action}${formatContext(ctx)}`, details !== undefined ? details : "");
  },

  error(category: string, action: string, ctx?: StructuredLogContext, error?: any) {
    console.error(`[${category}:ERROR] ${action}${formatContext(ctx)}`, error !== undefined ? error : "");
  }
};

export const AuthLogger = {
  stage(stageName: string, details?: any) {
    StructuredLogger.auth(stageName, details);
  },

  query(collectionName: string, queryInfo: any) {
    StructuredLogger.sync(`query:${collectionName}`, undefined, queryInfo);
  },

  lookup(target: string, result: any) {
    StructuredLogger.role(`lookup:${target}`, undefined, result);
  },

  subscription(entity: string, event: string, details?: any) {
    StructuredLogger.sync(`sub:${entity}:${event}`, undefined, details);
  },

  render(component: string, status: string, stateInfo?: any) {
    StructuredLogger.session(`render:${component}:${status}`, undefined, stateInfo);
  },

  warn(context: string, warning: any) {
    StructuredLogger.warn("Auth", context, undefined, warning);
  },

  error(context: string, error: any) {
    StructuredLogger.error("Auth", context, undefined, error);
  }
};

