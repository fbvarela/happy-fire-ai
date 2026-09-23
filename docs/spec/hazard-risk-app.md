# OpenSpec: Hazard Risk App

## Overview

Transform the current fire-risk dashboard into a multi-hazard risk application. The app will assess and display risk scores across multiple hazard categories and provide an overall composite risk score.

## Hazards

### 1. Wildfire Risk (existing)
- Current deterministic scoring via `src/domain/risk.ts`
- Environmental context from weather, land cover, elevation, slope
- **Status**: Migrate existing logic; no breaking changes to score calculation

### 2. Radioactivity Levels
- **Data source**: External radiation monitoring APIs (e.g., EURDEP, national nuclear agencies)
- **Env gate**: `RADIOACTIVITY_PROVIDER=<provider>` (e.g., `eurdep`)
- **Metrics**: Ambient dose rate (µSv/h), radionuclide concentrations
- **Score range**: 0–100 (higher = more dangerous)
- **Fallback**: Deterministic mock with `*Warning` on failure

### 3. Water Pollution
- **Data source**: Copernicus Marine Service / national water quality agencies
- **Env gate**: `WATER_POLLUTION_PROVIDER=<provider>`
- **Metrics**: Contaminant levels, turbidity, heavy metals, microplastics
- **Score range**: 0–100
- **Fallback**: Deterministic mock with `*Warning` on failure

### 4. Radon Risk
- **Data source**: National radon maps / geological surveys
- **Env gate**: `RADON_PROVIDER=<provider>` (e.g., `ine` for Spain)
- **Metrics**: Radon concentration (Bq/m³), geological risk zones
- **Score range**: 0–100
- **Fallback**: Deterministic mock with `*Warning` on failure

### 5. Flood Risk
- **Data source**: Hydrological monitoring networks
- **Env gate**: `FLOOD_PROVIDER=<provider>`
- **Metrics**: River levels, rainfall accumulation, soil saturation
- **Score range**: 0–100
- **Fallback**: Deterministic mock with `*Warning` on failure

### 6. Air Quality
- **Data source**: EEA / national air quality networks
- **Env gate**: `AIR_QUALITY_PROVIDER=<provider>`
- **Metrics**: PM2.5, PM10, NO₂, O₃, AQI
- **Score range**: 0–100
- **Fallback**: Deterministic mock with `*Warning` on failure

## Scoring Architecture

### Per-Hazard Score
Each hazard produces a score in the range **0–100** via a deterministic function in `src/domain/hazards/<hazard>.ts`.

### Composite Score
- **Group score**: Average of all enabled hazard scores in a category (e.g., environmental, geological)
- **Overall score**: Weighted average of all group scores
- **Weights** are configurable via env var `RISK_WEIGHTS` (JSON object, e.g. `{"wildfire":0.3,"radioactivity":0.2}`)
- Default weights: equal weighting across all enabled hazards

### Score Display
```
┌─────────────────────────────────┐
│  Overall Risk:  72 / 100  🔴   │
├─────────────────────────────────┤
│  Environmental                    │
│  Wildfire        85  🔴          │
│  Air Quality     40  🟡          │
│  Water Pollution 15  🟢          │
│  Group Avg:      47              │
├─────────────────────────────────┤
│  Geological                       │
│  Radon           60  🟡          │
│  Flood           30  🟢          │
│  Group Avg:      45              │
├─────────────────────────────────┤
│  Radiation                        │
│  Radioactivity  90  🔴          │
│  Group Avg:      90              │
└─────────────────────────────────┘
```

## Domain Layer Changes

### New files
- `src/domain/hazards/wildfire.ts` — migrate from `risk.ts`
- `src/domain/hazards/radioactivity.ts`
- `src/domain/hazards/water-pollution.ts`
- `src/domain/hazards/radon.ts`
- `src/domain/hazards/flood.ts`
- `src/domain/hazards/air-quality.ts`
- `src/domain/composite.ts` — group and overall score calculation

### Updated files
- `src/domain/environment.ts` — extend `EnvironmentalContext` with hazard-specific fields
- `src/domain/risk.ts` — **deprecated**; re-export from `wildfire.ts` for backward compat

## Provider Layer Changes

### New files
- `src/server/providers/radioactivity.ts`
- `src/server/providers/water-pollution.ts`
- `src/server/providers/radon.ts`
- `src/server/providers/flood.ts`
- `src/server/providers/air-quality.ts`

### Existing
- `src/server/providers/weather.ts` — reused for wildfire context
- `src/server/providers/land-cover.ts` — reused for wildfire context

## Safety Constraints (unchanged)

- All scores are deterministic; AI-generated text is explanatory only
- AI must never change any score, factor, safety notice, or emergency guidance
- Missing/stale/error data lowers confidence and is never treated as safe
- No route recommendations from any hazard data

## API Changes

### `GET /api/v1/risk`
- Response now includes `hazards` object with per-hazard scores
- Response includes `groups` object with per-group averages
- Response includes `overall` score
- Backward-compatible: existing `score` field remains as overall

### New endpoint
- `GET /api/v1/hazards` — list all supported hazards with their status (enabled/disabled, last update, data quality)

## UI Changes

- Replace single-score view with hazard grid
- Color coding: 🟢 0–33 (low), 🟡 34–66 (medium), 🔴 67–100 (high)
- Group sections collapsible
- Overall score prominently displayed at top
- Each hazard shows: name, score, trend indicator, data freshness

## Migration Plan

1. **Phase 1**: Create domain layer for new hazards with mock data
2. **Phase 2**: Implement provider adapters for each hazard
3. **Phase 3**: Build composite scoring logic
4. **Phase 4**: Update API endpoints
5. **Phase 5**: Update UI components
6. **Phase 6**: Add env-gated provider integration tests

## Env Variables Summary

| Variable | Purpose |
|---|---|
| `RADIOACTIVITY_PROVIDER` | Radioactivity data source |
| `WATER_POLLUTION_PROVIDER` | Water pollution data source |
| `RADON_PROVIDER` | Radon data source |
| `FLOOD_PROVIDER` | Flood data source |
| `AIR_QUALITY_PROVIDER` | Air quality data source |
| `RISK_WEIGHTS` | JSON object for hazard weights |
| `WEATHER_PROVIDER` | Existing — kept for wildfire |
| `CDSE_CLIENT_ID` / `CDSE_CLIENT_SECRET` | Existing — kept for wildfire |
| `WORLDPOP_ENABLED` | Existing — kept |
| `DGT_ROAD_CLOSURES_ENABLED` | Existing — display only |
| `COHERE_API_KEY` | Existing — AI explanation only |
| `JEV_AI_ENABLED` / `JEV_API_KEY` | Existing — AI advisory only |