-- Widen backlinks URL columns to support long DataForSEO URLs
-- Previous schema used VARCHAR(191) which can overflow and break auto-sync (Prisma P2000).

ALTER TABLE `backlinks`
  MODIFY `sourceUrl` TEXT NOT NULL,
  MODIFY `targetUrl` TEXT NOT NULL,
  MODIFY `anchorText` TEXT NULL;

