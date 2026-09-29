import { ZodError } from "zod";

import { AppError, badRequest, toErrorBody } from "./errors";

// Route handlers 统一走这里返回 JSON，避免各接口各写一套响应格式。
export function jsonResponse(body: unknown, init?: ResponseInit) {
  return Response.json(body, init);
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
}

export function handleRouteError(error: unknown) {
  if (error instanceof ZodError) {
    // Zod 错误统一转成 400，前端可以根据 details 高亮具体字段。
    return jsonResponse(
      {
        error: "bad_request",
        message: "Request validation failed",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  if (error instanceof AppError) {
    return jsonResponse(toErrorBody(error), { status: error.status });
  }

  // 未预期错误只返回通用信息，具体堆栈留在服务端日志里。
  console.error(error);
  return jsonResponse(toErrorBody(error), { status: 500 });
}
