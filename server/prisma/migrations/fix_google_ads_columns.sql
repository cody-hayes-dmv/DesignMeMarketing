-- Fix: Add Google Ads columns if they don't exist
-- Run this SQL directly on your database if the columns are missing
-- MySQL doesn't support IF NOT EXISTS for ALTER TABLE, so we check first

USE seo_dashboard;

-- Add googleAdsAccessToken if it doesn't exist
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = 'seo_dashboard' 
  AND TABLE_NAME = 'clients' 
  AND COLUMN_NAME = 'googleAdsAccessToken');
SET @sql = IF(@col_exists = 0, 
  'ALTER TABLE `clients` ADD COLUMN `googleAdsAccessToken` TEXT NULL', 
  'SELECT "Column googleAdsAccessToken already exists" as message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add googleAdsRefreshToken if it doesn't exist
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = 'seo_dashboard' 
  AND TABLE_NAME = 'clients' 
  AND COLUMN_NAME = 'googleAdsRefreshToken');
SET @sql = IF(@col_exists = 0, 
  'ALTER TABLE `clients` ADD COLUMN `googleAdsRefreshToken` TEXT NULL', 
  'SELECT "Column googleAdsRefreshToken already exists" as message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add googleAdsCustomerId if it doesn't exist
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = 'seo_dashboard' 
  AND TABLE_NAME = 'clients' 
  AND COLUMN_NAME = 'googleAdsCustomerId');
SET @sql = IF(@col_exists = 0, 
  'ALTER TABLE `clients` ADD COLUMN `googleAdsCustomerId` VARCHAR(191) NULL', 
  'SELECT "Column googleAdsCustomerId already exists" as message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add googleAdsAccountEmail if it doesn't exist
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = 'seo_dashboard' 
  AND TABLE_NAME = 'clients' 
  AND COLUMN_NAME = 'googleAdsAccountEmail');
SET @sql = IF(@col_exists = 0, 
  'ALTER TABLE `clients` ADD COLUMN `googleAdsAccountEmail` VARCHAR(191) NULL', 
  'SELECT "Column googleAdsAccountEmail already exists" as message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add googleAdsConnectedAt if it doesn't exist
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = 'seo_dashboard' 
  AND TABLE_NAME = 'clients' 
  AND COLUMN_NAME = 'googleAdsConnectedAt');
SET @sql = IF(@col_exists = 0, 
  'ALTER TABLE `clients` ADD COLUMN `googleAdsConnectedAt` DATETIME(3) NULL', 
  'SELECT "Column googleAdsConnectedAt already exists" as message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Google Ads columns check complete!' as Status;
