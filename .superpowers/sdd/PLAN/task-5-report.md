# Task 5 Report: Bounded Fire-Spread Simulation

## Status

Implemented Task 5 from `task-5-brief.md`.

## Domain Simulation

- Added `src/domain/simulation.ts` with the requested `SimulationCell`, `SimulationGrid`, `SimulationOptions`, and `stepSimulation` interfaces.
- The step function is pure and deterministic: burning cells become burned, orthogonally adjacent empty cells may ignite, and existing burned cells remain burned.
- Spread is bounded to the supplied grid. Dryness and slope provide base influence; wind speed and downwind alignment add deterministic influence. No randomness or external data is used.
- Added `src/domain/simulation.test.ts` before the implementation and verified the expected missing-module failure before adding production code.
- Tests cover burning-to-burned transitions, adjacent spread, and preservation of unrelated cells with zero wind.

## Canvas UI

- Added `src/components/FireSimulation.tsx` using native Canvas 2D.
- Added Start, Pause, Step, and Reset controls with a visible step count.
- The visualization is labeled `Hypothetical scenario` and explicitly states that it is not a forecast or evacuation route.
- Selected context values are used for wind direction, wind speed, slope, and vegetation dryness.
- Missing context values use documented fallback assumptions: north wind at 15 kph, 10 degrees slope, and vegetation dryness 60.
- Integrated the simulation below the existing dashboard without removing or changing the existing risk safety notice.
- Added responsive styling consistent with the existing dashboard.

## Verification

- `npm test -- src/domain/simulation.test.ts`: 3 tests passed.
- `npm test`: 2 test files and 7 tests passed.
- `npm run build`: passed and generated the Vercel output.
- `git diff --check`: passed.

## Concerns

- The simulation is intentionally illustrative and must not be used for operational fire prediction, evacuation decisions, or route planning.
- The test/build runner reports the existing warning that `VERCEL_OIDC_TOKEN` is not set; this did not fail verification.
- Browser-only Canvas interaction was not exercised in a real browser session; compilation and the pure simulation suite passed.

## Review Fix

- Added `describeSimulationAssumptions` in `FireSimulation.tsx` and a regression test covering a context with wind speed and slope available but wind direction and vegetation dryness missing.
- The fallback message now lists only missing fields, while `getOptions` continues to use every available environmental value.
- The hypothetical scenario and non-forecast/non-evacuation-route labeling are unchanged.

### Verification Output

```text
$ npm test
Test Files  2 passed (2)
Tests  8 passed (8)

$ npm run build
successfully generated the Vercel output

$ git diff --check
passed with no output
```
