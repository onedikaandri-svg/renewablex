"""Pembuat buku kerja Excel (.xlsx) multi-sheet untuk laporan sistem hybrid Tahap 7 dan 8B."""

from io import BytesIO
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from app.errors import EngineError

_THIN_SIDE = Side(style="thin", color="E5EDF5")
_BORDER = Border(left=_THIN_SIDE, right=_THIN_SIDE, top=_THIN_SIDE, bottom=_THIN_SIDE)
_TITLE_FILL = PatternFill("solid", fgColor="533AFD")
_HEADER_FILL = PatternFill("solid", fgColor="F8FAFC")
_TOTAL_FILL = PatternFill("solid", fgColor="EEF2FF")

_TITLE_FONT = Font(name="Calibri", size=12, bold=True, color="FFFFFF")
_SECTION_FONT = Font(name="Calibri", size=11, bold=True, color="061B31")
_HEADER_FONT = Font(name="Calibri", size=10, bold=True, color="061B31")
_BODY_FONT = Font(name="Calibri", size=10, bold=False, color="0B1F3A")
_TOTAL_FONT = Font(name="Calibri", size=10, bold=True, color="061B31")

_MONTH_NAMES_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
_MONTH_NAMES_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _style_banner(ws: Any, row_idx: int, title: str, col_span: int) -> None:
    ws.cell(row=row_idx, column=1, value=title)
    if col_span > 1:
        ws.merge_cells(start_row=row_idx, start_column=1, end_row=row_idx, end_column=col_span)
    for col in range(1, col_span + 1):
        cell = ws.cell(row=row_idx, column=col)
        cell.fill = _TITLE_FILL
        cell.font = _TITLE_FONT
        cell.alignment = Alignment(vertical="center", horizontal="left")
    ws.row_dimensions[row_idx].height = 24


def _style_table_header(ws: Any, row_idx: int, headers: list[str]) -> None:
    for col_idx, label in enumerate(headers, start=1):
        cell = ws.cell(row=row_idx, column=col_idx, value=label)
        cell.fill = _HEADER_FILL
        cell.font = _HEADER_FONT
        cell.border = _BORDER
        cell.alignment = Alignment(vertical="center", horizontal="left" if col_idx == 1 else "right")
    ws.row_dimensions[row_idx].height = 20


def _write_row(
    ws: Any,
    row_idx: int,
    values: list[Any],
    *,
    num_formats: dict[int, str] | None = None,
    is_total: bool = False,
) -> None:
    for col_idx, val in enumerate(values, start=1):
        cell = ws.cell(row=row_idx, column=col_idx, value=val)
        cell.font = _TOTAL_FONT if is_total else _BODY_FONT
        cell.border = _BORDER
        if is_total:
            cell.fill = _TOTAL_FILL
        if isinstance(val, (int, float)) and not isinstance(val, bool):
            cell.alignment = Alignment(vertical="center", horizontal="right")
            if num_formats and col_idx in num_formats:
                cell.number_format = num_formats[col_idx]
            else:
                cell.number_format = "#,##0.00"
        else:
            cell.alignment = Alignment(vertical="center", horizontal="left")


def _autofit_columns(ws: Any, min_width: int = 12, max_width: int = 44) -> None:
    for col_cells in ws.columns:
        col_idx = col_cells[0].column
        max_len = 0
        for cell in col_cells:
            if cell.row == 1:
                continue
            val = "" if cell.value is None else str(cell.value)
            if len(val) > max_len:
                max_len = len(val)
        width = max(min_width, min(max_len + 4, max_width))
        ws.column_dimensions[get_column_letter(col_idx)].width = width


