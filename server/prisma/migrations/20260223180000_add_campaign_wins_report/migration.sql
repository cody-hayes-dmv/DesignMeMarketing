-- AlterTable
ALTER TABLE `clients`
  ADD COLUMN `campaign_wins_enabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `campaign_wins_emails` LONGTEXT NULL,
  ADD COLUMN `campaign_wins_last_sent` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `campaign_win_events` (
  `id` VARCHAR(191) NOT NULL,
  `client_id` VARCHAR(191) NOT NULL,
  `event_type` VARCHAR(191) NOT NULL,
  `event_detail` TEXT NOT NULL,
  `threshold_key` VARCHAR(255) NOT NULL,
  `triggered_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `notified_at` DATETIME(3) NULL,
  `cooldown_until` DATETIME(3) NULL,

  UNIQUE INDEX `campaign_win_events_client_id_threshold_key_key`(`client_id`, `threshold_key`),
  INDEX `campaign_win_events_client_id_notified_at_idx`(`client_id`, `notified_at`),
  INDEX `campaign_win_events_client_id_cooldown_until_idx`(`client_id`, `cooldown_until`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `campaign_win_events`
  ADD CONSTRAINT `campaign_win_events_client_id_fkey`
  FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
