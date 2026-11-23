# RenewableX Database Schema

**Database:** PostgreSQL (Supabase-compatible)
**Migrations:** `supabase/migrations/0001_initial_schema.sql`, `supabase/migrations/0002_align_with_api_v0_2.sql`
**Aligned with:** calculation engine API v0.2.0 (`docs/api.md`, `examples/`)

## Design notes

- UUID primary keys.
- Project data is private to its owner in the first release.
- Row Level Security (RLS) is enabled on every table in `public`. Results of the check are below.
- A calculation run stores an input snapshot and the engine and methodology versions. Immutability is a design intent and is **not enforced** yet (see "RLS findings").
- Numeric values carry explicit units in column names or metadata.
- AI analysis and reports reference a specific calculation run.
- The engine owns all formulas. The database stores inputs and results and never recomputes them.

## Main entities

| Table | Purpose |
|---|---|
| `profiles` | User profile linked to Supabase Auth |
| `projects` | Project identity and basic configuration |
| `technical_inputs` | PV technical assumptions |
| `financial_inputs` | Financial assumptions |
| `scenarios` | Named assumption variants |
| `calculation_runs` | Calculation execution and summary |
| `annual_results` | Year-by-year output |
| `ai_analyses` | AI explanations tied to a run |
| `reports` | Generated report metadata |

## Alignment with the API (state after 0002)

The API values are the reference. Where `docs/api.md` is silent, the bound comes from `app/models/schemas.py`.

| Column | Rule after 0002 | Source |
|---|---|---|
| `technical_inputs.yield_boundary` | `net_ac_at_delivery` or `gross_pre_loss`. Old `gross_before_losses` rows are converted | api.md |
| `technical_inputs.performance_loss_fraction` | 0 up to but excluding 1 | api.md |
| `technical_inputs.degradation_fraction_per_year` | 0 up to but excluding 1 | api.md |
| `technical_inputs` net yield | `net_ac_at_delivery` requires `performance_loss_fraction` = 0 | api.md |
| `technical_inputs.specific_yield_kwh_per_kwp_year` | greater than 0, up to 10,000; required for `manual_specific_yield` | api.md |
| `projects.capacity_kwp` | greater than 0, up to 10,000,000 | api.md |
| `projects.project_type` | `ground_mounted`, `rooftop`, `floating`, `carport` | schemas.py |
| `projects.country_code`, `currency_code`, `calculation_runs.currency_code` | capital letters only (2 and 3) | api.md, schemas.py |
| `projects.project_name`, `location_name` | 1 to 120 and at most 200 characters | schemas.py |
| `financial_inputs.discount_rate_fraction` and both escalations | greater than -1, up to 1 | api.md |
| `financial_inputs.tariff_per_kwh` | at most 1,000,000,000 | schemas.py |
| `calculation_runs.irr_status` (new) | `ok`, `no_sign_change`, `ambiguous`, `not_found`; IRR is stored only when `ok` | api.md |
| `calculation_runs.net_specific_yield_kwh_per_kwp_year` (new) | greater than 0 | api.md response |
| `calculation_runs.warnings` (new) | JSON array of strings | api.md response |
| `calculation_runs.energy_method` | `manual_specific_yield` or `location_based` | api.md |

### Mapping from the API response to storage

| API field | Column |
|---|---|
| `year_1_energy_kwh` | `calculation_runs.annual_energy_year1_kwh` |
| `net_specific_yield_kwh_per_kwp_year` | `calculation_runs.net_specific_yield_kwh_per_kwp_year` |
| `npv_amount`, `project_irr_fraction`, `simple_payback_years`, `payback_status` | same names on `calculation_runs` |
| `irr_status`, `warnings` | same names on `calculation_runs` |
| `inputs` | `calculation_runs.input_snapshot` (includes `notes`) |
| `annual_results[].year` | `annual_results.year_number` |
| `annual_results[].revenue`, `opex`, `cash_flow`, `cumulative_cash_flow` | `revenue_amount`, `opex_amount`, `cash_flow_amount`, `cumulative_cash_flow_amount` |
| `calculated_at` | not stored; `created_at` is the insert time |
| `scope`, `disclaimer` | not stored; constant for a methodology version |

### Deliberate differences kept

