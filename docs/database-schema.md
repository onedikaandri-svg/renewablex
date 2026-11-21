# RenewableX Database Schema

**Database:** PostgreSQL (Supabase-compatible)  
**Migration:** `supabase/migrations/0001_initial_schema.sql`

## Design notes

- UUID primary keys.
- Project data is private to its owner in the first release.
- Row Level Security (RLS) is enabled on user-owned tables.
- Calculation runs retain immutable input snapshots and engine/methodology versions.
- Store numeric values with explicit units in column names or metadata.
- AI analysis and reports reference a specific calculation run.

## Main entities

| Table | Purpose |
|---|---|
| `profiles` | User profile linked to Supabase Auth |
| `projects` | Project identity and basic configuration |
| `technical_inputs` | PV technical assumptions |
| `financial_inputs` | Financial assumptions |
| `scenarios` | Named assumption variants |
| `calculation_runs` | Immutable calculation execution and summary |
| `annual_results` | Year-by-year output |
| `ai_analyses` | AI explanations tied to a run |
| `reports` | Generated report metadata |

## Security

The initial policy is owner-only access. Do not expose the Supabase service-role key in frontend code. Use RLS and server-side authorization. Public/open-source code does not mean user project data is public.
