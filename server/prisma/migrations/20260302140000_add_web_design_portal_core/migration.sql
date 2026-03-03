-- Alter Role enum for users
ALTER TABLE `users`
  MODIFY COLUMN `role` ENUM('SUPER_ADMIN', 'ADMIN', 'AGENCY', 'DESIGNER', 'SPECIALIST', 'USER') NOT NULL DEFAULT 'AGENCY';

-- CreateTable
CREATE TABLE `web_design_projects` (
  `id` VARCHAR(191) NOT NULL,
  `project_name` VARCHAR(191) NOT NULL,
  `client_id` VARCHAR(191) NOT NULL,
  `activated_by_id` VARCHAR(191) NOT NULL,
  `agency_id` VARCHAR(191) NULL,
  `designer_id` VARCHAR(191) NOT NULL,
  `status` ENUM('active', 'complete') NOT NULL DEFAULT 'active',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` DATETIME(3) NULL,

  INDEX `web_design_projects_client_id_idx`(`client_id`),
  INDEX `web_design_projects_agency_id_status_idx`(`agency_id`, `status`),
  INDEX `web_design_projects_designer_id_status_idx`(`designer_id`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `web_design_pages` (
  `id` VARCHAR(191) NOT NULL,
  `project_id` VARCHAR(191) NOT NULL,
  `page_name` VARCHAR(191) NOT NULL,
  `status` ENUM('pending_upload', 'needs_review', 'revision_requested', 'approved') NOT NULL DEFAULT 'pending_upload',
  `approved_at` DATETIME(3) NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `figma_link` VARCHAR(2048) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `web_design_pages_project_id_sort_order_idx`(`project_id`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `web_design_page_versions` (
  `id` VARCHAR(191) NOT NULL,
  `page_id` VARCHAR(191) NOT NULL,
  `version_number` INTEGER NOT NULL,
  `file_url` VARCHAR(2048) NOT NULL,
  `uploaded_by_id` VARCHAR(191) NOT NULL,
  `uploaded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `web_design_page_versions_page_id_version_number_key`(`page_id`, `version_number`),
  INDEX `web_design_page_versions_page_id_uploaded_at_idx`(`page_id`, `uploaded_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `web_design_comments` (
  `id` VARCHAR(191) NOT NULL,
  `page_id` VARCHAR(191) NOT NULL,
  `parent_id` VARCHAR(191) NULL,
  `author_id` VARCHAR(191) NOT NULL,
  `author_role` ENUM('client', 'designer', 'admin') NOT NULL,
  `message` TEXT NOT NULL,
  `actionTaken` ENUM('revision_requested', 'approved') NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `web_design_comments_page_id_created_at_idx`(`page_id`, `created_at`),
  INDEX `web_design_comments_parent_id_idx`(`parent_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `web_design_projects` ADD CONSTRAINT `web_design_projects_client_id_fkey`
FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `web_design_projects` ADD CONSTRAINT `web_design_projects_activated_by_id_fkey`
FOREIGN KEY (`activated_by_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `web_design_projects` ADD CONSTRAINT `web_design_projects_agency_id_fkey`
FOREIGN KEY (`agency_id`) REFERENCES `agencies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `web_design_projects` ADD CONSTRAINT `web_design_projects_designer_id_fkey`
FOREIGN KEY (`designer_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `web_design_pages` ADD CONSTRAINT `web_design_pages_project_id_fkey`
FOREIGN KEY (`project_id`) REFERENCES `web_design_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `web_design_page_versions` ADD CONSTRAINT `web_design_page_versions_page_id_fkey`
FOREIGN KEY (`page_id`) REFERENCES `web_design_pages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `web_design_page_versions` ADD CONSTRAINT `web_design_page_versions_uploaded_by_id_fkey`
FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `web_design_comments` ADD CONSTRAINT `web_design_comments_page_id_fkey`
FOREIGN KEY (`page_id`) REFERENCES `web_design_pages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `web_design_comments` ADD CONSTRAINT `web_design_comments_parent_id_fkey`
FOREIGN KEY (`parent_id`) REFERENCES `web_design_comments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `web_design_comments` ADD CONSTRAINT `web_design_comments_author_id_fkey`
FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
