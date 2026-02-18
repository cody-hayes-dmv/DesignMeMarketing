-- CreateTable (IF NOT EXISTS for idempotency when table was created outside migrations)
CREATE TABLE IF NOT EXISTS `client_agency_included` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `agencyId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `client_agency_included_clientId_agencyId_key`(`clientId`, `agencyId`),
    INDEX `client_agency_included_agencyId_idx`(`agencyId`),
    INDEX `client_agency_included_clientId_idx`(`clientId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `client_agency_included_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `client_agency_included_agencyId_fkey` FOREIGN KEY (`agencyId`) REFERENCES `agencies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
