-- CreateEnum
CREATE TYPE "BmiCategory" AS ENUM ('underweight', 'normal', 'overweight', 'obese');

-- AlterTable
ALTER TABLE "results" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "results" ALTER COLUMN "bmiCategory" TYPE "BmiCategory" USING "bmiCategory"::"BmiCategory";
