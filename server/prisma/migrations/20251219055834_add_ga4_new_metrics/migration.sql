/*
  Warnings:

  - A unique constraint covering the columns `[clientId]` on the table `ga4_metrics` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `engagedSessions` to the `ga4_metrics` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalUsers` to the `ga4_metrics` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX `ga4_metrics_clientId_startDate_endDate_key` ON `ga4_metrics`;

-- AlterTable
ALTER TABLE `ga4_metrics` ADD COLUMN `engagedSessions` INTEGER NOT NULL,
    ADD COLUMN `totalUsers` INTEGER NOT NULL,
    ADD COLUMN `totalUsersTrend` JSON NULL;

-- CreateIndex
CREATE UNIQUE INDEX `ga4_metrics_clientId_key` ON `ga4_metrics`(`clientId`);
