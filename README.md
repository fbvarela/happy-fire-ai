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

Leave `WEATHER_PROVIDER` unset or set it to `mock` for deterministic offline development. Invalid, stale, or unavailable Open-Meteo responses fall back to the deterministic mock context. The provider timestamp is exposed as the context `observedAt` value; data older than 90 minutes is marked stale.
