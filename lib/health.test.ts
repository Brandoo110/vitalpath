import { describe, expect, it } from "vitest";

import { calculateHealthResult, classifyBmi, validateHealthInput, type HealthInput } from "./health";

const baseInput: HealthInput = {
  gender: "female",
  goal: "lose_weight",
  age: 32,
  heightCm: 165,
  weightKg: 72,
  targetWeightKg: 62,
  activityLevel: "light",
  pacePreference: "standard",
  wellnessEligible: true,
  now: new Date("2026-09-30T00:00:00.000Z"),
};

describe("wellness-v2 health algorithm", () => {
  it("calculates the golden female weight-loss scenario", () => {
    const result = calculateHealthResult(baseInput);

    expect(result.bmi).toBe(26.4);
    expect(result.bmiCategory).toBe("overweight");
    expect(result.recommendedCalories).toBe(1573);
    expect(result.targetDate?.toISOString()).toBe("2027-05-29T00:00:00.000Z");
    expect(result.calculationDetails).toMatchObject({
      method: "mifflin_st_jeor",
      policyVersion: "wellness-v2",
      REE: 1430.25,
      TDEE: 1966.59375,
      projectionStatus: "projected",
    });
  });

  it("supports male gain-muscle with the capped surplus", () => {
    const result = calculateHealthResult({
      ...baseInput,
      gender: "male",
      goal: "gain_muscle",
      age: 28,
      heightCm: 180,
      weightKg: 75,
      targetWeightKg: 80,
      activityLevel: "moderate",
    });

    expect(result.bmi).toBe(23.1);
    expect(result.bmiCategory).toBe("normal");
    expect(result.recommendedCalories).toBe(2997);
    expect(result.targetDate).toBeInstanceOf(Date);
  });

  it("classifies BMI boundaries using the unrounded value", () => {
    expect(classifyBmi(18.499)).toBe("underweight");
    expect(classifyBmi(18.5)).toBe("normal");
    expect(classifyBmi(24.999)).toBe("normal");
    expect(classifyBmi(25)).toBe("overweight");
    expect(classifyBmi(29.999)).toBe("overweight");
    expect(classifyBmi(30)).toBe("obese");
  });

  it("uses the activity multiplier and pace caps", () => {
    const sedentary = calculateHealthResult({ ...baseInput, activityLevel: "sedentary" });
    const high = calculateHealthResult({ ...baseInput, activityLevel: "high" });
    const gentle = calculateHealthResult({ ...baseInput, pacePreference: "gentle" });

    expect(high.recommendedCalories).toBeGreaterThan(sedentary.recommendedCalories);
    expect(gentle.recommendedCalories).toBe(1717);
  });

  it("returns maintenance without a fabricated date", () => {
    const result = calculateHealthResult({ ...baseInput, goal: "keep_fit", targetWeightKg: 72 });

    expect(result.targetDate).toBeNull();
    expect(result.calculationDetails.projectionStatus).toBe("maintenance");
    expect(result.recommendedCalories).toBe(1967);
  });

  it("returns not_projected when the one-year scenario cannot reach target", () => {
    const result = calculateHealthResult({
      ...baseInput,
      weightKg: 100,
      targetWeightKg: 51,
      heightCm: 165,
    });

    expect(result.targetDate).toBeNull();
    expect(result.calculationDetails.projectionStatus).toBe("not_projected");
  });

  it("rejects unsupported range, non-finite values and mismatched goals", () => {
    expect(() => validateHealthInput({ ...baseInput, age: 19 })).toThrow("age");
    expect(() => validateHealthInput({ ...baseInput, age: 79 })).toThrow("age");
    expect(() => validateHealthInput({ ...baseInput, heightCm: 129 })).toThrow("heightCm");
    expect(() => validateHealthInput({ ...baseInput, heightCm: 221 })).toThrow("heightCm");
    expect(() => validateHealthInput({ ...baseInput, heightCm: 165, weightKg: 49 })).toThrow("current BMI");
    expect(() => validateHealthInput({ ...baseInput, heightCm: 165, targetWeightKg: 49 })).toThrow("target BMI");
    expect(() => validateHealthInput({ ...baseInput, age: Number.NaN })).toThrow("finite");
    expect(() => calculateHealthResult({ ...baseInput, goal: "lose_weight", targetWeightKg: 75 })).toThrow("direction");
    expect(() => calculateHealthResult({ ...baseInput, goal: "gain_muscle", targetWeightKg: 70 })).toThrow("direction");
    expect(() => calculateHealthResult({ ...baseInput, goal: "keep_fit", targetWeightKg: 70 })).toThrow("direction");
    expect(() => calculateHealthResult({ ...baseInput, wellnessEligible: false })).toThrow("eligib");
  });
});
