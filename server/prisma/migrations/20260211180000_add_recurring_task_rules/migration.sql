-- CreateTable
CREATE TABLE `recurring_task_rules` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `agencyId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `category` VARCHAR(191) NULL,
    `priority` VARCHAR(191) NULL,
    `estimatedHours` INTEGER NULL,
    `assigneeId` VARCHAR(191) NULL,
    `clientId` VARCHAR(191) NULL,
    `frequency` VARCHAR(191) NOT NULL,
    `dayOfWeek` INTEGER NULL,
    `dayOfMonth` INTEGER NULL,
    `nextRunAt` DATETIME(3) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    INDEX `recurring_task_rules_agencyId_idx`(`agencyId`),
    INDEX `recurring_task_rules_nextRunAt_isActive_idx`(`nextRunAt`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `recurring_task_rules` ADD CONSTRAINT `recurring_task_rules_agencyId_fkey` FOREIGN KEY (`agencyId`) REFERENCES `agencies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recurring_task_rules` ADD CONSTRAINT `recurring_task_rules_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
