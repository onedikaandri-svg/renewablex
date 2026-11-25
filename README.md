# RenewableX

**Open-source Renewable Energy Project Feasibility Platform**

RenewableX helps renewable energy developers perform preliminary technical and financial screening of renewable energy projects. The first release focuses on grid-connected solar PV, with both manual specific-yield input and optional location-based resource estimation.

> **Status:** Early-stage MVP / active development  
> **License:** Apache License 2.0  
> **Scope:** Preliminary screening only — not a substitute for bankable energy-yield studies, detailed engineering, legal/tax advice, or investment due diligence.

## Product goals

- Create and save PV project assumptions.
- Estimate annual AC energy generation over the project lifetime.
- Calculate unlevered project cash flows, NPV, project IRR, and payback.
- Compare user-defined scenarios.
- Provide transparent calculation assumptions and reproducible results.
- Offer AI-assisted explanations and report drafting in a later milestone.

## MVP decisions

| Area | Decision |
|---|---|
| PV energy method | Both manual specific yield and location-based estimation |
| Deployment | Free-tier services for prototype/beta |
| License | Apache-2.0 |
| Initial technology | Grid-connected PV |
| Calculation ownership | Deterministic Python calculation engine; AI does not calculate or overwrite results |
| Initial location method | Provider adapter; manual input remains available as fallback |

## Planned stack

- Web: Next.js + TypeScript
- API and calculation engine: Python + FastAPI
- Calculations: Python (the formulas currently use only the standard library)
- Database and authentication: Supabase (PostgreSQL)
- Charts: Recharts
- Hosting: free-tier-compatible hosting, subject to current provider limits
- CI: GitHub Actions

Provider pricing, free-tier quotas, and availability can change. Confirm limits before public launch.

## Repository layout

```text
renewablex/
├── apps/
│   └── web/                       # Next.js frontend (Sprint 2+)
├── services/
│   └── calculation-engine/
│       ├── app/
│       │   ├── api/
│       │   ├── models/
│       │   └── services/
│       ├── tests/
│       ├── requirements.txt       # what the service needs to run
│       └── requirements-dev.txt   # adds the test tools
├── supabase/
│   └── migrations/
├── docs/
│   ├── product-blueprint.md
│   ├── calculation-methodology.md
│   ├── database-schema.md
│   └── user-guide.md
├── examples/
│   └── sample-pv-project.json
├── .github/
│   ├── ISSUE_TEMPLATE/
│   └── workflows/
├── .env.example
├── .gitignore
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
└── LICENSE
```

## Quick start

The initial Sprint 0/1 deliverable is the calculation engine. The frontend and hosted deployment are added in later sprints.

### Requirements

- Python 3.11+ (CI and the hosted service use 3.11.11)
- Git

### Run the calculation engine

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

API documentation will be available at `http://127.0.0.1:8000/docs`.

### Try a sample calculation

With the service running, follow [docs/api.md](docs/api.md) to post `examples/sample-pv-project.json` and compare with `examples/sample-pv-response.json`.

### Run tests

```bash
## Menjalankan Tes (Mesin)
cd services/calculation-engine
pip install -r requirements-dev.txt
pytest
```

## Energy calculation modes

1. **Manual specific yield:** user enters a documented annual specific yield in kWh/kWp/year.
2. **Location-based estimate:** user supplies coordinates and system assumptions; a configured solar-resource provider adapter returns resource data and a documented yield estimate. If no provider is configured, the app must ask the user to enter specific yield manually. It must not silently invent a yield.

The location-based method is an estimate. The source, dataset version, period, tilt/azimuth assumptions, losses, and timestamp should be stored with the calculation run.

## Engineering principles

- Store units explicitly and validate ranges.
- Keep input assumptions immutable for each calculation run.
- Version the calculation engine.
- Use deterministic formulas for all numeric results.
- Keep AI separate from the calculation engine.
- Add tests for formulas, edge cases, and sample projects.
- Show users whether a value is user-provided, defaulted, or externally sourced.
- Never describe preliminary results as bankable or guaranteed.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Please include a methodology reference and tests for changes to engineering or financial formulas.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
