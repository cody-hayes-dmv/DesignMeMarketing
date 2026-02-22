-- AlterTable: Add keyword type field (money/topical) to keywords and target_keywords tables.
-- Existing rows default to "money".

ALTER TABLE `keywords` ADD COLUMN `type` VARCHAR(20) NOT NULL DEFAULT 'money';
ALTER TABLE `target_keywords` ADD COLUMN `type` VARCHAR(20) NOT NULL DEFAULT 'money';
