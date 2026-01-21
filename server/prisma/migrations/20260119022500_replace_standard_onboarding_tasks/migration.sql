-- Replace the default "Standard SEO Onboarding" template task structure
-- Applies to any template with name = 'Standard SEO Onboarding'

SET @now := NOW(3);

DELETE FROM `onboarding_tasks`
WHERE `templateId` IN (
  SELECT `id` FROM `onboarding_templates` WHERE `name` = 'Standard SEO Onboarding'
);

-- Insert new task structure (one set per matching template)
INSERT INTO `onboarding_tasks` (`id`, `createdAt`, `updatedAt`, `title`, `description`, `category`, `priority`, `estimatedHours`, `order`, `templateId`)
SELECT UUID(), @now, @now, 'Collect logins', NULL, 'Onboarding', 'high', 1, 1, t.`id`
FROM `onboarding_templates` t WHERE t.`name` = 'Standard SEO Onboarding';

INSERT INTO `onboarding_tasks` (`id`, `createdAt`, `updatedAt`, `title`, `description`, `category`, `priority`, `estimatedHours`, `order`, `templateId`)
SELECT UUID(), @now, @now, 'Set up GHL', NULL, 'Onboarding', 'high', 1, 2, t.`id`
FROM `onboarding_templates` t WHERE t.`name` = 'Standard SEO Onboarding';

INSERT INTO `onboarding_tasks` (`id`, `createdAt`, `updatedAt`, `title`, `description`, `category`, `priority`, `estimatedHours`, `order`, `templateId`)
SELECT UUID(), @now, @now, 'Set up clawed project', NULL, 'Onboarding', 'high', 1, 3, t.`id`
FROM `onboarding_templates` t WHERE t.`name` = 'Standard SEO Onboarding';

INSERT INTO `onboarding_tasks` (`id`, `createdAt`, `updatedAt`, `title`, `description`, `category`, `priority`, `estimatedHours`, `order`, `templateId`)
SELECT UUID(), @now, @now, 'Master input', NULL, 'Onboarding', 'high', 1, 4, t.`id`
FROM `onboarding_templates` t WHERE t.`name` = 'Standard SEO Onboarding';

INSERT INTO `onboarding_tasks` (`id`, `createdAt`, `updatedAt`, `title`, `description`, `category`, `priority`, `estimatedHours`, `order`, `templateId`)
SELECT UUID(), @now, @now, 'Keyword and map pack research', NULL, 'Research', 'high', 1, 5, t.`id`
FROM `onboarding_templates` t WHERE t.`name` = 'Standard SEO Onboarding';

INSERT INTO `onboarding_tasks` (`id`, `createdAt`, `updatedAt`, `title`, `description`, `category`, `priority`, `estimatedHours`, `order`, `templateId`)
SELECT UUID(), @now, @now, 'Technical audit', NULL, 'Technical SEO', 'high', 1, 6, t.`id`
FROM `onboarding_templates` t WHERE t.`name` = 'Standard SEO Onboarding';

INSERT INTO `onboarding_tasks` (`id`, `createdAt`, `updatedAt`, `title`, `description`, `category`, `priority`, `estimatedHours`, `order`, `templateId`)
SELECT UUID(), @now, @now, 'GBP categories research', NULL, 'GBP', 'medium', 1, 7, t.`id`
FROM `onboarding_templates` t WHERE t.`name` = 'Standard SEO Onboarding';

INSERT INTO `onboarding_tasks` (`id`, `createdAt`, `updatedAt`, `title`, `description`, `category`, `priority`, `estimatedHours`, `order`, `templateId`)
SELECT UUID(), @now, @now, 'GBP services research', NULL, 'GBP', 'medium', 1, 8, t.`id`
FROM `onboarding_templates` t WHERE t.`name` = 'Standard SEO Onboarding';

INSERT INTO `onboarding_tasks` (`id`, `createdAt`, `updatedAt`, `title`, `description`, `category`, `priority`, `estimatedHours`, `order`, `templateId`)
SELECT UUID(), @now, @now, 'Create avatar', NULL, 'Strategy', 'medium', 1, 9, t.`id`
FROM `onboarding_templates` t WHERE t.`name` = 'Standard SEO Onboarding';

