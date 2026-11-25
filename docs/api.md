# Calculation Engine API (v0.3.0)

Preliminary, pre-tax, unlevered PV screening. Results are estimates from user-entered assumptions. Not bankable.

## Run one sample calculation

```bash
cd services/calculation-engine
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

In a second terminal, from the repository root:

```bash
curl -X POST http://127.0.0.1:8000/v1/pv/preliminary \
  -H "Content-Type: application/json" \
  -d @examples/sample-pv-project.json
```

Interactive docs: `http://127.0.0.1:8000/docs`. The expected response for the sample is in `examples/sample-pv-response.json` (`calculated_at` differs on every run).

To run the tests, install the test tools as well: `pip install -r requirements-dev.txt`, then `pytest`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Service status and engine version |
| POST | `/v1/pv/preliminary` | Energy, NPV, IRR, and payback for one set of assumptions |
| POST | `/v1/pv/sensitivity` | How NPV, IRR, and payback move when one assumption is shifted at a time |

## Request

The body has `project`, `technical`, `financial`, and optional `notes`. Every field is required unless a default is shown. Unknown fields are rejected, so an assumption is never ignored silently. The reference is `examples/sample-pv-project.json`. `app/models/schemas.py` is the source of truth: when this table and the code differ, the code is right and this file gets fixed.

A request body larger than 65,536 bytes is rejected with HTTP 413 (see Errors). A normal request is about 1 KB.

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
| `technical.energy_method` | choice | `manual_specific_yield` (supported), `location_based` (422 until a resource provider is configured) |
| `technical.specific_yield_kwh_per_kwp_year` | kWh/kWp/year | greater than 0, up to 10,000. Required for `manual_specific_yield` |
| `technical.yield_boundary` | choice | `net_ac_at_delivery` or `gross_pre_loss` |
| `technical.performance_loss_fraction` | fraction, default 0 | 0 to below 1. Must be 0 when the yield is already net |
| `technical.degradation_fraction_per_year` | fraction | 0 to below 1 |
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
| `simple_payback_years` | First year cumulative undiscounted cash flow reaches zero, interpolated within the year (an estimate), or `null` |
| `payback_status` | `recovered` or `not_recovered` |
| `annual_results` | Year 0 to N: energy, revenue, OPEX, cash flow, cumulative cash flow |
| `warnings` | Unusual but valid values. The engine never changes them |
| `inputs`, `engine_version`, `methodology_version`, `calculated_at` | Provenance of the run |

Numeric outputs are finite or `null` with a status.

## Errors

Invalid input returns HTTP 422 with `detail`, a list of items:

| Field | Meaning |
|---|---|
| `code` | Stable identifier. Clients should branch on this, never on `msg` |
| `type` | The validation type, kept for compatibility |
| `loc` | Path to the field, starting with `body`. Two or fewer entries means the error is not tied to one field |
| `msg` | English text for people reading logs. Not stable |
| `ctx` | Limits and parameters when present, for example `{"le": 40}` |

For built-in checks, `code` equals `type` (`missing`, `greater_than`, `greater_than_equal`, `less_than`, `less_than_equal`, `string_pattern_mismatch`, `literal_error`, `int_parsing`, `float_parsing`, `int_from_float`, `string_too_short`, `string_too_long`, `extra_forbidden`). The engine adds these codes:

| `code` | When |
|---|---|
| `location_based_unavailable` | `energy_method` is `location_based` and no resource provider is configured |
| `yield_required` | `specific_yield_kwh_per_kwp_year` is missing for `manual_specific_yield` |
| `double_counted_loss` | `performance_loss_fraction` above 0 with a net yield |
| `unsupported_revenue_method` | `revenue_method` other than `fixed_tariff` |
| `non_finite_result` | Inputs so extreme that a result is not a finite number |
| `duplicate_variables`, `duplicate_shifts` | `/v1/pv/sensitivity` lists contain repeats |
| `shift_out_of_bounds` | A shift is 0, below -0.9, or above 1.0 |
| `shift_out_of_range` | A shift moves a variable outside its allowed range, for example yield above 10,000 |
| `request_too_large` | The request body is larger than 65,536 bytes. Returned with HTTP 413 instead of 422, in the same `detail` shape |

The submitted input is not echoed back in error items.

## Sensitivity

`POST /v1/pv/sensitivity` runs the same calculation as `/v1/pv/preliminary` several times, changing one assumption at a time. The reference request is `examples/sample-sensitivity-request.json`.

Request:

| Field | Meaning |
|---|---|
| `base` | A complete request body, exactly as for `/v1/pv/preliminary` |
| `variables` | Optional, 1 to 5 distinct values from `specific_yield`, `tariff`, `capex`, `opex`, `discount_rate`. Default: all five |
| `shifts` | Optional, 1 to 9 distinct fractions, each from -0.9 to 1.0 and not 0. Default: -0.2, -0.1, 0.1, 0.2 |

A shift is relative: the new value is `base value × (1 + shift)`. A base discount rate of 0 therefore stays 0, and its NPV does not change.

Response:

| Field | Meaning |
|---|---|
| `base` | NPV, IRR, IRR status, payback, and payback status of the unchanged inputs |
| `variables` | One entry per variable, sorted by `max_abs_npv_delta`, largest first |
| `variables[].field` | The request field that was shifted, for example `financial.tariff_per_kwh` |
| `variables[].base_value` | Its value in `base` |
| `variables[].cases` | One entry per shift, sorted by shift: `shift_fraction`, `input_value` (the shifted value), `npv_amount`, `npv_delta` (versus the base), IRR and payback with their statuses |

A shift that would break a limit of the request (for example yield above 10,000) returns 422 with `shift_out_of_range`. Every case is a full engine run, so results match `/v1/pv/preliminary` for the same inputs.

## Operations

- Each request writes one JSON log line with `method`, `path`, `status`, `duration_ms`, and `engine_version`. The request body and query string are never logged, because assumptions can be commercially sensitive.
- `/docs` and `/openapi.json` stay open. Revisit this when user accounts exist.

## Conventions

- Degradation applies from year 2. Escalation of tariff and OPEX also compounds from year 2, so year 1 uses the base values.
- A gross yield has the performance loss applied once. A net yield with a loss above 0 is rejected as double counting.
- CAPEX is a negative year-0 cash flow. Tax, debt, and incentives are excluded.

## Not supported yet

- `energy_method: location_based` returns 422 until a resource provider is configured (S1-03). Use `manual_specific_yield`.
- `revenue_method: self_consumption_savings` returns 422.
- Discounted payback and equity IRR.
