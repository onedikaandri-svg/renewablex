# RenewableX: PV Calculation Methodology (MVP)

**Document status:** Draft for implementation  
**Scope:** Preliminary annual-energy and unlevered project-finance screening for grid-connected PV.

## 1. Calculation modes

### Mode A: Manual specific yield

The user supplies annual specific yield:

- `specific_yield_kwh_per_kwp_year`
- `yield_basis`: AC energy at point of delivery, or another explicitly selected boundary
- source/reference and date (recommended)
- system assumptions (tilt, azimuth, losses) for traceability

The application must define the yield boundary clearly. For the MVP, use **annual net AC energy delivered per installed kWp DC at the selected delivery boundary**. If the user instead enters a gross or pre-loss yield, the UI must identify that basis and apply losses only once.

### Mode B: Location-based estimate

The user provides latitude, longitude, installed DC capacity, mounting/tilt/azimuth assumptions, and system loss assumptions. A resource-provider adapter retrieves solar resource or estimated PV yield data.

The adapter response must include, where available:

- provider and dataset/model name
- dataset or API version
- coordinate and elevation basis
- time period / typical meteorological year basis
- tilt and azimuth
- DC capacity and system configuration
- loss assumptions
- estimated annual AC energy or specific yield
- retrieval timestamp and source attribution requirements

Do not hardcode a guessed yield. If no provider credentials or supported source are configured, return a clear validation message and allow the user to switch to manual mode.

## 2. Units and conventions

| Quantity | Unit |
|---|---|
| Installed DC capacity | kWp |
| Specific yield | kWh/kWp/year |
| Annual AC energy | kWh/year or MWh/year |
| Performance loss fraction | 0 to 1 |
| Annual degradation fraction | 0 to 1 |
| CAPEX / OPEX / revenue | Project currency |
| Discount rate | Fraction, e.g. 0.10 = 10% |
| Project life | Years |

Use decimal fractions internally for percentages. Display percentages in the UI.

## 3. Energy model

Let:

- `P_dc` = installed DC capacity (kWp)
- `Y_1` = first-year specific yield (kWh/kWp/year), after the selected loss boundary
- `d` = annual degradation fraction
- `n` = project life in years

First-year annual energy:

`E_1_kWh = P_dc × Y_1`

For year `t`:

`E_t_kWh = E_1_kWh × (1 - d)^(t - 1)`

`E_t_MWh = E_t_kWh / 1000`

If the user enters a pre-loss yield, apply the explicitly selected loss factor once:

`Y_net = Y_gross × (1 - L_total)`

Do not apply losses again when the selected yield source already reports net AC yield.

### Important simplification

The MVP uses annual energy, not hourly or sub-hourly simulation. It does not model clipping, curtailment, availability by month, shading geometry, temperature coefficients, inverter loading ratio, grid constraints, or detailed component-level losses unless those effects are already represented in the supplied yield.

## 4. Financial model

The first financial model is an **unlevered project cash-flow model**, before financing.

Required inputs:

- initial CAPEX at year 0
- annual OPEX
- revenue method: `fixed_tariff` or `self_consumption_savings`
- tariff / avoided-cost assumption
- project lifetime
- discount rate
- optional annual tariff escalation
- optional annual OPEX escalation

For a simple fixed-tariff case:

`Revenue_t = Energy_t_kWh × Tariff_per_kWh`

For self-consumption savings, this simplified model may use eligible self-consumed energy multiplied by avoided tariff. It must not assume all generation is self-consumed unless explicitly entered.

Operating cash flow before tax:

`Operating_CF_t = Revenue_t - OPEX_t`

Base pre-tax project cash flow:

- Year 0: `CF_0 = -CAPEX`
- Years 1..n: `CF_t = Revenue_t - OPEX_t`

NPV:

`NPV = Σ(CF_t / (1 + r)^t), t = 0..n`

Project IRR is the discount rate that makes NPV equal to zero. Use a robust numerical method (e.g. `numpy_financial.irr` or a bracketed root solver). If there is no valid IRR or multiple sign changes make IRR ambiguous, return a clear status rather than a misleading number.

Simple payback: first year in which cumulative **undiscounted** cash flow becomes non-negative. Interpolate within the year only if clearly labelled as an estimate. If never recovered within the project life, return `not_recovered`.

Discounted payback uses discounted cash flow and should be reported separately if implemented.

### Tax and depreciation

Tax, depreciation, incentives, debt, interest, repayment, working capital, replacement CAPEX, and terminal value are excluded from the first MVP unless a dedicated and reviewed model is added. Do not imply after-tax returns. Do not calculate equity IRR in this release.

## 5. Scenario analysis

A scenario is a copy of the base assumptions with explicit overrides. Each calculation run must store a complete immutable snapshot of all assumptions.

Suggested starter scenarios (editable by user):

- Base
- Optimistic
- Pessimistic

No scenario adjustment should be silently applied. Display the exact delta or overridden value for each parameter.

## 6. Validation and error handling

Reject or flag:

- capacity <= 0
- project life outside supported range (MVP: 1 to 40 years)
- specific yield <= 0
- loss or degradation outside 0 to 1
- discount rate <= -1
- negative CAPEX or OPEX
- missing tariff for fixed-tariff revenue
- invalid coordinates (latitude outside -90..90, longitude outside -180..180)
- missing resource-provider metadata for location mode

Warn (do not silently correct) on unusual but potentially valid assumptions, such as very high yield, loss, tariff, or degradation.

## 7. Provenance and reproducibility

Every calculation run should retain:

- complete input snapshot
- calculation engine version
- methodology version
- selected mode
- resource provider and dataset metadata, if applicable
- currency and unit conventions
- creation timestamp

Changing a project input creates a new run; it must not mutate the assumptions behind an earlier result.

## 8. Verification cases

At minimum, test:

1. `1,000 kWp × 1,500 kWh/kWp/year = 1,500,000 kWh/year` when yield is already net.
2. With 0.5% degradation, year 2 = year 1 × 0.995.
3. CAPEX is a negative year-0 cash flow.
4. NPV at zero discount rate equals the sum of all cash flows.
5. IRR for a known cash-flow vector matches a trusted reference.
6. Payback returns `not_recovered` when cumulative cash flow remains negative.
7. Invalid percentages and units are rejected.
8. Manual and location-based modes cannot apply the same loss factor twice.

## 9. Limitations disclaimer

RenewableX MVP outputs are preliminary estimates based on user-entered assumptions and/or external resource data. Results require independent review and validation before financing, procurement, permitting, or investment decisions.

## 10. Implementation conventions (engine 0.2.0)

- Tariff and OPEX escalation compound from year 2. Year 1 uses the base values.
- IRR is found by bracketed bisection between -99% and 10,000%. It returns a status instead of a number when the cash flow has no sign change, more than one sign change (`ambiguous`), or no root in the bracket.
- Payback uses unrounded cumulative cash flow. Rounding happens only in the response.
- Request fields not listed in this document are rejected.

## 11. Sensitivity (engine 0.3.0)

- One-at-a-time analysis: each case changes a single assumption and keeps all others at the base values.
- Shifts are relative to the base value. Variables: specific yield, tariff, CAPEX, annual OPEX, discount rate.
- Each case is a complete run of sections 1 to 10. No separate formulas exist.
- Ranking uses the largest absolute NPV change across the shifts of a variable.
- One-at-a-time results do not capture interactions between assumptions.