INSERT INTO `onboarding_tasks` (`id`, `createdAt`, `updatedAt`, `title`, `description`, `category`, `priority`, `estimatedHours`, `order`, `templateId`)
SELECT UUID(), @now, @now, 'Keyword research', NULL, 'Research', 'high', 1, 10, t.`id`
FROM `onboarding_templates` t WHERE t.`name` = 'Standard SEO Onboarding';

INSERT INTO `onboarding_tasks` (`id`, `createdAt`, `updatedAt`, `title`, `description`, `category`, `priority`, `estimatedHours`, `order`, `templateId`)
SELECT UUID(), @now, @now, 'SEO content gap analysis', NULL, 'Research', 'medium', 1, 11, t.`id`
FROM `onboarding_templates` t WHERE t.`name` = 'Standard SEO Onboarding';

INSERT INTO `onboarding_tasks` (`id`, `createdAt`, `updatedAt`, `title`, `description`, `category`, `priority`, `estimatedHours`, `order`, `templateId`)
SELECT UUID(), @now, @now, 'Site hierarchy', NULL, 'Architecture', 'medium', 1, 12, t.`id`
FROM `onboarding_templates` t WHERE t.`name` = 'Standard SEO Onboarding';

INSERT INTO `onboarding_tasks` (`id`, `createdAt`, `updatedAt`, `title`, `description`, `category`, `priority`, `estimatedHours`, `order`, `templateId`)
SELECT UUID(), @now, @now, 'Internal linking structure', NULL, 'Architecture', 'medium', 1, 13, t.`id`
FROM `onboarding_templates` t WHERE t.`name` = 'Standard SEO Onboarding';

INSERT INTO `onboarding_tasks` (`id`, `createdAt`, `updatedAt`, `title`, `description`, `category`, `priority`, `estimatedHours`, `order`, `templateId`)
SELECT UUID(), @now, @now, 'SEO silo architecture', NULL, 'Architecture', 'medium', 1, 14, t.`id`
FROM `onboarding_templates` t WHERE t.`name` = 'Standard SEO Onboarding';

INSERT INTO `onboarding_tasks` (`id`, `createdAt`, `updatedAt`, `title`, `description`, `category`, `priority`, `estimatedHours`, `order`, `templateId`)
SELECT UUID(), @now, @now, '12-month content building plan', NULL, 'Content', 'medium', 1, 15, t.`id`
FROM `onboarding_templates` t WHERE t.`name` = 'Standard SEO Onboarding';

INSERT INTO `onboarding_tasks` (`id`, `createdAt`, `updatedAt`, `title`, `description`, `category`, `priority`, `estimatedHours`, `order`, `templateId`)
SELECT UUID(), @now, @now, 'Create 12-month roadmap', NULL, 'Strategy', 'medium', 1, 16, t.`id`
FROM `onboarding_templates` t WHERE t.`name` = 'Standard SEO Onboarding';

INSERT INTO `onboarding_tasks` (`id`, `createdAt`, `updatedAt`, `title`, `description`, `category`, `priority`, `estimatedHours`, `order`, `templateId`)
SELECT UUID(), @now, @now, 'Map pack optimization', NULL, 'Local SEO', 'medium', 1, 17, t.`id`
FROM `onboarding_templates` t WHERE t.`name` = 'Standard SEO Onboarding';

INSERT INTO `onboarding_tasks` (`id`, `createdAt`, `updatedAt`, `title`, `description`, `category`, `priority`, `estimatedHours`, `order`, `templateId`)
SELECT UUID(), @now, @now, 'Update all GBP categories', NULL, 'GBP', 'medium', 1, 18, t.`id`
FROM `onboarding_templates` t WHERE t.`name` = 'Standard SEO Onboarding';

INSERT INTO `onboarding_tasks` (`id`, `createdAt`, `updatedAt`, `title`, `description`, `category`, `priority`, `estimatedHours`, `order`, `templateId`)
SELECT UUID(), @now, @now, 'Update all GBP services', NULL, 'GBP', 'medium', 1, 19, t.`id`
FROM `onboarding_templates` t WHERE t.`name` = 'Standard SEO Onboarding';

INSERT INTO `onboarding_tasks` (`id`, `createdAt`, `updatedAt`, `title`, `description`, `category`, `priority`, `estimatedHours`, `order`, `templateId`)
SELECT UUID(), @now, @now, 'Complete entire GBP profile', NULL, 'GBP', 'high', 1, 20, t.`id`
FROM `onboarding_templates` t WHERE t.`name` = 'Standard SEO Onboarding';

