-- CreateEnum
CREATE TYPE "PacePreference" AS ENUM ('gentle', 'standard', 'aggressive');

-- CreateEnum
CREATE TYPE "WorkoutLocation" AS ENUM ('home', 'gym', 'mixed');

-- CreateEnum
CREATE TYPE "DietPreference" AS ENUM ('balanced', 'high_protein', 'vegetarian', 'low_carb');

-- CreateEnum
CREATE TYPE "StressLevel" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "MainBarrier" AS ENUM ('no_time', 'cravings', 'motivation', 'knowledge', 'injury');

-- AlterTable
ALTER TABLE "assessments" ADD COLUMN     "dietPreference" "DietPreference",
ADD COLUMN     "mainBarrier" "MainBarrier",
ADD COLUMN     "pacePreference" "PacePreference",
ADD COLUMN     "sessionMinutes" INTEGER,
ADD COLUMN     "sleepHours" DOUBLE PRECISION,
ADD COLUMN     "stressLevel" "StressLevel",
ADD COLUMN     "workoutDaysPerWeek" INTEGER,
ADD COLUMN     "workoutLocation" "WorkoutLocation";
