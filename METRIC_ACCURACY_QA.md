# Metric Accuracy QA Checklist

Use this checklist before releasing metric-related backend or frontend changes.

## Contract and fail-closed checks

- Confirm `/api/seo/dashboard/:clientId` returns an `accuracy` object and nulls unavailable GA4 metrics.
- Confirm `/api/seo/share/:token/dashboard` mirrors the same metric values and `accuracy.unavailable` list.
- Confirm `/api/seo/ai-search-visibility/:clientId`, `/api/seo/share/:token/ai-search-visibility`, and `/api/seo/ai-intelligence/:clientId` include an `accuracy` object.
- Confirm `/api/seo/domain-overview/:clientId` and `/api/seo/domain-overview-any` include an `accuracy` object and no non-finite numeric metrics.

## Source-of-truth checks

- With GA4 connected, verify dashboard GA4 KPIs (`totalSessions`, `organicSessions`, `activeUsers`, `eventCount`, `newUsers`, `keyEvents`, `totalUsers`) match GA4 source data for the same date range.
- With GA4 disconnected, verify GA4 KPIs are rendered as unavailable/null (not backfilled with guessed values).
- Verify `averagePosition` and keyword/backlink derived metrics remain finite and never return `NaN`/`Infinity`.

## Persistence and freshness checks

- Confirm GA4 snapshots are only used for exact date-range matches.
- Confirm saving GA4 data sanitizes non-finite values before persistence.
- Confirm stale or invalid payloads produce unavailable metric entries in `accuracy.unavailable`.

## Observability checks

- Confirm server logs structured `metric_accuracy` unavailable entries with `route`, `metric`, `reason`, and `source`.
- Confirm repeated failures increment in-memory counters in logs.

## Regression tests

- Run `npm run test:quality-contracts` in `server`.
- Run `npm run test:metric-accuracy` in `server`.
- Exercise dashboard and share dashboard manually for at least one GA4-connected and one GA4-disconnected client.
