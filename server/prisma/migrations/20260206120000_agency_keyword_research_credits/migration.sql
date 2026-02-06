-- AlterTable
ALTER TABLE `agencies` ADD COLUMN `keywordResearchCreditsUsed` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `keywordResearchCreditsResetAt` DATETIME(3) NULL;
