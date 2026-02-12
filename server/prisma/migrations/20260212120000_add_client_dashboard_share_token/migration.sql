-- AlterTable
ALTER TABLE `clients` ADD COLUMN `dashboardShareToken` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `clients_dashboardShareToken_key` ON `clients`(`dashboardShareToken`);
