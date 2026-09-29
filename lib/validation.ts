import { z } from "zod";

import {
  activityLevels,
  dietPreferences,
  genders,
  goals,
  mainBarriers,
  pacePreferences,
  stressLevels,
  workoutLocations,
} from "./health";

export const sessionIdSchema = z.string().uuid("sessionId must be a valid UUID");

export const healthDataConsentSchema = z.boolean().optional();

// assessment 的 data 是增量更新：每一步只传本步产生的字段。
export const assessmentDataSchema = z
  .object({
    gender: z.enum(genders).optional(),
    goal: z.enum(goals).optional(),
    age: z.number().int().min(13).max(120).optional(),
    heightCm: z.number().min(50).max(300).optional(),
    weightKg: z.number().min(20).max(500).optional(),
    targetWeightKg: z.number().min(20).max(500).optional(),
    activityLevel: z.enum(activityLevels).optional(),
    pacePreference: z.enum(pacePreferences).optional(),
    workoutDaysPerWeek: z.number().int().min(1).max(7).optional(),
    sessionMinutes: z.number().int().min(10).max(240).optional(),
    workoutLocation: z.enum(workoutLocations).optional(),
    dietPreference: z.enum(dietPreferences).optional(),
    sleepHours: z.number().min(0).max(16).optional(),
    stressLevel: z.enum(stressLevels).optional(),
    mainBarrier: z.enum(mainBarriers).optional(),
    healthDataConsent: z.boolean().optional(),
  })
  .strict();

export const patchAssessmentSchema = z.object({
  sessionId: sessionIdSchema,
  // step 用于进度恢复；服务端会保证它只前进不后退。
  step: z.number().int().min(0).max(20),
  version: z.number().int().min(0).optional(),
  data: assessmentDataSchema,
});

export const createSessionSchema = z
  .object({
    healthDataConsent: healthDataConsentSchema,
  })
  .strict()
  .optional();

export const updateSessionLeadSchema = z.object({
  sessionId: sessionIdSchema,
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
});

export const sessionRequestSchema = z.object({
  sessionId: sessionIdSchema,
});

export const payRequestSchema = z.object({
  sessionId: sessionIdSchema,
  plan: z.enum(["trial", "monthly", "quarterly"]).optional(),
});
