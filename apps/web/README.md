# RenewableX web

Next.js screen for the preliminary PV screening. It shows what the calculation engine returns and holds no formulas of its own.

## Run locally

Start the engine first (see `docs/api.md`), then:

```bash
cd apps/web
cp .env.example .env.local   # Windows: copy .env.example .env.local
npm ci
npm run dev
```

Open http://localhost:3000. `NEXT_PUBLIC_API_URL` must point at the engine, and the engine's `ALLOWED_ORIGINS` must include this site's address.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

Design direction: `DESIGN.md` in the repository root.
