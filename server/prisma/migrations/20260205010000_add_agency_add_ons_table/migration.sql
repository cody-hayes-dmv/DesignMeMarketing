-- CreateTable
CREATE TABLE `agency_add_ons` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `agencyId` VARCHAR(191) NOT NULL,
    `addOnType` VARCHAR(191) NOT NULL,
    `addOnOption` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `details` VARCHAR(500) NULL,
    `priceCents` INTEGER NOT NULL,
    `billingInterval` VARCHAR(191) NOT NULL,
    `stripeSubscriptionItemId` VARCHAR(255) NULL,

    INDEX `agency_add_ons_agencyId_idx`(`agencyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `agency_add_ons` ADD CONSTRAINT `agency_add_ons_agencyId_fkey` FOREIGN KEY (`agencyId`) REFERENCES `agencies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
