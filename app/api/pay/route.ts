import { handleRouteError, jsonResponse, readJson } from "@/lib/api";
import { lockUser } from "@/lib/assessment-service";
import { conflict } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { payRequestSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const input = payRequestSchema.parse(await readJson(request));

    const subscription = await prisma.$transaction(async (tx) => {
      await lockUser(tx, input.sessionId);
      const current = await tx.subscription.findUnique({ where: { userId: input.sessionId } });

      if (current?.status === "active") {
        if (input.plan && input.plan !== current.plan) {
          throw conflict("plan_conflict", "Subscription is already active on another plan", {
            currentPlan: current.plan,
            requestedPlan: input.plan,
          });
        }
        // Replays, including a request that omits plan, return the original
        // paidAt and plan instead of generating a new payment timestamp.
        return current;
      }

      const plan = input.plan ?? "monthly";
      const paidAt = new Date();
      if (!current) {
        return tx.subscription.create({
          data: {
            userId: input.sessionId,
            status: "active",
            plan,
            paidAt,
          },
        });
      }

      return tx.subscription.update({
        where: { userId: input.sessionId },
        data: { status: "active", plan, paidAt },
      });
    });

    return jsonResponse({
      ok: true,
      subscriptionStatus: subscription.status,
      plan: subscription.plan,
      paidAt: subscription.paidAt?.toISOString(),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
