-- CreateTable
CREATE TABLE `ga4_metrics` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `activeUsers` INTEGER NOT NULL,
    `eventCount` INTEGER NOT NULL,
    `newUsers` INTEGER NOT NULL,
    `keyEvents` INTEGER NOT NULL,
    `totalSessions` INTEGER NOT NULL,
    `organicSessions` INTEGER NOT NULL,
    `directSessions` INTEGER NOT NULL,
    `referralSessions` INTEGER NOT NULL,
    `paidSessions` INTEGER NOT NULL,
    `bounceRate` DOUBLE NOT NULL,
    `avgSessionDuration` DOUBLE NOT NULL,
    `pagesPerSession` DOUBLE NOT NULL,
    `conversions` INTEGER NOT NULL,
    `conversionRate` DOUBLE NOT NULL,
    `newUsersTrend` JSON NULL,
    `activeUsersTrend` JSON NULL,
    `events` JSON NULL,
    `clientId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `ga4_metrics_clientId_startDate_endDate_key`(`clientId`, `startDate`, `endDate`),
    INDEX `ga4_metrics_clientId_endDate_idx`(`clientId`, `endDate`),
    INDEX `ga4_metrics_clientId_createdAt_idx`(`clientId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ga4_metrics` ADD CONSTRAINT `ga4_metrics_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

