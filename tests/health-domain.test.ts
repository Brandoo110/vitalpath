import { describe, expect, it } from "vitest";

import {
  calculateHealthResult,
  type HealthInput,
  type ProjectionStatus,
} from "@/lib/health";

import {
  oracleActivityMultipliers,
  oracleDate,
  oracleHealth,
  oracleWeightAt,
  type OracleActivity,
  type OracleGender,
  type OracleGoal,
  type OraclePace,
} from "./helpers/health-oracle";

const fixedNow = new Date("2024-02-28T23:30:00-05:00");
const genders = ["female", "male"] as const;
const activities = ["sedentary", "light", "moderate", "high"] as const;
const paces = ["gentle", "standard", "aggressive"] as const;
const ageValues = [20, 49, 78];
const heightValues = [130, 175, 220];
const currentBmis = [19, 27, 39];

const categorySpecs = [
  { name: "lose", goal: "lose_weight", targetDelta: -0.4 },
  { name: "gain", goal: "gain_muscle", targetDelta: 0.4 },
  { name: "maintain", goal: "keep_fit", targetDelta: 0 },
  { name: "toned_decline", goal: "get_toned", targetDelta: -0.4 },
  { name: "toned_equal", goal: "get_toned", targetDelta: 0 },
] as const;

describe("wellness-v2 product domain", () => {
  it("checks all 3,240 supported-domain combinations against an independent algebraic oracle", () => {
    const stats = Object.fromEntries(categorySpecs.map(({ name }) => [name, { accepted: 0, rejected: 0 }])) as Record<
      (typeof categorySpecs)[number]["name"],
      { accepted: number; rejected: number }
    >;
    let accepted = 0;
    let rejected = 0;
    let scenarios = 0;

    for (const gender of genders) {
      for (const activityLevel of activities) {
        for (const pacePreference of paces) {
          for (const category of categorySpecs) {
            for (const age of ageValues) {
              for (const heightCm of heightValues) {
                for (const currentBmi of currentBmis) {
                  scenarios += 1;
                  const input = makeDomainInput({
                    gender,
                    activityLevel,
                    pacePreference,
                    age,
                    heightCm,
                    currentBmi,
                    goal: category.goal,
                    targetDelta: category.targetDelta,
                  });
                  const oracle = oracleHealth(input);

                  if (oracle.rejection) {
                    rejected += 1;
                    stats[category.name].rejected += 1;
                    expect(() => calculateHealthResult(toHealthInput(input))).toThrow(
                      oracle.rejection === "tdee_threshold" ? /TDEE.*threshold/i : /recommended calories/i,
                    );
                    continue;
                  }

                  accepted += 1;
                  stats[category.name].accepted += 1;
                  const result = calculateHealthResult(toHealthInput(input));
                  assertFiniteSuccess(result);
                  expect(result.recommendedCalories).toBe(oracle.intake);
                  expect(result.calculationDetails.REE).toBeCloseTo(oracle.ree, 10);
                  expect(result.calculationDetails.TDEE).toBeCloseTo(oracle.tdee, 10);
                  expect(result.calculationDetails.actualEnergyDifference).toBeCloseTo(
                    oracle.intake - oracle.tdee,
                    10,
                  );

                  const expectedStatus: ProjectionStatus = category.targetDelta === 0
                    ? "maintenance"
                    : oracle.projection.day === null
                      ? "not_projected"
                      : "projected";
                  expect(result.calculationDetails.projectionStatus).toBe(expectedStatus);
                  expect(result.targetDate?.getTime() ?? null).toBe(
                    oracleDate(fixedNow, oracle.projection.day)?.getTime() ?? null,
                  );
                }
              }
            }
          }
        }
      }
    }

    expect(scenarios).toBe(3240);
    expect(accepted + rejected).toBe(3240);
    for (const category of categorySpecs) {
      expect(stats[category.name].accepted + stats[category.name].rejected).toBe(648);
      expect(stats[category.name].accepted).toBeGreaterThan(0);
      expect(stats[category.name].rejected).toBeGreaterThan(0);
    }
    console.info("wellness-v2 domain statistics", { scenarios, accepted, rejected, stats });
  });

  it.each([
    ["age", [undefined, null, "32", Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]],
    ["heightCm", [undefined, null, "165", Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]],
    ["weightKg", [undefined, null, "72", Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]],
    ["targetWeightKg", [undefined, null, "62", Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]],
  ])("rejects missing, null, string and non-finite %s values", (field, values) => {
    for (const value of values) {
      expect(() => calculateHealthResult({ ...toHealthInput(baseOracleInput()), [field]: value } as HealthInput)).toThrow(
        new RegExp(String(field)),
      );
    }
  });

  it("enforces numeric boundaries and BMI edges without relying on rounded BMI", () => {
    const validAtAgeEdges = [20, 78].map((age) => ({ ...toHealthInput(baseOracleInput()), age }));
    for (const input of validAtAgeEdges) expect(() => calculateHealthResult(input)).not.toThrow();
    expect(() => calculateHealthResult({ ...toHealthInput(baseOracleInput()), age: 19 })).toThrow(/age/);
    expect(() => calculateHealthResult({ ...toHealthInput(baseOracleInput()), age: 79 })).toThrow(/age/);
    expect(() => calculateHealthResult({ ...toHealthInput(baseOracleInput()), age: 32.5 })).toThrow(/age/);
    expect(() => calculateHealthResult({ ...toHealthInput(baseOracleInput()), heightCm: 129.99 })).toThrow(/heightCm/);
    expect(() => calculateHealthResult({ ...toHealthInput(baseOracleInput()), heightCm: 220.01 })).toThrow(/heightCm/);

    const equalAtLowerBmi = inputForBmis(18.5, 18.5);
    expect(() => calculateHealthResult(equalAtLowerBmi)).not.toThrow();
    expect(() => calculateHealthResult(inputForBmis(18.499, 18.6))).toThrow(/current BMI/);
    expect(() => calculateHealthResult(inputForBmis(39.999, 39.5))).not.toThrow();
    expect(() => calculateHealthResult(inputForBmis(40, 39.5))).toThrow(/current BMI/);
    expect(() => calculateHealthResult(inputForBmis(19, 40))).toThrow(/target BMI/);
  });

  it("rejects invalid enums, missing or false eligibility, and every invalid goal direction", () => {
    const input = toHealthInput(baseOracleInput());
    for (const [field, value] of [
      ["gender", "other"],
      ["goal", "other"],
      ["activityLevel", "other"],
      ["pacePreference", "other"],
    ] as const) {
      expect(() => calculateHealthResult({ ...input, [field]: value } as HealthInput)).toThrow(new RegExp(String(field)));
    }
    expect(() => calculateHealthResult({ ...input, wellnessEligible: undefined })).toThrow(/eligib/i);
    expect(() => calculateHealthResult({ ...input, wellnessEligible: false })).toThrow(/eligib/i);

    expect(() => calculateHealthResult({ ...input, goal: "lose_weight", targetWeightKg: input.weightKg })).toThrow(/direction/);
    expect(() => calculateHealthResult({ ...input, goal: "gain_muscle", targetWeightKg: input.weightKg })).toThrow(/direction/);
    expect(() => calculateHealthResult({ ...input, goal: "gain_muscle", targetWeightKg: input.weightKg - 1 })).toThrow(/direction/);
    expect(() => calculateHealthResult({ ...input, goal: "keep_fit", targetWeightKg: input.weightKg - 1 })).toThrow(/direction/);
    expect(() => calculateHealthResult({ ...input, goal: "get_toned", targetWeightKg: input.weightKg + 1 })).toThrow(/direction/);
  });

  it("matches analytical projection boundaries at days 364, 365 and 366", () => {
    const base = baseOracleInput();
    const intake = oracleHealth(base).intake;
    for (const day of [364, 365, 366]) {
      const previousWeight = oracleWeightAt(base, intake, day - 1);
      const dayWeight = oracleWeightAt(base, intake, day);
      const targetWeightKg = (previousWeight + dayWeight) / 2;
      expect(previousWeight).toBeGreaterThan(targetWeightKg);
      expect(dayWeight).toBeLessThan(targetWeightKg);
      const input = { ...base, targetWeightKg };
      const oracle = oracleHealth(input);
      const result = calculateHealthResult(toHealthInput(input));
      expect(oracle.projection.day).toBe(day <= 365 ? day : null);
      expect(result.calculationDetails.projectionStatus).toBe(day <= 365 ? "projected" : "not_projected");
      expect(result.targetDate?.getTime() ?? null).toBe(oracleDate(fixedNow, oracle.projection.day)?.getTime() ?? null);
    }
  });

  it("keeps policy directions, monotonic targets, and deterministic non-mutating inputs", () => {
    const base = baseOracleInput();
    const gentleLoss = calculateHealthResult(toHealthInput({ ...base, pacePreference: "gentle" }));
    const standardLoss = calculateHealthResult(toHealthInput({ ...base, pacePreference: "standard" }));
    const aggressiveLoss = calculateHealthResult(toHealthInput({ ...base, pacePreference: "aggressive" }));
    expect(gentleLoss.recommendedCalories).toBeGreaterThan(standardLoss.recommendedCalories);
    expect(aggressiveLoss.recommendedCalories).toBe(standardLoss.recommendedCalories);

    const gentleGain = calculateHealthResult(toHealthInput({ ...base, goal: "gain_muscle", weightKg: 72, targetWeightKg: 75, pacePreference: "gentle" }));
    const standardGain = calculateHealthResult(toHealthInput({ ...base, goal: "gain_muscle", weightKg: 72, targetWeightKg: 75, pacePreference: "standard" }));
    const aggressiveGain = calculateHealthResult(toHealthInput({ ...base, goal: "gain_muscle", weightKg: 72, targetWeightKg: 75, pacePreference: "aggressive" }));
    expect(gentleGain.recommendedCalories).toBeLessThan(standardGain.recommendedCalories);
    expect(aggressiveGain.recommendedCalories).toBe(standardGain.recommendedCalories);

    for (const pacePreference of paces) {
      const maintenance = calculateHealthResult(toHealthInput({ ...base, goal: "keep_fit", targetWeightKg: base.weightKg, pacePreference }));
      const tonedEqual = calculateHealthResult(toHealthInput({ ...base, goal: "get_toned", targetWeightKg: base.weightKg, pacePreference }));
      expect(maintenance.recommendedCalories).toBe(tonedEqual.recommendedCalories);
      expect(maintenance.targetDate).toBeNull();
      expect(tonedEqual.targetDate).toBeNull();
    }

    const nearTarget = calculateHealthResult(toHealthInput({ ...base, targetWeightKg: 65 }));
    const fartherTarget = calculateHealthResult(toHealthInput({ ...base, targetWeightKg: 60 }));
    expect(nearTarget.targetDate).not.toBeNull();
    expect(fartherTarget.targetDate).not.toBeNull();
    expect(fartherTarget.targetDate!.getTime()).toBeGreaterThan(nearTarget.targetDate!.getTime());

    const input = toHealthInput({ ...base, now: new Date(fixedNow) });
    const before = { ...input, now: input.now?.getTime() };
    const first = calculateHealthResult(input);
    const second = calculateHealthResult(input);
    expect(second).toEqual(first);
    expect({ ...input, now: input.now?.getTime() }).toEqual(before);
  });

  it("uses threshold and upper-calorie examples constructed away from rounding edges", () => {
    const femaleBelow = inputForTdee(1100, "female", "sedentary", "standard");
    expect(() => calculateHealthResult(femaleBelow)).toThrow(/1200.*threshold/);

    const femaleAboveBase = inputForTdee(1500, "female", "high", "standard");
    const femaleAbove = {
      ...femaleAboveBase,
      goal: "lose_weight" as const,
      targetWeightKg: femaleAboveBase.weightKg - 1,
    };
    expect(calculateHealthResult(femaleAbove).recommendedCalories).toBe(1200);

    const maleBelow = inputForTdee(1300, "male", "sedentary", "standard");
    expect(() => calculateHealthResult(maleBelow)).toThrow(/1500.*threshold/);

    const maleAbove = inputForTdee(1800, "male", "high", "standard");
    expect(calculateHealthResult(maleAbove).recommendedCalories).toBe(1800);

    const upperAccepted = inputForTdee(4900, "male", "high", "standard");
    expect(calculateHealthResult(upperAccepted).recommendedCalories).toBe(4900);
    const upperRejected = { ...inputForTdee(5100, "male", "high", "standard"), goal: "gain_muscle" as const, targetWeightKg: 180 };
    expect(() => calculateHealthResult(upperRejected)).toThrow(/recommended calories/i);
  });
});

