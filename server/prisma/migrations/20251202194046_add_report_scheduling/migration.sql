-- AlterTable
ALTER TABLE `seo_reports` ADD COLUMN `activeUsers` INTEGER NULL,
    ADD COLUMN `emailSubject` VARCHAR(191) NULL,
    ADD COLUMN `eventCount` INTEGER NULL,
    ADD COLUMN `keyEvents` INTEGER NULL,
    ADD COLUMN `newUsers` INTEGER NULL,
    ADD COLUMN `recipients` JSON NULL,
    ADD COLUMN `scheduleId` VARCHAR(191) NULL,
    ADD COLUMN `sentAt` DATETIME(3) NULL,
    ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'draft';

-- CreateTable
CREATE TABLE `report_schedules` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `frequency` VARCHAR(191) NOT NULL,
    `dayOfWeek` INTEGER NULL,
    `dayOfMonth` INTEGER NULL,
    `timeOfDay` VARCHAR(191) NOT NULL DEFAULT '09:00',
    `recipients` JSON NOT NULL,
    `emailSubject` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `clientId` VARCHAR(191) NOT NULL,
    `lastRunAt` DATETIME(3) NULL,
    `nextRunAt` DATETIME(3) NULL,

    INDEX `report_schedules_clientId_idx`(`clientId`),
    INDEX `report_schedules_isActive_nextRunAt_idx`(`isActive`, `nextRunAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `seo_reports_scheduleId_idx` ON `seo_reports`(`scheduleId`);

-- AddForeignKey
ALTER TABLE `seo_reports` ADD CONSTRAINT `seo_reports_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `report_schedules`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_schedules` ADD CONSTRAINT `report_schedules_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
