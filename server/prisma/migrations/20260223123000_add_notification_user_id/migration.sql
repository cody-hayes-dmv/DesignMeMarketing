-- AlterTable
ALTER TABLE `notifications` ADD COLUMN `userId` VARCHAR(255) NULL;

-- CreateIndex
CREATE INDEX `notifications_userId_idx` ON `notifications`(`userId`);