function baseOracleInput() {
  return {
    gender: "female" as const,
    goal: "lose_weight" as const,
    age: 32,
    heightCm: 165,
    weightKg: 72,
    targetWeightKg: 62,
    activityLevel: "light" as const,
    pacePreference: "standard" as const,
  };
}

function makeDomainInput(input: {
  gender: OracleGender;
  activityLevel: OracleActivity;
  pacePreference: OraclePace;
  age: number;
  heightCm: number;
  currentBmi: number;
  goal: OracleGoal;
  targetDelta: number;
}) {
  const weightKg = input.currentBmi * (input.heightCm / 100) ** 2;
  const targetBmi = input.currentBmi + input.targetDelta;
  return {
    gender: input.gender,
    goal: input.goal,
    age: input.age,
    heightCm: input.heightCm,
    weightKg,
    targetWeightKg: targetBmi * (input.heightCm / 100) ** 2,
    activityLevel: input.activityLevel,
    pacePreference: input.pacePreference,
  };
}

function toHealthInput(input: ReturnType<typeof baseOracleInput> | Record<string, unknown>) {
  return { ...input, wellnessEligible: true, now: new Date(fixedNow) } as HealthInput;
}

function inputForBmis(currentBmi: number, targetBmi: number): HealthInput {
  const heightCm = 175;
  const weightKg = currentBmi * (heightCm / 100) ** 2;
  return toHealthInput({
    gender: "female",
    goal: targetBmi === currentBmi ? "keep_fit" : "lose_weight",
    age: 32,
    heightCm,
    weightKg,
    targetWeightKg: targetBmi * (heightCm / 100) ** 2,
    activityLevel: "light",
    pacePreference: "standard",
  });
}

