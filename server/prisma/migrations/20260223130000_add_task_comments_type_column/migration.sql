-- Backfill missing task_comments.type on databases created before the enum field existed.
-- This migration is idempotent: it only adds the column/index when absent.

-- Add `type` column if it does not exist.
SET @add_type_col_sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'task_comments'
        AND COLUMN_NAME = 'type'
    ),
    'SELECT 1',
    "ALTER TABLE `task_comments` ADD COLUMN `type` ENUM('COMMENT','QUESTION','APPROVAL_REQUEST','APPROVAL','REVISION_REQUEST') NOT NULL DEFAULT 'COMMENT' AFTER `body`"
  )
);
PREPARE add_type_col_stmt FROM @add_type_col_sql;
EXECUTE add_type_col_stmt;
DEALLOCATE PREPARE add_type_col_stmt;

-- Ensure index exists (safe if already present).
SET @add_type_idx_sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'task_comments'
        AND INDEX_NAME = 'task_comments_type_idx'
    ),
    'SELECT 1',
    'CREATE INDEX `task_comments_type_idx` ON `task_comments`(`type`)'
  )
);
PREPARE add_type_idx_stmt FROM @add_type_idx_sql;
EXECUTE add_type_idx_stmt;
DEALLOCATE PREPARE add_type_idx_stmt;
