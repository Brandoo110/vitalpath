import { describe, expect, it } from "vitest";

import { buildPlan, buildPlanPreview } from "./plan";

const completeInput = {
  goal: "lose_weight" as const,
  activityLevel: "moderate" as const,
  pacePreference: "gentle" as const,
  workoutDaysPerWeek: 3,
  sessionMinutes: 45,
  workoutLocation: "mixed" as const,
  dietPreference: "vegetarian" as const,
  sleepHours: 6.5,
  stressLevel: "high" as const,
  mainBarrier: "injury" as const,
};

describe("plan generation", () => {
  it("uses two-hour-plus session length in generated plan copy", () => {
    const plan = buildPlan({
      goal: "gain_muscle",
      workoutDaysPerWeek: 5,
      sessionMinutes: 150,
      workoutLocation: "gym",
      mainBarrier: "no_time",
    });

    expect(plan.summary.sessionMinutes).toBe(150);
    expect(plan.sections[0].preview).toContain("150 minutes");
    expect(plan.sections[3].items.join(" ")).toContain("available");
    expect(plan.sections[3].items.join(" ")).not.toContain("do 150 minutes");
  });

  it("returns an answer-grounded paid report contract with concrete sections", () => {
    const plan = buildPlan(completeInput);

    expect(plan.basis).toEqual(expect.arrayContaining([
      { field: "pacePreference", label: expect.any(String), value: "Gentle", source: "answer" },
      { field: "workoutDaysPerWeek", label: expect.any(String), value: "3 days per week (chosen frequency)", source: "answer" },
      { field: "sessionMinutes", label: expect.any(String), value: "45 minutes available", source: "answer" },
      { field: "workoutLocation", label: expect.any(String), value: "Mixed Home/Gym", source: "answer" },
      { field: "dietPreference", label: expect.any(String), value: "Vegetarian", source: "answer" },
      { field: "sleepHours", label: expect.any(String), value: "6.5 hours", source: "answer" },
      { field: "stressLevel", label: expect.any(String), value: "High", source: "answer" },
      { field: "mainBarrier", label: expect.any(String), value: "Physical Limitations", source: "answer" },
    ]));
    expect(plan.basis).toHaveLength(8);
    expect(plan.sections).toHaveLength(4);
    for (const section of plan.sections) {
      expect(section.rationale).toEqual(expect.any(String));
      expect(section.items.length).toBeGreaterThanOrEqual(4);
      expect(section.items.length).toBeLessThanOrEqual(5);
      expect(section.items.every((item) => item.length > 20)).toBe(true);
    }
    expect(plan.reviewPrompts.length).toBeGreaterThanOrEqual(3);
  });

  it("labels missing optional answers as defaults without inventing personal facts", () => {
    const plan = buildPlan({ goal: "keep_fit", activityLevel: "sedentary" });

    expect(plan.basis).toEqual(expect.arrayContaining([
      { field: "sleepHours", label: expect.any(String), value: "Not provided", source: "default" },
      { field: "stressLevel", label: expect.any(String), value: "Not provided", source: "default" },
      { field: "mainBarrier", label: expect.any(String), value: "Not provided", source: "default" },
    ]));
    expect(plan.sections.find((section) => section.id === "recovery")?.rationale).toContain("not provided");
    expect(plan.sections.find((section) => section.id === "recovery")?.items.join(" ")).not.toContain("7-hour");
    expect(plan.sections.find((section) => section.id === "daily_actions")?.items.join(" ")).toContain("suggestion");
  });

  it("preserves zero sleep as an explicit answer without recommending it as a target", () => {
    const plan = buildPlan({ ...completeInput, sleepHours: 0 });
    const sleepBasis = plan.basis.find((entry) => entry.field === "sleepHours");
    const recovery = plan.sections.find((section) => section.id === "recovery");

    expect(sleepBasis).toMatchObject({ value: "0 hours", source: "answer" });
    expect(recovery?.rationale).toContain("reported 0 hours");
    expect(recovery?.rationale).not.toMatch(/preserve|maintain|target.*0 hours/i);
  });

  it.each([1, 3, 7])("builds exactly seven days with %s planned session days", (workoutDaysPerWeek) => {
    const plan = buildPlan({ ...completeInput, workoutDaysPerWeek });

    expect(plan.firstWeek).toHaveLength(7);
    expect(plan.firstWeek.map((day) => day.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const sessionDays = plan.firstWeek.filter((day) => day.title.toLowerCase().includes("session"));
    expect(sessionDays).toHaveLength(workoutDaysPerWeek);
    expect(plan.firstWeek.every((day) => day.actions.length >= 2)).toBe(true);
    if (workoutDaysPerWeek === 7) {
      expect(plan.firstWeek.some((day) => day.actions.join(" ").toLowerCase().includes("lighter"))).toBe(true);
    }
  });

  it("keeps free preview to the strict id, title, and preview whitelist", () => {
    const plan = buildPlan(completeInput);
    const preview = buildPlanPreview(plan);

    expect(preview).toHaveLength(plan.sections.length);
    expect(preview.every((section) => Object.keys(section).sort().join(",") === "id,preview,title")).toBe(true);
    expect(JSON.stringify(preview)).not.toContain("rationale");
    expect(JSON.stringify(preview)).not.toContain("firstWeek");
    expect(JSON.stringify(preview)).not.toContain("reviewPrompts");
    expect(JSON.stringify(preview)).not.toContain("basis");
  });

  it("uses safe nutrition examples and acknowledges pace policy", () => {
    const gentle = buildPlan({ ...completeInput, pacePreference: "gentle", dietPreference: "low_carb" });
    const standard = buildPlan({ ...completeInput, pacePreference: "standard", dietPreference: "balanced" });
    const aggressive = buildPlan({ ...completeInput, pacePreference: "aggressive", dietPreference: "high_protein" });
    const gentleText = gentle.sections.find((section) => section.id === "nutrition")?.items.join(" ") ?? "";
    const standardText = standard.sections.find((section) => section.id === "nutrition")?.rationale ?? "";
    const aggressiveText = aggressive.sections.find((section) => section.id === "nutrition")?.rationale ?? "";

    expect(gentleText).toContain("lower-carb");
    expect(gentleText).toMatch(/example/i);
    expect(gentleText).not.toMatch(/macro|exact calorie|meal plan/i);
    expect(standardText).toMatch(/same calorie policy/i);
    expect(aggressiveText).toMatch(/same calorie policy/i);
  });

  it("keeps injury guidance non-prescriptive and makes availability explicit", () => {
    const plan = buildPlan({ ...completeInput, sessionMinutes: 150, mainBarrier: "injury" });
    const text = plan.sections.flatMap((section) => [section.rationale, ...section.items]).join(" ");

    expect(text).toMatch(/qualified.*individualized advice/i);
    expect(text).not.toMatch(/rehab|rehabilitation|diagnos|guarantee|muscle gain/i);
    expect(text).toMatch(/available|availability/i);
    expect(text).not.toContain("Block 150 minutes");
  });
});
