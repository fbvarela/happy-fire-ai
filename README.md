# happy-fire-ai

A minimal TanStack Start app with one route and plain CSS.

```bash
npm install
npm run dev
```
Edit `src/routes/index.tsx` to get started. Add route files under
`src/routes`; TanStack Router updates `src/routeTree.gen.ts` for you.

Build the production app with:

```bash
npm run build
```

## Deploy on Vercel

This project uses Nitro's Vercel preset. Import the repository into Vercel and use the default build settings; Vercel will run `npm run build` and publish Nitro's generated Vercel output.

```bash
npm run build
```

For local preview, run `npm run preview` after the build. Vercel deployment details are documented at https://nitro.build/deploy/providers/vercel.

## Weather data

The server can use Open-Meteo without an API key or SDK:

```bash
WEATHER_PROVIDER=open-meteo npm run dev
```

Leave `WEATHER_PROVIDER` unset or set it to `mock` for deterministic offline development. Stale Open-Meteo data is surfaced as `stale`; unavailable provider errors fall back to the deterministic mock context. The provider timestamp is exposed as the context `observedAt` value; data older than 90 minutes is marked stale.

Successful default Open-Meteo responses are cached for 10 minutes per running server instance, with a maximum of 32 coordinate entries. Expired entries and the oldest entries are evicted. This is a best-effort Vercel cache, not shared or durable storage; injected providers are never cached. Server logs emit structured `weather-fetch`, `weather-cache-hit`, and `weather-fetch-failed` events with request timing; cache hits include source timestamp, age, and expiry.

## Copernicus land cover

Set `CDSE_CLIENT_ID` and `CDSE_CLIENT_SECRET` for server-side client-credentials access, or use `CDSE_ACCESS_TOKEN` for local/test fallback. Land-cover fuel dryness is a 0-100 weighted score: tree 0.8, shrub 0.8, grass 0.9, crops 0.6, and bare cover 0.1, with each fraction supplied as a percentage. Tokens are cached briefly in process memory and never logged. Official product and collection: https://land.copernicus.eu/en/products/corine-land-cover.

Generated using European Union's Copernicus Land Monitoring Service information.
