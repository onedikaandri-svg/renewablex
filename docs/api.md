# Calculation Engine API (v0.2.1)

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

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Service status and engine version |
| POST | `/v1/pv/preliminary` | Energy, NPV, IRR, and payback for one set of assumptions |

## Request

The body has `project`, `technical`, `financial`, and optional `notes`. Unknown fields are rejected, so an assumption is never ignored silently. The reference is `examples/sample-pv-project.json`.

| Field | Unit | Range |
|---|---|---|
| `project.capacity_kwp` | kWp | greater than 0, up to 10,000,000 |
| `project.lifetime_years` | years | integer, 1 to 40 |
| `project.currency_code` | ISO 4217 | three capital letters |
| `technical.specific_yield_kwh_per_kwp_year` | kWh/kWp/year | greater than 0, up to 10,000 |
| `technical.yield_boundary` | n/a | `net_ac_at_delivery` or `gross_pre_loss` |
| `technical.performance_loss_fraction` | fraction | 0 to below 1; must be 0 when the yield is already net |
| `technical.degradation_fraction_per_year` | fraction | 0 to below 1 |
| `financial.capex_amount`, `annual_opex_amount` | currency | 0 or more |
| `financial.tariff_per_kwh` | currency/kWh | 0 or more |
| `financial.discount_rate_fraction` | fraction | greater than -1, up to 1 |
| `financial.annual_tariff_escalation_fraction`, `annual_opex_escalation_fraction` | fraction | greater than -1, up to 1; default 0 |

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

The submitted input is not echoed back in error items.

## Conventions

- Degradation applies from year 2. Escalation of tariff and OPEX also compounds from year 2, so year 1 uses the base values.
- A gross yield has the performance loss applied once. A net yield with a loss above 0 is rejected as double counting.
- CAPEX is a negative year-0 cash flow. Tax, debt, and incentives are excluded.

## Not supported yet

- `energy_method: location_based` returns 422 until a resource provider is configured (S1-03). Use `manual_specific_yield`.
- `revenue_method: self_consumption_savings` returns 422.
- Discounted payback and equity IRR.
