# AGENTS.md

TanStack Start + TanStack Router + React 19 + TypeScript (strict), server via Nitro with the Vercel preset. Deterministic multi-hazard risk dashboard; external providers are opt-in via env vars and default to mock. Spec: `docs/spec/hazard-risk-app.md`; legacy spec: `spec.md`; plan: `PLAN.md`.

## Commands

- `npm run dev` — dev server on port 3000 (`vite dev --port 3000`)
- `npm run test` — `vitest run --passWithNoTests`
- `npm test -- <file>` — run one test file, e.g. `npm test -- src/domain/risk.test.ts`
- `npm run generate-routes` — regenerate `src/routeTree.gen.ts` after adding/renaming files under `src/routes`
- `npm run build` — production build; emits `.vercel/output` via the Nitro Vercel preset (`.vercel/` is gitignored)
- There is **no lint or typecheck script**. The release gate is `npm test` → `npm run generate-routes` (must produce no diff) → `npm run build` → `git diff --check`.

## Architecture

- `src/domain/` — pure, provider-free logic: `environment.ts` (normalized `EnvironmentalContext`), `hazards/*.ts` (per-hazard deterministic 0–100 scorers; `wildfire.ts` holds the migrated `calculateRisk`, `modelVersion: 'mvp-2'`), `composite.ts` (group/overall weighted scores). `risk.ts` is a deprecated re-export of `hazards/wildfire`. Never import React or providers here.
- `src/server/` — server functions (`createServerFn`) and the provider adapter layer. `providers/*.ts` factories accept an injected `fetcher` for tests and gate on `process.env`. `hazard-environment.ts` resolves the hazard providers with mock fallback; `assessment.ts` is the pure deterministic interval/data-quality layer (no AI); `assessment-service.ts` is its env-gated Jev wrapper.
- `src/routes/` — TanStack Router file routes; `api/v1/risk.ts` and `api/v1/hazards.ts` are Nitro server handlers reusing the same scoring pipeline.
- Providers resolve in `src/server/environment.ts` / `src/server/hazard-environment.ts`: each is enabled by env, and every provider failure falls back to the deterministic mock context with a `*Warning` and `status: 'error'` — never a silent success.

## Provider env gates (all server-only)

- Weather: `WEATHER_PROVIDER=open-meteo` (unset/mock = deterministic mock). Open-Meteo also supplies elevation/slope.
- Location search: `GEOCODING_PROVIDER=nominatim` (OpenStreetMap Nominatim, global, no key; unset/mock = deterministic mock results, always labelled).
- Land cover: `CDSE_CLIENT_ID` + `CDSE_CLIENT_SECRET` or `CDSE_ACCESS_TOKEN` (Copernicus).
- Population: `WORLDPOP_ENABLED=true`, optional `WORLDPOP_API_KEY`.
- Road closures: `DGT_ROAD_CLOSURES_ENABLED=true` (Spain DGT DATEX2; display only, never a route recommendation).
- Air quality: `AIR_QUALITY_PROVIDER=open-meteo` (Open-Meteo Air Quality / CAMS, global, no key).
- Flood: `FLOOD_PROVIDER=open-meteo` (Open-Meteo Flood / GloFAS river discharge, global, no key).
- Radioactivity: `RADIOACTIVITY_PROVIDER=bfs` (Germany BfS ODL-Info WFS, µSv/h) or `safecast` (global citizen-science CPM, sparse/stale).
- Water pollution: `WATER_POLLUTION_PROVIDER=eea-bathing` (EEA bathing-water classification, Europe) or `eea-pfas` (EEA PFAS monitoring concentrations, sparse).
- Radon: `RADON_PROVIDER=epa-ie` (Ireland EPA radon risk map WFS, CC-BY; static national map).
- Hazard weights: `RISK_WEIGHTS` JSON object keyed by hazard id (e.g. `{"wildfire":0.3,"radioactivity":0.2}`); unnamed hazards share the leftover weight, default is equal weighting.
- AI explanation: `COHERE_API_KEY` (optional, server-only, must never affect the score).
- AI advisory: `JEV_AI_ENABLED=true` + `JEV_API_KEY` (Jev/TypeSafe, optional, server-only). Adds a display-only advisory (data sufficiency, anomalies, provider reliability) via `src/server/assessment-service.ts`; can only widen the risk interval upward and append warnings — never changes the score.

## Safety constraints (architectural)

- The risk score is deterministic and LLM-generated text is explanatory only — AI must never change the score, factors, safety notice, or emergency guidance.
- Missing/stale/error data lowers confidence and is never treated as safe.
- No "safest"/evacuation route may be inferred from the risk score; road data is display-only.

## Gotchas

- `src/routeTree.gen.ts` is committed and marked read-only in `.vscode/settings.json`. Regenerate it, don't hand-edit; verify no diff after route changes.
- Weather context is cached in-process (10 min TTL, 32 entries, 90 min staleness threshold); API `/api/v1/risk` rate-limits per-IP 60/min in-process. Both reset per server instance.
- Aliases `#/*` (package.json `imports`) and `@/*` (tsconfig) both map to `./src/*`; existing code mostly uses relative imports.
- `npm run build` requires a fresh `node_modules` (no lockfile-present node_modules right now); no CI workflows exist in this repo.