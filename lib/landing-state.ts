export type FunnelView = "bootstrapping" | "landing" | "funnel" | "lead" | "results";

type FreshStartActionInput = {
  sessionWasRestored: boolean;
};

type RetentionOfferInput = {
  sessionId: string | null;
  claimedSessionId: string | null;
};

export function getInitialFunnelView(): FunnelView {
  return "landing";
}

export function shouldShowFreshStartAction({ sessionWasRestored }: FreshStartActionInput) {
  return sessionWasRestored;
}

export function isRetentionOfferApplied({ sessionId, claimedSessionId }: RetentionOfferInput) {
  return Boolean(sessionId && claimedSessionId === sessionId);
}
