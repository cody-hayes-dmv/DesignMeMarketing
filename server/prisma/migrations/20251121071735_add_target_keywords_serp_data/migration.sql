-- AlterTable
ALTER TABLE `target_keywords` ADD COLUMN `googlePosition` INTEGER NULL,
    ADD COLUMN `googleUrl` VARCHAR(191) NULL,
    ADD COLUMN `languageCode` VARCHAR(191) NULL,
    ADD COLUMN `languageName` VARCHAR(191) NULL,
    ADD COLUMN `locationCode` INTEGER NULL,
    ADD COLUMN `locationName` VARCHAR(191) NULL,
    ADD COLUMN `previousPosition` INTEGER NULL,
    ADD COLUMN `seResultsCount` VARCHAR(191) NULL,
    ADD COLUMN `serpInfo` JSON NULL,
    ADD COLUMN `serpItemTypes` JSON NULL;

-- CreateIndex
CREATE INDEX `target_keywords_clientId_googlePosition_idx` ON `target_keywords`(`clientId`, `googlePosition`);
