-- RenewableX initial schema
-- Requires Supabase auth schema (auth.users).

create extension if not exists pgcrypto;

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.projects (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    project_name text not null,
    technology text not null default 'solar_pv'
        check (technology in ('solar_pv')),
    project_type text not null default 'ground_mounted'
        check (project_type in ('ground_mounted', 'rooftop')),
    country_code char(2) not null default 'ID',
    location_name text,
    latitude double precision check (latitude is null or latitude between -90 and 90),
    longitude double precision check (longitude is null or longitude between -180 and 180),
    capacity_kwp numeric(14,3) not null check (capacity_kwp > 0),
    lifetime_years integer not null check (lifetime_years between 1 and 40),
    currency_code char(3) not null default 'IDR',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.technical_inputs (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.projects(id) on delete cascade,
    energy_method text not null check (energy_method in ('manual_specific_yield', 'location_based')),
    specific_yield_kwh_per_kwp_year numeric(12,3),
    yield_boundary text not null default 'net_ac_at_delivery'
        check (yield_boundary in ('net_ac_at_delivery', 'gross_before_losses')),
    performance_loss_fraction numeric(8,6) not null default 0
        check (performance_loss_fraction between 0 and 1),
    degradation_fraction_per_year numeric(8,6) not null default 0.005
        check (degradation_fraction_per_year between 0 and 1),
    tilt_degrees numeric(6,2) check (tilt_degrees is null or tilt_degrees between 0 and 90),
    azimuth_degrees numeric(6,2) check (azimuth_degrees is null or azimuth_degrees between 0 and 360),
    resource_provider text,
    resource_dataset text,
    resource_dataset_version text,
    resource_period text,
    resource_retrieved_at timestamptz,
    source_metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists public.financial_inputs (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.projects(id) on delete cascade,
    capex_amount numeric(20,2) not null check (capex_amount >= 0),
    annual_opex_amount numeric(20,2) not null default 0 check (annual_opex_amount >= 0),
    revenue_method text not null default 'fixed_tariff'
        check (revenue_method in ('fixed_tariff', 'self_consumption_savings')),
    tariff_per_kwh numeric(20,6),
    self_consumption_fraction numeric(8,6)
        check (self_consumption_fraction is null or self_consumption_fraction between 0 and 1),
    discount_rate_fraction numeric(8,6) not null default 0.10
        check (discount_rate_fraction > -1),
    annual_tariff_escalation_fraction numeric(8,6) not null default 0
        check (annual_tariff_escalation_fraction > -1),
    annual_opex_escalation_fraction numeric(8,6) not null default 0
        check (annual_opex_escalation_fraction > -1),
    tax_model text not null default 'pre_tax'
        check (tax_model = 'pre_tax'),
    created_at timestamptz not null default now(),
    check (
        (revenue_method = 'fixed_tariff' and tariff_per_kwh is not null and tariff_per_kwh >= 0)
        or
        (revenue_method = 'self_consumption_savings' and tariff_per_kwh is not null
         and tariff_per_kwh >= 0 and self_consumption_fraction is not null)
    )
);

create table if not exists public.scenarios (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.projects(id) on delete cascade,
    scenario_name text not null,
    description text,
    assumption_overrides jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (project_id, scenario_name)
);

create table if not exists public.calculation_runs (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references public.projects(id) on delete cascade,
    scenario_id uuid references public.scenarios(id) on delete set null,
    engine_version text not null,
    methodology_version text not null,
    energy_method text not null,
    input_snapshot jsonb not null,
    annual_energy_year1_kwh numeric(20,3) not null,
    npv_amount numeric(20,2),
    project_irr_fraction numeric(12,8),
    simple_payback_years numeric(12,4),
    payback_status text not null default 'not_calculated'
        check (payback_status in ('recovered', 'not_recovered', 'not_calculated')),
    currency_code char(3) not null,
    status text not null default 'completed'
        check (status in ('completed', 'failed')),
    created_at timestamptz not null default now()
);

create table if not exists public.annual_results (
    id uuid primary key default gen_random_uuid(),
    calculation_run_id uuid not null references public.calculation_runs(id) on delete cascade,
    year_number integer not null check (year_number between 0 and 40),
    energy_kwh numeric(20,3) not null default 0,
    revenue_amount numeric(20,2) not null default 0,
    opex_amount numeric(20,2) not null default 0,
    cash_flow_amount numeric(20,2) not null default 0,
    discounted_cash_flow_amount numeric(20,2),
    cumulative_cash_flow_amount numeric(20,2),
    unique (calculation_run_id, year_number)
);

create table if not exists public.ai_analyses (
    id uuid primary key default gen_random_uuid(),
    calculation_run_id uuid not null references public.calculation_runs(id) on delete cascade,
    provider text not null,
    model_name text not null,
    prompt_version text not null,
    analysis_text text not null,
    created_at timestamptz not null default now()
);

create table if not exists public.reports (
    id uuid primary key default gen_random_uuid(),
    calculation_run_id uuid not null references public.calculation_runs(id) on delete cascade,
    report_type text not null default 'preliminary_feasibility',
    storage_path text not null,
    created_at timestamptz not null default now()
);

create index if not exists idx_projects_owner on public.projects(owner_id);
create index if not exists idx_technical_inputs_project on public.technical_inputs(project_id);
create index if not exists idx_financial_inputs_project on public.financial_inputs(project_id);
create index if not exists idx_scenarios_project on public.scenarios(project_id);
create index if not exists idx_runs_project_created on public.calculation_runs(project_id, created_at desc);
create index if not exists idx_annual_results_run on public.annual_results(calculation_run_id);

-- Row Level Security: users may access only their own project data.
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.technical_inputs enable row level security;
alter table public.financial_inputs enable row level security;
alter table public.scenarios enable row level security;
alter table public.calculation_runs enable row level security;
alter table public.annual_results enable row level security;
alter table public.ai_analyses enable row level security;
alter table public.reports enable row level security;

create policy "profiles_select_own" on public.profiles
for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "projects_owner_all" on public.projects
for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "technical_inputs_owner_all" on public.technical_inputs
for all using (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
);

create policy "financial_inputs_owner_all" on public.financial_inputs
for all using (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
);

create policy "scenarios_owner_all" on public.scenarios
for all using (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
);

create policy "calculation_runs_owner_all" on public.calculation_runs
for all using (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
);

create policy "annual_results_owner_all" on public.annual_results
for all using (
    exists (
        select 1 from public.calculation_runs r
        join public.projects p on p.id = r.project_id
        where r.id = calculation_run_id and p.owner_id = auth.uid()
    )
) with check (
    exists (
        select 1 from public.calculation_runs r
        join public.projects p on p.id = r.project_id
        where r.id = calculation_run_id and p.owner_id = auth.uid()
    )
);

create policy "ai_analyses_owner_all" on public.ai_analyses
for all using (
    exists (
        select 1 from public.calculation_runs r
        join public.projects p on p.id = r.project_id
        where r.id = calculation_run_id and p.owner_id = auth.uid()
    )
) with check (
    exists (
        select 1 from public.calculation_runs r
        join public.projects p on p.id = r.project_id
        where r.id = calculation_run_id and p.owner_id = auth.uid()
    )
);

create policy "reports_owner_all" on public.reports
for all using (
    exists (
        select 1 from public.calculation_runs r
        join public.projects p on p.id = r.project_id
        where r.id = calculation_run_id and p.owner_id = auth.uid()
    )
) with check (
    exists (
        select 1 from public.calculation_runs r
        join public.projects p on p.id = r.project_id
        where r.id = calculation_run_id and p.owner_id = auth.uid()
    )
);
