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

export type PlanBasis = {
  field: string;
  label: string;
  value: string;
  source: "answer" | "default";
};

export type FirstWeekDay = {
  day: number;
  title: string;
  actions: string[];
};

export type PlanSection = {
  id: "workout" | "nutrition" | "recovery" | "daily_actions";
  title: string;
  preview: string;
  rationale: string;
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
  basis: PlanBasis[];
  firstWeek: FirstWeekDay[];
  reviewPrompts: string[];
};

export type PlanPreviewSection = Pick<PlanSection, "id" | "title" | "preview">;

export function buildPlan(input: PlanInput): GeneratedPlan {
  const pacePreference = input.pacePreference ?? "standard";
  const workoutDaysPerWeek = clampWorkoutDays(
    input.workoutDaysPerWeek ?? fallbackWorkoutDays(input.activityLevel),
  );
  const sessionMinutes = input.sessionMinutes ?? 30;
  const workoutLocation = input.workoutLocation ?? "home";
  const dietPreference = input.dietPreference ?? "balanced";
  const mainBarrier = input.mainBarrier ?? null;

  return {
    summary: {
      pacePreference,
      workoutDaysPerWeek,
      sessionMinutes,
      workoutLocation,
      dietPreference,
    },
    sections: [
      buildWorkoutSection(
        workoutDaysPerWeek,
        sessionMinutes,
        workoutLocation,
        input.goal,
        input.activityLevel,
        input.workoutDaysPerWeek !== undefined && input.workoutDaysPerWeek !== null,
        input.sessionMinutes !== undefined && input.sessionMinutes !== null,
        input.workoutLocation !== undefined && input.workoutLocation !== null,
      ),
      buildNutritionSection(dietPreference, pacePreference, input.goal),
      buildRecoverySection(input.sleepHours, input.stressLevel),
      buildDailyActionsSection(mainBarrier, sessionMinutes),
    ],
    basis: buildBasis(input, workoutDaysPerWeek, sessionMinutes, workoutLocation, dietPreference),
    firstWeek: buildFirstWeek(workoutDaysPerWeek, sessionMinutes, workoutLocation, mainBarrier),
    reviewPrompts: [
      "Did the schedule fit the time you had available?",
      "Which action felt easiest to repeat?",
      "Did sleep or stress change how the week felt?",
      "What would you simplify before next week?",
    ],
  };
}

export function buildPlanPreview(plan: GeneratedPlan): PlanPreviewSection[] {
  // 免费态只拿每个 section 的 preview，完整 paid fields 绝不从这里泄露。
  return plan.sections.map(({ id, title, preview }) => ({ id, title, preview }));
}

function buildBasis(
  input: PlanInput,
  workoutDaysPerWeek: number,
  sessionMinutes: number,
  workoutLocation: WorkoutLocation,
  dietPreference: DietPreference,
): PlanBasis[] {
  const activityLabel = activityLevelLabel(input.activityLevel);
  const chosenDays = input.workoutDaysPerWeek !== undefined && input.workoutDaysPerWeek !== null;
  const chosenMinutes = input.sessionMinutes !== undefined && input.sessionMinutes !== null;
  const chosenLocation = input.workoutLocation !== undefined && input.workoutLocation !== null;
  const chosenDiet = input.dietPreference !== undefined && input.dietPreference !== null;
  const chosenPace = input.pacePreference !== undefined && input.pacePreference !== null;

  return [
    basis("pacePreference", "Progress pace", chosenPace ? paceLabel(input.pacePreference!) : "Standard (suggested default)", chosenPace),
    basis(
      "workoutDaysPerWeek",
      "Workout days",
      chosenDays
        ? `${workoutDaysPerWeek} days per week (chosen frequency)`
        : `${workoutDaysPerWeek} days per week (suggested from ${activityLabel} activity)`,
      chosenDays,
    ),
    basis(
      "sessionMinutes",
      "Session time",
      chosenMinutes ? `${sessionMinutes} minutes available` : `${sessionMinutes} minutes available (suggested default)`,
      chosenMinutes,
    ),
    basis(
      "workoutLocation",
      "Training place",
      chosenLocation ? titleCase(workoutLocationLabel(workoutLocation)) : "Home (suggested default)",
      chosenLocation,
    ),
    basis(
      "dietPreference",
      "Diet preference",
      chosenDiet ? titleCase(dietPreferenceLabel(dietPreference)) : "Balanced (suggested default)",
      chosenDiet,
    ),
    basis(
      "sleepHours",
      "Average sleep",
      input.sleepHours === undefined || input.sleepHours === null ? "Not provided" : `${input.sleepHours} hours`,
      input.sleepHours !== undefined && input.sleepHours !== null,
    ),
    basis(
      "stressLevel",
      "Stress level",
      input.stressLevel === undefined || input.stressLevel === null ? "Not provided" : titleCase(input.stressLevel),
      input.stressLevel !== undefined && input.stressLevel !== null,
    ),
    basis(
      "mainBarrier",
      "Main barrier",
      input.mainBarrier === undefined || input.mainBarrier === null ? "Not provided" : titleCase(mainBarrierLabel(input.mainBarrier)),
      input.mainBarrier !== undefined && input.mainBarrier !== null,
    ),
  ];
}

