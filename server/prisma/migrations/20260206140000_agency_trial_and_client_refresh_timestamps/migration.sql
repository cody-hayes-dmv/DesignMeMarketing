-- AlterTable (Agency: trial)
ALTER TABLE `agencies` ADD COLUMN `trialEndsAt` DATETIME(3) NULL;

-- AlterTable (Client: refresh throttles)
ALTER TABLE `clients` ADD COLUMN `lastRankRefreshAt` DATETIME(3) NULL,
    ADD COLUMN `lastAiRefreshAt` DATETIME(3) NULL;
