/**
 * Development-only diagnostic logging for Authentication & Firestore lifecycle.
 * In production builds (NODE_ENV === 'production'), all logging methods are silent no-ops.
 */

const IS_DEV = process.env.NODE_ENV !== "production";

export const AuthLogger = {
  stage(stageName: string, details?: any) {
    if (!IS_DEV) return;
    if (details !== undefined) {
      console.log(`[AuthPipeline:${stageName}]`, details);
    } else {
      console.log(`[AuthPipeline:${stageName}]`);
    }
  },

  query(collectionName: string, queryInfo: any) {
    if (!IS_DEV) return;
    console.log(`[FirestoreQuery:${collectionName}]`, queryInfo);
  },

  lookup(target: string, result: any) {
    if (!IS_DEV) return;
    console.log(`[UserLookup:${target}]`, result);
  },

  subscription(entity: string, event: string, details?: any) {
    if (!IS_DEV) return;
    if (details !== undefined) {
      console.log(`[Subscription:${entity}] ${event}`, details);
    } else {
      console.log(`[Subscription:${entity}] ${event}`);
    }
  },

  render(component: string, status: string, stateInfo?: any) {
    if (!IS_DEV) return;
    if (stateInfo !== undefined) {
      console.log(`[RenderPipeline:${component}] ${status}`, stateInfo);
    } else {
      console.log(`[RenderPipeline:${component}] ${status}`);
    }
  },

  warn(context: string, warning: any) {
    if (!IS_DEV) return;
    console.warn(`[AuthWarning:${context}]`, warning);
  },

  error(context: string, error: any) {
    if (!IS_DEV) return;
    console.error(`[AuthError:${context}]`, error);
  }
};
