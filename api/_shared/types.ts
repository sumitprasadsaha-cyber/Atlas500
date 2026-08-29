/**
 * Shared API Types & Request/Response Contracts
 * Phase 9: Vercel Serverless Function Consolidation
 */

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  statusCode?: number;
  [key: string]: any;
}

// ==========================================
// Storage API Types
// ==========================================
export type StorageAction =
  | "upload"
  | "download"
  | "signed-url"
  | "delete"
  | "delete-multiple"
  | "replace"
  | "list"
  | "exists"
  | "verify"
  | "head";

export interface StorageUploadRequest {
  bucket?: string;
  key: string;
  base64?: string;
  mimeType?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

export interface StorageSignedUrlRequest {
  bucket?: string;
  key: string;
  expiresIn?: number;
  operation?: "getObject" | "putObject";
  contentType?: string;
}

export interface StorageDeleteRequest {
  bucket?: string;
  key?: string;
  storagePath?: string;
  path?: string;
}

export interface StorageDeleteMultipleRequest {
  bucket?: string;
  keys: string[];
}

export interface StorageReplaceRequest {
  bucket?: string;
  oldKey?: string;
  oldStoragePath?: string;
  newKey?: string;
  newStoragePath?: string;
  key?: string;
  base64?: string;
  mimeType?: string;
}

export interface StorageListRequest {
  bucket?: string;
  prefix?: string;
  limit?: number;
  continuationToken?: string;
}

// ==========================================
// Notes API Types
// ==========================================
export type NotesAction =
  | "create"
  | "update"
  | "replace"
  | "delete"
  | "list"
  | "get"
  | "download";

export interface NoteMetadata {
  id: string;
  title: string;
  subject: string;
  classGrade: string;
  chapterNo?: number;
  chapterName?: string;
  topicName?: string;
  storageKey?: string;
  storagePath?: string;
  fileUrl?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  uploadedBy?: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: any;
}

// ==========================================
// Practice Tests API Types
// ==========================================
export type PracticeTestsAction =
  | "upload"
  | "save"
  | "update"
  | "delete"
  | "list"
  | "get"
  | "publish"
  | "archive"
  | "download"
  | "delete-all";

export interface PracticeTestQuestion {
  id: string;
  questionText: string;
  options: string[];
  correctAnswer: number | string;
  explanation?: string;
  imageUrl?: string;
  published?: boolean;
  orderIndex?: number;
  [key: string]: any;
}

export interface PracticeTestRecord {
  id: string;
  classGrade: string;
  subject: string;
  chapterNo: number;
  chapterName: string;
  topicName: string;
  rawText?: string;
  questions: PracticeTestQuestion[];
  createdAt: string;
  updatedAt: string;
  uploadedBy?: string;
}

// ==========================================
// Students API Types
// ==========================================
export type StudentsAction =
  | "profile"
  | "attendance"
  | "fees"
  | "homework"
  | "progress"
  | "dashboard"
  | "service-status";

// ==========================================
// Auth API Types
// ==========================================
export type AuthAction =
  | "session"
  | "verify-admin"
  | "verify-token"
  | "permissions";

export interface AuthSessionUser {
  uid: string;
  email?: string;
  role: "admin" | "teacher" | "student" | "guest";
  permissions: string[];
}

// ==========================================
// AI API Types
// ==========================================
export type AIAction =
  | "chat"
  | "report"
  | "summary"
  | "notes"
  | "analysis"
  | "analytics"
  | "practice-test"
  | "practice_test"
  | "homework"
  | "search"
  | "moderation"
  | "metrics"
  | "limits";

// ==========================================
// Health API Types
// ==========================================
export interface HealthStatusReport {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  environment: {
    nodeEnv: string;
    runtime: string;
    isVercel: boolean;
  };
  services: {
    cloudflareR2: {
      status: "connected" | "fallback_local" | "error";
      configured: boolean;
      bucket: string;
      hasEndpoint: boolean;
      hasCredentials: boolean;
      readWriteVerified?: boolean;
      error?: string;
    };
    firestore: {
      status: "connected" | "unconfigured" | "error";
      configured: boolean;
      projectId?: string;
    };
    geminiAI: {
      status: "configured" | "missing_key";
      hasApiKey: boolean;
    };
  };
}
