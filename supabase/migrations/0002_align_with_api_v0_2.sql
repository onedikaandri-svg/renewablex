-- Align the schema with the calculation engine API v0.2.0 (docs/api.md, app/models/schemas.py).
-- Rule: convert old values first, then swap constraints. Rows that cannot be converted
-- safely keep their data and the new constraint is left NOT VALID (see the last block).

begin;

-- projects ------------------------------------------------------------------

alter table public.projects drop constraint if exists projects_project_type_check;
alter table public.projects add constraint projects_project_type_check
    check (project_type in ('ground_mounted', 'rooftop', 'floating', 'carport'));

update public.projects set country_code = upper(country_code) where country_code <> upper(country_code);
update public.projects set currency_code = upper(currency_code) where currency_code <> upper(currency_code);

alter table public.projects drop constraint if exists projects_country_code_format_check;
alter table public.projects add constraint projects_country_code_format_check
    check (country_code ~ '^[A-Z]{2}$') not valid;

alter table public.projects drop constraint if exists projects_currency_code_format_check;
alter table public.projects add constraint projects_currency_code_format_check
    check (currency_code ~ '^[A-Z]{3}$') not valid;

alter table public.projects drop constraint if exists projects_project_name_length_check;
alter table public.projects add constraint projects_project_name_length_check
    check (char_length(project_name) between 1 and 120) not valid;

alter table public.projects drop constraint if exists projects_location_name_length_check;
alter table public.projects add constraint projects_location_name_length_check
    check (location_name is null or char_length(location_name) <= 200) not valid;

alter table public.projects drop constraint if exists projects_capacity_kwp_max_check;
alter table public.projects add constraint projects_capacity_kwp_max_check
    check (capacity_kwp <= 10000000) not valid;

-- technical_inputs ----------------------------------------------------------

alter table public.technical_inputs drop constraint if exists technical_inputs_yield_boundary_check;
update public.technical_inputs set yield_boundary = 'gross_pre_loss' where yield_boundary = 'gross_before_losses';
alter table public.technical_inputs add constraint technical_inputs_yield_boundary_check
    check (yield_boundary in ('net_ac_at_delivery', 'gross_pre_loss'));

-- Scenario overrides feed future runs, so the old value is renamed there too.
-- Past calculation_runs.input_snapshot rows are records and stay untouched.
update public.scenarios
set assumption_overrides = jsonb_set(assumption_overrides, '{yield_boundary}', '"gross_pre_loss"')
where assumption_overrides ->> 'yield_boundary' = 'gross_before_losses';

update public.scenarios
set assumption_overrides = jsonb_set(assumption_overrides, '{technical,yield_boundary}', '"gross_pre_loss"')
where assumption_overrides -> 'technical' ->> 'yield_boundary' = 'gross_before_losses';

-- The API rejects 1 (a 100 percent loss or a fully degraded system), 0001 allowed it.
alter table public.technical_inputs drop constraint if exists technical_inputs_performance_loss_fraction_check;
alter table public.technical_inputs add constraint technical_inputs_performance_loss_fraction_check
    check (performance_loss_fraction >= 0 and performance_loss_fraction < 1) not valid;

alter table public.technical_inputs drop constraint if exists technical_inputs_degradation_fraction_per_year_check;
alter table public.technical_inputs add constraint technical_inputs_degradation_fraction_per_year_check
    check (degradation_fraction_per_year >= 0 and degradation_fraction_per_year < 1) not valid;

-- A net yield with a loss above 0 counts losses twice, so the API rejects it.
alter table public.technical_inputs drop constraint if exists technical_inputs_net_yield_no_loss_check;
alter table public.technical_inputs add constraint technical_inputs_net_yield_no_loss_check
    check (yield_boundary <> 'net_ac_at_delivery' or performance_loss_fraction = 0) not valid;

alter table public.technical_inputs drop constraint if exists technical_inputs_specific_yield_range_check;
alter table public.technical_inputs add constraint technical_inputs_specific_yield_range_check
    check (specific_yield_kwh_per_kwp_year is null
           or (specific_yield_kwh_per_kwp_year > 0 and specific_yield_kwh_per_kwp_year <= 10000)) not valid;

alter table public.technical_inputs drop constraint if exists technical_inputs_manual_yield_required_check;
alter table public.technical_inputs add constraint technical_inputs_manual_yield_required_check
    check (energy_method <> 'manual_specific_yield' or specific_yield_kwh_per_kwp_year is not null) not valid;

-- financial_inputs ----------------------------------------------------------

alter table public.financial_inputs drop constraint if exists financial_inputs_discount_rate_fraction_check;
alter table public.financial_inputs add constraint financial_inputs_discount_rate_fraction_check
    check (discount_rate_fraction > -1 and discount_rate_fraction <= 1) not valid;

alter table public.financial_inputs drop constraint if exists financial_inputs_annual_tariff_escalation_fraction_check;
alter table public.financial_inputs add constraint financial_inputs_annual_tariff_escalation_fraction_check
    check (annual_tariff_escalation_fraction > -1 and annual_tariff_escalation_fraction <= 1) not valid;

