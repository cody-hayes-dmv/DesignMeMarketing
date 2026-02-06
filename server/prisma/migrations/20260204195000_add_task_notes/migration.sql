-- Add taskNotes (rich text / work log task field) to tasks
ALTER TABLE `tasks` ADD COLUMN `taskNotes` LONGTEXT NULL;