function inputForTdee(targetTdee: number, gender: OracleGender, activityLevel: OracleActivity, pacePreference: OraclePace): HealthInput {
  const useTallYoungGeometry = targetTdee >= 4900;
  const age = useTallYoungGeometry ? 20 : 78;
  const heightCm = useTallYoungGeometry ? 220 : 130;
  const constant = 6.25 * heightCm - 5 * age + (gender === "male" ? 5 : -161);
  const ree = targetTdee / oracleActivityMultipliers[activityLevel];
  const weightKg = (ree - constant) / 10;
  return toHealthInput({
    gender,
    goal: "keep_fit",
    age,
    heightCm,
    weightKg,
    targetWeightKg: weightKg,
    activityLevel,
    pacePreference,
  });
}

function assertFiniteSuccess(result: ReturnType<typeof calculateHealthResult>) {
  expect(Number.isFinite(result.bmi)).toBe(true);
  expect(Number.isFinite(result.calculationDetails.REE)).toBe(true);
  expect(Number.isFinite(result.calculationDetails.TDEE)).toBe(true);
  expect(Number.isFinite(result.calculationDetails.actualEnergyDifference)).toBe(true);
  expect(Number.isInteger(result.recommendedCalories)).toBe(true);
  expect(result.recommendedCalories).toBeGreaterThan(0);
  expect(result.recommendedCalories).toBeLessThan(5000);
  expect(["projected", "not_projected", "maintenance"]).toContain(result.calculationDetails.projectionStatus);
  if (result.targetDate) expect(Number.isFinite(result.targetDate.getTime())).toBe(true);
}
