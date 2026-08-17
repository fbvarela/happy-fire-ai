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

## AI explanations

Set `COHERE_API_KEY` to enable the optional explanation for a completed estimate. The key is server-only. AI text is explanatory only: it never changes the numeric score, risk factors, safety notice, or emergency guidance. Without the key, or if Cohere is unavailable, the app shows deterministic fallback text.

## Copernicus land cover

Set `CDSE_CLIENT_ID` and `CDSE_CLIENT_SECRET` for server-side client-credentials access, or use `CDSE_ACCESS_TOKEN` for local/test fallback. Land-cover fuel dryness is a 0-100 weighted score: tree 0.8, shrub 0.8, grass 0.9, crops 0.6, and bare cover 0.1, with each fraction supplied as a percentage. Zero-fraction pixels use the documented `Discrete_Classification` band. Tokens are cached briefly in process memory and never logged. Official product and collection: https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/clms/land-cover-and-land-use-mapping/global-dynamic-land-cover/lc_global_100m_yearly_v3.html (`byoc-35fecfec-8a73-4723-bb08-b775f283a535`; `Tree_Cover_Fraction`, `Shrub_Cover_Fraction`, `Grass_Cover_Fraction`, `Crops_Cover_Fraction`, `Bare_Cover_Fraction`, `Discrete_Classification`).

Generated using European Union's Copernicus Land Monitoring Service information.

## WorldPop population exposure

Set `WORLDPOP_ENABLED=true` to use WorldPop population estimates for the exposure input. The query uses an approximately 1 km radius window around the requested coordinate. An optional `WORLDPOP_API_KEY` can be configured for authenticated requests; it is used only on the server and never logged or sent to the client. WorldPop data is available under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) from the [WorldPop stats API](https://api.worldpop.org/v1/services/stats).

Set `DGT_ROAD_CLOSURES_ENABLED=true` to query the official Spain DGT DATEX2 v3.7 feed for nearby active road closures. The feed covers the state road network except the Basque Country and Catalonia, and is used only to display closure status. Happy Fire does not calculate or recommend a safest route. Source: [DGT NAP Incidencias DATEX2 v3.7](https://nap.dgt.es/dataset/incidencias-dgt-datex2-v3-7).
