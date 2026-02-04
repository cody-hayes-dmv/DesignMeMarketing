-- Update agency role enum to use SPECIALIST instead of WORKER
ALTER TABLE `user_agencies`
  MODIFY COLUMN `agencyRole` ENUM('WORKER','SPECIALIST','MANAGER','OWNER') NOT NULL DEFAULT 'WORKER';

UPDATE `user_agencies`
SET `agencyRole` = 'SPECIALIST'
WHERE `agencyRole` = 'WORKER';

ALTER TABLE `user_agencies`
  MODIFY COLUMN `agencyRole` ENUM('SPECIALIST','MANAGER','OWNER') NOT NULL DEFAULT 'SPECIALIST';
