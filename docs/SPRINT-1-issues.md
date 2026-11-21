# GitHub Issues — Sprint 1: PV Calculation Engine

Create each section below as an individual GitHub Issue.

## S1-01 — Scaffold FastAPI calculation service
**Labels:** feature, backend  
**Priority:** P0

**Tasks**
- Set up Python package structure.
- Add FastAPI app and `/health` endpoint.
- Add dependency and local run instructions.

**Acceptance criteria**
- Service starts locally.
- `/health` returns a valid status response.
- API docs are available in development.

## S1-02 — Implement PV energy calculation for manual specific yield
**Labels:** calculation, feature  
**Priority:** P0

**Tasks**
- Validate installed DC capacity and specific yield.
- Calculate year-1 annual energy.
- Calculate annual energy over project lifetime using degradation.
- Return results with units and methodology version.

**Acceptance criteria**
- 1,000 kWp × 1,500 kWh/kWp/year = 1,500,000 kWh/year.
- Degradation is applied from year 2 onward.
- Invalid capacity, yield, life, and degradation are rejected.
- Unit tests cover normal and boundary cases.

## S1-03 — Implement location-based yield provider interface
**Labels:** feature, calculation, integration  
**Priority:** P1

**Tasks**
- Define provider interface and normalized response schema.
- Capture coordinates, tilt, azimuth, source, dataset/version, period, and retrieval timestamp where available.
- Add provider configuration through environment variables.
- Return a clear error/fallback when no provider is configured.

**Acceptance criteria**
- Provider-specific response is normalized to the internal schema.
- Source metadata is retained.
- No default or guessed yield is silently substituted.
- Manual specific-yield mode remains available.

## S1-04 — Implement unlevered pre-tax financial model
**Labels:** calculation, feature  
**Priority:** P0

**Tasks**
- Generate year 0 to year N cash flows.
- Calculate annual revenue and OPEX.
- Calculate NPV and project IRR.
- Calculate simple payback and `not_recovered` status.
- Handle ambiguous or unavailable IRR safely.

**Acceptance criteria**
- CAPEX is recorded as negative year-0 cash flow.
- NPV matches an independently checked reference case.
- IRR matches a trusted reference within defined tolerance.
- Payback status is correct when cash flow never recovers.
- Output clearly states pre-tax and unlevered scope.

## S1-05 — Add API request/response schemas and validation
**Labels:** backend, feature  
**Priority:** P0

**Tasks**
- Define typed request and response models.
- Validate units, ranges, currency, and required fields.
- Return readable validation errors.
- Include engine and methodology versions.

**Acceptance criteria**
- Invalid requests return appropriate 4xx responses.
- Valid requests return stable documented response structure.
- Numeric outputs are finite or explicitly null with a status.

## S1-06 — Add calculation regression test suite
**Labels:** tests, calculation  
**Priority:** P0

**Tasks**
- Test energy arithmetic and degradation.
- Test NPV at zero discount rate.
- Test known IRR cash-flow vectors.
- Test payback and not-recovered conditions.
- Test invalid inputs and yield loss double-counting.

**Acceptance criteria**
- Tests run in CI.
- Test cases document expected values and tolerances.
- Formula changes cannot merge without passing tests.

## S1-07 — Add sample API request and usage documentation
**Labels:** documentation  
**Priority:** P1

**Tasks**
- Add sample JSON request and response.
- Document API endpoint, units, and limitations.
- Document how to run tests and service locally.

**Acceptance criteria**
- A new contributor can run one sample calculation by following the docs.
