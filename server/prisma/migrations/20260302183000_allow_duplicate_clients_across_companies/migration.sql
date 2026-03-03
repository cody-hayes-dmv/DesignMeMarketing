-- Allow duplicate client names/domains across different companies.
-- Keep exact-duplicate protection in application logic for same owner account.
ALTER TABLE `clients` DROP INDEX `clients_name_key`;
ALTER TABLE `clients` DROP INDEX `clients_domain_key`;
