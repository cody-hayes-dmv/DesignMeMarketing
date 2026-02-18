-- AlterTable: add 'trial' to BillingType enum
ALTER TABLE `agencies` MODIFY COLUMN `billingType` ENUM('paid', 'free', 'trial', 'custom') NULL DEFAULT 'paid';
