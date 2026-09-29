export type OfferKind = "initial" | "retention";

export type PriceTier = {
  id: "1week" | "4weeks" | "12weeks";
  label: string;
  old: string;
  now: string;
  per: string;
  discountLabel: string;
  popular?: boolean;
};

type BasePriceTier = Omit<PriceTier, "old" | "now" | "per" | "discountLabel"> & {
  oldCents: number;
  days: number;
};

const basePriceTiers: BasePriceTier[] = [
  { id: "1week", label: "1-week trial", oldCents: 1499, days: 7 },
  { id: "4weeks", label: "4-week plan", oldCents: 3999, days: 28, popular: true },
  { id: "12weeks", label: "12-week plan", oldCents: 8999, days: 84 },
];

const offerConfigs = {
  initial: {
    discountPercent: 30,
    multiplier: 0.7,
    headline: "Your 30% discount is reserved while the timer runs.",
    cta: "Get my 30% off plan now",
  },
  retention: {
    discountPercent: 50,
    multiplier: 0.5,
    headline: "Your 50% discount has been applied for this session.",
    cta: "Get my 50% off plan now",
  },
} satisfies Record<
  OfferKind,
  {
    discountPercent: number;
    multiplier: number;
    headline: string;
    cta: string;
  }
>;

export function getOfferConfig(kind: OfferKind) {
  return offerConfigs[kind];
}

export function buildPriceTiers(kind: OfferKind): PriceTier[] {
  const offer = getOfferConfig(kind);
  const discountLabel = `${offer.discountPercent}% off`;

  return basePriceTiers.map((tier) => {
    // 原价只维护一份；初始 offer 为 7 折，挽留 offer 为 5 折，避免各套餐折扣口径不一致。
    const discountedCents = Math.round(tier.oldCents * offer.multiplier);

    return {
      id: tier.id,
      label: tier.label,
      old: formatUsd(tier.oldCents),
      now: formatUsd(discountedCents),
      per: `${formatUsd(Math.round(discountedCents / tier.days))} / day`,
      discountLabel,
      popular: tier.popular,
    };
  });
}

function formatUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
