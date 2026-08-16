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

## Notes

- No dependency was added.
- The unrelated pre-existing `.idea/` worktree item was not modified.
