-- AlterTable (safe if columns already exist)
ALTER TABLE `target_keywords`
    ADD COLUMN IF NOT EXISTS `googlePosition` INTEGER NULL,
    ADD COLUMN IF NOT EXISTS `googleUrl` VARCHAR(191) NULL,
    ADD COLUMN IF NOT EXISTS `languageCode` VARCHAR(191) NULL,
    ADD COLUMN IF NOT EXISTS `languageName` VARCHAR(191) NULL,
    ADD COLUMN IF NOT EXISTS `locationCode` INTEGER NULL,
    ADD COLUMN IF NOT EXISTS `locationName` VARCHAR(191) NULL,
    ADD COLUMN IF NOT EXISTS `previousPosition` INTEGER NULL,
    ADD COLUMN IF NOT EXISTS `seResultsCount` VARCHAR(191) NULL,
    ADD COLUMN IF NOT EXISTS `serpInfo` JSON NULL,
    ADD COLUMN IF NOT EXISTS `serpItemTypes` JSON NULL;

-- CreateIndex (make it safe too)
-- CREATE INDEX `target_keywords_clientId_googlePosition_idx` ON `target_keywords`(`clientId`, `googlePosition`);
