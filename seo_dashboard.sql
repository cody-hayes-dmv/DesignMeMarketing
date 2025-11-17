/*
 Navicat Premium Data Transfer

 Source Server         : Tinker
 Source Server Type    : MySQL
 Source Server Version : 100432 (10.4.32-MariaDB)
 Source Host           : localhost:3306
 Source Schema         : seo_dashboard

 Target Server Type    : MySQL
 Target Server Version : 100432 (10.4.32-MariaDB)
 File Encoding         : 65001

 Date: 16/11/2025 14:23:10
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for agencies
-- ----------------------------
DROP TABLE IF EXISTS `agencies`;
CREATE TABLE `agencies`  (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) NOT NULL,
  `name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `subdomain` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `agencies_subdomain_key`(`subdomain` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of agencies
-- ----------------------------
INSERT INTO `agencies` VALUES ('cmhnfpsxb0003m6w0bq5bpnqo', '2025-11-06 13:00:29.999', '2025-11-06 13:00:29.999', 'Acme Agency', 'acme');
INSERT INTO `agencies` VALUES ('cmhnfpsxc0004m6w0cdspi04i', '2025-11-06 13:00:30.000', '2025-11-06 13:00:30.000', 'Super Agency', 'super');

-- ----------------------------
-- Table structure for backlinks
-- ----------------------------
DROP TABLE IF EXISTS `backlinks`;
CREATE TABLE `backlinks`  (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) NOT NULL,
  `sourceUrl` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `targetUrl` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `anchorText` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `domainRating` double NULL DEFAULT NULL,
  `urlRating` double NULL DEFAULT NULL,
  `traffic` int NULL DEFAULT NULL,
  `isFollow` tinyint(1) NOT NULL DEFAULT 1,
  `isLost` tinyint(1) NOT NULL DEFAULT 0,
  `firstSeen` datetime(3) NULL DEFAULT NULL,
  `lastSeen` datetime(3) NULL DEFAULT NULL,
  `clientId` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `backlinks_clientId_isLost_idx`(`clientId` ASC, `isLost` ASC) USING BTREE,
  INDEX `backlinks_clientId_domainRating_idx`(`clientId` ASC, `domainRating` ASC) USING BTREE,
  CONSTRAINT `backlinks_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of backlinks
-- ----------------------------
INSERT INTO `backlinks` VALUES ('cmhnfpszb0031m6w01sej1jyz', '2025-11-06 13:00:30.071', '2025-11-06 13:00:30.071', 'https://example.com/article-1', 'https://acme.example/page-1', 'best seo services', 55, 51, 2502, 1, 0, '2025-11-01 08:11:07.009', '2025-10-31 23:16:59.835', 'cmhnfpsxp000jm6w03i1kly9e');
INSERT INTO `backlinks` VALUES ('cmhnfpszc0033m6w0etdfzeqx', '2025-11-06 13:00:30.072', '2025-11-06 13:00:30.072', 'https://techblog.com/article-2', 'https://acme.example/page-2', 'digital marketing tips', 71, 56, 6926, 0, 1, '2025-10-29 15:56:48.902', '2025-10-19 16:39:45.775', 'cmhnfpsxp000jm6w03i1kly9e');
INSERT INTO `backlinks` VALUES ('cmhnfpszd0035m6w0uv8rjnaw', '2025-11-06 13:00:30.074', '2025-11-06 13:00:30.074', 'https://businessnews.com/article-3', 'https://acme.example/page-3', 'seo company', 79, 49, 1399, 1, 0, '2024-12-19 13:17:47.880', '2025-10-15 13:37:09.947', 'cmhnfpsxp000jm6w03i1kly9e');
INSERT INTO `backlinks` VALUES ('cmhnfpsze0037m6w07rpr9486', '2025-11-06 13:00:30.075', '2025-11-06 13:00:30.075', 'https://startupguide.com/article-4', 'https://acme.example/page-4', 'marketing strategies', 57, 40, 2093, 1, 0, '2025-02-14 14:03:28.152', '2025-11-04 19:11:17.826', 'cmhnfpsxp000jm6w03i1kly9e');
INSERT INTO `backlinks` VALUES ('cmhnfpszf0039m6w044zf9mew', '2025-11-06 13:00:30.076', '2025-11-06 13:00:30.076', 'https://marketinginsights.com/article-5', 'https://acme.example/page-5', 'link building guide', 72, 47, 2266, 0, 0, '2025-05-11 01:35:10.665', '2025-10-18 12:05:53.986', 'cmhnfpsxp000jm6w03i1kly9e');
INSERT INTO `backlinks` VALUES ('cmhnfpszh003bm6w0l0v3i40e', '2025-11-06 13:00:30.078', '2025-11-06 13:00:30.078', 'https://seotips.com/article-6', 'https://acme.example/page-6', 'content marketing ideas', 57, 52, 7851, 1, 0, '2025-05-15 16:31:19.483', '2025-10-11 10:35:43.173', 'cmhnfpsxp000jm6w03i1kly9e');
INSERT INTO `backlinks` VALUES ('cmhnfpszi003dm6w06ofl7n4e', '2025-11-06 13:00:30.079', '2025-11-06 13:00:30.079', 'https://digitaltrends.com/article-7', 'https://acme.example/page-7', 'local seo expert', 62, 44, 7057, 0, 0, '2025-09-14 21:57:29.085', '2025-10-14 10:47:34.996', 'cmhnfpsxp000jm6w03i1kly9e');
INSERT INTO `backlinks` VALUES ('cmhnfpszk003fm6w0zon76lso', '2025-11-06 13:00:30.080', '2025-11-06 13:00:30.080', 'https://webmasterworld.com/article-8', 'https://acme.example/page-8', 'technical seo audit', 55, 41, 5479, 1, 0, '2025-02-06 13:04:41.875', '2025-10-30 05:10:02.223', 'cmhnfpsxp000jm6w03i1kly9e');
INSERT INTO `backlinks` VALUES ('cmhnfpszl003hm6w0llvtdres', '2025-11-06 13:00:30.081', '2025-11-06 13:00:30.081', 'https://example.com/article-9', 'https://acme.example/page-9', 'best seo services', 58, 32, 10610, 1, 0, '2025-04-17 03:37:00.753', '2025-11-02 03:14:07.837', 'cmhnfpsxp000jm6w03i1kly9e');
INSERT INTO `backlinks` VALUES ('cmhnfpszm003jm6w0ks4vfxsg', '2025-11-06 13:00:30.082', '2025-11-06 13:00:30.082', 'https://techblog.com/article-10', 'https://acme.example/page-10', 'digital marketing tips', 69, 46, 1156, 1, 0, '2025-08-26 04:25:09.969', '2025-10-19 05:28:10.826', 'cmhnfpsxp000jm6w03i1kly9e');
INSERT INTO `backlinks` VALUES ('cmhnfpszn003lm6w0oiwu8qdt', '2025-11-06 13:00:30.083', '2025-11-06 13:00:30.083', 'https://businessnews.com/article-11', 'https://acme.example/page-11', 'seo company', 63, 48, 5724, 1, 0, '2025-09-16 12:21:18.007', '2025-10-23 01:48:53.466', 'cmhnfpsxp000jm6w03i1kly9e');
INSERT INTO `backlinks` VALUES ('cmhnfpszo003nm6w0874evjqe', '2025-11-06 13:00:30.084', '2025-11-06 13:00:30.084', 'https://startupguide.com/article-12', 'https://acme.example/page-12', 'marketing strategies', 40, 50, 9228, 1, 0, '2025-02-18 17:46:20.838', '2025-10-14 00:33:27.035', 'cmhnfpsxp000jm6w03i1kly9e');
INSERT INTO `backlinks` VALUES ('cmhnfpszp003pm6w0coktyacg', '2025-11-06 13:00:30.085', '2025-11-06 13:00:30.085', 'https://marketinginsights.com/article-13', 'https://acme.example/page-13', 'link building guide', 51, 52, 10674, 1, 0, '2025-07-01 00:28:46.384', '2025-10-23 10:56:37.360', 'cmhnfpsxp000jm6w03i1kly9e');
INSERT INTO `backlinks` VALUES ('cmhnfpszq003rm6w0fbnkg0xx', '2025-11-06 13:00:30.086', '2025-11-06 13:00:30.086', 'https://seotips.com/article-14', 'https://acme.example/page-14', 'content marketing ideas', 57, 44, 10799, 1, 0, '2025-11-03 08:28:33.025', '2025-10-17 12:33:42.573', 'cmhnfpsxp000jm6w03i1kly9e');
INSERT INTO `backlinks` VALUES ('cmhnfpszr003tm6w0p6apctel', '2025-11-06 13:00:30.087', '2025-11-06 13:00:30.087', 'https://digitaltrends.com/article-15', 'https://acme.example/page-15', 'local seo expert', 40, 34, 1950, 0, 0, '2025-05-17 16:20:42.578', '2025-10-23 02:14:24.574', 'cmhnfpsxp000jm6w03i1kly9e');
INSERT INTO `backlinks` VALUES ('cmhnfpszr003vm6w0boikjmh0', '2025-11-06 13:00:30.088', '2025-11-06 13:00:30.088', 'https://example.com/article-1', 'https://beta.example/page-1', 'best seo services', 43, 22, 5068, 0, 0, '2025-02-07 09:44:16.020', '2025-11-04 23:52:24.189', 'cmhnfpsxq000lm6w0gbffh8uu');
INSERT INTO `backlinks` VALUES ('cmhnfpszt003xm6w0jzycqnek', '2025-11-06 13:00:30.089', '2025-11-06 13:00:30.089', 'https://techblog.com/article-2', 'https://beta.example/page-2', 'digital marketing tips', 52, 42, 3782, 0, 0, '2025-03-16 03:43:04.548', '2025-10-23 05:01:18.473', 'cmhnfpsxq000lm6w0gbffh8uu');
INSERT INTO `backlinks` VALUES ('cmhnfpszu003zm6w0tdw1im3l', '2025-11-06 13:00:30.090', '2025-11-06 13:00:30.090', 'https://businessnews.com/article-3', 'https://beta.example/page-3', 'seo company', 52, 32, 3282, 1, 0, '2025-07-03 05:02:01.432', '2025-10-25 21:57:12.300', 'cmhnfpsxq000lm6w0gbffh8uu');
INSERT INTO `backlinks` VALUES ('cmhnfpszv0041m6w0ywb279zp', '2025-11-06 13:00:30.091', '2025-11-06 13:00:30.091', 'https://startupguide.com/article-4', 'https://beta.example/page-4', 'marketing strategies', 60, 43, 8466, 0, 0, '2025-09-11 20:12:44.529', '2025-11-04 22:43:50.797', 'cmhnfpsxq000lm6w0gbffh8uu');
INSERT INTO `backlinks` VALUES ('cmhnfpszw0043m6w0krm3cykn', '2025-11-06 13:00:30.092', '2025-11-06 13:00:30.092', 'https://marketinginsights.com/article-5', 'https://beta.example/page-5', 'link building guide', 58, 20, 5583, 1, 0, '2025-10-24 02:57:06.979', '2025-11-03 08:21:46.804', 'cmhnfpsxq000lm6w0gbffh8uu');
INSERT INTO `backlinks` VALUES ('cmhnfpszx0045m6w08oyfek0p', '2025-11-06 13:00:30.093', '2025-11-06 13:00:30.093', 'https://seotips.com/article-6', 'https://beta.example/page-6', 'content marketing ideas', 36, 28, 6728, 1, 0, '2025-06-08 18:06:26.559', '2025-10-27 14:44:58.091', 'cmhnfpsxq000lm6w0gbffh8uu');
INSERT INTO `backlinks` VALUES ('cmhnfpszy0047m6w03f2svbhu', '2025-11-06 13:00:30.094', '2025-11-06 13:00:30.094', 'https://digitaltrends.com/article-7', 'https://beta.example/page-7', 'local seo expert', 49, 38, 6003, 1, 0, '2025-04-28 03:14:22.655', '2025-10-18 15:34:25.000', 'cmhnfpsxq000lm6w0gbffh8uu');
INSERT INTO `backlinks` VALUES ('cmhnfpszz0049m6w01txgcohx', '2025-11-06 13:00:30.096', '2025-11-06 13:00:30.096', 'https://webmasterworld.com/article-8', 'https://beta.example/page-8', 'technical seo audit', 39, 31, 6565, 1, 0, '2025-02-16 10:49:50.425', '2025-10-30 06:53:01.092', 'cmhnfpsxq000lm6w0gbffh8uu');
INSERT INTO `backlinks` VALUES ('cmhnfpt00004bm6w0p9n4nlpa', '2025-11-06 13:00:30.097', '2025-11-06 13:00:30.097', 'https://example.com/article-9', 'https://beta.example/page-9', 'best seo services', 34, 25, 3272, 1, 0, '2025-02-01 14:25:58.578', '2025-10-21 01:21:51.783', 'cmhnfpsxq000lm6w0gbffh8uu');
INSERT INTO `backlinks` VALUES ('cmhnfpt01004dm6w06i88eg14', '2025-11-06 13:00:30.097', '2025-11-06 13:00:30.097', 'https://techblog.com/article-10', 'https://beta.example/page-10', 'digital marketing tips', 32, 22, 5777, 1, 0, '2025-01-29 10:38:02.116', '2025-10-24 01:03:18.041', 'cmhnfpsxq000lm6w0gbffh8uu');

-- ----------------------------
-- Table structure for clients
-- ----------------------------
DROP TABLE IF EXISTS `clients`;
CREATE TABLE `clients`  (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) NOT NULL,
  `name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `domain` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `industry` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `targets` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  `status` enum('ACTIVE','PENDING','REJECTED') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `loginUrl` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `username` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `password` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `notes` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `userId` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `clients_name_key`(`name` ASC) USING BTREE,
  UNIQUE INDEX `clients_domain_key`(`domain` ASC) USING BTREE,
  INDEX `clients_name_domain_idx`(`name` ASC, `domain` ASC) USING BTREE,
  INDEX `clients_userId_fkey`(`userId` ASC) USING BTREE,
  CONSTRAINT `clients_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of clients
-- ----------------------------
INSERT INTO `clients` VALUES ('cmhnfpsxp000jm6w03i1kly9e', '2025-11-06 13:00:30.013', '2025-11-06 13:00:30.013', 'Aqua Creations', 'aquacreations.com', 'E-commerce', '[\"US / Chicago\"]', 'ACTIVE', 'aquacreations.com', 'admin@acme.example', 'Acme2024!', 'Main admin access. Contact IT for 2FA reset.', 'cmhnfpsx30000m6w0cqir1e42');
INSERT INTO `clients` VALUES ('cmhnfpsxq000lm6w0gbffh8uu', '2025-11-06 13:00:30.015', '2025-11-06 13:00:30.015', 'Sound of Heaven', 'soh.church', 'SaaS', '[\"US / Remote\"]', 'ACTIVE', 'soh.church', 'seo@beta.example', 'BetaSEO2024!', 'SEO dashboard access. Check with client for any password changes.', 'cmhnfpsxa0002m6w06ohjo2x4');
INSERT INTO `clients` VALUES ('cmhnfpsxs000nm6w0mm4mjug4', '2025-11-06 13:00:30.016', '2025-11-07 12:42:06.840', 'Alberta Chamber', 'abchamber.ca', 'Healthcare', '[\"US / NY\",\"US / NJ\"]', 'ACTIVE', 'abchamber.ca', 'healthcare@nimbus.example', 'Nimbus2024!', 'Healthcare client - HIPAA compliance required. Use secure connection only.', 'cmhnfpsxa0002m6w06ohjo2x4');
INSERT INTO `clients` VALUES ('cmhoflxnp00036vsb2yqzuotv', '2025-11-07 05:45:15.686', '2025-11-07 23:45:21.871', 'Code Effects', 'codeeffects.com', NULL, '[]', 'ACTIVE', NULL, NULL, NULL, NULL, 'cmhnfpsx30000m6w0cqir1e42');
INSERT INTO `clients` VALUES ('cmhosyp2y000399ccafaum1xu', '2025-11-07 11:59:06.106', '2025-11-07 12:42:13.249', 'Able Lock Shop', 'ablelockshop.com', NULL, '[]', 'ACTIVE', NULL, NULL, NULL, NULL, 'cmhnfpsxa0002m6w06ohjo2x4');

-- ----------------------------
-- Table structure for keywords
-- ----------------------------
DROP TABLE IF EXISTS `keywords`;
CREATE TABLE `keywords`  (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) NOT NULL,
  `keyword` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `searchVolume` int NOT NULL,
  `difficulty` double NULL DEFAULT NULL,
  `cpc` double NULL DEFAULT NULL,
  `competition` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `currentPosition` int NULL DEFAULT NULL,
  `previousPosition` int NULL DEFAULT NULL,
  `bestPosition` int NULL DEFAULT NULL,
  `googleUrl` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `serpFeatures` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  `totalResults` int NULL DEFAULT NULL,
  `clicks` int NOT NULL DEFAULT 0,
  `impressions` int NOT NULL DEFAULT 0,
  `ctr` double NOT NULL DEFAULT 0,
  `clientId` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `keywords_clientId_keyword_key`(`clientId` ASC, `keyword` ASC) USING BTREE,
  INDEX `keywords_clientId_currentPosition_idx`(`clientId` ASC, `currentPosition` ASC) USING BTREE,
  CONSTRAINT `keywords_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of keywords
-- ----------------------------
INSERT INTO `keywords` VALUES ('cmhnfwmxu0001x659h49xqkn2', '2025-11-06 13:05:48.831', '2025-11-06 13:06:58.012', 'alberta renewable energy policy', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '[\"organic\",\"perspectives\",\"scholarly_articles\",\"related_searches\"]', NULL, 0, 0, 0, 'cmhnfpsxs000nm6w0mm4mjug4');
INSERT INTO `keywords` VALUES ('cmhnfwumj0003x659lcril00b', '2025-11-06 13:05:58.795', '2025-11-13 22:39:20.432', 'alberta business awards', 0, NULL, NULL, NULL, 2, 2, 2, 'https://www.abchamber.ca/programs-and-initiatives/alberta-businesses-of-the-year/', '[\"organic\",\"video\",\"related_searches\"]', NULL, 0, 0, 0, 'cmhnfpsxs000nm6w0mm4mjug4');
INSERT INTO `keywords` VALUES ('cmhnfwyrv0005x6595trq3o15', '2025-11-06 13:06:04.172', '2025-11-12 22:19:50.130', 'chamber market alberta', 0, NULL, NULL, NULL, 2, 2, 2, 'https://www.abchamber.ca/programs-and-initiatives/chamber-market/', '[\"organic\",\"local_pack\",\"video\",\"related_searches\"]', NULL, 0, 0, 0, 'cmhnfpsxs000nm6w0mm4mjug4');
INSERT INTO `keywords` VALUES ('cmhnfxe030007x6597j0t313f', '2025-11-06 13:06:23.907', '2025-11-07 05:19:48.464', 'christian church', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '[\"local_pack\",\"organic\",\"people_also_ask\",\"product_considerations\",\"related_searches\",\"knowledge_graph\"]', NULL, 0, 0, 0, 'cmhnfpsxq000lm6w0gbffh8uu');
INSERT INTO `keywords` VALUES ('cmhnfxi810009x659c9lisdu0', '2025-11-06 13:06:29.377', '2025-11-07 05:19:48.138', 'jireh meaning', 0, NULL, NULL, NULL, 4, 4, 4, 'https://soh.church/jireh-meaning/', '[\"ai_overview\",\"people_also_ask\",\"organic\",\"carousel\",\"perspectives\",\"related_searches\"]', NULL, 0, 0, 0, 'cmhnfpsxq000lm6w0gbffh8uu');

-- ----------------------------
-- Table structure for onboarding_tasks
-- ----------------------------
DROP TABLE IF EXISTS `onboarding_tasks`;
CREATE TABLE `onboarding_tasks`  (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) NOT NULL,
  `title` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `category` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `priority` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `estimatedHours` int NULL DEFAULT NULL,
  `order` int NOT NULL DEFAULT 0,
  `templateId` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `onboarding_tasks_templateId_order_idx`(`templateId` ASC, `order` ASC) USING BTREE,
  CONSTRAINT `onboarding_tasks_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `onboarding_templates` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of onboarding_tasks
-- ----------------------------
INSERT INTO `onboarding_tasks` VALUES ('cmhnfpsxu000rm6w0ouxed810', '2025-11-06 13:00:30.019', '2025-11-06 13:00:30.019', 'Website Audit', 'Complete technical SEO audit of the website', 'Technical SEO', 'high', 4, 1, 'cmhnfpsxt000pm6w0jip532p8');
INSERT INTO `onboarding_tasks` VALUES ('cmhnfpsxw000tm6w0h3euiu4s', '2025-11-06 13:00:30.020', '2025-11-06 13:00:30.020', 'Keyword Research', 'Research and identify target keywords', 'Research', 'high', 3, 2, 'cmhnfpsxt000pm6w0jip532p8');
INSERT INTO `onboarding_tasks` VALUES ('cmhnfpsxw000vm6w0umgl5ntm', '2025-11-06 13:00:30.021', '2025-11-06 13:00:30.021', 'Competitor Analysis', 'Analyze top 5 competitors and their strategies', 'Research', 'medium', 2, 3, 'cmhnfpsxt000pm6w0jip532p8');
INSERT INTO `onboarding_tasks` VALUES ('cmhnfpsxx000xm6w08c7cegm9', '2025-11-06 13:00:30.022', '2025-11-06 13:00:30.022', 'Google Analytics Setup', 'Install and configure Google Analytics and Search Console', 'Setup', 'high', 1, 4, 'cmhnfpsxt000pm6w0jip532p8');
INSERT INTO `onboarding_tasks` VALUES ('cmhnfpsxy000zm6w0nsfrfw0z', '2025-11-06 13:00:30.023', '2025-11-06 13:00:30.023', 'Meta Tags Optimization', 'Optimize title tags, meta descriptions, and headers', 'On-Page SEO', 'medium', 2, 5, 'cmhnfpsxt000pm6w0jip532p8');
INSERT INTO `onboarding_tasks` VALUES ('cmhnfpsxz0011m6w0jqq6k9p1', '2025-11-06 13:00:30.024', '2025-11-06 13:00:30.024', 'Content Strategy', 'Develop content strategy and editorial calendar', 'Content', 'medium', 3, 6, 'cmhnfpsxt000pm6w0jip532p8');
INSERT INTO `onboarding_tasks` VALUES ('cmhnfpsy00013m6w0wwflty62', '2025-11-06 13:00:30.025', '2025-11-06 13:00:30.025', 'Local SEO Setup', 'Set up Google My Business and local citations', 'Local SEO', 'low', 2, 7, 'cmhnfpsxt000pm6w0jip532p8');

-- ----------------------------
-- Table structure for onboarding_templates
-- ----------------------------
DROP TABLE IF EXISTS `onboarding_templates`;
CREATE TABLE `onboarding_templates`  (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) NOT NULL,
  `name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `isDefault` tinyint(1) NOT NULL DEFAULT 0,
  `agencyId` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `onboarding_templates_agencyId_idx`(`agencyId` ASC) USING BTREE,
  CONSTRAINT `onboarding_templates_agencyId_fkey` FOREIGN KEY (`agencyId`) REFERENCES `agencies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of onboarding_templates
-- ----------------------------
INSERT INTO `onboarding_templates` VALUES ('cmhnfpsxt000pm6w0jip532p8', '2025-11-06 13:00:30.018', '2025-11-06 13:00:30.018', 'Standard SEO Onboarding', 'Default template for new SEO clients', 1, 'cmhnfpsxb0003m6w0bq5bpnqo');

-- ----------------------------
-- Table structure for ranked_keywords_history
-- ----------------------------
DROP TABLE IF EXISTS `ranked_keywords_history`;
CREATE TABLE `ranked_keywords_history`  (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) NOT NULL,
  `totalKeywords` int NOT NULL,
  `clientId` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `month` int NOT NULL,
  `year` int NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `ranked_keywords_history_clientId_month_year_key`(`clientId` ASC, `month` ASC, `year` ASC) USING BTREE,
  INDEX `ranked_keywords_history_clientId_year_month_idx`(`clientId` ASC, `year` ASC, `month` ASC) USING BTREE,
  CONSTRAINT `ranked_keywords_history_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of ranked_keywords_history
-- ----------------------------
INSERT INTO `ranked_keywords_history` VALUES ('cmhoeobeu00011066xc6cjdhe', '2025-11-07 05:19:07.205', '2025-11-07 05:19:07.205', 44819, 'cmhnfpsxq000lm6w0gbffh8uu', 11, 2025);
INSERT INTO `ranked_keywords_history` VALUES ('cmhoeobfp00031066ieju07y6', '2025-11-07 05:19:07.237', '2025-11-07 10:15:10.869', 137, 'cmhnfpsxs000nm6w0mm4mjug4', 11, 2025);
INSERT INTO `ranked_keywords_history` VALUES ('cmhofko3y00016vsbcjnhqusf', '2025-11-07 05:44:16.655', '2025-11-07 05:44:16.655', 168, 'cmhnfpsxp000jm6w03i1kly9e', 11, 2025);
INSERT INTO `ranked_keywords_history` VALUES ('cmhofmi2i00056vsbpppfdi8s', '2025-11-07 05:45:42.138', '2025-11-07 05:45:42.138', 63, 'cmhoflxnp00036vsb2yqzuotv', 11, 2025);
INSERT INTO `ranked_keywords_history` VALUES ('cmhosyu84000599ccp9h9jaxf', '2025-11-07 11:59:12.773', '2025-11-07 11:59:12.773', 562, 'cmhosyp2y000399ccafaum1xu', 11, 2025);

-- ----------------------------
-- Table structure for seo_reports
-- ----------------------------
DROP TABLE IF EXISTS `seo_reports`;
CREATE TABLE `seo_reports`  (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) NOT NULL,
  `reportDate` datetime(3) NOT NULL,
  `period` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `totalSessions` int NOT NULL,
  `organicSessions` int NOT NULL,
  `paidSessions` int NOT NULL,
  `directSessions` int NOT NULL,
  `referralSessions` int NOT NULL,
  `totalClicks` int NOT NULL,
  `totalImpressions` int NOT NULL,
  `averageCtr` double NOT NULL,
  `averagePosition` double NOT NULL,
  `bounceRate` double NOT NULL,
  `avgSessionDuration` double NOT NULL,
  `pagesPerSession` double NOT NULL,
  `conversions` int NOT NULL,
  `conversionRate` double NOT NULL,
  `clientId` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `seo_reports_clientId_reportDate_period_key`(`clientId` ASC, `reportDate` ASC, `period` ASC) USING BTREE,
  INDEX `seo_reports_clientId_reportDate_idx`(`clientId` ASC, `reportDate` ASC) USING BTREE,
  CONSTRAINT `seo_reports_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of seo_reports
-- ----------------------------
INSERT INTO `seo_reports` VALUES ('cmhnfpsyb001hm6w0gdmzumcv', '2025-11-06 13:00:30.036', '2025-11-06 13:00:30.036', '2024-01-01 00:00:00.000', 'monthly', 4000, 2800, 600, 400, 200, 4500, 15000, 3.477248987023105, 12, 35, 180, 2.5, 150, 3.5, 'cmhnfpsxp000jm6w03i1kly9e');
INSERT INTO `seo_reports` VALUES ('cmhnfpsyd001jm6w08zgmkn3m', '2025-11-06 13:00:30.037', '2025-11-06 13:00:30.037', '2024-02-01 00:00:00.000', 'monthly', 4200, 2940, 630, 420, 210, 4800, 16000, 3.414612338358694, 11.8, 34, 190, 2.6, 170, 3.7, 'cmhnfpsxp000jm6w03i1kly9e');
INSERT INTO `seo_reports` VALUES ('cmhnfpsye001lm6w0c4bkf7xn', '2025-11-06 13:00:30.039', '2025-11-06 13:00:30.039', '2024-03-01 00:00:00.000', 'monthly', 4400, 3080, 660, 440, 220, 5100, 17000, 3.424919544165245, 11.6, 33, 200, 2.7, 190, 3.9, 'cmhnfpsxp000jm6w03i1kly9e');
INSERT INTO `seo_reports` VALUES ('cmhnfpsyf001nm6w0c040ykpd', '2025-11-06 13:00:30.040', '2025-11-06 13:00:30.040', '2024-04-01 00:00:00.000', 'monthly', 4600, 3220, 690, 460, 230, 5400, 18000, 3.142598525800814, 11.4, 32, 210, 2.8, 210, 4.1, 'cmhnfpsxp000jm6w03i1kly9e');
INSERT INTO `seo_reports` VALUES ('cmhnfpsyh001pm6w0z2jvvo48', '2025-11-06 13:00:30.041', '2025-11-06 13:00:30.041', '2024-05-01 00:00:00.000', 'monthly', 4800, 3360, 720, 480, 240, 5700, 19000, 3.204763172277463, 11.2, 31, 220, 2.9, 230, 4.3, 'cmhnfpsxp000jm6w03i1kly9e');
INSERT INTO `seo_reports` VALUES ('cmhnfpsyi001rm6w00gef16vj', '2025-11-06 13:00:30.042', '2025-11-06 13:00:30.042', '2024-06-01 00:00:00.000', 'monthly', 5000, 3500, 750, 500, 250, 6000, 20000, 3.38058733265676, 11, 30, 230, 3, 250, 4.5, 'cmhnfpsxp000jm6w03i1kly9e');
INSERT INTO `seo_reports` VALUES ('cmhnfpsym001tm6w08ci2x3fa', '2025-11-06 13:00:30.046', '2025-11-06 13:00:30.046', '2024-01-01 00:00:00.000', 'monthly', 3000, 1950, 600, 300, 150, 3500, 12000, 2.985015814822897, 15, 40, 160, 2.2, 120, 3.2, 'cmhnfpsxq000lm6w0gbffh8uu');
INSERT INTO `seo_reports` VALUES ('cmhnfpsyn001vm6w0df8umh65', '2025-11-06 13:00:30.047', '2025-11-06 13:00:30.047', '2024-02-01 00:00:00.000', 'monthly', 3150, 2047, 630, 315, 157, 3700, 12800, 2.873705797571907, 14.7, 38.5, 168, 2.3, 135, 3.35, 'cmhnfpsxq000lm6w0gbffh8uu');
INSERT INTO `seo_reports` VALUES ('cmhnfpsyo001xm6w0yg6i32xv', '2025-11-06 13:00:30.048', '2025-11-06 13:00:30.048', '2024-03-01 00:00:00.000', 'monthly', 3300, 2145, 660, 330, 165, 3900, 13600, 2.985039481369297, 14.4, 37, 176, 2.4, 150, 3.5, 'cmhnfpsxq000lm6w0gbffh8uu');
INSERT INTO `seo_reports` VALUES ('cmhnfpsyp001zm6w0b0bs3vuo', '2025-11-06 13:00:30.050', '2025-11-06 13:00:30.050', '2024-04-01 00:00:00.000', 'monthly', 3450, 2242, 690, 345, 172, 4100, 14400, 2.804301994206484, 14.1, 35.5, 184, 2.5, 165, 3.65, 'cmhnfpsxq000lm6w0gbffh8uu');
INSERT INTO `seo_reports` VALUES ('cmhnfpsyq0021m6w0rzm17bog', '2025-11-06 13:00:30.051', '2025-11-06 13:00:30.051', '2024-05-01 00:00:00.000', 'monthly', 3600, 2340, 720, 360, 180, 4300, 15200, 2.879311670070723, 13.8, 34, 192, 2.6, 180, 3.8, 'cmhnfpsxq000lm6w0gbffh8uu');
INSERT INTO `seo_reports` VALUES ('cmhnfpsyr0023m6w0fqh5hsy7', '2025-11-06 13:00:30.052', '2025-11-06 13:00:30.052', '2024-06-01 00:00:00.000', 'monthly', 3750, 2437, 750, 375, 187, 4500, 16000, 3.019021164659942, 13.5, 32.5, 200, 2.7, 195, 3.95, 'cmhnfpsxq000lm6w0gbffh8uu');

-- ----------------------------
-- Table structure for tasks
-- ----------------------------
DROP TABLE IF EXISTS `tasks`;
CREATE TABLE `tasks`  (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) NOT NULL,
  `title` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `category` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `dueDate` datetime(3) NULL DEFAULT NULL,
  `status` enum('TODO','IN_PROGRESS','REVIEW','DONE') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'TODO',
  `priority` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `estimatedHours` int NULL DEFAULT NULL,
  `agencyId` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdById` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `assigneeId` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `clientId` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `proof` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `tasks_agencyId_status_idx`(`agencyId` ASC, `status` ASC) USING BTREE,
  INDEX `tasks_assigneeId_idx`(`assigneeId` ASC) USING BTREE,
  INDEX `tasks_createdById_fkey`(`createdById` ASC) USING BTREE,
  INDEX `tasks_clientId_fkey`(`clientId` ASC) USING BTREE,
  CONSTRAINT `tasks_agencyId_fkey` FOREIGN KEY (`agencyId`) REFERENCES `agencies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `tasks_assigneeId_fkey` FOREIGN KEY (`assigneeId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `tasks_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `tasks_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of tasks
-- ----------------------------
INSERT INTO `tasks` VALUES ('cmhnfpsy10015m6w0k1u7av0q', '2025-11-06 13:00:30.026', '2025-11-06 13:00:30.026', 'Setup SEO audit for new client', 'Perform comprehensive SEO audit for the new e-commerce client', 'On-page', NULL, 'TODO', NULL, NULL, 'cmhnfpsxb0003m6w0bq5bpnqo', 'cmhnfpsxa0002m6w06ohjo2x4', 'cmhnfpsxg0009m6w0nf9e1oy7', 'cmhnfpsxq000lm6w0gbffh8uu', NULL);
INSERT INTO `tasks` VALUES ('cmhnfpsy30017m6w0k86lrru3', '2025-11-06 13:00:30.027', '2025-11-07 12:20:36.583', 'Keyword research for tech blog', 'Research high-volume keywords for the technology blog project', 'Content', NULL, 'IN_PROGRESS', NULL, NULL, 'cmhnfpsxb0003m6w0bq5bpnqo', 'cmhnfpsxa0002m6w06ohjo2x4', 'cmhnfpsxg0009m6w0nf9e1oy7', 'cmhnfpsxs000nm6w0mm4mjug4', '[{\"type\":\"video\",\"value\":\"http://localhost:5000/uploads/Screen Recording 2025-10-27 115102-1762518034373-123187740.mp4\",\"name\":\"Screen Recording 2025-10-27 115102.mp4\"}]');
INSERT INTO `tasks` VALUES ('cmhnfpsy60019m6w0z7i3qc5p', '2025-11-06 13:00:30.030', '2025-11-06 13:00:30.030', 'Monthly SEO report', 'Generate and send monthly SEO performance report to client', 'Link building', NULL, 'DONE', NULL, NULL, 'cmhnfpsxb0003m6w0bq5bpnqo', 'cmhnfpsxa0002m6w06ohjo2x4', 'cmhnfpsxi000am6w0y1tqwaqh', 'cmhnfpsxs000nm6w0mm4mjug4', NULL);
INSERT INTO `tasks` VALUES ('cmhnfpsy7001bm6w0n1g4gb8y', '2025-11-06 13:00:30.031', '2025-11-06 13:00:30.031', 'Fix title tags on category pages', 'Fix title tages on category pages', 'Link building', NULL, 'TODO', NULL, NULL, 'cmhnfpsxb0003m6w0bq5bpnqo', 'cmhnfpsxa0002m6w06ohjo2x4', 'cmhnfpsxi000am6w0y1tqwaqh', 'cmhnfpsxq000lm6w0gbffh8uu', NULL);
INSERT INTO `tasks` VALUES ('cmhnfpsy8001dm6w05yq80bby', '2025-11-06 13:00:30.033', '2025-11-06 13:00:30.033', 'SILO Structure Mapping', 'Plan website SILO architecture based on keywords and categories.', 'On-page', NULL, 'IN_PROGRESS', NULL, NULL, 'cmhnfpsxc0004m6w0cdspi04i', 'cmhnfpsx30000m6w0cqir1e42', 'cmhnfpsxj000bm6w0wvik407e', 'cmhnfpsxp000jm6w03i1kly9e', NULL);
INSERT INTO `tasks` VALUES ('cmhnfpsy9001fm6w0j7s0v0va', '2025-11-06 13:00:30.034', '2025-11-06 13:00:30.034', 'Competitor Analysis', 'Analyze top competitors’ backlink profiles and content strategies.', 'Link building', NULL, 'TODO', NULL, NULL, 'cmhnfpsxc0004m6w0cdspi04i', 'cmhnfpsx30000m6w0cqir1e42', 'cmhnfpsxj000bm6w0wvik407e', 'cmhnfpsxp000jm6w03i1kly9e', NULL);
INSERT INTO `tasks` VALUES ('cmhofzac700066vsbhv3x0wqp', '2025-11-07 05:55:38.647', '2025-11-07 12:20:43.345', 'Website Audit', 'Complete technical SEO audit of the website', 'Technical SEO', '2025-11-27 00:00:00.000', 'DONE', 'high', 4, 'cmhnfpsxb0003m6w0bq5bpnqo', 'cmhnfpsxa0002m6w06ohjo2x4', 'cmhnfpsxg0009m6w0nf9e1oy7', 'cmhnfpsxq000lm6w0gbffh8uu', '[{\"type\":\"image\",\"value\":\"http://localhost:5000/uploads/Screenshot 2025-09-03 033538-1762510333211-355468752.png\",\"name\":\"Screenshot 2025-09-03 033538.png\"},{\"type\":\"video\",\"value\":\"http://localhost:5000/uploads/Screen Recording 2025-09-30 200936-1762510408086-570186678.mp4\",\"name\":\"Screen Recording 2025-09-30 200936.mp4\"}]');
INSERT INTO `tasks` VALUES ('cmhofzac700076vsbld510xey', '2025-11-07 05:55:38.647', '2025-11-10 20:15:42.555', 'Keyword Research', 'Research and identify target keywords', 'Research', '2025-11-08 00:00:00.000', 'REVIEW', 'high', 3, 'cmhnfpsxb0003m6w0bq5bpnqo', 'cmhnfpsxa0002m6w06ohjo2x4', 'cmhnfpsxg0009m6w0nf9e1oy7', 'cmhnfpsxq000lm6w0gbffh8uu', '[{\"type\":\"video\",\"value\":\"http://localhost:5000/uploads/Screen Recording 2025-10-27 115102-1762510358127-241272352.mp4\",\"name\":\"Screen Recording 2025-10-27 115102.mp4\"}]');
INSERT INTO `tasks` VALUES ('cmhofzac700086vsbqwqo318q', '2025-11-07 05:55:38.647', '2025-11-10 20:15:45.066', 'Competitor Analysis', 'Analyze top 5 competitors and their strategies', 'Research', '2025-11-27 00:00:00.000', 'IN_PROGRESS', 'medium', 2, 'cmhnfpsxb0003m6w0bq5bpnqo', 'cmhnfpsxa0002m6w06ohjo2x4', 'cmhnfpsxg0009m6w0nf9e1oy7', 'cmhnfpsxq000lm6w0gbffh8uu', NULL);
INSERT INTO `tasks` VALUES ('cmhofzac700096vsb3k7iglve', '2025-11-07 05:55:38.647', '2025-11-07 12:20:44.343', 'Google Analytics Setup', 'Install and configure Google Analytics and Search Console', 'Setup', '2025-11-27 00:00:00.000', 'DONE', 'high', 1, 'cmhnfpsxb0003m6w0bq5bpnqo', 'cmhnfpsxa0002m6w06ohjo2x4', 'cmhnfpsxg0009m6w0nf9e1oy7', 'cmhnfpsxq000lm6w0gbffh8uu', NULL);
INSERT INTO `tasks` VALUES ('cmhofzac7000a6vsbgxxzzcsa', '2025-11-07 05:55:38.647', '2025-11-07 05:55:54.565', 'Meta Tags Optimization', 'Optimize title tags, meta descriptions, and headers', 'On-Page SEO', '2025-11-27 00:00:00.000', 'REVIEW', 'medium', 2, 'cmhnfpsxb0003m6w0bq5bpnqo', 'cmhnfpsxa0002m6w06ohjo2x4', 'cmhnfpsxg0009m6w0nf9e1oy7', 'cmhnfpsxq000lm6w0gbffh8uu', NULL);
INSERT INTO `tasks` VALUES ('cmhofzac7000b6vsbq6xuk9sk', '2025-11-07 05:55:38.647', '2025-11-07 05:55:38.647', 'Content Strategy', 'Develop content strategy and editorial calendar', 'Content', '2025-11-27 00:00:00.000', 'TODO', 'medium', 3, 'cmhnfpsxb0003m6w0bq5bpnqo', 'cmhnfpsxa0002m6w06ohjo2x4', 'cmhnfpsxg0009m6w0nf9e1oy7', 'cmhnfpsxq000lm6w0gbffh8uu', NULL);
INSERT INTO `tasks` VALUES ('cmhofzac7000c6vsb6bz0jg3v', '2025-11-07 05:55:38.647', '2025-11-07 05:55:38.647', 'Local SEO Setup', 'Set up Google My Business and local citations', 'Local SEO', '2025-11-27 00:00:00.000', 'TODO', 'low', 2, 'cmhnfpsxb0003m6w0bq5bpnqo', 'cmhnfpsxa0002m6w06ohjo2x4', 'cmhnfpsxg0009m6w0nf9e1oy7', 'cmhnfpsxq000lm6w0gbffh8uu', NULL);
INSERT INTO `tasks` VALUES ('cmhqxi8l90001c8hgpukqetra', '2025-11-08 23:41:48.669', '2025-11-08 23:41:48.669', 'AAA', 'AAA', 'Seo', '2025-11-20 05:00:00.000', 'TODO', 'high', NULL, 'cmhnfpsxc0004m6w0cdspi04i', 'cmhnfpsx30000m6w0cqir1e42', 'cmhnfpsxg0009m6w0nf9e1oy7', 'cmhosyp2y000399ccafaum1xu', NULL);

-- ----------------------------
-- Table structure for tokens
-- ----------------------------
DROP TABLE IF EXISTS `tokens`;
CREATE TABLE `tokens`  (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `usedAt` datetime(3) NULL DEFAULT NULL,
  `type` enum('EMAIL_VERIFY','INVITE','MAGIC_LOGIN') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `token` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `expiresAt` datetime(3) NOT NULL,
  `userId` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `agencyId` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `role` enum('SUPER_ADMIN','ADMIN','AGENCY','WORKER') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `tokens_token_key`(`token` ASC) USING BTREE,
  INDEX `tokens_type_email_idx`(`type` ASC, `email` ASC) USING BTREE,
  INDEX `tokens_userId_fkey`(`userId` ASC) USING BTREE,
  INDEX `tokens_agencyId_fkey`(`agencyId` ASC) USING BTREE,
  CONSTRAINT `tokens_agencyId_fkey` FOREIGN KEY (`agencyId`) REFERENCES `agencies` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of tokens
-- ----------------------------

-- ----------------------------
-- Table structure for user_agencies
-- ----------------------------
DROP TABLE IF EXISTS `user_agencies`;
CREATE TABLE `user_agencies`  (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `userId` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `agencyId` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `agencyRole` enum('WORKER','MANAGER','OWNER') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'WORKER',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `user_agencies_userId_agencyId_key`(`userId` ASC, `agencyId` ASC) USING BTREE,
  INDEX `user_agencies_agencyId_idx`(`agencyId` ASC) USING BTREE,
  INDEX `user_agencies_userId_idx`(`userId` ASC) USING BTREE,
  CONSTRAINT `user_agencies_agencyId_fkey` FOREIGN KEY (`agencyId`) REFERENCES `agencies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `user_agencies_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of user_agencies
-- ----------------------------
INSERT INTO `user_agencies` VALUES ('cmhnfpsxd0006m6w0m5bp4982', 'cmhnfpsx30000m6w0cqir1e42', 'cmhnfpsxc0004m6w0cdspi04i', 'OWNER');
INSERT INTO `user_agencies` VALUES ('cmhnfpsxf0008m6w0o2leerqi', 'cmhnfpsxa0002m6w06ohjo2x4', 'cmhnfpsxb0003m6w0bq5bpnqo', 'OWNER');
INSERT INTO `user_agencies` VALUES ('cmhnfpsxk000dm6w0vsq3l2l6', 'cmhnfpsxg0009m6w0nf9e1oy7', 'cmhnfpsxb0003m6w0bq5bpnqo', 'WORKER');
INSERT INTO `user_agencies` VALUES ('cmhnfpsxk000fm6w0gj804i7h', 'cmhnfpsxi000am6w0y1tqwaqh', 'cmhnfpsxb0003m6w0bq5bpnqo', 'WORKER');
INSERT INTO `user_agencies` VALUES ('cmhnfpsxn000hm6w02ea7rt05', 'cmhnfpsxj000bm6w0wvik407e', 'cmhnfpsxc0004m6w0cdspi04i', 'WORKER');

-- ----------------------------
-- Table structure for users
-- ----------------------------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users`  (
  `id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updatedAt` datetime(3) NOT NULL,
  `email` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `passwordHash` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `role` enum('SUPER_ADMIN','ADMIN','AGENCY','WORKER') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'AGENCY',
  `verified` tinyint(1) NOT NULL DEFAULT 0,
  `invited` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `users_email_key`(`email` ASC) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of users
-- ----------------------------
INSERT INTO `users` VALUES ('cmhnfpsx30000m6w0cqir1e42', '2025-11-06 13:00:29.991', '2025-11-06 13:00:29.991', 'super@super.com', 'SuperAdmin', '$2a$12$rPXSX8iwPNOWsIVohUyXI.t9XUmpHhdq.O5FGncxuskHDYoRAGOkC', 'SUPER_ADMIN', 1, 0);
INSERT INTO `users` VALUES ('cmhnfpsx80001m6w0jqrhmdf6', '2025-11-06 13:00:29.996', '2025-11-06 13:00:29.996', 'admin@admin.com', 'Admin', '$2a$12$rPXSX8iwPNOWsIVohUyXI.t9XUmpHhdq.O5FGncxuskHDYoRAGOkC', 'ADMIN', 1, 0);
INSERT INTO `users` VALUES ('cmhnfpsxa0002m6w06ohjo2x4', '2025-11-06 13:00:29.998', '2025-11-06 13:00:29.998', 'acme@acme.com', 'Acme Agency', '$2a$12$rPXSX8iwPNOWsIVohUyXI.t9XUmpHhdq.O5FGncxuskHDYoRAGOkC', 'AGENCY', 1, 0);
INSERT INTO `users` VALUES ('cmhnfpsxg0009m6w0nf9e1oy7', '2025-11-06 13:00:30.005', '2025-11-06 13:00:30.005', 'worker@acme.com', 'Worker', '$2a$12$rPXSX8iwPNOWsIVohUyXI.t9XUmpHhdq.O5FGncxuskHDYoRAGOkC', 'WORKER', 1, 1);
INSERT INTO `users` VALUES ('cmhnfpsxi000am6w0y1tqwaqh', '2025-11-06 13:00:30.006', '2025-11-06 13:00:30.006', 'worker1@acme.com', 'Worker1', '$2a$12$rPXSX8iwPNOWsIVohUyXI.t9XUmpHhdq.O5FGncxuskHDYoRAGOkC', 'WORKER', 1, 1);
INSERT INTO `users` VALUES ('cmhnfpsxj000bm6w0wvik407e', '2025-11-06 13:00:30.007', '2025-11-06 13:00:30.007', 'superworker@super.com', 'Worker3', '$2a$12$rPXSX8iwPNOWsIVohUyXI.t9XUmpHhdq.O5FGncxuskHDYoRAGOkC', 'WORKER', 1, 1);

SET FOREIGN_KEY_CHECKS = 1;
