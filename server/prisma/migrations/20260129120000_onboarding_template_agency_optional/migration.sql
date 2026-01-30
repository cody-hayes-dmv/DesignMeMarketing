-- AlterTable: make OnboardingTemplate.agencyId optional so we can have global templates (e.g. "Standard SEO Onboarding") with no agency
ALTER TABLE `onboarding_templates` MODIFY COLUMN `agencyId` VARCHAR(191) NULL;
