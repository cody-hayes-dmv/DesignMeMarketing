-- CreateTable
CREATE TABLE `dataforseo_daily_spend` (
    `id` VARCHAR(191) NOT NULL,
    `date` VARCHAR(10) NOT NULL,
    `total` DOUBLE NOT NULL,
    `byApi` LONGTEXT NULL,

    UNIQUE INDEX `dataforseo_daily_spend_date_key`(`date`),
    INDEX `dataforseo_daily_spend_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
