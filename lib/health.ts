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

export type HealthInput = {
  gender: Gender;
  goal: Goal;
  age: number;
  heightCm: number;
  weightKg: number;
  targetWeightKg: number;
  activityLevel: ActivityLevel;
  pacePreference?: PacePreference;
  now?: Date;
};

export type HealthResult = {
  bmi: number;
  bmiCategory: BmiCategory;
  recommendedCalories: number;
  targetDate: Date;
};

const activityMultipliers: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
};

const weeklyTargetRateKg = 0.75;
const minimumCalories = 1200;

export function calculateHealthResult(input: HealthInput): HealthResult {
  const validInput = validateHealthInput(input);
  const bmi = roundToOne(validInput.weightKg / (validInput.heightCm / 100) ** 2);
  const bmr = calculateBmr(validInput);
  const tdee = bmr * activityMultipliers[validInput.activityLevel];
  // 热量建议只由服务端计算，避免前端篡改后直接影响结果页。
  const recommendedCalories = Math.round(
    applyGoalCalorieAdjustment(tdee, validInput.goal, validInput.pacePreference ?? "standard"),
  );
  const targetDate = calculateTargetDate(validInput);

  return {
    bmi,
    bmiCategory: classifyBmi(bmi),
    recommendedCalories,
    targetDate,
  };
}

export function validateHealthInput(input: HealthInput): HealthInput {
  if (!genders.includes(input.gender)) {
    throw new Error("gender must be male or female");
  }

  if (!goals.includes(input.goal)) {
    throw new Error("goal is invalid");
  }

  if (!activityLevels.includes(input.activityLevel)) {
    throw new Error("activityLevel is invalid");
  }

  if (input.pacePreference !== undefined && !pacePreferences.includes(input.pacePreference)) {
    throw new Error("pacePreference is invalid");
  }

  assertFiniteNumberInRange("age", input.age, 13, 120, true);
  assertFiniteNumberInRange("heightCm", input.heightCm, 50, 300);
  assertFiniteNumberInRange("weightKg", input.weightKg, 20, 500);
  assertFiniteNumberInRange("targetWeightKg", input.targetWeightKg, 20, 500);

  // 这里只校验健康数据是否合理，不按“减重/增肌方向”拒绝输入。
  const targetBmi = input.targetWeightKg / (input.heightCm / 100) ** 2;
  if (targetBmi < 10 || targetBmi > 60) {
    throw new Error("target BMI must be between 10 and 60");
  }

  return input;
}

export function classifyBmi(bmi: number): BmiCategory {
  if (bmi < 18.5) return "underweight";
  if (bmi < 25) return "normal";
  if (bmi < 30) return "overweight";
  return "obese";
}

function calculateBmr(input: HealthInput): number {
  const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age;
  return input.gender === "male" ? base + 5 : base - 161;
}

function applyGoalCalorieAdjustment(tdee: number, goal: Goal, pacePreference: PacePreference): number {
  switch (goal) {
    case "lose_weight":
      return Math.max(minimumCalories, tdee - calorieDeficit(pacePreference));
    case "gain_muscle":
      return tdee + calorieSurplus(pacePreference);
    case "get_toned":
      return Math.max(minimumCalories, tdee - toneDeficit(pacePreference));
    case "keep_fit":
      return tdee;
  }
}

function calorieDeficit(pacePreference: PacePreference) {
  // 激进减重仍按标准缺口封顶，避免为了迎合问卷偏好生成过低热量。
  if (pacePreference === "gentle") return 250;
  return 500;
}

function calorieSurplus(pacePreference: PacePreference) {
  if (pacePreference === "gentle") return 150;
  if (pacePreference === "aggressive") return 400;
  return 300;
}

function toneDeficit(pacePreference: PacePreference) {
  if (pacePreference === "gentle") return 150;
  if (pacePreference === "aggressive") return 300;
  return 250;
}

function calculateTargetDate(input: HealthInput): Date {
  // 0.75kg/week 取自竞品 0.45-0.90kg/week 的中间值，便于测试稳定。
  const days = Math.ceil((Math.abs(input.weightKg - input.targetWeightKg) / weeklyTargetRateKg) * 7);
  const targetDate = new Date((input.now ?? new Date()).getTime());
  targetDate.setUTCDate(targetDate.getUTCDate() + days);
  return targetDate;
}

function assertFiniteNumberInRange(
  field: string,
  value: number,
  min: number,
  max: number,
  integer = false,
) {
  if (!Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }

  if (integer && !Number.isInteger(value)) {
    throw new Error(`${field} must be an integer`);
  }

  if (value < min || value > max) {
    throw new Error(`${field} must be between ${min} and ${max}`);
  }
}

function roundToOne(value: number): number {
  return Math.round(value * 10) / 10;
}
