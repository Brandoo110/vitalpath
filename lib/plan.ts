import type {
  ActivityLevel,
  DietPreference,
  Goal,
  MainBarrier,
  PacePreference,
  StressLevel,
  WorkoutLocation,
} from "./health";

export type PlanInput = {
  goal?: Goal | null;
  activityLevel?: ActivityLevel | null;
  pacePreference?: PacePreference | null;
  workoutDaysPerWeek?: number | null;
  sessionMinutes?: number | null;
  workoutLocation?: WorkoutLocation | null;
  dietPreference?: DietPreference | null;
  sleepHours?: number | null;
  stressLevel?: StressLevel | null;
  mainBarrier?: MainBarrier | null;
};

export type PlanSection = {
  id: "workout" | "nutrition" | "recovery" | "daily_actions";
  title: string;
  preview: string;
  items: string[];
};

export type GeneratedPlan = {
  summary: {
    pacePreference: PacePreference;
    workoutDaysPerWeek: number;
    sessionMinutes: number;
    workoutLocation: WorkoutLocation;
    dietPreference: DietPreference;
  };
  sections: PlanSection[];
};

export type PlanPreviewSection = Pick<PlanSection, "id" | "title" | "preview">;

export function buildPlan(input: PlanInput): GeneratedPlan {
  const pacePreference = input.pacePreference ?? "standard";
  const workoutDaysPerWeek = input.workoutDaysPerWeek ?? fallbackWorkoutDays(input.activityLevel);
  const sessionMinutes = input.sessionMinutes ?? 30;
  const workoutLocation = input.workoutLocation ?? "home";
  const dietPreference = input.dietPreference ?? "balanced";
  const sleepHours = input.sleepHours ?? 7;
  const stressLevel = input.stressLevel ?? "medium";
  const mainBarrier = input.mainBarrier ?? "motivation";

  return {
    summary: {
      pacePreference,
      workoutDaysPerWeek,
      sessionMinutes,
      workoutLocation,
      dietPreference,
    },
    sections: [
      buildWorkoutSection(workoutDaysPerWeek, sessionMinutes, workoutLocation, input.goal),
      buildNutritionSection(dietPreference, pacePreference, input.goal),
      buildRecoverySection(sleepHours, stressLevel),
      buildDailyActionsSection(mainBarrier, sessionMinutes),
    ],
  };
}

export function buildPlanPreview(plan: GeneratedPlan): PlanPreviewSection[] {
  // 免费态只拿每个 section 的 preview，完整 items 只在会员结果里返回。
  return plan.sections.map(({ id, title, preview }) => ({ id, title, preview }));
}

function buildWorkoutSection(
  workoutDaysPerWeek: number,
  sessionMinutes: number,
  workoutLocation: WorkoutLocation,
  goal?: Goal | null,
): PlanSection {
  const focus = goal === "gain_muscle" ? "strength blocks" : "low-impact cardio and strength";
  const locationLabel = workoutLocationLabel(workoutLocation);

  return {
    id: "workout",
    title: "Workout plan",
    preview: `${workoutDaysPerWeek} ${locationLabel} sessions per week, ${sessionMinutes} minutes each.`,
    items: [
      `${workoutDaysPerWeek} ${locationLabel} sessions focused on ${focus}.`,
      `Keep each session near ${sessionMinutes} minutes so the plan fits your schedule.`,
      "Use one lighter mobility day when soreness or stress is high.",
    ],
  };
}

function buildNutritionSection(
  dietPreference: DietPreference,
  pacePreference: PacePreference,
  goal?: Goal | null,
): PlanSection {
  const dietLabel = dietPreferenceLabel(dietPreference);
  const goalLabel = goalLabelForCopy(goal);

  return {
    id: "nutrition",
    title: "Nutrition plan",
    preview: `A ${dietLabel} approach tuned for a ${pacePreference} ${goalLabel} pace.`,
    items: [
      `Anchor each meal around a ${dietLabel} protein or fiber source.`,
      "Keep snacks planned instead of reactive, especially around your usual low-energy window.",
      "Adjust portions weekly based on weight trend, not one noisy day.",
    ],
  };
}

function buildRecoverySection(sleepHours: number, stressLevel: StressLevel): PlanSection {
  return {
    id: "recovery",
    title: "Recovery plan",
    preview: `Your baseline is ${sleepHours} hours of sleep with ${stressLevel} stress.`,
    items: [
      `Protect a ${sleepHours}-hour sleep window before increasing workout intensity.`,
      `Use a lower-intensity session when stress is ${stressLevel}.`,
      "Track energy for the first week before raising volume.",
    ],
  };
}

function buildDailyActionsSection(mainBarrier: MainBarrier, sessionMinutes: number): PlanSection {
  return {
    id: "daily_actions",
    title: "Daily actions",
    preview: `Built around your main barrier: ${mainBarrierLabel(mainBarrier)}.`,
    items: [
      mainBarrierAction(mainBarrier),
      `Block ${sessionMinutes} minutes in your calendar before the day starts.`,
      "Review the plan once each evening and choose tomorrow's smallest action.",
    ],
  };
}

function fallbackWorkoutDays(activityLevel?: ActivityLevel | null) {
  if (activityLevel === "high") return 5;
  if (activityLevel === "moderate") return 4;
  return 3;
}

function workoutLocationLabel(workoutLocation: WorkoutLocation) {
  if (workoutLocation === "gym") return "gym";
  if (workoutLocation === "mixed") return "mixed home/gym";
  return "home";
}

function dietPreferenceLabel(dietPreference: DietPreference) {
  if (dietPreference === "high_protein") return "high-protein";
  if (dietPreference === "low_carb") return "lower-carb";
  if (dietPreference === "vegetarian") return "vegetarian";
  return "balanced";
}

function goalLabelForCopy(goal?: Goal | null) {
  if (goal === "gain_muscle") return "muscle-building";
  if (goal === "keep_fit") return "maintenance";
  if (goal === "get_toned") return "toning";
  return "fat-loss";
}

function mainBarrierLabel(mainBarrier: MainBarrier) {
  if (mainBarrier === "no_time") return "time";
  if (mainBarrier === "cravings") return "cravings";
  if (mainBarrier === "knowledge") return "not knowing what to do";
  if (mainBarrier === "injury") return "physical limitations";
  return "motivation";
}

function mainBarrierAction(mainBarrier: MainBarrier) {
  if (mainBarrier === "no_time") return "Use short sessions and remove setup-heavy exercises.";
  if (mainBarrier === "cravings") return "Prepare one default high-protein snack before cravings hit.";
  if (mainBarrier === "knowledge") return "Follow the listed actions without adding extra choices.";
  if (mainBarrier === "injury") return "Keep movements low-impact and stop on sharp pain.";
  return "Start with the smallest visible action to reduce friction.";
}
