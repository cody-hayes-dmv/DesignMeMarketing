-- CreateTable
CREATE TABLE `campaign_win_keyword_states` (
  `id` VARCHAR(191) NOT NULL,
  `client_id` VARCHAR(191) NOT NULL,
  `keyword_id` VARCHAR(191) NOT NULL,
  `level` VARCHAR(191) NOT NULL,
  `is_above` BOOLEAN NOT NULL DEFAULT false,
  `above_streak` INTEGER NOT NULL DEFAULT 0,
  `below_streak` INTEGER NOT NULL DEFAULT 0,
  `last_evaluated_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `campaign_win_keyword_states_client_id_keyword_id_level_key`(`client_id`, `keyword_id`, `level`),
  INDEX `campaign_win_keyword_states_client_id_level_idx`(`client_id`, `level`),
  INDEX `campaign_win_keyword_states_keyword_id_idx`(`keyword_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `campaign_win_keyword_states`
  ADD CONSTRAINT `campaign_win_keyword_states_client_id_fkey`
  FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campaign_win_keyword_states`
  ADD CONSTRAINT `campaign_win_keyword_states_keyword_id_fkey`
  FOREIGN KEY (`keyword_id`) REFERENCES `keywords`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