def build_hybrid_excel_bytes(
    *,
    project_config: dict[str, Any],
    simulation_result: dict[str, Any],
    language: str = "id",
    sweep_result: dict[str, Any] | None = None,
    sensitivity_result: dict[str, Any] | None = None,
) -> bytes:
    """Merangkai buku kerja Excel (.xlsx) multi-sheet dari hasil simulasi hybrid nyata."""
    summary = simulation_result.get("summary")
    monthly = simulation_result.get("monthly")
    cashflows = simulation_result.get("cashflow_schedule")
    if not isinstance(summary, dict) or not isinstance(monthly, list) or not isinstance(cashflows, list):
        raise EngineError(
            "export_payload_invalid",
            "Data hasil simulasi tidak lengkap (wajib memuat summary, monthly, dan cashflow_schedule).",
        )

    is_en = language == "en"
    wb = Workbook()

    # 1. Sheet Ringkasan
    ws_sum = wb.active
    ws_sum.title = "Ringkasan"
    _style_banner(
        ws_sum,
        1,
        f"RenewableX Hybrid Report: {simulation_result.get('project_name', 'Proyek Hybrid')}"
        if is_en
        else f"Laporan Analisis Hybrid RenewableX: {simulation_result.get('project_name', 'Proyek Hybrid')}",
        3,
    )

    fin = simulation_result.get("finance_summary") or {}
    em = simulation_result.get("emissions_summary") or {}
    ws_meta = simulation_result.get("weather_source") or {}
    bess_sum = simulation_result.get("bess_summary") or {}
    bio_sum = simulation_result.get("biomass_summary") or {}
    diesel_sum = simulation_result.get("diesel_summary") or {}
    lcoe_bd = simulation_result.get("lcoe_breakdown") or {}
    curr = str(fin.get("currency_code") or (project_config.get("project") or {}).get("currency_code") or "IDR")

    r = 3
    ws_sum.cell(row=r, column=1, value="Metadata & Lokasi" if not is_en else "Metadata & Location").font = _SECTION_FONT
    r += 1
    _style_table_header(ws_sum, r, ["Parameter", "Nilai" if not is_en else "Value", "Satuan / Catatan" if not is_en else "Unit / Note"])
    r += 1
    meta_rows = [
        ("Nama Proyek" if not is_en else "Project Name", simulation_result.get("project_name", ""), ""),
        ("Versi Mesin / Kontrak" if not is_en else "Engine / Contract Version", f"{simulation_result.get('engine_version', '')} / {simulation_result.get('contract_version', '')}", ""),
        ("Strategi EMS" if not is_en else "EMS Dispatch Strategy", simulation_result.get("dispatch_strategy", ""), ""),
        ("Sumber Cuaca" if not is_en else "Weather Source", f"{ws_meta.get('provider', '')} ({ws_meta.get('dataset', '')})", str(ws_meta.get("period", ""))),
        ("Koordinat" if not is_en else "Coordinates", f"{ws_meta.get('latitude', '')}, {ws_meta.get('longitude', '')}", str(ws_meta.get("timezone", ""))),
    ]
    for label, val, unit in meta_rows:
        _write_row(ws_sum, r, [label, val, unit])
        r += 1

    sim_cfg = project_config.get("simulation") or {}
    disp_params = sim_cfg.get("dispatch_params") or {}
    ems_rules_doc = disp_params.get("ems_rules")
    if simulation_result.get("dispatch_strategy") == "custom_ems" and isinstance(ems_rules_doc, dict):
        raw_rules = ems_rules_doc.get("rules")
        rules_list = raw_rules if isinstance(raw_rules, list) else []
        enabled_rules = [item for item in rules_list if isinstance(item, dict) and item.get("enabled", True) is not False]
        r += 1
        ws_sum.cell(
            row=r,
            column=1,
            value="Ringkasan Aturan Supervisory EMS Kustom" if not is_en else "Custom Supervisory EMS Rules Summary",
        ).font = _SECTION_FONT
        r += 1
        _style_table_header(
            ws_sum,
            r,
            [
                "ID Aturan / Paket" if not is_en else "Rule ID / Rule Set",
                "Prioritas / Status" if not is_en else "Priority / Status",
                "Aksi & Cakupan Mode" if not is_en else "Actions & Mode Scope",
            ],
        )
        r += 1
        _write_row(
            ws_sum,
            r,
            [
                f"Paket: {ems_rules_doc.get('name', 'custom_ems')} (v{ems_rules_doc.get('ems_schema_version', '0.1')})",
                f"{len(enabled_rules)}/{len(rules_list)} aktif" if not is_en else f"{len(enabled_rules)}/{len(rules_list)} active",
                str(ems_rules_doc.get("description", "")),
            ],
        )
        r += 1
        sorted_rules = sorted(
            [item for item in rules_list if isinstance(item, dict)],
            key=lambda item: int(item.get("priority", 999)) if isinstance(item.get("priority"), int) else 999,
        )
        for rule_item in sorted_rules:
            actions_raw = rule_item.get("then") if isinstance(rule_item.get("then"), list) else []
            action_labels: list[str] = []
            for act in actions_raw:
                if isinstance(act, dict):
                    act_name = str(act.get("action", ""))
                    arg_val = act.get("limit") if "limit" in act else act.get("target")
                    action_labels.append(f"{act_name}({arg_val})" if arg_val is not None else act_name)
            status_label = (
                ("Aktif" if rule_item.get("enabled", True) is not False else "Nonaktif")
                if not is_en
                else ("Enabled" if rule_item.get("enabled", True) is not False else "Disabled")
            )
            _write_row(
                ws_sum,
                r,
                [
                    str(rule_item.get("id", "")),
                    f"P{rule_item.get('priority', 0)} ({status_label})",
                    ", ".join(action_labels),
                ],
            )
            r += 1


    r += 1
    ws_sum.cell(row=r, column=1, value="KPI Keuangan & Emisi" if not is_en else "Financial & Emissions KPI").font = _SECTION_FONT
    r += 1
    _style_table_header(ws_sum, r, ["Metrik" if not is_en else "Metric", "Nilai" if not is_en else "Value", "Satuan" if not is_en else "Unit"])
    r += 1
    fin_rows: list[tuple[str, Any, str, str]] = [
        ("Status Kelayakan" if not is_en else "Viability Status", fin.get("viability_status", ""), "", ""),
        ("Gross CAPEX", fin.get("gross_capex", 0.0), curr, "#,##0"),
        ("Net CAPEX", fin.get("net_capex", 0.0), curr, "#,##0"),
        ("Total NPC", fin.get("total_npc", 0.0), curr, "#,##0"),
        ("LCOE", fin.get("lcoe", 0.0), f"{curr}/kWh", "#,##0.00"),
        ("NPV", fin.get("npv", 0.0), curr, "#,##0"),
        ("IRR", fin.get("irr"), "fraksi", "0.00%"),
        ("Simple Payback", fin.get("simple_payback_years"), "tahun" if not is_en else "years", "#,##0.0"),
        ("Discounted Payback", fin.get("discounted_payback_years"), "tahun" if not is_en else "years", "#,##0.0"),
        ("Emisi Dihindari" if not is_en else "Avoided Emissions", em.get("avoided_emissions_tons_co2e", 0.0), "ton CO2e", "#,##0.0"),
    ]
    for label, val, unit, fmt in fin_rows:
        _write_row(ws_sum, r, [label, val if val is not None else "Tidak tersedia", unit], num_formats={2: fmt} if fmt else None)
        r += 1

    r += 1
    ws_sum.cell(row=r, column=1, value="Kinerja Teknis Tahun 1" if not is_en else "Year 1 Technical Performance").font = _SECTION_FONT
    r += 1
    _style_table_header(ws_sum, r, ["Metrik" if not is_en else "Metric", "Nilai" if not is_en else "Value", "Satuan" if not is_en else "Unit"])
    r += 1
    tech_rows: list[tuple[str, Any, str, str]] = [
        ("Total Beban" if not is_en else "Total Load", summary.get("total_load_kwh", 0.0), "kWh/thn", "#,##0.0"),
        ("Produksi PV" if not is_en else "PV Generation", summary.get("pv_generation_kwh", 0.0), "kWh/thn", "#,##0.0"),
        ("Produksi Biomass" if not is_en else "Biomass Generation", summary.get("biomass_generation_kwh", 0.0), "kWh/thn", "#,##0.0"),
        ("Produksi Diesel" if not is_en else "Diesel Generation", summary.get("diesel_generation_kwh", 0.0), "kWh/thn", "#,##0.0"),
        ("Beban Terpenuhi" if not is_en else "Served Load", summary.get("served_load_kwh", 0.0), "kWh/thn", "#,##0.0"),
        ("Beban Tidak Terpenuhi" if not is_en else "Unmet Load", summary.get("unmet_load_kwh", 0.0), "kWh/thn", "#,##0.0"),
        ("Curtailment", summary.get("curtailment_kwh", 0.0), "kWh/thn", "#,##0.0"),
        ("Pangsa Energi Terbarukan" if not is_en else "Renewable Fraction", summary.get("renewable_fraction", 0.0), "fraksi", "0.0%"),
        ("Yield Spesifik PV" if not is_en else "PV Specific Yield", summary.get("pv_specific_yield_kwh_per_kwp", 0.0), "kWh/kWp/thn", "#,##0.0"),
        ("BESS Discharge", bess_sum.get("total_discharge_kwh", 0.0), "kWh/thn", "#,##0.0"),
        ("Siklus BESS (EFC)" if not is_en else "BESS Cycles (EFC)", bess_sum.get("equivalent_full_cycles", 0.0), "siklus", "#,##0.0"),
        ("Konsumsi Bahan Bakar Biomass" if not is_en else "Biomass Fuel Consumed", bio_sum.get("total_fuel_tons", 0.0), "ton/thn", "#,##0.0"),
        ("Konsumsi Solar Diesel" if not is_en else "Diesel Fuel Consumed", diesel_sum.get("total_fuel_liters", 0.0), "liter/thn", "#,##0.0"),
        ("Jam Operasi Diesel" if not is_en else "Diesel Operating Hours", diesel_sum.get("total_operating_hours", 0.0), "jam/thn", "#,##0.0"),
        ("Emisi CO2e Diesel" if not is_en else "Diesel CO2e Emissions", diesel_sum.get("total_co2e_kg", 0.0), "kg CO2e/thn", "#,##0.0"),
        ("Galat Neraca Maks" if not is_en else "Max Balance Error", summary.get("max_balance_error_kw", 0.0), "kW", "0.00E+00"),
    ]
    for label, val, unit, fmt in tech_rows:
        _write_row(ws_sum, r, [label, val, unit], num_formats={2: fmt})
        r += 1

    if lcoe_bd:
        r += 1
        ws_sum.cell(row=r, column=1, value="Rincian Komponen LCOE" if not is_en else "LCOE Breakdown").font = _SECTION_FONT
        r += 1
        _style_table_header(ws_sum, r, ["Komponen", "Kontribusi", "Satuan"])
        r += 1
        for k, v in lcoe_bd.items():
            _write_row(ws_sum, r, [str(k), v, f"{curr}/kWh"], num_formats={2: "#,##0.00"})
            r += 1

    ws_sum.freeze_panes = "A3"
    _autofit_columns(ws_sum)

    # 2. Sheet Energi_Bulanan
    ws_mon = wb.create_sheet("Energi_Bulanan")
    _style_banner(ws_mon, 1, "Ringkasan Energi Bulanan (Tahun 1, kWh)" if not is_en else "Monthly Energy Summary (Year 1, kWh)", 12)
    mon_headers = [
        "Bulan" if not is_en else "Month",
        "Beban (kWh)",
        "PV (kWh)",
        "Biomass (kWh)",
        "Diesel (kWh)",
        "BESS Charge (kWh)",
        "BESS Discharge (kWh)",
        "Grid Impor (kWh)",
        "Grid Ekspor (kWh)",
        "Terpenuhi (kWh)",
        "Unmet (kWh)",
        "Curtailment (kWh)",
    ]
    _style_table_header(ws_mon, 3, mon_headers)
    m_names = _MONTH_NAMES_EN if is_en else _MONTH_NAMES_ID
    mon_fmt = {c: "#,##0.0" for c in range(2, 13)}
    totals = [0.0] * 11
    row_i = 4
    for m_row in monthly:
        m_num = int(m_row.get("month", 1))
        m_label = m_names[m_num - 1] if 1 <= m_num <= 12 else str(m_num)
        vals = [
            float(m_row.get("load_kwh", 0.0)),
            float(m_row.get("pv_generation_kwh", 0.0)),
            float(m_row.get("biomass_generation_kwh", 0.0)),
            float(m_row.get("diesel_generation_kwh", 0.0)),
            float(m_row.get("bess_charge_kwh", 0.0)),
            float(m_row.get("bess_discharge_kwh", 0.0)),
            float(m_row.get("grid_import_kwh", 0.0)),
            float(m_row.get("grid_export_kwh", 0.0)),
            float(m_row.get("served_load_kwh", 0.0)),
            float(m_row.get("unmet_load_kwh", 0.0)),
            float(m_row.get("curtailment_kwh", 0.0)),
        ]
        for idx, v in enumerate(vals):
            totals[idx] += v
        _write_row(ws_mon, row_i, [m_label, *vals], num_formats=mon_fmt)
        row_i += 1
    _write_row(ws_mon, row_i, ["Total", *totals], num_formats=mon_fmt, is_total=True)
    ws_mon.freeze_panes = "A4"
    _autofit_columns(ws_mon)

    # 3. Sheet Arus_Kas_Tahunan
    ws_cf = wb.create_sheet("Arus_Kas_Tahunan")
    _style_banner(ws_cf, 1, f"Jadwal Arus Kas Tahunan ({curr})" if not is_en else f"Annual Cash Flow Schedule ({curr})", 14)
    cf_headers = [
        "Tahun" if not is_en else "Year",
        "Beban Terpenuhi (kWh)",
        "CAPEX",
        "Pendapatan / Penghematan",
        "Pendapatan Ekspor",
        "O&M",
        "Bahan Bakar & Logistik",
        "Impor Grid",
        "Penggantian & Overhaul",
        "Nilai Sisa (Salvage)",
        "Pajak",
        "Arus Kas Bersih",
        "Arus Kas Terdiskonto",
        "Kumulatif",
    ]
    _style_table_header(ws_cf, 3, cf_headers)
    cf_fmt = {2: "#,##0.0", **{c: "#,##0" for c in range(3, 15)}}
    cf_totals = [0.0] * 12
    row_i = 4
    for cf_row in cashflows:
        yr = int(cf_row.get("year", 0))
        vals = [
            float(cf_row.get("served_load_kwh", 0.0)),
            float(cf_row.get("capex_outflow", 0.0)),
            float(cf_row.get("gross_revenue_or_savings", 0.0)),
            float(cf_row.get("export_revenue", 0.0)),
            float(cf_row.get("om_cost", 0.0)),
            float(cf_row.get("fuel_and_logistics_cost", 0.0)),
            float(cf_row.get("grid_import_cost", 0.0)),
            float(cf_row.get("replacement_and_overhaul_cost", 0.0)),
            float(cf_row.get("salvage_inflow", 0.0)),
            float(cf_row.get("tax_outflow", 0.0)),
            float(cf_row.get("net_cash_flow", 0.0)),
            float(cf_row.get("discounted_cash_flow", 0.0)),
        ]
        for idx, v in enumerate(vals):
            cf_totals[idx] += v
        cum_val = float(cf_row.get("cumulative_cash_flow", 0.0))
        _write_row(ws_cf, row_i, [yr, *vals, cum_val], num_formats={1: "0", **cf_fmt})
        row_i += 1
    last_cum = float(cashflows[-1].get("cumulative_cash_flow", 0.0)) if cashflows else 0.0
    _write_row(ws_cf, row_i, ["Total", *cf_totals, last_cum], num_formats=cf_fmt, is_total=True)
    ws_cf.freeze_panes = "A4"
    _autofit_columns(ws_cf)

    # 4. Sheet Asumsi_Konfigurasi
    ws_cfg = wb.create_sheet("Asumsi_Konfigurasi")
    _style_banner(ws_cfg, 1, "Asumsi Konfigurasi & Sumber Parameter [REAL DATA]", 3)
    _style_table_header(ws_cfg, 3, ["Bagian / Parameter", "Nilai", "Sumber / Catatan"])

    def _flatten_rows(prefix: str, obj: Any, out: list[tuple[str, Any, str]]) -> None:
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k in ("csv_text", "weather_data", "topology", "weatherPreview", "loadPreview"):
                    continue
                _flatten_rows(f"{prefix}.{k}" if prefix else str(k), v, out)
        elif isinstance(obj, list):
            out.append((prefix, ", ".join(str(x) for x in obj), "[REAL DATA] / input proyek"))
        else:
            if prefix == "components.diesel.emission_factor_kg_co2e_per_liter":
                note = "Rujukan IPCC 2006 / DEFRA (2,68 kg CO2e/liter); lihat docs/assumptions.md"
            elif prefix.startswith(("components", "finance")):
                note = "Lihat docs/assumptions.md [REAL DATA]"
            else:
                note = "Konfigurasi proyek"
            out.append((prefix, obj if obj is not None else "Kosong", note))

    cfg_rows: list[tuple[str, Any, str]] = []
    _flatten_rows("", project_config, cfg_rows)
    row_i = 4
    for key_path, val, note in cfg_rows:
        _write_row(ws_cfg, row_i, [key_path, val, note])
        row_i += 1
    ws_cfg.freeze_panes = "A4"
    _autofit_columns(ws_cfg)

    # 5. Sheet Hasil_Sapuan (opsional)
    if sweep_result and isinstance(sweep_result.get("combinations"), list):
        ws_sw = wb.create_sheet("Hasil_Sapuan")
        _style_banner(ws_sw, 1, "Hasil Sapuan Kombinasi Gaya HOMER", 12)
        sw_headers = [
            "Peringkat",
            "ID Kombinasi",
            "Layak Batasan",
            "PV (kWp)",
            "BESS (kWh)",
            "Biomass (kW)",
            "Diesel (kW)",
            f"LCOE ({curr}/kWh)",
            f"Total NPC ({curr})",
            f"NPV ({curr})",
            "IRR",
            "Pangsa Terbarukan",
        ]
        _style_table_header(ws_sw, 3, sw_headers)
        sw_fmt = {1: "0", 4: "#,##0.0", 5: "#,##0.0", 6: "#,##0.0", 7: "#,##0.0", 8: "#,##0.00", 9: "#,##0", 10: "#,##0", 11: "0.00%", 12: "0.0%"}
        row_i = 4
        for c in sweep_result["combinations"]:
            sz = c.get("sizing") or {}
            tc = c.get("technical") or {}
            fn = c.get("finance") or {}
            _write_row(
                ws_sw,
                row_i,
                [
                    c.get("rank", row_i - 3),
                    c.get("combination_id", ""),
                    "Ya" if c.get("feasible") else "Tidak",
                    sz.get("pv_capacity_kwp", 0.0),
                    sz.get("bess_nominal_capacity_kwh", 0.0),
                    sz.get("biomass_rated_capacity_kw", 0.0),
                    sz.get("diesel_rated_capacity_kw", 0.0),
                    fn.get("lcoe", 0.0),
                    fn.get("total_npc", 0.0),
                    fn.get("npv", 0.0),
                    fn.get("irr"),
                    tc.get("renewable_fraction", 0.0),
                ],
                num_formats=sw_fmt,
            )
            row_i += 1
        ws_sw.freeze_panes = "A4"
        _autofit_columns(ws_sw)

    # 6. Sheet Sensitivitas (opsional)
    if sensitivity_result and isinstance(sensitivity_result.get("variables"), list):
        ws_sn = wb.create_sheet("Sensitivitas")
        _style_banner(ws_sn, 1, "Analisis Sensitivitas Hybrid (Tornado)", 7)
        sn_headers = [
            "Variabel",
            "Nilai Dasar",
            "Pergeseran",
            "Nilai Uji",
            f"NPV ({curr})",
            f"Selisih NPV ({curr})",
            f"LCOE ({curr}/kWh)",
        ]
        _style_table_header(ws_sn, 3, sn_headers)
        sn_fmt = {2: "#,##0.00", 3: "0.0%", 4: "#,##0.00", 5: "#,##0", 6: "#,##0", 7: "#,##0.00"}
        row_i = 4
        for var_item in sensitivity_result["variables"]:
            if var_item.get("skipped"):
                _write_row(ws_sn, row_i, [var_item.get("variable", ""), 0.0, "Dilewati", var_item.get("skip_reason", ""), 0.0, 0.0, 0.0])
                row_i += 1
                continue
            for cs in var_item.get("cases", []):
                _write_row(
                    ws_sn,
                    row_i,
                    [
                        var_item.get("variable", ""),
                        var_item.get("base_value", 0.0),
                        cs.get("shift_fraction", 0.0),
                        cs.get("input_value", 0.0),
                        cs.get("npv", 0.0),
                        cs.get("npv_delta", 0.0),
                        cs.get("lcoe", 0.0),
                    ],
                    num_formats=sn_fmt,
                )
                row_i += 1
        ws_sn.freeze_panes = "A4"
        _autofit_columns(ws_sn)

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
