export type ErrorDetails = Record<string, unknown> | string[] | undefined;

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorDetails;

  constructor(status: number, code: string, message: string, details?: ErrorDetails) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message: string, details?: ErrorDetails) {
  return new AppError(400, "bad_request", message, details);
}

export function notFound(message = "Resource not found") {
  return new AppError(404, "not_found", message);
}

export function conflict(code: string, message: string, details?: ErrorDetails) {
  return new AppError(409, code, message, details);
}

export function unprocessable(code: string, message: string, details?: ErrorDetails) {
  return new AppError(422, code, message, details);
}

export function toErrorBody(error: unknown) {
  if (error instanceof AppError) {
    const body = {
      error: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };
    if (error.details && !Array.isArray(error.details) && typeof error.details === "object") {
      const details = error.details as Record<string, unknown>;
      return {
        ...body,
        ...(details.issues ? { issues: details.issues } : {}),
        ...(details.missingFields ? { missingFields: details.missingFields } : {}),
        ...(details.nextStep !== undefined ? { nextStep: details.nextStep } : {}),
        ...(details.nextAction ? { nextAction: details.nextAction } : {}),
      };
    }
    return body;
  }

  return {
    error: "internal_server_error",
    message: "Unexpected server error",
  };
}
