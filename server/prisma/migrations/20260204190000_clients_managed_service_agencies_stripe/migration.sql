-- AlterTable (agencies): add Stripe and billing columns
ALTER TABLE `agencies`
  ADD COLUMN `stripeCustomerId` VARCHAR(255) NULL,
  ADD COLUMN `stripeSubscriptionId` VARCHAR(255) NULL,
  ADD COLUMN `billingType` ENUM('paid', 'free', 'custom') NULL DEFAULT 'paid';

-- AlterTable (clients): add managed service and agency columns
ALTER TABLE `clients`
  ADD COLUMN `managedServiceStatus` ENUM('none', 'pending', 'active', 'canceled', 'suspended', 'archived') NULL DEFAULT 'none',
  ADD COLUMN `managedServicePackage` ENUM('foundation', 'growth', 'domination', 'custom') NULL,
  ADD COLUMN `managedServicePrice` DECIMAL(10, 2) NULL,
  ADD COLUMN `managedServiceRequestedDate` DATETIME(3) NULL,
  ADD COLUMN `managedServiceActivatedDate` DATETIME(3) NULL,
  ADD COLUMN `managedServiceCanceledDate` DATETIME(3) NULL,
  ADD COLUMN `managedServiceEndDate` DATE NULL,
  ADD COLUMN `belongsToAgencyId` VARCHAR(191) NULL,
  ADD COLUMN `isAgencyOwnDashboard` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex (clients)
CREATE INDEX `clients_belongsToAgencyId_idx` ON `clients`(`belongsToAgencyId`);

-- AddForeignKey (clients -> agencies)
ALTER TABLE `clients` ADD CONSTRAINT `clients_belongsToAgencyId_fkey` FOREIGN KEY (`belongsToAgencyId`) REFERENCES `agencies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
