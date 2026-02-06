-- AlterTable: allow client to stay as Dashboard Only after canceled end date instead of Archived
ALTER TABLE `clients` ADD COLUMN `keepDashboardAfterEndDate` TINYINT(1) NULL DEFAULT 0;
