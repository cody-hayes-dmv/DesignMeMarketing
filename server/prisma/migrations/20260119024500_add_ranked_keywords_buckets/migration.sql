-- Add rank-range bucket columns to ranked_keywords_history

SET @has_top3 := (
  SELECT COUNT(1)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'ranked_keywords_history'
    AND column_name = 'top3'
);
SET @sql := IF(
  @has_top3 = 0,
  'ALTER TABLE `ranked_keywords_history` ADD COLUMN `top3` INTEGER NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_top10 := (
  SELECT COUNT(1)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'ranked_keywords_history'
    AND column_name = 'top10'
);
SET @sql := IF(
  @has_top10 = 0,
  'ALTER TABLE `ranked_keywords_history` ADD COLUMN `top10` INTEGER NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_page2 := (
  SELECT COUNT(1)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'ranked_keywords_history'
    AND column_name = 'page2'
);
SET @sql := IF(
  @has_page2 = 0,
  'ALTER TABLE `ranked_keywords_history` ADD COLUMN `page2` INTEGER NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_pos21_30 := (
  SELECT COUNT(1)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'ranked_keywords_history'
    AND column_name = 'pos21_30'
);
SET @sql := IF(
  @has_pos21_30 = 0,
  'ALTER TABLE `ranked_keywords_history` ADD COLUMN `pos21_30` INTEGER NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_pos31_50 := (
  SELECT COUNT(1)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'ranked_keywords_history'
    AND column_name = 'pos31_50'
);
SET @sql := IF(
  @has_pos31_50 = 0,
  'ALTER TABLE `ranked_keywords_history` ADD COLUMN `pos31_50` INTEGER NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_pos51Plus := (
  SELECT COUNT(1)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'ranked_keywords_history'
    AND column_name = 'pos51Plus'
);
SET @sql := IF(
  @has_pos51Plus = 0,
  'ALTER TABLE `ranked_keywords_history` ADD COLUMN `pos51Plus` INTEGER NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