- `payback_status` also allows `not_calculated`, which the API never returns. It covers failed runs.
- `revenue_method` allows `self_consumption_savings`, which the engine rejects today. The columns are ready for later.
- `annual_results.discounted_cash_flow_amount` has no API field yet (discounted payback is not supported).
- `latitude`, `longitude`, `tilt_degrees`, `azimuth_degrees` and the `resource_*` columns are not in the API request yet. They carry the `location_based` mode (S1-03).

## Existing data and NOT VALID constraints

0002 converts values it can convert without guessing: `gross_before_losses` becomes `gross_pre_loss` (also inside `scenarios.assumption_overrides`), country and currency codes are upper-cased, and `irr_status` is set to `ok` where an IRR is stored. `calculation_runs.input_snapshot` is a record and is never rewritten, so an old snapshot can still contain `gross_before_losses`.

Rows that break a new rule are not changed. The constraint is then left `NOT VALID`: it applies to new rows and to updates of any row, and the migration prints a notice with the number of existing rows that violate it. After fixing the rows, run `alter table <t> validate constraint <name>`. Constraints that may stay `NOT VALID`:

`projects_country_code_format_check`, `projects_currency_code_format_check`, `projects_project_name_length_check`, `projects_location_name_length_check`, `projects_capacity_kwp_max_check`, `technical_inputs_performance_loss_fraction_check`, `technical_inputs_degradation_fraction_per_year_check`, `technical_inputs_net_yield_no_loss_check`, `technical_inputs_specific_yield_range_check`, `technical_inputs_manual_yield_required_check`, `financial_inputs_discount_rate_fraction_check`, `financial_inputs_annual_tariff_escalation_fraction_check`, `financial_inputs_annual_opex_escalation_fraction_check`, `financial_inputs_tariff_per_kwh_max_check`, `calculation_runs_currency_code_format_check`, `calculation_runs_energy_method_check`.

## Security

The initial policy is owner-only access. Do not expose the Supabase service-role key in frontend code. The service role bypasses RLS, so server code that uses it must check ownership itself. Public and open-source code does not mean user project data is public.

### RLS check per table (after 0002)

Checked on PostgreSQL 16 with a stand-in for the Supabase `auth` schema, using two users and an anonymous role: 61 checks, all passing. Each table was tested for read, update, delete, and insert by another user, and for anonymous access. The scripts are added to the repository in a separate task (`supabase/tests/`).

| Table | RLS | Policy | Ownership path | Result |
|---|---|---|---|---|
| `profiles` | on | select, insert, update on `auth.uid() = id`; no delete policy | own id | Isolated. Users cannot delete a profile, it goes with the auth user |
| `projects` | on | all operations on `auth.uid() = owner_id` | `owner_id` | Isolated. `with check` blocks inserting for or moving a project to another owner |
| `technical_inputs` | on | all operations, project must belong to the user | `project_id` | Isolated |
| `financial_inputs` | on | all operations, project must belong to the user | `project_id` | Isolated |
| `scenarios` | on | all operations, project must belong to the user | `project_id` | Isolated |
| `calculation_runs` | on | all operations, project must belong to the user; a scenario must belong to the same project | `project_id` | Isolated. Fixed in 0002 (finding 1) |
| `annual_results` | on | all operations, run must belong to the user | run, then project | Isolated |
| `ai_analyses` | on | all operations, run must belong to the user | run, then project | Isolated |
| `reports` | on | all operations, run must belong to the user | run, then project | Isolated. Files in Storage need their own policies (finding 4) |

### RLS findings

1. **Fixed in 0002.** With 0001 alone, a user could create a run whose `scenario_id` points to another user's scenario or to a scenario of another project (the foreign key check ignores RLS). The `calculation_runs` policy now requires the scenario to belong to the same project. Confirmed by test before and after.
2. **Open, needs a decision.** Owners can update and delete their own `calculation_runs` and `annual_results`, including `input_snapshot`. The "immutable run" intent is not enforced. A trigger or a narrower policy would fix it. This belongs to the persistence design (D3).
3. **Open, not blocking.** Policies apply to every role and rely on `auth.uid()` being null for anonymous users, which works. Restricting them to `authenticated` and writing `(select auth.uid())` is the usual hardening and speeds up large scans. `updated_at` on `profiles` and `projects` has no trigger, so it never changes after insert.
4. **Out of scope here.** `reports.storage_path` points to Supabase Storage. Bucket policies on `storage.objects` are not part of these migrations and must be added when reports are implemented.
