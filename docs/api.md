# Calculation Engine API (v0.4.0)

Preliminary, pre-tax, unlevered PV screening. Results are estimates from user-entered assumptions. Not bankable.

## Run one sample calculation

cd services/calculation-engine
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload

In a second terminal, from the repository root:

curl -X POST http://127.0.0.1:8000/v1/pv/preliminary \
  -H "Content-Type: application/json" \
  -d @examples/sample-pv-project.json

Interactive docs: `http://127.0.0.1:8000/docs`. The expected response for the sample is in `examples/sample-pv-response.json` (`calculated_at` differs on every run).

To run the tests, install the test tools as well: `pip install -r requirements-dev.txt`, then `pytest`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Service status and engine version |
| POST | `/v1/pv/preliminary` | Energy, NPV, IRR, and payback for one set of assumptions |
| POST | `/v1/pv/sensitivity` | How NPV, IRR, and payback move when one assumption is shifted at a time |

## Request

The body has `project`, `technical`, `financial`, and optional `notes`. Every field is required unless a default is shown. Unknown fields are rejected, so an assumption is never ignored silently. The reference is `examples/sample-pv-project.json`. `app/models/schemas.py` is the source of truth.

A request body larger than 65,536 bytes is rejected with HTTP 413.

| Field | Type or unit | Allowed values |
|---|---|---|
| `project.project_name` | text | 1 to 120 characters |
| `project.technology` | fixed | `solar_pv` |
| `project.project_type` | choice | `ground_mounted`, `rooftop`, `floating`, `carport` |
| `project.country_code` | ISO 3166-1 alpha-2 | two capital letters, for example `ID` |
| `project.location_name` | text, optional | up to 200 characters |
| `project.capacity_kwp` | kWp | greater than 0, up to 10,000,000 |
| `project.lifetime_years` | years | integer, 1 to 40 |
| `project.currency_code` | ISO 4217 | three capital letters, for example `IDR` |
| `technical.energy_method` | choice | `manual_specific_yield`, `location_based` |
| `technical.resource_source` | choice, default `pvgis` | `pvgis` (supported), `nasa` (422 unavailable) |
| `technical.specific_yield_kwh_per_kwp_year` | kWh/kWp/year | Required for `manual_specific_yield`. Ignored for `location_based` |
| `technical.yield_boundary` | choice | `net_ac_at_delivery` or `gross_pre_loss` |
| `technical.performance_loss_fraction` | fraction, default 0 | 0 to below 1. Must be 0 when the manual yield is already net. When `location_based`, this is sent to PVGIS as the loss parameter |
| `technical.degradation_fraction_per_year` | fraction | 0 to below 1 |
| `technical.latitude` | degrees | -90 to 90. Required for `location_based` |
| `technical.longitude` | degrees | -180 to 180. Required for `location_based` |
| `technical.tilt_degrees` | degrees, default 0 | 0 to 90 |
| `technical.azimuth_degrees` | degrees, default 180 | -180 to 180 (180 is North) |
| `financial.capex_amount` | currency | 0 to 10^18 |
| `financial.annual_opex_amount` | currency per year | 0 to 10^18 |
| `financial.revenue_method` | choice | `fixed_tariff` (supported), `self_consumption_savings` (422) |
| `financial.tariff_per_kwh` | currency per kWh | 0 to 1,000,000,000 |
| `financial.discount_rate_fraction` | fraction | greater than -1, up to 1 |
| `financial.annual_tariff_escalation_fraction` | fraction, default 0 | greater than -1, up to 1 |
| `financial.annual_opex_escalation_fraction` | fraction, default 0 | greater than -1, up to 1 |
| `financial.tax_model` | fixed | `pre_tax` |
| `notes` | text, optional | up to 2,000 characters |

## Response

| Field | Meaning |
|---|---|
| `npv_amount` | NPV at the discount rate, year 0 to N, in project currency |
| `project_irr_fraction` | IRR as a fraction, or `null` when `irr_status` is not `ok` |
| `irr_status` | `ok`, `no_sign_change`, `ambiguous` (more than one sign change), or `not_found` |
| `simple_payback_years` | First year cumulative undiscounted cash flow reaches zero, interpolated within the year, or `null` |
| `payback_status` | `recovered` or `not_recovered` |
| `annual_results` | Year 0 to N: energy, revenue, OPEX, cash flow, cumulative cash flow |
| `warnings` | English text for unusual but valid values |
| `warning_codes` | Stable codes for the warnings, for example `high_specific_yield`, `resource_data_fetched` |
| `resource_metadata` | If `location_based`, contains provider, dataset, version, period, and retrieval timestamp |
| `inputs`, `engine_version`, `methodology_version`, `calculated_at` | Provenance of the run |

## Errors

Invalid input returns HTTP 422 with `detail`, a list of items. Clients must branch on `code`, never on `msg`.

The engine adds these codes (others match Pydantic defaults):

| `code` | When |
|---|---|
| `location_required` | `energy_method` is `location_based` but latitude or longitude is missing |
| `resource_source_unavailable` | `resource_source` is `nasa` (not implemented yet) |
| `yield_required` | `specific_yield_kwh_per_kwp_year` is missing for `manual_specific_yield` |
| `double_counted_loss` | `performance_loss_fraction` above 0 with a manual net yield |
| `unsupported_revenue_method` | `revenue_method` other than `fixed_tariff` |
| `out_of_coverage` | PVGIS rejected the location (for example, over the sea) |
| `provider_unavailable` | PVGIS returned a 5xx error or network failed |
| `provider_timeout` | PVGIS request exceeded 10 seconds |
| `provider_invalid_response` | PVGIS returned unparsable data |
| `non_finite_result` | Inputs so extreme that a result is not a finite number |
| `duplicate_variables`, `duplicate_shifts` | `/v1/pv/sensitivity` lists contain repeats |
| `shift_out_of_bounds` | A shift is 0, below -0.9, or above 1.0 |
| `shift_out_of_range` | A shift moves a variable outside its allowed range |

## Sensitivity

`POST /v1/pv/sensitivity` runs the same calculation as `/v1/pv/preliminary` several times, changing one assumption at a time.

Request:

| Field | Meaning |
|---|---|
| `base` | A complete request body, exactly as for `/v1/pv/preliminary` |
| `variables` | Optional, 1 to 5 distinct values from `specific_yield`, `tariff`, `capex`, `opex`, `discount_rate`. Default: all five |
| `shifts` | Optional, 1 to 9 distinct fractions, each from -0.9 to 1.0 and not 0. Default: -0.2, -0.1, 0.1, 0.2 |

Response matches v0.3.0, with the addition that if `base` uses `location_based`, the provider is called once and its result is reused for all cases.

## Conventions

- Degradation applies from year 2. Escalation compounds from year 2.
- When `manual_specific_yield` is used, a gross yield has the performance loss applied once. A net yield with a loss above 0 is rejected.
- When `location_based` is used, the engine calls PVGIS with `performance_loss_fraction`, sets the boundary to `net_ac_at_delivery`, and zeroes out the loss before the financial calculation to prevent double counting.

## Not supported yet

- `resource_source: nasa` returns 422.
- `revenue_method: self_consumption_savings` returns 422.
- Discounted payback and equity IRR.
