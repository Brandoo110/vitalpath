export const genders = ["male", "female"] as const;
export const goals = ["lose_weight", "gain_muscle", "keep_fit", "get_toned"] as const;
export const activityLevels = ["sedentary", "light", "moderate", "high"] as const;
export const bmiCategories = ["underweight", "normal", "overweight", "obese"] as const;
export const pacePreferences = ["gentle", "standard", "aggressive"] as const;
export const workoutLocations = ["home", "gym", "mixed"] as const;
export const dietPreferences = ["balanced", "high_protein", "vegetarian", "low_carb"] as const;
export const stressLevels = ["low", "medium", "high"] as const;
export const mainBarriers = ["no_time", "cravings", "motivation", "knowledge", "injury"] as const;

export type Gender = (typeof genders)[number];
export type Goal = (typeof goals)[number];
export type ActivityLevel = (typeof activityLevels)[number];
export type BmiCategory = (typeof bmiCategories)[number];
export type PacePreference = (typeof pacePreferences)[number];
export type WorkoutLocation = (typeof workoutLocations)[number];
export type DietPreference = (typeof dietPreferences)[number];
export type StressLevel = (typeof stressLevels)[number];
export type MainBarrier = (typeof mainBarriers)[number];
export type ProjectionStatus = "projected" | "not_projected" | "maintenance";

export type CalculationDetails = {
  method: "mifflin_st_jeor";
  policyVersion: "wellness-v2";
  REE: number;
  TDEE: number;
  actualEnergyDifference: number;
  projectionStatus: ProjectionStatus;
  assumptions: {
    activityMultiplier: number;
    energyPerKg: 7700;
    projectionDays: 365;
    fixedIntake: number;
    fixedActivityLevel: ActivityLevel;
    scenario: "simplified_energy_balance_v1";
  };
};

export type HealthInput = {
  gender: Gender;
  goal: Goal;
  age: number;
  heightCm: number;
  weightKg: number;
  targetWeightKg: number;
  activityLevel: ActivityLevel;
  pacePreference?: PacePreference;
  wellnessEligible?: boolean;
  now?: Date;
};

export type HealthResult = {
  bmi: number;
  bmiCategory: BmiCategory;
  recommendedCalories: number;
  targetDate: Date | null;
  calculationDetails: CalculationDetails;
};

export const healthAlgorithmVersion = "wellness-v2" as const;

const activityMultipliers: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
};

const maximumCalories = 5000;
const projectionDays = 365;
const energyPerKg = 7700;
const supportedAge = { min: 20, max: 78 };
const supportedHeight = { min: 130, max: 220 };
const supportedBmi = { min: 18.5, maxExclusive: 40 };

export function calculateHealthResult(input: HealthInput): HealthResult {
  const validInput = validateHealthInput(input);
  if (validInput.wellnessEligible !== true) {
    throw new Error("wellness eligibility must be explicitly confirmed");
  }

  const currentBmiRaw = bmiFor(validInput.weightKg, validInput.heightCm);
  const bmi = roundToOne(currentBmiRaw);
  const ree = calculateRee(validInput);
  const tdee = ree * activityMultipliers[validInput.activityLevel];
  assertPositiveFinite("REE", ree);
  assertPositiveFinite("TDEE", tdee);

  const recommendedCalories = calculateRecommendedCalories(tdee, validInput);
  const projection = calculateProjection(validInput, recommendedCalories);

  return {
    bmi,
    bmiCategory: classifyBmi(currentBmiRaw),
    recommendedCalories,
    targetDate: projection.targetDate,
    calculationDetails: {
      method: "mifflin_st_jeor",
      policyVersion: healthAlgorithmVersion,
      REE: ree,
      TDEE: tdee,
      actualEnergyDifference: recommendedCalories - tdee,
      projectionStatus: projection.projectionStatus,
      assumptions: {
        activityMultiplier: activityMultipliers[validInput.activityLevel],
        energyPerKg,
        projectionDays,
        fixedIntake: recommendedCalories,
        fixedActivityLevel: validInput.activityLevel,
        scenario: "simplified_energy_balance_v1",
      },
    },
  };
}

