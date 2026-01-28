-- Add vendasta field to clients table
ALTER TABLE `clients`
  ADD COLUMN `vendasta` BOOLEAN NOT NULL DEFAULT false;
