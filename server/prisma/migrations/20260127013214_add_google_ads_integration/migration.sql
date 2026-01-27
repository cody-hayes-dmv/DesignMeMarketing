/*
  Warnings:

  - You are about to drop the column `totalUsersTrend` on the `ga4_metrics` table. All the data in the column will be lost.
  - You are about to drop the column `visitorSources` on the `ga4_metrics` table. All the data in the column will be lost.
  - You are about to alter the column `role` on the `tokens` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(5))` to `VarChar(191)`.

*/
-- AlterTable
ALTER TABLE `backlink_timeseries` MODIFY `rawData` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `clients` ADD COLUMN `googleAdsAccessToken` TEXT NULL,
    ADD COLUMN `googleAdsAccountEmail` VARCHAR(191) NULL,
    ADD COLUMN `googleAdsConnectedAt` DATETIME(3) NULL,
    ADD COLUMN `googleAdsCustomerId` VARCHAR(191) NULL,
    ADD COLUMN `googleAdsRefreshToken` TEXT NULL,
    MODIFY `targets` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `ga4_metrics` DROP COLUMN `totalUsersTrend`,
    DROP COLUMN `visitorSources`,
    MODIFY `newUsersTrend` LONGTEXT NULL,
    MODIFY `activeUsersTrend` LONGTEXT NULL,
    MODIFY `engagedSessions` INTEGER NULL,
    MODIFY `totalUsers` INTEGER NULL,
    MODIFY `events` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `keywords` MODIFY `serpFeatures` LONGTEXT NULL,
    MODIFY `locationName` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `report_schedules` MODIFY `recipients` LONGTEXT NOT NULL;

-- AlterTable
ALTER TABLE `seo_reports` MODIFY `recipients` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `target_keywords` MODIFY `monthlySearches` LONGTEXT NULL,
    MODIFY `keywordInfo` LONGTEXT NULL,
    MODIFY `serpInfo` LONGTEXT NULL,
    MODIFY `serpItemTypes` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `tasks` MODIFY `proof` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `tokens` MODIFY `role` VARCHAR(191) NULL,
    MODIFY `metadata` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `top_pages` MODIFY `rawData` LONGTEXT NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `lastLoginAt` DATETIME(3) NULL,
    MODIFY `role` ENUM('SUPER_ADMIN', 'ADMIN', 'AGENCY', 'WORKER', 'USER') NOT NULL DEFAULT 'AGENCY';

-- CreateTable
CREATE TABLE `client_users` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `invitedById` VARCHAR(191) NULL,
    `clientRole` ENUM('CLIENT', 'STAFF') NOT NULL DEFAULT 'CLIENT',
    `status` ENUM('PENDING', 'ACTIVE') NOT NULL DEFAULT 'PENDING',
    `invitedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `acceptedAt` DATETIME(3) NULL,

    INDEX `client_users_clientId_idx`(`clientId`),
    INDEX `client_users_userId_idx`(`userId`),
    INDEX `client_users_invitedById_idx`(`invitedById`),
    UNIQUE INDEX `client_users_clientId_userId_key`(`clientId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `client_users` ADD CONSTRAINT `client_users_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_users` ADD CONSTRAINT `client_users_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_users` ADD CONSTRAINT `client_users_invitedById_fkey` FOREIGN KEY (`invitedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
