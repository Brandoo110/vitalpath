export type OracleGender = "male" | "female";
export type OracleGoal = "lose_weight" | "gain_muscle" | "keep_fit" | "get_toned";
export type OracleActivity = "sedentary" | "light" | "moderate" | "high";
export type OraclePace = "gentle" | "standard" | "aggressive";

export const oracleActivityMultipliers: Record<OracleActivity, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
};

const oracleEnergyPerKg = 7700;
const oracleProjectionDays = 365;

export type OracleInput = {
  gender: OracleGender;
  goal: OracleGoal;
  age: number;
  heightCm: number;
  weightKg: number;
  targetWeightKg: number;
  activityLevel: OracleActivity;
  pacePreference: OraclePace;
};

export type OracleProjection = {
  day: number | null;
  fixedPointKg: number | null;
  q: number | null;
};

export type OracleResult = {
  ree: number;
  tdee: number;
  intake: number;
  rejection: "tdee_threshold" | "calories_range" | null;
  projection: OracleProjection;
};

export function oracleHealth(input: OracleInput): OracleResult {
  const ree = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age + (input.gender === "male" ? 5 : -161);
  const tdee = ree * oracleActivityMultipliers[input.activityLevel];
  const threshold = input.gender === "female" ? 1200 : 1500;
  if (tdee < threshold) {
    return {
      ree,
      tdee,
      intake: Number.NaN,
      rejection: "tdee_threshold",
      projection: { day: null, fixedPointKg: null, q: null },
    };
  }

  const pace = input.pacePreference;
  let intake = tdee;
  const isDecliningTone = input.goal === "get_toned" && input.targetWeightKg < input.weightKg;
  if (input.goal === "lose_weight" || isDecliningTone) {
    const cap = pace === "gentle" ? 250 : 500;
    intake = Math.max(threshold, tdee - Math.min(cap, tdee * (pace === "gentle" ? 0.15 : 0.2)));
  } else if (input.goal === "gain_muscle") {
    const cap = pace === "gentle" ? 150 : 300;
    intake = tdee + Math.min(cap, tdee * (pace === "gentle" ? 0.1 : 0.15));
  }

  const rounded = Math.round(intake);
  if (!Number.isFinite(rounded) || rounded <= 0 || rounded >= 5000) {
    return {
      ree,
      tdee,
      intake: rounded,
      rejection: "calories_range",
      projection: { day: null, fixedPointKg: null, q: null },
    };
  }

  return {
    ree,
    tdee,
    intake: rounded,
    rejection: null,
    projection: oracleProjection(input, rounded),
  };
}

function oracleProjection(input: OracleInput, intake: number): OracleProjection {
  if (input.weightKg === input.targetWeightKg) {
    return { day: null, fixedPointKg: null, q: null };
  }

  const multiplier = oracleActivityMultipliers[input.activityLevel];
  const constant = 6.25 * input.heightCm - 5 * input.age + (input.gender === "male" ? 5 : -161);
  const fixedPointKg = (intake / multiplier - constant) / 10;
  const q = 1 - (10 * multiplier) / oracleEnergyPerKg;
  const gaining = input.targetWeightKg > input.weightKg;
  const ratio = gaining
    ? (fixedPointKg - input.targetWeightKg) / (fixedPointKg - input.weightKg)
    : (input.targetWeightKg - fixedPointKg) / (input.weightKg - fixedPointKg);

  if (!(ratio > 0 && ratio < 1) || !(q > 0 && q < 1)) {
    return { day: null, fixedPointKg, q };
  }

  const realDay = Math.log(ratio) / Math.log(q);
  let day = Math.max(1, Math.ceil(realDay - 1e-10));
  const reachesTarget = (weight: number) => gaining
    ? weight >= input.targetWeightKg
    : weight <= input.targetWeightKg;
  if (!reachesTarget(weightAt(input, day, fixedPointKg, q))) day += 1;
  if (day > 1 && reachesTarget(weightAt(input, day - 1, fixedPointKg, q))) day -= 1;

  return { day: day <= oracleProjectionDays ? day : null, fixedPointKg, q };
}

function weightAt(input: OracleInput, day: number, fixedPointKg: number, q: number) {
  return fixedPointKg + (input.weightKg - fixedPointKg) * q ** day;
}

export function oracleWeightAt(input: OracleInput, intake: number, day: number) {
  const multiplier = oracleActivityMultipliers[input.activityLevel];
  const constant = 6.25 * input.heightCm - 5 * input.age + (input.gender === "male" ? 5 : -161);
  const fixedPointKg = (intake / multiplier - constant) / 10;
  const q = 1 - (10 * multiplier) / oracleEnergyPerKg;
  return fixedPointKg + (input.weightKg - fixedPointKg) * q ** day;
}

export function oracleDate(now: Date, day: number | null) {
  if (day === null) return null;
  return new Date(now.getTime() + day * 86_400_000);
}
