-- Add AI Search SERP cache table for throttled DataForSEO calls

CREATE TABLE IF NOT EXISTS `ai_search_serp_cache` (
  `id` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `fetchedAt` DATETIME(3) NOT NULL,
  `checkedKeywords` INT NOT NULL DEFAULT 0,
  `aiOverviewCitedPages` INT NOT NULL DEFAULT 0,
  `aiModeCitedPages` INT NOT NULL DEFAULT 0,
  `aiOverviewCitedUrls` LONGTEXT NULL,
  `aiModeCitedUrls` LONGTEXT NULL,
  `clientId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ai_search_serp_cache_clientId_key` (`clientId`),
  KEY `ai_search_serp_cache_clientId_updatedAt_idx` (`clientId`, `updatedAt`),
  CONSTRAINT `ai_search_serp_cache_clientId_fkey`
    FOREIGN KEY (`clientId`) REFERENCES `clients` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

