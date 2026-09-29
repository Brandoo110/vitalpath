import { handleRouteError, jsonResponse, readJson } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { payRequestSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const { sessionId, plan = "monthly" } = payRequestSchema.parse(await readJson(request));

    const user = await prisma.user.findUnique({
      where: { id: sessionId },
      include: { subscription: true },
    });

    if (!user) {
      throw notFound("Session not found");
    }

    const paidAt =
      user.subscription?.status === "active" && user.subscription.paidAt
        ? user.subscription.paidAt
        : new Date();

    const subscription = await prisma.$transaction(async (tx) => {
      // 模拟支付回调要同时更新用户快照和订阅快照，避免结果接口读到不一致状态。
      await tx.user.update({
        where: { id: sessionId },
        data: { subscriptionStatus: "active" },
      });

      return tx.subscription.upsert({
        where: { userId: sessionId },
        create: {
          userId: sessionId,
          status: "active",
          plan,
          paidAt,
        },
        update: {
          status: "active",
          plan,
          paidAt,
        },
      });
    });

    return jsonResponse({
      ok: true,
      subscriptionStatus: subscription.status,
      paidAt: subscription.paidAt?.toISOString(),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
