# AGENTS.md

TanStack Start + TanStack Router + React 19 + TypeScript (strict), server via Nitro with the Vercel preset. Deterministic fire-risk dashboard; external providers are opt-in via env vars and default to mock. Spec: `spec.md`; implementation plan: `PLAN.md`.

## Commands

- `npm run dev` — dev server on port 3000 (`vite dev --port 3000`)
- `npm run test` — `vitest run --passWithNoTests`
- `npm test -- <file>` — run one test file, e.g. `npm test -- src/domain/risk.test.ts`
- `npm run generate-routes` — regenerate `src/routeTree.gen.ts` after adding/renaming files under `src/routes`
- `npm run build` — production build; emits `.vercel/output` via the Nitro Vercel preset (`.vercel/` is gitignored)
- There is **no lint or typecheck script**. The release gate is `npm test` → `npm run generate-routes` (must produce no diff) → `npm run build` → `git diff --check`.

## Architecture

- `src/domain/` — pure, provider-free logic: `environment.ts` (normalized `EnvironmentalContext`), `risk.ts` (`calculateRisk`, deterministic, `modelVersion: 'mvp-2'`). Never import React or providers here.
- `src/server/` — server functions (`createServerFn`) and the provider adapter layer. `providers/*.ts` factories accept an injected `fetcher` for tests and gate on `process.env`.
- `src/routes/` — TanStack Router file routes; `api/v1/risk.ts` is a Nitro server handler reusing the same scoring pipeline.
- Providers resolve in `src/server/environment.ts`: each is enabled by env, and every provider failure falls back to the deterministic mock context with a `*Warning` and `status: 'error'` — never a silent success.

## Provider env gates (all server-only)

- Weather: `WEATHER_PROVIDER=open-meteo` (unset/mock = deterministic mock). Open-Meteo also supplies elevation/slope.
- Land cover: `CDSE_CLIENT_ID` + `CDSE_CLIENT_SECRET` or `CDSE_ACCESS_TOKEN` (Copernicus).
- Population: `WORLDPOP_ENABLED=true`, optional `WORLDPOP_API_KEY`.
- Road closures: `DGT_ROAD_CLOSURES_ENABLED=true` (Spain DGT DATEX2; display only, never a route recommendation).
- AI explanation: `COHERE_API_KEY` (optional, server-only, must never affect the score).

## Safety constraints (architectural)

- The risk score is deterministic and LLM-generated text is explanatory only — AI must never change the score, factors, safety notice, or emergency guidance.
- Missing/stale/error data lowers confidence and is never treated as safe.
- No "safest"/evacuation route may be inferred from the risk score; road data is display-only.

## Gotchas

- `src/routeTree.gen.ts` is committed and marked read-only in `.vscode/settings.json`. Regenerate it, don't hand-edit; verify no diff after route changes.
- Weather context is cached in-process (10 min TTL, 32 entries, 90 min staleness threshold); API `/api/v1/risk` rate-limits per-IP 60/min in-process. Both reset per server instance.
- Aliases `#/*` (package.json `imports`) and `@/*` (tsconfig) both map to `./src/*`; existing code mostly uses relative imports.
- `npm run build` requires a fresh `node_modules` (no lockfile-present node_modules right now); no CI workflows exist in this repo.