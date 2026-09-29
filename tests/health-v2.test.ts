import { describe, expect, it } from "vitest";

import { calculateHealthResult, healthAlgorithmVersion, validateHealthInput } from "@/lib/health";

const supported = {
  gender: "female" as const,
  goal: "lose_weight" as const,
  age: 32,
  heightCm: 165,
  weightKg: 72,
  targetWeightKg: 62,
  activityLevel: "light" as const,
  pacePreference: "standard" as const,
  wellnessEligible: true,
  now: new Date("2026-09-30T00:00:00.000Z"),
};

describe("wellness-v2 algorithm contract", () => {
  it("uses the frozen version and stores auditable calculation details", () => {
    const result = calculateHealthResult(supported);

    expect(healthAlgorithmVersion).toBe("wellness-v2");
    expect(result.targetDate).toBeInstanceOf(Date);
    expect(result.recommendedCalories).toBe(1573);
    expect(result.targetDate?.toISOString()).toBe("2027-05-29T00:00:00.000Z");
    expect(result.calculationDetails).toMatchObject({
      method: "mifflin_st_jeor",
      policyVersion: "wellness-v2",
      projectionStatus: "projected",
    });
    expect(result.calculationDetails.REE).toBeCloseTo(1430.25, 5);
    expect(result.calculationDetails.TDEE).toBeCloseTo(1966.59375, 5);
  });

  it("enforces the supported adult and BMI domain", () => {
    for (const invalid of [
      { age: 19 },
      { age: 79 },
      { heightCm: 129 },
      { heightCm: 221 },
      { weightKg: 49, heightCm: 165 },
      { targetWeightKg: 49, heightCm: 165 },
    ]) {
      expect(() => validateHealthInput({ ...supported, ...invalid })).toThrow();
    }
  });

  it("requires explicit wellness eligibility and goal direction", () => {
    expect(() => calculateHealthResult({ ...supported, wellnessEligible: false })).toThrow(
      /eligib/i,
    );
    expect(() => calculateHealthResult({ ...supported, goal: "lose_weight", targetWeightKg: 75 })).toThrow(
      /direction/i,
    );
    expect(() => calculateHealthResult({ ...supported, goal: "gain_muscle", targetWeightKg: 70 })).toThrow(
      /direction/i,
    );
    expect(() => calculateHealthResult({ ...supported, goal: "keep_fit", targetWeightKg: 70 })).toThrow(
      /direction/i,
    );
  });

  it("returns an explicit maintenance projection for equal weight", () => {
    const result = calculateHealthResult({ ...supported, goal: "keep_fit", targetWeightKg: 72 });

    expect(result.targetDate).toBeNull();
    expect(result.calculationDetails.projectionStatus).toBe("maintenance");
    expect(result.recommendedCalories).toBe(1967);
  });

  it("does not fake a date after the one year simulation window", () => {
    const result = calculateHealthResult({
      ...supported,
      weightKg: 100,
      targetWeightKg: 51,
      heightCm: 165,
      goal: "lose_weight",
    });

    expect(result.targetDate).toBeNull();
    expect(result.calculationDetails.projectionStatus).toBe("not_projected");
  });
});