function basis(field: string, label: string, value: string, answered: boolean): PlanBasis {
  return { field, label, value, source: answered ? "answer" : "default" };
}

function buildWorkoutSection(
  workoutDaysPerWeek: number,
  sessionMinutes: number,
  workoutLocation: WorkoutLocation,
  goal?: Goal | null,
  activityLevel?: ActivityLevel | null,
  chosenDays = false,
  chosenMinutes = false,
  chosenLocation = false,
): PlanSection {
  const focus = goal === "gain_muscle" ? "strength practice" : "low-impact cardio and strength practice";
  const locationLabel = workoutLocationLabel(workoutLocation);
  const scheduleReason = chosenDays
    ? `You chose ${workoutDaysPerWeek} workout days, so the schedule follows that frequency.`
    : `${workoutDaysPerWeek} workout days is a suggestion based on your ${activityLevelLabel(activityLevel)} activity answer.`;
  const timeReason = chosenMinutes
    ? `The ${sessionMinutes} minutes describe time available, not an obligation to complete a fixed amount.`
    : `The ${sessionMinutes}-minute window is a planning suggestion because no session time was provided; it does not claim your availability.`;
  const locationReason = chosenLocation
    ? `The plan uses ${locationLabel} as selected.`
    : "Home is a suggested default because no training place was provided.";

  return {
    id: "workout",
    title: "Workout plan",
    preview: `${workoutDaysPerWeek} ${locationLabel} sessions per week, ${sessionMinutes} minutes available each.`,
    rationale: `${scheduleReason} ${timeReason} ${locationReason}`,
    items: [
      `Use up to ${sessionMinutes} minutes of available time for ${focus}; choose a shorter version when needed.`,
      `Keep one ${locationLabel} option ready so setup does not become the hardest part of starting.`,
      "Begin with an easy warm-up and finish with comfortable movement that fits the time you have.",
      "Place sessions on convenient days and leave room to reschedule instead of doubling up.",
      "Stop or scale back if movement causes sharp or worsening pain.",
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
  const paceNote = pacePreference === "gentle"
    ? "Gentle uses the product's gentler adjustment; standard and aggressive use the same calorie policy."
    : "Standard and aggressive use the same calorie policy in this product; choose the pace that feels realistic.";

  return {
    id: "nutrition",
    title: "Nutrition plan",
    preview: `A ${dietLabel} approach for a ${pacePreference} ${goalLabel} pace.`,
    rationale: `${paceNote} These are flexible examples, not a strict prescription or a promise about results.`,
    items: [
      nutritionExample(dietPreference),
      "Keep one simple, satisfying option available for busy or lower-energy days.",
      "If you choose a snack, pair something filling with a food you enjoy rather than relying on rigid rules.",
      "Review portions and energy over a full week instead of reacting to one noisy day.",
    ],
  };
}

function nutritionExample(dietPreference: DietPreference) {
  if (dietPreference === "vegetarian") {
    return "Example structure: pair beans, tofu, eggs, or yogurt with produce and a satisfying grain or starchy food.";
  }
  if (dietPreference === "high_protein") {
    return "Example structure: make a protein source the anchor, then add produce and a carbohydrate or fat you enjoy.";
  }
  if (dietPreference === "low_carb") {
    return "Example lower-carb structure: pair protein and non-starchy vegetables with a source of fat, adjusting carbohydrate foods to your preference.";
  }
  return "Example structure: pair a protein or plant-protein source with produce, fiber, and a satisfying carbohydrate or fat.";
}

function buildRecoverySection(
  sleepHours?: number | null,
  stressLevel?: StressLevel | null,
): PlanSection {
  const sleepText = sleepHours === undefined || sleepHours === null
    ? "Sleep hours were not provided, so these are general recovery suggestions."
    : `You reported ${sleepHours} hours of sleep; use that context when choosing effort and leaving room for rest.`;
  const stressText = stressLevel === undefined || stressLevel === null
    ? "Stress level was not provided, so adjust from how the day actually feels."
    : `You reported ${stressLevel} stress; a lighter option is available when stress feels higher than usual.`;
  const preview = sleepHours !== undefined && sleepHours !== null && stressLevel !== undefined && stressLevel !== null
    ? `Your baseline is ${sleepHours} hours of sleep with ${stressLevel} stress.`
    : sleepHours !== undefined && sleepHours !== null
      ? `Recovery suggestions based on the ${sleepHours}-hour sleep answer provided.`
      : stressLevel !== undefined && stressLevel !== null
        ? `Recovery suggestions based on the ${stressLevel} stress answer provided.`
        : "General recovery suggestions; sleep and stress were not provided.";

  return {
    id: "recovery",
    title: "Recovery plan",
    preview,
    rationale: `${sleepText} ${stressText}`,
    items: [
      "Use a lighter option or a recovery day when energy is low or stress is higher than usual.",
      "Keep a simple wind-down cue when it is practical, without treating one sleep target as a requirement.",
      "Note sleep, stress, and energy alongside sessions during the first week.",
      "Increase effort only when the current routine feels manageable; reschedule rather than doubling up.",
    ],
  };
}

function buildDailyActionsSection(mainBarrier: MainBarrier | null, sessionMinutes: number): PlanSection {
  const barrierText = mainBarrier === null
    ? "No main barrier was provided, so these flexible actions are suggestions rather than personal assumptions."
    : `The actions respond to the barrier you selected: ${mainBarrierLabel(mainBarrier)}.`;

  return {
    id: "daily_actions",
    title: "Daily actions",
    preview: mainBarrier === null
      ? "Flexible actions for the first week."
      : `Built around your main barrier: ${mainBarrierLabel(mainBarrier)}.`,
    rationale: barrierText,
    items: [
      mainBarrierAction(mainBarrier),
      `Treat your ${sessionMinutes} minutes as available time and an availability window, not an obligation to complete a fixed amount.`,
      "Put tomorrow's smallest action where you can see it before the day starts.",
      "At the end of the week, keep the action that was easiest to repeat and simplify the rest.",
    ],
  };
}

function buildFirstWeek(
  workoutDaysPerWeek: number,
  sessionMinutes: number,
  workoutLocation: WorkoutLocation,
  mainBarrier: MainBarrier | null,
): FirstWeekDay[] {
  const sessionDays = new Set(
    Array.from({ length: workoutDaysPerWeek }, (_, index) => Math.floor((index * 7) / workoutDaysPerWeek) + 1),
  );
  let sessionNumber = 0;

  return Array.from({ length: 7 }, (_, index) => {
    const day = index + 1;
    if (sessionDays.has(day)) {
      sessionNumber += 1;
      const lighter = workoutDaysPerWeek === 7 && day === 7;
      return {
        day,
        title: lighter ? `Session ${sessionNumber} (lighter)` : `Session ${sessionNumber}`,
        actions: [
          lighter
            ? "Make this a lighter session with easy movement or mobility that feels comfortable."
            : `Use up to ${sessionMinutes} minutes of available ${workoutLocationLabel(workoutLocation)} time; a shorter version is fine.`,
          "Use the workout focus at a comfortable effort and stop or scale back if pain is sharp or worsening.",
          mainBarrier === "injury"
            ? "If an injury affects activity, seek qualified individualized advice before changing exercise choices."
            : "Write down one sentence about how the session felt before planning the next one.",
        ],
      };
    }

    return {
      day,
      title: "Recovery and planning",
      actions: [
        "Use this day for rest or lighter activity that feels comfortable.",
        "Review the next available session and prepare one simple option.",
      ],
    };
  });
}

function fallbackWorkoutDays(activityLevel?: ActivityLevel | null) {
  if (activityLevel === "high") return 5;
  if (activityLevel === "moderate") return 4;
  return 3;
}

function clampWorkoutDays(days: number) {
  return Math.min(7, Math.max(1, Math.round(days)));
}

function activityLevelLabel(activityLevel?: ActivityLevel | null) {
  if (activityLevel === "high") return "high";
  if (activityLevel === "moderate") return "moderate";
  if (activityLevel === "light") return "light";
  if (activityLevel === "sedentary") return "sedentary";
  return "general";
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

function paceLabel(pacePreference: PacePreference) {
  if (pacePreference === "gentle") return "Gentle";
  if (pacePreference === "aggressive") return "Aggressive";
  return "Standard";
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

function mainBarrierAction(mainBarrier: MainBarrier | null) {
  if (mainBarrier === "no_time") return "Choose a short option and remove setup steps before the day gets busy.";
  if (mainBarrier === "cravings") return "Prepare one satisfying option ahead of time so the next choice is easier.";
  if (mainBarrier === "knowledge") return "Choose one listed action and repeat it before adding more choices.";
  if (mainBarrier === "injury") return "If an injury affects activity, seek qualified individualized advice; this report is not individualized exercise advice.";
  if (mainBarrier === "motivation") return "Put the first small action where you can see it and begin before adding complexity.";
  return "Choose one small action that fits today; this is a suggestion, not a requirement, and review whether it felt workable.";
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
