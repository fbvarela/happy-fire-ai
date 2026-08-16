# WorldPop Population Exposure Report

## Implemented

- Added the server-only `PopulationProvider` and `createWorldPopPopulationProvider`.
- WorldPop requests use `wpgppop`, 2020, synchronous execution, and a local polygon FeatureCollection.
- HTTP status, payload status/error, and finite non-negative population values are validated.
- Requests use `AbortSignal.timeout`; `WORLDPOP_API_KEY` is optional, server-only, and never logged.
- Added `exposureSource` and `exposureWarning` to environmental context.
- WorldPop is enabled only by `WORLDPOP_ENABLED=true` or `WORLDPOP_API_KEY`.
- Population exposure is cached with weather, terrain, and fuel.
- WorldPop failure preserves live weather and fuel and renders a fallback warning/source.
- Added README attribution, license, API URL, and setup instructions.

## Verification

- Focused tests: 35 passed.
- Full tests: 64 passed.
- TypeScript: `npx tsc --noEmit` passed.
- Vercel build: `npm run build` passed.
- `git diff --check` passed.

## Antimeridian and Log Follow-up

- WorldPop rejects normalized longitudes within 0.5 degrees of either antimeridian edge before constructing a wrapping polygon; ordinary 1 km windows remain unchanged.
- Terrain and land-cover failure logs now omit precise coordinates and retain source, fallback status, duration, and error details.

## Latest Verification

- Focused tests: 41 passed.
- Full tests: 70 passed.
- TypeScript: `npx tsc --noEmit` passed.
- Vercel build: `npm run build` passed.
- `git diff --check` passed.

## Latest Review Follow-up

- WorldPop rejects non-finite coordinates and locations with absolute latitude at or above 89.5 degrees before constructing the local window; valid near-pole and dateline coordinates remain covered by regression tests.
- Shared `weather-fetch`, `weather-cache-hit`, and `weather-fetch-failed` logs no longer include latitude or longitude. They retain duration, source/status, and cache timing metadata.

## Latest Verification

- Focused tests: 40 passed.
- Full tests: 69 passed.
- TypeScript: `npx tsc --noEmit` passed.
- Vercel build: `npm run build` passed.
- `git diff --check` passed.

## Notes

- No dependency was added.
- The unrelated pre-existing `.idea/` worktree item was not modified.

## Review follow-up

- Added WorldPop `created` task polling through `/v1/tasks/{taskid}` with finished/failed validation and bounded interval/total polling time.
- Preserved direct finished responses.
- Reworked the query polygon to an approximately 1 km radius window with latitude clamping, dateline-safe longitude normalization, and valid coordinate bounds, including pole coverage tests.
- Removed precise coordinates from population fetch logs; logs retain status and duration.

## Follow-up Verification

- Focused tests: 39 passed.
- Full tests: 68 passed.
- TypeScript: `npx tsc --noEmit` passed.
- Vercel build: `npm run build` passed.
- `git diff --check` passed.