export function validateHealthInput(input: HealthInput): HealthInput {
  if (!genders.includes(input.gender)) throw new Error("gender must be male or female");
  if (!goals.includes(input.goal)) throw new Error("goal is invalid");
  if (!activityLevels.includes(input.activityLevel)) throw new Error("activityLevel is invalid");
  if (input.pacePreference !== undefined && !pacePreferences.includes(input.pacePreference)) {
    throw new Error("pacePreference is invalid");
  }

  assertFiniteNumberInRange("age", input.age, supportedAge.min, supportedAge.max, true);
  assertFiniteNumberInRange("heightCm", input.heightCm, supportedHeight.min, supportedHeight.max);
  assertFiniteNumberInRange("weightKg", input.weightKg, 20, 500);
  assertFiniteNumberInRange("targetWeightKg", input.targetWeightKg, 20, 500);

  assertSupportedBmi("current", bmiFor(input.weightKg, input.heightCm));
  assertSupportedBmi("target", bmiFor(input.targetWeightKg, input.heightCm));
  assertGoalDirection(input.goal, input.weightKg, input.targetWeightKg);
  return input;
}

export function classifyBmi(bmi: number): BmiCategory {
  if (bmi < 18.5) return "underweight";
  if (bmi < 25) return "normal";
  if (bmi < 30) return "overweight";
  return "obese";
}

function calculateRee(input: HealthInput) {
  const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age;
  return input.gender === "male" ? base + 5 : base - 161;
}

function calculateRecommendedCalories(tdee: number, input: HealthInput) {
  const threshold = input.gender === "female" ? 1200 : 1500;
  if (tdee < threshold) throw new Error(`TDEE is below the ${threshold} calorie product threshold`);

  const pace = input.pacePreference ?? "standard";
  let intake = tdee;
  if (input.goal === "lose_weight" || input.goal === "get_toned") {
    const cap = pace === "gentle" ? 250 : 500;
    intake = Math.max(threshold, tdee - Math.min(cap, tdee * (pace === "gentle" ? 0.15 : 0.2)));
  } else if (input.goal === "gain_muscle") {
    const cap = pace === "gentle" ? 150 : 300;
    intake = tdee + Math.min(cap, tdee * (pace === "gentle" ? 0.1 : 0.15));
  }

  const rounded = Math.round(intake);
  if (!Number.isFinite(rounded) || rounded <= 0 || rounded >= maximumCalories) {
    throw new Error("recommended calories are outside the supported product range");
  }
  return rounded;
}

function calculateProjection(input: HealthInput, intake: number) {
  if (input.weightKg === input.targetWeightKg) {
    return { targetDate: null, projectionStatus: "maintenance" as const };
  }

  let weight = input.weightKg;
  const start = new Date(input.now ?? new Date());
  const gaining = input.targetWeightKg > input.weightKg;
  for (let day = 1; day <= projectionDays; day += 1) {
    const ree = calculateRee({ ...input, weightKg: weight });
    const expenditure = ree * activityMultipliers[input.activityLevel];
    const delta = (intake - expenditure) / energyPerKg;
    weight += delta;
    if ((gaining && weight >= input.targetWeightKg) || (!gaining && weight <= input.targetWeightKg)) {
      const targetDate = new Date(start);
      targetDate.setUTCDate(targetDate.getUTCDate() + day);
      return { targetDate, projectionStatus: "projected" as const };
    }
    if ((gaining && delta <= 0) || (!gaining && delta >= 0) || !Number.isFinite(weight)) break;
  }
  return { targetDate: null, projectionStatus: "not_projected" as const };
}

function assertGoalDirection(goal: Goal, current: number, target: number) {
  if (goal === "lose_weight" && target >= current) throw new Error("goal direction is invalid");
  if (goal === "gain_muscle" && target <= current) throw new Error("goal direction is invalid");
  if (goal === "keep_fit" && target !== current) throw new Error("goal direction is invalid");
  if (goal === "get_toned" && target > current) throw new Error("goal direction is invalid");
}

function assertSupportedBmi(label: string, bmi: number) {
  if (bmi < supportedBmi.min || bmi >= supportedBmi.maxExclusive) {
    throw new Error(`${label} BMI is outside the supported wellness range`);
  }
}

function assertPositiveFinite(label: string, value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive and finite`);
}

function assertFiniteNumberInRange(field: string, value: number, min: number, max: number, integer = false) {
  if (!Number.isFinite(value)) throw new Error(`${field} must be a finite number`);
  if (integer && !Number.isInteger(value)) throw new Error(`${field} must be an integer`);
  if (value < min || value > max) throw new Error(`${field} must be between ${min} and ${max}`);
}

function bmiFor(weightKg: number, heightCm: number) {
  return weightKg / (heightCm / 100) ** 2;
}

function roundToOne(value: number) {
  return Math.round(value * 10) / 10;
}
