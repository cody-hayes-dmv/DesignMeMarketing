-- Add accountInfo JSON blob for extended client fields
ALTER TABLE `clients`
  ADD COLUMN `accountInfo` LONGTEXT NULL;

