-- AlterTable
ALTER TABLE `notifications` ADD COLUMN `agencyId` VARCHAR(255) NULL;

-- CreateIndex
CREATE INDEX `notifications_agencyId_idx` ON `notifications`(`agencyId`);
