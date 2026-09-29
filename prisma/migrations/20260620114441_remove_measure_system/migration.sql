/*
  Warnings:

  - You are about to drop the column `measureSystem` on the `assessments` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "assessments" DROP COLUMN "measureSystem";

-- DropEnum
DROP TYPE "MeasureSystem";
