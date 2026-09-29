import { describe, expect, test } from "vitest";

import { buildPriceTiers, getOfferConfig } from "@/lib/pricing";

describe("pricing offers", () => {
  test("uses a 30 percent discount for the initial paywall offer", () => {
    const offer = getOfferConfig("initial");
    const tiers = buildPriceTiers("initial");

    expect(offer.discountPercent).toBe(30);
    expect(tiers).toMatchObject([
      { id: "1week", old: "$14.99", now: "$10.49", per: "$1.50 / day", discountLabel: "30% off" },
      { id: "4weeks", old: "$39.99", now: "$27.99", per: "$1.00 / day", discountLabel: "30% off" },
      { id: "12weeks", old: "$89.99", now: "$62.99", per: "$0.75 / day", discountLabel: "30% off" },
    ]);
  });

  test("uses a 50 percent discount after the exit offer is claimed", () => {
    const offer = getOfferConfig("retention");
    const tiers = buildPriceTiers("retention");

    expect(offer.discountPercent).toBe(50);
    expect(tiers).toMatchObject([
      { id: "1week", old: "$14.99", now: "$7.50", per: "$1.07 / day", discountLabel: "50% off" },
      { id: "4weeks", old: "$39.99", now: "$20.00", per: "$0.71 / day", discountLabel: "50% off" },
      { id: "12weeks", old: "$89.99", now: "$45.00", per: "$0.54 / day", discountLabel: "50% off" },
    ]);
  });
});
