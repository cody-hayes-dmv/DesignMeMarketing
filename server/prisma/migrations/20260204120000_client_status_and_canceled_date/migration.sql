-- AlterTable: add new client status enum values and canceledEndDate
ALTER TABLE `clients` MODIFY COLUMN `status` ENUM('ACTIVE', 'PENDING', 'REJECTED', 'DASHBOARD_ONLY', 'CANCELED', 'SUSPENDED', 'ARCHIVED') NOT NULL DEFAULT 'PENDING';

ALTER TABLE `clients` ADD COLUMN `canceledEndDate` DATETIME(3) NULL;
