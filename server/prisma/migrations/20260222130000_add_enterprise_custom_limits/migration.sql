-- Enterprise custom limits (override tier defaults when set)
ALTER TABLE `agencies` ADD COLUMN `enterpriseMaxDashboards` INT NULL;
ALTER TABLE `agencies` ADD COLUMN `enterpriseKeywordsTotal` INT NULL;
ALTER TABLE `agencies` ADD COLUMN `enterpriseCreditsPerMonth` INT NULL;
ALTER TABLE `agencies` ADD COLUMN `enterpriseMaxTeamUsers` INT NULL;
