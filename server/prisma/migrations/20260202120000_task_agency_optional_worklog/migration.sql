-- Make Task.agencyId optional so Work Log can be client-only (no agency required)
ALTER TABLE `tasks` MODIFY COLUMN `agencyId` VARCHAR(191) NULL;
