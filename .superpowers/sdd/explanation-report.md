# Cohere Explanation Slice

Implemented the approved opt-in explanation flow.

- Added a timeout-bound Cohere v2 Chat provider using `command-a-03-2025`, JSON mode, server-side authorization, and strict `{summary, drivers, caveat}` validation.
- Added a validated TanStack server function that sends only score, risk level, and allowlisted factor labels. Missing keys and provider failures return deterministic fallback text.
- Added an accessible `ExplanationPanel` with explicit action, loading, error, fallback, and Cohere source states.
- Kept score calculation, factors, safety notice, and emergency guidance independent of model output.
- Documented `COHERE_API_KEY` and the explanatory-only boundary in `README.md`.

## Verification

- Focused tests: 4 passed.
- Full tests: 75 passed.
- TypeScript: `npx tsc --noEmit` passed.
- Vercel production build: `npm run build` passed.
- Diff check: `git diff --check` passed.

The test runner reports an existing 10-second Vite shutdown timeout after successful runs; it does not affect test results.