alter table public.financial_inputs drop constraint if exists financial_inputs_annual_opex_escalation_fraction_check;
alter table public.financial_inputs add constraint financial_inputs_annual_opex_escalation_fraction_check
    check (annual_opex_escalation_fraction > -1 and annual_opex_escalation_fraction <= 1) not valid;

alter table public.financial_inputs drop constraint if exists financial_inputs_tariff_per_kwh_max_check;
alter table public.financial_inputs add constraint financial_inputs_tariff_per_kwh_max_check
    check (tariff_per_kwh is null or tariff_per_kwh <= 1000000000) not valid;

-- calculation_runs ----------------------------------------------------------

alter table public.calculation_runs add column if not exists irr_status text;
alter table public.calculation_runs add column if not exists net_specific_yield_kwh_per_kwp_year numeric(12,3);
alter table public.calculation_runs add column if not exists warnings jsonb not null default '[]'::jsonb;

-- A stored IRR can only have come from a run where the engine reported ok.
update public.calculation_runs set irr_status = 'ok'
where irr_status is null and project_irr_fraction is not null;

alter table public.calculation_runs drop constraint if exists calculation_runs_irr_status_check;
alter table public.calculation_runs add constraint calculation_runs_irr_status_check
    check (irr_status is null or irr_status in ('ok', 'no_sign_change', 'ambiguous', 'not_found'));

-- The API returns a null IRR whenever irr_status is not ok.
alter table public.calculation_runs drop constraint if exists calculation_runs_irr_matches_status_check;
alter table public.calculation_runs add constraint calculation_runs_irr_matches_status_check
    check (irr_status is null or ((irr_status = 'ok') = (project_irr_fraction is not null)));

alter table public.calculation_runs drop constraint if exists calculation_runs_net_yield_positive_check;
alter table public.calculation_runs add constraint calculation_runs_net_yield_positive_check
    check (net_specific_yield_kwh_per_kwp_year is null or net_specific_yield_kwh_per_kwp_year > 0);

alter table public.calculation_runs drop constraint if exists calculation_runs_warnings_array_check;
alter table public.calculation_runs add constraint calculation_runs_warnings_array_check
    check (jsonb_typeof(warnings) = 'array');

update public.calculation_runs set currency_code = upper(currency_code) where currency_code <> upper(currency_code);

alter table public.calculation_runs drop constraint if exists calculation_runs_currency_code_format_check;
alter table public.calculation_runs add constraint calculation_runs_currency_code_format_check
    check (currency_code ~ '^[A-Z]{3}$') not valid;

alter table public.calculation_runs drop constraint if exists calculation_runs_energy_method_check;
alter table public.calculation_runs add constraint calculation_runs_energy_method_check
    check (energy_method in ('manual_specific_yield', 'location_based')) not valid;

-- Row Level Security --------------------------------------------------------

-- Without the project match, a run could point at another user's scenario id.
drop policy if exists "calculation_runs_owner_all" on public.calculation_runs;
create policy "calculation_runs_owner_all" on public.calculation_runs
for all using (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
) with check (
    exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid())
    and (
        scenario_id is null
        or exists (
            select 1 from public.scenarios s
            where s.id = calculation_runs.scenario_id and s.project_id = calculation_runs.project_id
        )
    )
);

-- Validation of existing rows ----------------------------------------------

-- Try to validate each NOT VALID constraint. Violating rows are reported, never changed.
do $$
declare
    c record;
    bad bigint;
begin
    for c in
        select conrelid::regclass as tbl, conname, conrelid, conbin
        from pg_constraint
        where connamespace = 'public'::regnamespace
          and contype = 'c'
          and not convalidated
          and conname = any (array[
              'projects_country_code_format_check',
              'projects_currency_code_format_check',
              'projects_project_name_length_check',
              'projects_location_name_length_check',
              'projects_capacity_kwp_max_check',
              'technical_inputs_performance_loss_fraction_check',
              'technical_inputs_degradation_fraction_per_year_check',
              'technical_inputs_net_yield_no_loss_check',
              'technical_inputs_specific_yield_range_check',
              'technical_inputs_manual_yield_required_check',
              'financial_inputs_discount_rate_fraction_check',
              'financial_inputs_annual_tariff_escalation_fraction_check',
              'financial_inputs_annual_opex_escalation_fraction_check',
              'financial_inputs_tariff_per_kwh_max_check',
              'calculation_runs_currency_code_format_check',
              'calculation_runs_energy_method_check'
          ])
    loop
        begin
            execute format('alter table %s validate constraint %I', c.tbl, c.conname);
        exception when check_violation then
            execute format('select count(*) from %s where (%s) is false', c.tbl, pg_get_expr(c.conbin, c.conrelid))
                into bad;
            raise notice 'Left NOT VALID: % on % (% existing rows violate it)', c.conname, c.tbl, bad;
        end;
    end loop;
end $$;

commit;
