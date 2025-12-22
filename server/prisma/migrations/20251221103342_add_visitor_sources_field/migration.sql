/*
  Warnings:

  - You are about to drop the `ga4_events` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `ga4_events` DROP FOREIGN KEY `ga4_events_clientId_fkey`;

-- DropForeignKey
ALTER TABLE `ga4_events` DROP FOREIGN KEY `ga4_events_metricsId_fkey`;

-- AlterTable
ALTER TABLE `ga4_metrics` ADD COLUMN `events` JSON NULL,
    ADD COLUMN `visitorSources` JSON NULL;

-- DropTable
DROP TABLE `ga4_events`;
