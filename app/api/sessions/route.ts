import { jsonResponse, handleRouteError, readJson } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { createSessionSchema, updateSessionLeadSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const body = createSessionSchema.parse(await readJson(request));
    const healthDataConsent = body?.healthDataConsent ?? false;

    // session 是后端生成的匿名身份，同时初始化免费订阅状态。
    const user = await prisma.user.create({
      data: {
        healthDataConsent,
        subscription: {
          create: {
            status: "free",
          },
        },
      },
      select: {
        id: true,
        subscriptionStatus: true,
      },
    });

    return jsonResponse(
      {
        sessionId: user.id,
        subscriptionStatus: user.subscriptionStatus,
      },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const input = updateSessionLeadSchema.parse(await readJson(request));

    const existingUser = await prisma.user.findUnique({
      where: { id: input.sessionId },
      select: { id: true },
    });

    if (!existingUser) {
      throw notFound("Session not found");
    }

    // 报告生成后再收集 lead 信息，既降低前置问卷阻力，也让恢复/发送计划有真实联系人。
    const user = await prisma.user.update({
      where: { id: input.sessionId },
      data: {
        name: input.name,
        email: input.email,
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    return jsonResponse({
      ok: true,
      sessionId: user.id,
      name: user.name,
      email: user.email,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
