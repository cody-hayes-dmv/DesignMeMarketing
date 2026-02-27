-- Add per-agency white-label branding and custom-domain lifecycle fields
ALTER TABLE `agencies`
  ADD COLUMN `brandDisplayName` VARCHAR(255) NULL,
  ADD COLUMN `logoUrl` VARCHAR(2048) NULL,
  ADD COLUMN `primaryColor` VARCHAR(16) NULL,
  ADD COLUMN `customDomain` VARCHAR(255) NULL,
  ADD COLUMN `domainStatus` ENUM('NONE', 'PENDING_VERIFICATION', 'VERIFIED', 'SSL_PENDING', 'ACTIVE', 'FAILED') NOT NULL DEFAULT 'NONE',
  ADD COLUMN `domainVerificationToken` VARCHAR(191) NULL,
  ADD COLUMN `domainVerifiedAt` DATETIME(3) NULL,
  ADD COLUMN `sslIssuedAt` DATETIME(3) NULL,
  ADD COLUMN `sslError` VARCHAR(500) NULL;

CREATE UNIQUE INDEX `agencies_customDomain_key` ON `agencies`(`customDomain`);
