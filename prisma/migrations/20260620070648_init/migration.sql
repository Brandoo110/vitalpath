-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('free', 'active');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female');

-- CreateEnum
CREATE TYPE "Goal" AS ENUM ('lose_weight', 'gain_muscle', 'keep_fit', 'get_toned');

-- CreateEnum
CREATE TYPE "MeasureSystem" AS ENUM ('metric', 'imperial');

-- CreateEnum
CREATE TYPE "ActivityLevel" AS ENUM ('sedentary', 'light', 'moderate', 'high');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'free',
    "healthDataConsent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "measureSystem" "MeasureSystem" NOT NULL DEFAULT 'metric',
    "gender" "Gender",
    "goal" "Goal",
    "age" INTEGER,
    "heightCm" DOUBLE PRECISION,
    "weightKg" DOUBLE PRECISION,
    "targetWeightKg" DOUBLE PRECISION,
    "activityLevel" "ActivityLevel",
    "step" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "results" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bmi" DOUBLE PRECISION NOT NULL,
    "bmiCategory" TEXT NOT NULL,
    "recommendedCalories" INTEGER NOT NULL,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'free',
    "plan" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assessments_userId_key" ON "assessments"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "results_userId_key" ON "results"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_userId_key" ON "subscriptions"("userId");

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
