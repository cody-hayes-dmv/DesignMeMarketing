/*
  Warnings:

  - A unique constraint covering the columns `[clientId]` on the table `seo_reports` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX `seo_reports_clientId_reportDate_period_key` ON `seo_reports`;

-- CreateIndex
CREATE UNIQUE INDEX `seo_reports_clientId_key` ON `seo_reports`(`clientId`);
