import { describe, expect, it } from "vitest";

import {
  calculateHealthResult,
  classifyBmi,
  validateHealthInput,
  type HealthInput,
} from "./health";

const baseInput: HealthInput = {
  gender: "female",
  goal: "lose_weight",
  age: 32,
  heightCm: 165,
  weightKg: 72,
  targetWeightKg: 62,
  activityLevel: "light",
  now: new Date("2026-06-20T00:00:00.000Z"),
};

describe("calculateHealthResult", () => {
  it("calculates_result_for_valid_female_weight_loss", () => {
    const result = calculateHealthResult(baseInput);

    expect(result.bmi).toBe(26.4);
    expect(result.bmiCategory).toBe("overweight");
    expect(result.recommendedCalories).toBe(1467);
    expect(result.targetDate.toISOString()).toBe("2026-09-22T00:00:00.000Z");
  });

  it("calculates_result_for_valid_male_muscle_gain", () => {
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
    expect(result.targetDate.toISOString()).toBe("2026-08-06T00:00:00.000Z");
  });

  it("classifies_bmi_boundaries", () => {
    expect(classifyBmi(18.4)).toBe("underweight");
    expect(classifyBmi(18.5)).toBe("normal");
    expect(classifyBmi(24.9)).toBe("normal");
    expect(classifyBmi(25)).toBe("overweight");
    expect(classifyBmi(29.9)).toBe("overweight");
    expect(classifyBmi(30)).toBe("obese");
  });

  it("applies_activity_level_multipliers", () => {
    const sedentary = calculateHealthResult({ ...baseInput, activityLevel: "sedentary" });
    const high = calculateHealthResult({ ...baseInput, activityLevel: "high" });

    expect(high.recommendedCalories).toBeGreaterThan(sedentary.recommendedCalories);
  });

  it("enforces_minimum_calories_for_weight_loss", () => {
    const result = calculateHealthResult({
      ...baseInput,
      age: 70,
      heightCm: 150,
      weightKg: 45,
      targetWeightKg: 40,
      activityLevel: "sedentary",
    });

    expect(result.recommendedCalories).toBe(1200);
  });

  it("uses_pace_preference_for_weight_loss_deficit", () => {
    const gentle = calculateHealthResult({ ...baseInput, pacePreference: "gentle" });
    const standard = calculateHealthResult({ ...baseInput, pacePreference: "standard" });

    expect(gentle.recommendedCalories).toBe(1717);
    expect(standard.recommendedCalories).toBe(1467);
  });

  it("returns_today_when_target_weight_equals_current_weight", () => {
    const result = calculateHealthResult({
      ...baseInput,
      targetWeightKg: baseInput.weightKg,
    });

    expect(result.targetDate.toISOString()).toBe("2026-06-20T00:00:00.000Z");
  });

  it("accepts_min_max_valid_health_inputs", () => {
    expect(() =>
      validateHealthInput({
        ...baseInput,
        age: 13,
      }),
    ).not.toThrow();

    expect(() =>
      validateHealthInput({
        ...baseInput,
        age: 120,
        heightCm: 300,
        weightKg: 500,
        targetWeightKg: 500,
      }),
    ).not.toThrow();

    expect(() =>
      validateHealthInput({
        ...baseInput,
        heightCm: 140,
        weightKg: 20,
        targetWeightKg: 20,
      }),
    ).not.toThrow();
  });

  it("rejects_invalid_health_inputs", () => {
    expect(() => validateHealthInput({ ...baseInput, age: 12 })).toThrow("age");
    expect(() => validateHealthInput({ ...baseInput, heightCm: 49 })).toThrow("heightCm");
    expect(() => validateHealthInput({ ...baseInput, weightKg: 19 })).toThrow("weightKg");
    expect(() => validateHealthInput({ ...baseInput, targetWeightKg: 501 })).toThrow(
      "targetWeightKg",
    );
  });

  it("rejects_missing_runtime_health_fields", () => {
    const withoutAge = { ...baseInput };
    delete (withoutAge as Partial<HealthInput>).age;

    const withoutHeight = { ...baseInput };
    delete (withoutHeight as Partial<HealthInput>).heightCm;

    expect(() => validateHealthInput(withoutAge as HealthInput)).toThrow("age");
    expect(() => validateHealthInput(withoutHeight as HealthInput)).toThrow("heightCm");
  });

  it("rejects_unreasonable_target_bmi", () => {
    expect(() =>
      validateHealthInput({
        ...baseInput,
        heightCm: 200,
        targetWeightKg: 35,
      }),
    ).toThrow("target BMI");

    expect(() =>
      validateHealthInput({
        ...baseInput,
        heightCm: 100,
        targetWeightKg: 80,
      }),
    ).toThrow("target BMI");
  });

  it("does_not_reject_goal_direction_mismatch", () => {
    expect(() =>
      validateHealthInput({
        ...baseInput,
        goal: "lose_weight",
        weightKg: 70,
        targetWeightKg: 75,
      }),
    ).not.toThrow();
  });
});
