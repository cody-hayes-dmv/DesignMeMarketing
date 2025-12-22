/*
  Warnings:

  - You are about to drop the column `events` on the `ga4_metrics` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `ga4_metrics` DROP COLUMN `events`;

-- CreateTable
CREATE TABLE `ga4_events` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `count` INTEGER NOT NULL,
    `change` VARCHAR(191) NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `rank` INTEGER NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `metricsId` VARCHAR(191) NULL,

    INDEX `ga4_events_clientId_startDate_endDate_idx`(`clientId`, `startDate`, `endDate`),
    INDEX `ga4_events_clientId_count_idx`(`clientId`, `count`),
    INDEX `ga4_events_clientId_name_idx`(`clientId`, `name`),
    UNIQUE INDEX `ga4_events_clientId_name_startDate_endDate_key`(`clientId`, `name`, `startDate`, `endDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ga4_events` ADD CONSTRAINT `ga4_events_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ga4_events` ADD CONSTRAINT `ga4_events_metricsId_fkey` FOREIGN KEY (`metricsId`) REFERENCES `ga4_metrics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
