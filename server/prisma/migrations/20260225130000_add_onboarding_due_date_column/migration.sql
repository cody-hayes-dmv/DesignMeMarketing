-- Add missing onboarding task due date column for schema parity.
-- This is defensive so environments that already patched the column do not fail migration.
SET @db_name := DATABASE();
SET @has_due_date := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'onboarding_tasks'
    AND COLUMN_NAME = 'dueDate'
);

SET @ddl := IF(
  @has_due_date = 0,
  'ALTER TABLE `onboarding_tasks` ADD COLUMN `dueDate` DATETIME(3) NULL',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
