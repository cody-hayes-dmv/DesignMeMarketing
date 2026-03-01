-- AlterTable
ALTER TABLE `agencies`
  ADD COLUMN `snapshotMonthlyAllowance` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `snapshotMonthlyUsed` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `snapshotMonthlyResetAt` DATETIME(3) NULL,
  ADD COLUMN `snapshotPurchasedCredits` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `grid_keywords` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `agencyId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `keywordId` VARCHAR(191) NOT NULL,
    `keywordText` VARCHAR(255) NOT NULL,
    `placeId` VARCHAR(255) NOT NULL,
    `businessName` VARCHAR(255) NOT NULL,
    `businessAddress` VARCHAR(500) NULL,
    `centerLat` DECIMAL(10, 7) NOT NULL,
    `centerLng` DECIMAL(10, 7) NOT NULL,
    `locationLabel` VARCHAR(255) NULL,
    `gridSize` INTEGER NOT NULL DEFAULT 7,
    `gridSpacingMiles` DECIMAL(6, 2) NOT NULL DEFAULT 0.5,
    `status` ENUM('active', 'paused', 'canceled') NOT NULL DEFAULT 'active',
    `nextRunAt` DATETIME(3) NULL,
    `lastRunAt` DATETIME(3) NULL,

    UNIQUE INDEX `grid_keywords_clientId_keywordId_placeId_key`(`clientId`, `keywordId`, `placeId`),
    INDEX `grid_keywords_agencyId_status_idx`(`agencyId`, `status`),
    INDEX `grid_keywords_clientId_status_idx`(`clientId`, `status`),
    INDEX `grid_keywords_nextRunAt_status_idx`(`nextRunAt`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `grid_snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `gridKeywordId` VARCHAR(191) NOT NULL,
    `runDate` DATETIME(3) NOT NULL,
    `gridData` LONGTEXT NOT NULL,
    `ataScore` DOUBLE NOT NULL,
    `isBenchmark` BOOLEAN NOT NULL DEFAULT false,

    INDEX `grid_snapshots_gridKeywordId_runDate_idx`(`gridKeywordId`, `runDate`),
    INDEX `grid_snapshots_runDate_idx`(`runDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `on_demand_snapshot_logs` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `agencyId` VARCHAR(191) NULL,
    `clientId` VARCHAR(191) NULL,
    `runByUserId` VARCHAR(191) NULL,
    `keywordText` VARCHAR(255) NOT NULL,
    `placeId` VARCHAR(255) NOT NULL,
    `businessName` VARCHAR(255) NOT NULL,
    `businessAddress` VARCHAR(500) NULL,
    `centerLat` DECIMAL(10, 7) NOT NULL,
    `centerLng` DECIMAL(10, 7) NOT NULL,
    `gridData` LONGTEXT NOT NULL,
    `ataScore` DOUBLE NOT NULL,
    `creditSource` ENUM('monthly_allowance', 'purchased_credits', 'super_admin') NOT NULL,

    INDEX `on_demand_snapshot_logs_agencyId_createdAt_idx`(`agencyId`, `createdAt`),
    INDEX `on_demand_snapshot_logs_runByUserId_createdAt_idx`(`runByUserId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `grid_keywords` ADD CONSTRAINT `grid_keywords_agencyId_fkey` FOREIGN KEY (`agencyId`) REFERENCES `agencies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `grid_keywords` ADD CONSTRAINT `grid_keywords_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `grid_keywords` ADD CONSTRAINT `grid_keywords_keywordId_fkey` FOREIGN KEY (`keywordId`) REFERENCES `keywords`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `grid_snapshots` ADD CONSTRAINT `grid_snapshots_gridKeywordId_fkey` FOREIGN KEY (`gridKeywordId`) REFERENCES `grid_keywords`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `on_demand_snapshot_logs` ADD CONSTRAINT `on_demand_snapshot_logs_agencyId_fkey` FOREIGN KEY (`agencyId`) REFERENCES `agencies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `on_demand_snapshot_logs` ADD CONSTRAINT `on_demand_snapshot_logs_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `on_demand_snapshot_logs` ADD CONSTRAINT `on_demand_snapshot_logs_runByUserId_fkey` FOREIGN KEY (`runByUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
