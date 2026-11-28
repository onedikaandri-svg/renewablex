# GitHub Issues (Sprint 0): Repository & Project Foundation

Create each section below as an individual GitHub Issue.

## S0-01: Initialize public repository and project documentation
**Labels:** documentation, setup  
**Priority:** P0

**Tasks**
- Create public repository `renewablex`.
- Add README, Apache-2.0 LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.
- Add `.gitignore` and `.env.example`.
- Add initial folder structure.

**Acceptance criteria**
- Repository can be cloned.
- README explains scope, setup, limitations, and contribution process.
- No secrets or confidential data are committed.

## S0-02: Define PV MVP calculation contract
**Labels:** calculation, documentation  
**Priority:** P0

**Tasks**
- Agree units and energy boundary.
- Define manual specific-yield mode.
- Define location-based provider adapter contract.
- Define pre-tax, unlevered financial model boundaries.
- Document validation rules and limitations.

**Acceptance criteria**
- `docs/calculation-methodology.md` reviewed.
- All input fields have units and validation ranges.
- Yield losses cannot be applied twice.
- Location mode records provider/source metadata and has a manual fallback.

## S0-03: Create sample project and reference calculations
**Labels:** calculation, tests  
**Priority:** P0

**Tasks**
- Add at least one clearly labelled synthetic PV project.
- Prepare independently checked expected energy outputs.
- Prepare financial reference cash flows and NPV/IRR checks.

**Acceptance criteria**
- Sample data is non-confidential and labelled illustrative.
- Expected outputs can be independently reproduced.
- Reference assumptions and units are documented.

## S0-04: Add GitHub Actions CI
**Labels:** setup, tests  
**Priority:** P1

**Tasks**
- Configure Python test workflow.
- Run tests on pull requests and pushes affecting calculation engine.
- Document local test command.

**Acceptance criteria**
- Workflow runs successfully on a clean checkout.
- Failed tests block a successful CI result.
