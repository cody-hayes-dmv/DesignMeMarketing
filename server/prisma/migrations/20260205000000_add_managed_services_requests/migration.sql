-- CreateTable
CREATE TABLE `managed_services_requests` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `agencyId` VARCHAR(191) NOT NULL,
    `agencyName` VARCHAR(255) NOT NULL,
    `agencyEmail` VARCHAR(255) NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `clientName` VARCHAR(255) NOT NULL,
    `packageId` VARCHAR(80) NOT NULL,
    `packageName` VARCHAR(255) NOT NULL,
    `monthlyPriceCents` INTEGER NOT NULL,
    `startDate` DATE NOT NULL,
    `managedServiceId` VARCHAR(191) NULL,

    INDEX `managed_services_requests_agencyId_idx`(`agencyId`),
    INDEX `managed_services_requests_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
