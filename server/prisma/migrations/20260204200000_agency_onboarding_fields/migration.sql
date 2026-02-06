-- AlterTable (agencies): add onboarding/create form fields
ALTER TABLE `agencies`
  ADD COLUMN `website` VARCHAR(500) NULL,
  ADD COLUMN `industry` VARCHAR(100) NULL,
  ADD COLUMN `agencySize` VARCHAR(80) NULL,
  ADD COLUMN `numberOfClients` INT NULL,
  ADD COLUMN `contactName` VARCHAR(255) NULL,
  ADD COLUMN `contactEmail` VARCHAR(255) NULL,
  ADD COLUMN `contactPhone` VARCHAR(50) NULL,
  ADD COLUMN `contactJobTitle` VARCHAR(100) NULL,
  ADD COLUMN `streetAddress` VARCHAR(255) NULL,
  ADD COLUMN `city` VARCHAR(100) NULL,
  ADD COLUMN `state` VARCHAR(100) NULL,
  ADD COLUMN `zip` VARCHAR(20) NULL,
  ADD COLUMN `country` VARCHAR(100) NULL,
  ADD COLUMN `subscriptionTier` VARCHAR(50) NULL,
  ADD COLUMN `customPricing` DECIMAL(10, 2) NULL,
  ADD COLUMN `internalNotes` TEXT NULL,
  ADD COLUMN `onboardingData` LONGTEXT NULL;
