-- Add locationName to tracked keywords
SET @has_locationName := (
  SELECT COUNT(1)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'keywords'
    AND column_name = 'locationName'
);
SET @sql := IF(
  @has_locationName = 0,
  'ALTER TABLE `keywords` ADD COLUMN `locationName` VARCHAR(191) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


