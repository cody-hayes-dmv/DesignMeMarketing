/*
  Warnings:

  - A unique constraint covering the columns `[clientId]` on the table `ga4_metrics` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `engagedSessions` to the `ga4_metrics` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalUsers` to the `ga4_metrics` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
SET @idx := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'ga4_metrics'
    AND index_name = 'ga4_metrics_clientId_startDate_endDate_key'
);
SET @sql := IF(
  @idx > 0,
  'DROP INDEX `ga4_metrics_clientId_startDate_endDate_key` ON `ga4_metrics`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- AlterTable
SET @has_engagedSessions := (
  SELECT COUNT(1)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'ga4_metrics'
    AND column_name = 'engagedSessions'
);
SET @sql := IF(
  @has_engagedSessions = 0,
  'ALTER TABLE `ga4_metrics` ADD COLUMN `engagedSessions` INTEGER NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_totalUsers := (
  SELECT COUNT(1)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'ga4_metrics'
    AND column_name = 'totalUsers'
);
SET @sql := IF(
  @has_totalUsers = 0,
  'ALTER TABLE `ga4_metrics` ADD COLUMN `totalUsers` INTEGER NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_totalUsersTrend := (
  SELECT COUNT(1)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'ga4_metrics'
    AND column_name = 'totalUsersTrend'
);
SET @sql := IF(
  @has_totalUsersTrend = 0,
  'ALTER TABLE `ga4_metrics` ADD COLUMN `totalUsersTrend` JSON NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- CreateIndex
SET @idx := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'ga4_metrics'
    AND index_name = 'ga4_metrics_clientId_key'
);
SET @sql := IF(
  @idx = 0,
  'CREATE UNIQUE INDEX `ga4_metrics_clientId_key` ON `ga4_metrics`(`clientId`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
