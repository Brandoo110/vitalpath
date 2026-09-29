import { describe, expect, it } from "vitest";

import { buildPlan } from "./plan";

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
    expect(plan.sections[3].items).toContain("Block 150 minutes in your calendar before the day starts.");
  });
});
