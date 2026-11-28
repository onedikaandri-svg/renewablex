# RenewableX web

Next.js app for both workspaces: quick PV screening (`/`) and hybrid system design (`/hybrid`). It shows what the calculation engine returns and holds no formulas of its own.

## Run locally

Start the engine first (see the root [README](../../README.md)), then:

```bash
cd apps/web
npm ci
npm run dev
```

Open http://localhost:3000.

The app calls `http://127.0.0.1:8000` unless `NEXT_PUBLIC_API_URL` is set. To use another engine, create `apps/web/.env.local` with:

```bash
NEXT_PUBLIC_API_URL=https://your-engine.example.com
```

The engine's `ALLOWED_ORIGINS` must include this site's address (for local work, `http://localhost:3000`).

## Where things are

| Path | Contents |
|---|---|
| `app/page.tsx` | Quick PV screening |
| `app/hybrid/` | Hybrid project list, guide, and the ten step pages under `[projectId]/` |
| `components/hybrid/` | Dashboard, schematic canvas, charts, sweep, sensitivity, print report |
| `lib/` | API clients, formatting, storage, export helpers, and their tests |
| `lib/preferences.tsx` | Language (EN, ID, JA), currency, and theme settings |

Hybrid projects are saved in the browser's `localStorage`. Export a `.hybrid.json` backup from the project list or the export step.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

Design direction: [DESIGN.md](../../DESIGN.md) in the repository root.
