-- CreateTable
CREATE TABLE IF NOT EXISTS `ai_mentions` (
  `id` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `clientId` VARCHAR(191) NOT NULL,
  `query` LONGTEXT NOT NULL,
  `platform` VARCHAR(50) NOT NULL,
  `mentions` INTEGER NOT NULL,
  `aiSearchVolume` INTEGER NOT NULL,
  `impressions` INTEGER NULL,
  `snippet` LONGTEXT NULL,
  `referencedUrl` LONGTEXT NULL,
  `mentionPosition` INTEGER NULL,
  `dateRecorded` DATE NOT NULL,

  INDEX `ai_mentions_clientId_dateRecorded_idx`(`clientId`, `dateRecorded`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `ai_competitors` (
  `id` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `clientId` VARCHAR(191) NOT NULL,
  `competitorDomain` VARCHAR(255) NOT NULL,
  `mentions` INTEGER NOT NULL,
  `aiSearchVolume` INTEGER NOT NULL,
  `platform` VARCHAR(50) NOT NULL,
  `dateRecorded` DATE NOT NULL,

  INDEX `ai_competitors_clientId_competitorDomain_dateRecorded_idx`(`clientId`, `competitorDomain`, `dateRecorded`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `ai_search_volume_trends` (
  `id` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `clientId` VARCHAR(191) NOT NULL,
  `keyword` VARCHAR(255) NOT NULL,
  `year` INTEGER NOT NULL,
  `month` INTEGER NOT NULL,
  `aiSearchVolume` INTEGER NOT NULL,
  `dateRecorded` DATE NOT NULL,

  INDEX `ai_search_volume_trends_clientId_keyword_year_month_idx`(`clientId`, `keyword`, `year`, `month`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey (idempotent)
SET @fk_exists = (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'ai_mentions'
    AND constraint_name = 'ai_mentions_clientId_fkey'
    AND constraint_type = 'FOREIGN KEY'
);
SET @sql = IF(
  @fk_exists = 0,
  'ALTER TABLE `ai_mentions` ADD CONSTRAINT `ai_mentions_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- AddForeignKey (idempotent)
SET @fk_exists = (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'ai_competitors'
    AND constraint_name = 'ai_competitors_clientId_fkey'
    AND constraint_type = 'FOREIGN KEY'
);
SET @sql = IF(
  @fk_exists = 0,
  'ALTER TABLE `ai_competitors` ADD CONSTRAINT `ai_competitors_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- AddForeignKey (idempotent)
SET @fk_exists = (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'ai_search_volume_trends'
    AND constraint_name = 'ai_search_volume_trends_clientId_fkey'
    AND constraint_type = 'FOREIGN KEY'
);
SET @sql = IF(
  @fk_exists = 0,
  'ALTER TABLE `ai_search_volume_trends` ADD CONSTRAINT `ai_search_volume_trends_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
