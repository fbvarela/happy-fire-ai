# Copernicus Land-Cover Integration Report

Implemented server-only Copernicus land-cover retrieval with BYOC `byoc-35fecfec-8a73-4723-bb08-b775f283a535`, 1x1 JSON output, validated cover fractions, and documented weighted dryness scoring.

Added client-credentials token retrieval with a short-lived in-process cache, access-token fallback, request timeouts, isolated fuel fallback, normalized `fuelSource`, cache persistence, UI source disclosure, warnings, tests, and Copernicus attribution.

Verification: focused tests, full tests, TypeScript, route generation, `npm run build`, `npx vercel build --yes`, and `git diff --check` passed.
