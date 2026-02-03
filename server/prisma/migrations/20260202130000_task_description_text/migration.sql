-- Allow long work log descriptions (was VARCHAR(191))
ALTER TABLE `tasks` MODIFY COLUMN `description` TEXT NULL;
