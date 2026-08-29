export class HttpError extends Error {
  public statusCode: number;
  public code?: string;
  public details?: any;

  constructor(statusCode: number, message: string, code?: string, details?: any) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends HttpError {
  constructor(message: string, details?: any) {
    super(400, message, "VALIDATION_ERROR", details);
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message: string = "Unauthorized access.", details?: any) {
    super(401, message, "UNAUTHORIZED", details);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends HttpError {
  constructor(message: string = "Forbidden action.", details?: any) {
    super(403, message, "FORBIDDEN", details);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string = "Object not found", details?: any) {
    super(404, message, "OBJECT_NOT_FOUND", details);
    this.name = "NotFoundError";
  }
}

export class StorageError extends HttpError {
  constructor(message: string, code: string = "STORAGE_ERROR", details?: any) {
    super(500, message, code, details);
    this.name = "StorageError";
  }
}

