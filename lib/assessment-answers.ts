import { Prisma, type AssessmentAnswer, type QuestionnaireQuestion } from "@/app/generated/prisma/client";

import type {
  DietPreference,
  MainBarrier,
  PacePreference,
  StressLevel,
  WorkoutLocation,
} from "./health";

export const extendedQuestionDefinitions = [
  {
    key: "pacePreference",
    label: "Preferred progress pace",
    section: "goal",
    valueType: "single_choice",
    sortOrder: 10,
  },
  {
    key: "workoutDaysPerWeek",
    label: "Workout days per week",
    section: "training",
    valueType: "number",
    sortOrder: 20,
  },
  {
    key: "sessionMinutes",
    label: "Session length in minutes",
    section: "training",
    valueType: "number",
    sortOrder: 30,
  },
  {
    key: "workoutLocation",
    label: "Training place",
    section: "training",
    valueType: "single_choice",
    sortOrder: 40,
  },
  {
    key: "dietPreference",
    label: "Diet preference",
    section: "nutrition",
    valueType: "single_choice",
    sortOrder: 50,
  },
  {
    key: "sleepHours",
    label: "Average sleep hours",
    section: "recovery",
    valueType: "number",
    sortOrder: 60,
  },
  {
    key: "stressLevel",
    label: "Stress level",
    section: "recovery",
    valueType: "single_choice",
    sortOrder: 70,
  },
  {
    key: "mainBarrier",
    label: "Main barrier",
    section: "behavior",
    valueType: "single_choice",
    sortOrder: 80,
  },
] as const;

export type ExtendedQuestionKey = (typeof extendedQuestionDefinitions)[number]["key"];

export type ExtendedAssessmentAnswers = {
  pacePreference?: PacePreference;
  workoutDaysPerWeek?: number;
  sessionMinutes?: number;
  workoutLocation?: WorkoutLocation;
  dietPreference?: DietPreference;
  sleepHours?: number;
  stressLevel?: StressLevel;
  mainBarrier?: MainBarrier;
};

type AnswerWithQuestion = AssessmentAnswer & { question: QuestionnaireQuestion };

const extendedQuestionKeySet = new Set<string>(
  extendedQuestionDefinitions.map((question) => question.key),
);

const numericQuestionKeySet = new Set<ExtendedQuestionKey>([
  "workoutDaysPerWeek",
  "sessionMinutes",
  "sleepHours",
]);

export function isExtendedQuestionKey(key: string): key is ExtendedQuestionKey {
  return extendedQuestionKeySet.has(key);
}

export function splitAssessmentData<T extends Record<string, unknown>>(data: T) {
  const coreData: Record<string, unknown> = {};
  const extendedAnswers: Partial<Record<ExtendedQuestionKey, unknown>> = {};

  for (const [key, value] of Object.entries(data)) {
    if (isExtendedQuestionKey(key)) {
      extendedAnswers[key] = value;
    } else {
      coreData[key] = value;
    }
  }

  return { coreData, extendedAnswers };
}

export function mapAnswerRows(rows: AnswerWithQuestion[]): ExtendedAssessmentAnswers {
  const answers: ExtendedAssessmentAnswers = {};

  for (const row of rows) {
    const key = row.question.key;
    if (!isExtendedQuestionKey(key)) continue;

    const value = numericQuestionKeySet.has(key) ? row.valueNumber : row.valueText;
    if (value === null || value === undefined) continue;

    assignAnswerValue(answers, key, value);
  }

  return answers;
}

export async function upsertAssessmentAnswers(
  tx: Prisma.TransactionClient,
  assessmentId: string,
  answers: Partial<Record<ExtendedQuestionKey, unknown>>,
) {
  const entries = Object.entries(answers).filter(([, value]) => value !== undefined) as Array<
    [ExtendedQuestionKey, unknown]
  >;
  if (entries.length === 0) return;

  const questions = await tx.questionnaireQuestion.findMany({
    where: { key: { in: entries.map(([key]) => key) } },
  });
  const questionByKey = new Map(questions.map((question) => [question.key, question]));

  for (const [key, value] of entries) {
    const question = questionByKey.get(key);
    if (!question) {
      throw new Error(`Question definition is missing for ${key}`);
    }

    const data = answerValueData(key, value);
    await tx.assessmentAnswer.upsert({
      where: {
        assessmentId_questionId: {
          assessmentId,
          questionId: question.id,
        },
      },
      create: {
        assessmentId,
        questionId: question.id,
        ...data,
      },
      update: data,
    });
  }
}

function answerValueData(key: ExtendedQuestionKey, value: unknown) {
  const empty = {
    valueText: null,
    valueNumber: null,
    valueBoolean: null,
    valueJson: Prisma.DbNull,
  };

  if (numericQuestionKeySet.has(key)) {
    return { ...empty, valueNumber: value as number };
  }

  return { ...empty, valueText: value as string };
}

function assignAnswerValue(
  answers: ExtendedAssessmentAnswers,
  key: ExtendedQuestionKey,
  value: string | number,
) {
  switch (key) {
    case "pacePreference":
      answers.pacePreference = value as PacePreference;
      return;
    case "workoutDaysPerWeek":
      answers.workoutDaysPerWeek = value as number;
      return;
    case "sessionMinutes":
      answers.sessionMinutes = value as number;
      return;
    case "workoutLocation":
      answers.workoutLocation = value as WorkoutLocation;
      return;
    case "dietPreference":
      answers.dietPreference = value as DietPreference;
      return;
    case "sleepHours":
      answers.sleepHours = value as number;
      return;
    case "stressLevel":
      answers.stressLevel = value as StressLevel;
      return;
    case "mainBarrier":
      answers.mainBarrier = value as MainBarrier;
      return;
  }
}
