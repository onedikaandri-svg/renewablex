# Contributing to RenewableX

Thanks for your interest in contributing.

## Before opening an issue or pull request

- Search existing issues to avoid duplicates.
- For calculation changes, explain the engineering/financial methodology.
- State units and whether inputs are AC/DC, gross/net, pre-tax/after-tax, or levered/unlevered.
- Include at least one reproducible test case.
- Do not include confidential project data, credentials, or personal data.

## Pull request checklist

- [ ] Scope is focused and documented.
- [ ] Tests pass locally.
- [ ] Formula changes include references and assumptions.
- [ ] API/schema changes are documented.
- [ ] No secrets or confidential data are included.
- [ ] User-facing limitations are clear.

## Development approach

Use a feature branch and submit a pull request to `main`. Do not push to `main` directly. Numeric calculation changes require review before merge.

Changes to API JSON structures or the database schema start as a pull request containing only the contract document, and wait for owner approval before implementation. New dependencies also go in their own pull request with the reason, the license, and the built-in alternatives considered.

## Running the checks

```bash
cd services/calculation-engine
pip install -r requirements-dev.txt
pytest
```

```bash
cd apps/web
npm ci
npm run typecheck
npm test
npm run build
```

Project state and open items: [docs/handover/README.md](docs/handover/README.md). Rules for AI coding agents: [AGENTS.md](AGENTS.md).
