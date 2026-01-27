# Fix Google Ads Database Columns

## Problem
The database is missing the Google Ads columns, causing this error:
```
The column `seo_dashboard.clients.googleAdsAccessToken` does not exist in the current database.
```

## Solution

### Option 1: Run the SQL Script (Recommended)

1. Open your MySQL client (MySQL Workbench, phpMyAdmin, or command line)
2. Connect to your `seo_dashboard` database
3. Run the SQL script: `server/prisma/migrations/fix_google_ads_columns.sql`

Or copy and paste this SQL directly:

```sql
USE seo_dashboard;

-- Add googleAdsAccessToken
ALTER TABLE `clients` ADD COLUMN `googleAdsAccessToken` TEXT NULL;

-- Add googleAdsRefreshToken
ALTER TABLE `clients` ADD COLUMN `googleAdsRefreshToken` TEXT NULL;

-- Add googleAdsCustomerId
ALTER TABLE `clients` ADD COLUMN `googleAdsCustomerId` VARCHAR(191) NULL;

-- Add googleAdsAccountEmail
ALTER TABLE `clients` ADD COLUMN `googleAdsAccountEmail` VARCHAR(191) NULL;

-- Add googleAdsConnectedAt
ALTER TABLE `clients` ADD COLUMN `googleAdsConnectedAt` DATETIME(3) NULL;
```

**Note:** If you get an error that a column already exists, just skip that line and continue with the others.

### Option 2: Use MySQL Command Line

```bash
mysql -u root -p seo_dashboard < server/prisma/migrations/fix_google_ads_columns.sql
```

### After Adding Columns

1. Regenerate Prisma client:
   ```bash
   cd server
   npx prisma generate
   ```

2. Restart your server:
   ```bash
   npm run dev
   ```

## Verify

After running the SQL, verify the columns exist:

```sql
DESCRIBE clients;
```

You should see these columns:
- `googleAdsAccessToken`
- `googleAdsRefreshToken`
- `googleAdsCustomerId`
- `googleAdsAccountEmail`
- `googleAdsConnectedAt`
