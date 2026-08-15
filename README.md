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
