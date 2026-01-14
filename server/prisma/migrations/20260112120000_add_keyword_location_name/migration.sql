-- Add locationName to tracked keywords
ALTER TABLE `keywords`
  ADD COLUMN `locationName` VARCHAR(191) NULL;


