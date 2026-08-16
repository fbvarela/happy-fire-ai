# Phase 2A Fix Report

## Findings fixed

- The process-local weather cache is limited to 32 entries, prunes expired entries, and evicts the oldest entry when full.
- Only the configured default Open-Meteo path uses the cache. Injected providers are fetched independently.
- Cache-hit logs now include source timestamp, age, expiry, remaining TTL, and lookup duration.
- Cache hits recompute freshness, so stale source data remains marked `stale`.
- Expired entries are removed before refresh; refresh failures return the deterministic mock fallback.

## Focused coverage

- Injected provider isolation from the default cache.
- Coordinate isolation.
- Stale status and cache-hit age diagnostics.
- 32-entry bound and oldest-entry eviction.
- Expired refresh failure fallback.

## Verification

- `npm test`: 36 tests passed.
- `npx tsc --noEmit`: passed.
- `npm run generate-routes`: passed with the existing circular-dependency warning.
- `npm run build`: passed.
- `npm run generate-routes` after build: passed with the same warning.
