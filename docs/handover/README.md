# Handover: project state

Read this before starting new work. It records where the project stands, where things live, and what is still open. Update it when a stage finishes or a decision changes.

Last updated: 2026-11-28, from `main` at commit `f0cac42`.

## Current state

| Item | Value |
|---|---|
| Engine version | 0.7.0 (`services/calculation-engine/app/version.py`) |
| Methodology version | 0.3.0 (quick PV screening formulas) |
| Hybrid API contract | 0.7 (accepts 0.5 and 0.6 requests) |
| Hosting | Engine on Render (free plan, sleeps when idle), web on Vercel |
| CI | `.github/workflows/ci.yml`: pytest for the engine, typecheck, vitest, and build for the web |

## Development stages

Stages follow `AGENTS.md` section 10. Each has a contract document in `docs/`.

| Stage | Scope | Contract | Status |
|---|---|---|---|
| 1 | Engine foundation: time grid, component interface, power balance, PVWatts, CSV load, CLI | [hybrid-engine-contract.md](../hybrid-engine-contract.md) | Merged |
| 2 | Detailed PV, BESS with degradation, built-in dispatch | [stage-2-pv-bess-contract.md](../stage-2-pv-bess-contract.md) | Merged. Benchmark in [pv-benchmark-report.md](../pv-benchmark-report.md) |
| 3A | Biomass model | [stage-3-biomass-ems-contract.md](../stage-3-biomass-ems-contract.md) | Merged |
| 3B | Custom EMS rule interpreter | same | Merged (commit `c7bd3b9`). See open items |
| 4 | Finance and project lifetime | [stage-4-finance-lifetime-contract.md](../stage-4-finance-lifetime-contract.md) | Merged |
| 5 | Core UI, steps 1 to 7, base dashboard | [stage-5-ui-api-contract.md](../stage-5-ui-api-contract.md) | Merged |
| 6A | Schematic canvas | [stage-6a-schematic-canvas-contract.md](../stage-6a-schematic-canvas-contract.md) | Merged |
| 6B | Visual EMS editor | none yet | In progress on branch `feat/custom-ems-visual-builder-trilingual` |
| 7 | Sweep, comparison, sensitivity, export | [stage-7-sweep-compare-export-contract.md](../stage-7-sweep-compare-export-contract.md) | Merged |
| 8A | Performance, accessibility, user guide | [stage-8-polish-accessibility-docs-component-contract.md](../stage-8-polish-accessibility-docs-component-contract.md) | Merged |
| 8B | Diesel generator through the shared component interface | same | Merged |

## Where things live

**Engine** (`services/calculation-engine/`)

- `app/main.py`: FastAPI app, CORS (`ALLOWED_ORIGINS`), validation error handler.
- `app/api/`: endpoints. `pv.py` and `sensitivity.py` for quick screening, `hybrid.py` for everything under `/v1/hybrid`, `hybrid_schemas.py` for request models.
- `app/services/`: quick PV screening formulas (`energy.py`, `finance.py`, `calculate.py`).
- `app/hybrid/`: hybrid engine. `time_grid.py`, `weather.py`, `load.py`, `components.py`, `pv_detailed.py`, `bess.py`, `biomass.py`, `diesel.py`, `dispatch.py`, `ems.py`, `simulator.py`, `lifetime.py`, `finance.py`, `sensitivity.py`, `excel_export.py`, `cli.py`.
- `app/providers/`: weather and resource adapters (manual, PVGIS, NASA POWER).
- `tests/`: unit, property, golden-case, and API tests. Golden fixtures are in `tests/hybrid/fixtures/`.
- `scripts/benchmark_hybrid.py`: repeatable performance benchmark.

**Web** (`apps/web/`): see [apps/web/README.md](../../apps/web/README.md).

**Database** (`supabase/migrations/`): schema for the quick PV mode. Hybrid entities from `AGENTS.md` section 8 are not in the database yet.

## Decisions already made

These come from earlier contracts and `docs/HANDOVER-engine.md`. Do not reverse them without the owner's approval.

1. Quick PV screening is pre-tax and unlevered. Degradation and escalation start in year 2.
2. Performance losses are applied once. A `net_ac_at_delivery` yield with a non-zero loss is rejected.
3. IRR uses bisection and returns a status (`ok`, `no_sign_change`, `ambiguous`, `not_found`), never `nan`.
4. Rounding happens only on output.
5. Request schemas reject unknown fields. 422 errors carry a stable `code`, and clients branch on `code`, not on the message.
6. Leap days are dropped (`ignore_feb_29`), so a year is 365 x 24 hourly steps.
7. EMS rules are JSON data validated against a whitelist of variables. User configuration is never executed as code.
8. The frontend never recalculates engine metrics. It may format numbers, convert display units, and decimate chart points.
9. The minor engine version goes up when endpoints or fields are added. The methodology version goes up when a formula or definition changes.

## Open items

1. **Controller package install on `main`.** `requirements.txt` on `main` installs `renewablex-hybrid-controller` from a private Git repository, which fails for anyone without access, including CI. Branch `feat/custom-ems-visual-builder-trilingual` (commit `6dce495`) copies the package into `services/calculation-engine/packages/`. Merge that branch before relying on CI results.
2. **Final EMS schema from the owner.** The custom EMS interpreter runs on the draft rule format. Confirm it matches the owner's schema (`AGENTS.md` section 12, item 1).
3. **`docs/api.md` covers only the quick PV endpoints** and its header still says v0.4.0. Hybrid endpoints are documented in the stage contracts.
4. **Legacy files at the repository root.** `app/` and `components/` at the root are an older copy of the quick PV screen. The deployed app builds from `apps/web/`. Confirm with the owner before deleting them.
5. **Hybrid persistence.** Hybrid projects live in browser `localStorage`. Storing them in Supabase needs a database and API contract approved by the owner.
6. **Owner inputs still pending** (`AGENTS.md` section 12): approved weather source and target region, real datasheet parameters, default economic assumptions and tariffs, logo and final product name, palette decision.

## Older handover notes

[docs/HANDOVER-engine.md](../HANDOVER-engine.md) (Indonesian) describes the engine at version 0.3.0, before the hybrid work. Its decisions still apply to quick PV screening. Its version numbers and test counts are out of date.
