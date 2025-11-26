-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `passwordHash` VARCHAR(191) NULL,
    `role` ENUM('SUPER_ADMIN', 'ADMIN', 'AGENCY', 'WORKER') NOT NULL DEFAULT 'AGENCY',
    `verified` BOOLEAN NOT NULL DEFAULT false,
    `invited` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agencies` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `subdomain` VARCHAR(191) NULL,

    UNIQUE INDEX `agencies_subdomain_key`(`subdomain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_agencies` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `agencyId` VARCHAR(191) NOT NULL,
    `agencyRole` ENUM('WORKER', 'MANAGER', 'OWNER') NOT NULL DEFAULT 'WORKER',

    INDEX `user_agencies_agencyId_idx`(`agencyId`),
    INDEX `user_agencies_userId_idx`(`userId`),
    UNIQUE INDEX `user_agencies_userId_agencyId_key`(`userId`, `agencyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tasks` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `category` VARCHAR(191) NULL,
    `dueDate` DATETIME(3) NULL,
    `status` ENUM('TODO', 'IN_PROGRESS', 'REVIEW', 'DONE') NOT NULL DEFAULT 'TODO',
    `priority` VARCHAR(191) NULL,
    `estimatedHours` INTEGER NULL,
    `proof` JSON NULL,
    `agencyId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `assigneeId` VARCHAR(191) NULL,
    `clientId` VARCHAR(191) NULL,

    INDEX `tasks_agencyId_status_idx`(`agencyId`, `status`),
    INDEX `tasks_assigneeId_idx`(`assigneeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tokens` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `usedAt` DATETIME(3) NULL,
    `type` ENUM('EMAIL_VERIFY', 'INVITE', 'MAGIC_LOGIN') NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `token` VARCHAR(500) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `agencyId` VARCHAR(191) NULL,
    `role` ENUM('SUPER_ADMIN', 'ADMIN', 'AGENCY', 'WORKER') NULL,
    `metadata` JSON NULL,

    UNIQUE INDEX `tokens_token_key`(`token`),
    INDEX `tokens_type_email_idx`(`type`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `clients` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `domain` VARCHAR(191) NOT NULL,
    `industry` VARCHAR(191) NULL,
    `targets` JSON NULL,
    `status` ENUM('ACTIVE', 'PENDING', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `loginUrl` VARCHAR(191) NULL,
    `username` VARCHAR(191) NULL,
    `password` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `ga4AccessToken` VARCHAR(191) NULL,
    `ga4RefreshToken` VARCHAR(191) NULL,
    `ga4PropertyId` VARCHAR(191) NULL,
    `ga4AccountEmail` VARCHAR(191) NULL,
    `ga4ConnectedAt` DATETIME(3) NULL,
    `userId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `clients_name_key`(`name`),
    UNIQUE INDEX `clients_domain_key`(`domain`),
    INDEX `clients_name_domain_idx`(`name`, `domain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seo_reports` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `reportDate` DATETIME(3) NOT NULL,
    `period` VARCHAR(191) NOT NULL,
    `totalSessions` INTEGER NOT NULL,
    `organicSessions` INTEGER NOT NULL,
    `paidSessions` INTEGER NOT NULL,
    `directSessions` INTEGER NOT NULL,
    `referralSessions` INTEGER NOT NULL,
    `totalClicks` INTEGER NOT NULL,
    `totalImpressions` INTEGER NOT NULL,
    `averageCtr` DOUBLE NOT NULL,
    `averagePosition` DOUBLE NOT NULL,
    `bounceRate` DOUBLE NOT NULL,
    `avgSessionDuration` DOUBLE NOT NULL,
    `pagesPerSession` DOUBLE NOT NULL,
    `conversions` INTEGER NOT NULL,
    `conversionRate` DOUBLE NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,

    INDEX `seo_reports_clientId_reportDate_idx`(`clientId`, `reportDate`),
    UNIQUE INDEX `seo_reports_clientId_reportDate_period_key`(`clientId`, `reportDate`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `keywords` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `keyword` VARCHAR(191) NOT NULL,
    `searchVolume` INTEGER NOT NULL,
    `difficulty` DOUBLE NULL,
    `cpc` DOUBLE NULL,
    `competition` VARCHAR(191) NULL,
    `currentPosition` INTEGER NULL,
    `previousPosition` INTEGER NULL,
    `bestPosition` INTEGER NULL,
    `googleUrl` VARCHAR(191) NULL,
    `serpFeatures` JSON NULL,
    `totalResults` INTEGER NULL,
    `clicks` INTEGER NOT NULL DEFAULT 0,
    `impressions` INTEGER NOT NULL DEFAULT 0,
    `ctr` DOUBLE NOT NULL DEFAULT 0,
    `clientId` VARCHAR(191) NOT NULL,

    INDEX `keywords_clientId_currentPosition_idx`(`clientId`, `currentPosition`),
    UNIQUE INDEX `keywords_clientId_keyword_key`(`clientId`, `keyword`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ranked_keywords_history` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `totalKeywords` INTEGER NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `month` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,

    INDEX `ranked_keywords_history_clientId_year_month_idx`(`clientId`, `year`, `month`),
    UNIQUE INDEX `ranked_keywords_history_clientId_month_year_key`(`clientId`, `month`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `backlinks` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `sourceUrl` VARCHAR(191) NOT NULL,
    `targetUrl` VARCHAR(191) NOT NULL,
    `anchorText` VARCHAR(191) NULL,
    `domainRating` DOUBLE NULL,
    `urlRating` DOUBLE NULL,
    `traffic` INTEGER NULL,
    `isFollow` BOOLEAN NOT NULL DEFAULT true,
    `isLost` BOOLEAN NOT NULL DEFAULT false,
    `firstSeen` DATETIME(3) NULL,
    `lastSeen` DATETIME(3) NULL,
    `clientId` VARCHAR(191) NOT NULL,

    INDEX `backlinks_clientId_isLost_idx`(`clientId`, `isLost`),
    INDEX `backlinks_clientId_domainRating_idx`(`clientId`, `domainRating`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `onboarding_templates` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `agencyId` VARCHAR(191) NOT NULL,

    INDEX `onboarding_templates_agencyId_idx`(`agencyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `onboarding_tasks` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `category` VARCHAR(191) NULL,
    `priority` VARCHAR(191) NULL,
    `estimatedHours` INTEGER NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `templateId` VARCHAR(191) NOT NULL,

    INDEX `onboarding_tasks_templateId_order_idx`(`templateId`, `order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `top_pages` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `organicPos1` INTEGER NOT NULL DEFAULT 0,
    `organicPos2_3` INTEGER NOT NULL DEFAULT 0,
    `organicPos4_10` INTEGER NOT NULL DEFAULT 0,
    `organicCount` INTEGER NOT NULL DEFAULT 0,
    `organicEtv` DOUBLE NOT NULL DEFAULT 0,
    `organicIsNew` INTEGER NOT NULL DEFAULT 0,
    `organicIsUp` INTEGER NOT NULL DEFAULT 0,
    `organicIsDown` INTEGER NOT NULL DEFAULT 0,
    `organicIsLost` INTEGER NOT NULL DEFAULT 0,
    `paidCount` INTEGER NOT NULL DEFAULT 0,
    `paidEtv` DOUBLE NOT NULL DEFAULT 0,
    `rawData` JSON NULL,
    `clientId` VARCHAR(191) NOT NULL,

    INDEX `top_pages_clientId_organicEtv_idx`(`clientId`, `organicEtv`),
    UNIQUE INDEX `top_pages_clientId_url_key`(`clientId`, `url`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `traffic_sources` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `value` DOUBLE NOT NULL DEFAULT 0,
    `totalKeywords` INTEGER NOT NULL DEFAULT 0,
    `totalEstimatedTraffic` DOUBLE NOT NULL DEFAULT 0,
    `organicEstimatedTraffic` DOUBLE NOT NULL DEFAULT 0,
    `averageRank` DOUBLE NULL,
    `rankSampleSize` INTEGER NOT NULL DEFAULT 0,
    `clientId` VARCHAR(191) NOT NULL,

    INDEX `traffic_sources_clientId_idx`(`clientId`),
    UNIQUE INDEX `traffic_sources_clientId_name_key`(`clientId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `backlink_timeseries` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `newBacklinks` INTEGER NOT NULL DEFAULT 0,
    `lostBacklinks` INTEGER NOT NULL DEFAULT 0,
    `newReferringDomains` INTEGER NOT NULL DEFAULT 0,
    `lostReferringDomains` INTEGER NOT NULL DEFAULT 0,
    `newReferringMainDomains` INTEGER NOT NULL DEFAULT 0,
    `lostReferringMainDomains` INTEGER NOT NULL DEFAULT 0,
    `rawData` JSON NULL,
    `clientId` VARCHAR(191) NOT NULL,

    INDEX `backlink_timeseries_clientId_date_idx`(`clientId`, `date`),
    UNIQUE INDEX `backlink_timeseries_clientId_date_key`(`clientId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `target_keywords` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `keyword` VARCHAR(191) NOT NULL,
    `searchVolume` INTEGER NULL,
    `cpc` DOUBLE NULL,
    `competition` VARCHAR(191) NULL,
    `competitionValue` DOUBLE NULL,
    `monthlySearches` JSON NULL,
    `keywordInfo` JSON NULL,
    `locationCode` INTEGER NULL,
    `locationName` VARCHAR(191) NULL,
    `languageCode` VARCHAR(191) NULL,
    `languageName` VARCHAR(191) NULL,
    `serpInfo` JSON NULL,
    `serpItemTypes` JSON NULL,
    `googleUrl` VARCHAR(191) NULL,
    `googlePosition` INTEGER NULL,
    `previousPosition` INTEGER NULL,
    `seResultsCount` VARCHAR(191) NULL,
    `clientId` VARCHAR(191) NOT NULL,

    INDEX `target_keywords_clientId_searchVolume_idx`(`clientId`, `searchVolume`),
    INDEX `target_keywords_clientId_googlePosition_idx`(`clientId`, `googlePosition`),
    UNIQUE INDEX `target_keywords_clientId_keyword_key`(`clientId`, `keyword`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_agencies` ADD CONSTRAINT `user_agencies_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_agencies` ADD CONSTRAINT `user_agencies_agencyId_fkey` FOREIGN KEY (`agencyId`) REFERENCES `agencies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_agencyId_fkey` FOREIGN KEY (`agencyId`) REFERENCES `agencies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_assigneeId_fkey` FOREIGN KEY (`assigneeId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tokens` ADD CONSTRAINT `tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tokens` ADD CONSTRAINT `tokens_agencyId_fkey` FOREIGN KEY (`agencyId`) REFERENCES `agencies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `clients` ADD CONSTRAINT `clients_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seo_reports` ADD CONSTRAINT `seo_reports_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `keywords` ADD CONSTRAINT `keywords_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ranked_keywords_history` ADD CONSTRAINT `ranked_keywords_history_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `backlinks` ADD CONSTRAINT `backlinks_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `onboarding_templates` ADD CONSTRAINT `onboarding_templates_agencyId_fkey` FOREIGN KEY (`agencyId`) REFERENCES `agencies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `onboarding_tasks` ADD CONSTRAINT `onboarding_tasks_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `onboarding_templates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `top_pages` ADD CONSTRAINT `top_pages_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `traffic_sources` ADD CONSTRAINT `traffic_sources_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `backlink_timeseries` ADD CONSTRAINT `backlink_timeseries_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `target_keywords` ADD CONSTRAINT `target_keywords_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
