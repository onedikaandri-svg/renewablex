# RenewableX

RenewableX is an open-source tool for designing and analysing hybrid energy systems built from solar PV, battery storage (BESS), biomass generation, and an energy management system (EMS). It also keeps a quick PV screening mode for early feasibility checks.

> **Status:** active development, engine version 0.7.0, methodology version 0.3.0.
> **License:** Apache License 2.0.
> **Scope:** preliminary analysis only. Results are not a substitute for bankable energy-yield studies, detailed engineering, legal or tax advice, or investment due diligence.

## What it does

The app has two workspaces.

**Quick PV screening (`/`)** takes an annual specific yield and project costs, then returns annual energy, unlevered pre-tax cash flows, NPV, IRR, payback, and a one-variable sensitivity table.

**Hybrid system design (`/hybrid`)** walks through ten steps: project, location and weather, load profile, system schematic, EMS strategy, economics, run, results, compare, and export. The engine behind it:

- simulates every hour of the year (8,760 steps) and aggregates to day, month, year, and project lifetime (up to 40 years);
- models PV with either a PVWatts-style method or a detailed chain (transposition, cell temperature, single-diode DC model, inverter, itemised losses);
- models BESS state of charge, efficiency, and calendar plus cycle degradation with replacement;
- models biomass units with minimum load, ramp rate, up and down times, fuel curves, and fuel supply limits;
- includes an optional diesel generator and grid connection;
- dispatches with five built-in strategies (self-consumption, load following, cycle charging, peak shaving, time-of-use arbitrage) or a custom rule set stored as JSON data, never as executable code;
- closes the power balance every hour and records unmet load and curtailment explicitly;
- computes LCOE, total net present cost, NPV, IRR, simple and discounted payback, renewable fraction, and avoided emissions;
- runs size sweeps, scenario comparison, and tornado plus 5 x 5 sensitivity analysis;
- exports PDF (print), Excel (`.xlsx`), CSV, and JSON.

The web interface is available in English, Indonesian, and Japanese, with IDR or USD display and light and dark themes.

## How the pieces fit

| Part | Path | Notes |
|---|---|---|
| Calculation engine | `services/calculation-engine/` | Python 3.11, FastAPI, NumPy. All formulas live here. |
| Web app | `apps/web/` | Next.js 16, React 19, ECharts for charts, Leaflet for the map. Displays engine results and recalculates nothing. |
| Database schema | `supabase/migrations/` | Supabase (PostgreSQL). Hybrid projects are currently stored in the browser (`localStorage`). |
| Documentation | `docs/` | Methodology, assumptions, API contracts per stage, user guides. |
| Examples | `examples/` | Sample PV request and response, sample 8,760-hour load CSV. |

Results are deterministic: the same configuration and seed give the same numbers. AI tools are not part of the calculation path and do not produce or overwrite results.

## Quick start

### Requirements

- Python 3.11 (`services/calculation-engine/runtime.txt` pins 3.11.9 for hosting)
- Node.js 22 (the version CI uses)
- Git

### 1. Run the calculation engine

```bash
cd services/calculation-engine
python -m venv .venv

# macOS/Linux
source .venv/bin/activate
# Windows PowerShell
# .venv\Scripts\Activate.ps1

pip install -r requirements.txt
uvicorn app.main:app --reload
```

Interactive API docs open at http://127.0.0.1:8000/docs, and http://127.0.0.1:8000/health reports the engine version.

### 2. Run the web app

In a second terminal:

```bash
cd apps/web
npm ci
npm run dev
```

Open http://localhost:3000. The web app calls `http://127.0.0.1:8000` by default. To point it elsewhere, set `NEXT_PUBLIC_API_URL` in `apps/web/.env.local`. See [apps/web/README.md](apps/web/README.md).

### 3. Run a hybrid simulation without the web app

The engine has a command-line entry point that reads a JSON configuration and writes results to a folder:

```bash
cd services/calculation-engine
python -m app.hybrid.cli run tests/hybrid/fixtures/golden_jakarta_config.json -o out
```

### 4. Run the tests

```bash
cd services/calculation-engine
pip install -r requirements-dev.txt
pytest
```

```bash
cd apps/web
npm run typecheck
npm test
npm run build
```

CI runs both sets on every pull request to `main` ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## API overview

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Service status and engine version |
| POST | `/v1/pv/preliminary` | Quick PV screening |
| POST | `/v1/pv/sensitivity` | One-variable sensitivity for quick PV screening |
| GET | `/v1/hybrid/presets` | Component and fuel presets |
| POST | `/v1/hybrid/weather/preview` | Fetch and summarise hourly weather |
| POST | `/v1/hybrid/load/preview` | Validate and summarise a load profile |
| POST | `/v1/hybrid/ems/validate` | Validate a custom EMS rule set |
| POST | `/v1/hybrid/simulate` | Run one hybrid simulation synchronously |
| POST, GET | `/v1/hybrid/jobs`, `/v1/hybrid/jobs/{job_id}` | Run a long simulation as an async job and poll it |
| POST, GET | `/v1/hybrid/sweep/jobs`, `/v1/hybrid/sweep/jobs/{job_id}` | Size sweep as an async job (plus `/cancel`) |
| POST | `/v1/hybrid/sensitivity` | Tornado and 5 x 5 sensitivity for a hybrid case |
| POST | `/v1/hybrid/export/excel` | Multi-sheet Excel report |

Request and response details: [docs/api.md](docs/api.md) for the PV endpoints, and the stage contracts in `docs/` (starting with [docs/hybrid-engine-contract.md](docs/hybrid-engine-contract.md)) for the hybrid endpoints. Changes to these JSON structures need owner approval first.

## Documentation

| Document | Contents |
|---|---|
| [docs/handover/README.md](docs/handover/README.md) | Current project state, where things live, open items. Start here. |
| [docs/user-guide.md](docs/user-guide.md) | User guide in English ([Indonesian version](docs/user-guide-id.md)) |
| [docs/calculation-methodology.md](docs/calculation-methodology.md) | Quick PV screening formulas |
| [docs/assumptions.md](docs/assumptions.md) | Sources for every default parameter |
| [docs/pv-benchmark-report.md](docs/pv-benchmark-report.md) | PV model comparison against pvlib |
| [docs/providers.md](docs/providers.md) | Weather and resource data providers |
| [docs/database-schema.md](docs/database-schema.md) | Database tables |
| [DESIGN.md](DESIGN.md) | Visual design direction for the web app |
| [AGENTS.md](AGENTS.md) | Rules for AI coding agents working in this repo |

## Engineering principles

- Formulas run only in the Python engine. The frontend formats numbers and nothing more.
- Units are explicit and input ranges are validated.
- Every default parameter has a source in `docs/assumptions.md` or carries a `[REAL DATA]` label.
- The UI shows whether a value came from the user, a default, or an external source.
- Formula changes come with a methodology reference and tests.
- Preliminary results are never described as bankable or guaranteed.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Work on a feature branch and open a pull request to `main`. Do not push to `main` directly.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
