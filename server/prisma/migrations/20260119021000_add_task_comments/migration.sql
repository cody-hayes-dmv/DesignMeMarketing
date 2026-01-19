-- Add task comments

CREATE TABLE IF NOT EXISTS `task_comments` (
  `id` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `body` LONGTEXT NOT NULL,
  `taskId` VARCHAR(191) NOT NULL,
  `authorId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `task_comments_taskId_createdAt_idx` (`taskId`, `createdAt`),
  KEY `task_comments_authorId_idx` (`authorId`),
  CONSTRAINT `task_comments_taskId_fkey`
    FOREIGN KEY (`taskId`) REFERENCES `tasks` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `task_comments_authorId_fkey`
    FOREIGN KEY (`authorId`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

