import type { HybridProjectConfig, HybridSimulateResponse } from "@/lib/hybrid-types";

export interface SankeyNodeItem {
  name: string;
}

export interface SankeyLinkItem {
  source: string;
  target: string;
  value: number;
}

export interface SankeyEnergyData {
  nodes: SankeyNodeItem[];
  links: SankeyLinkItem[];
  rows: Array<{ source: string; target: string; mwh: number }>;
}

/**
 * Menyusun data Diagram Aliran Energi (Sankey Tahun 1) langsung dari angka mesin backend
 * dalam struktur graf berarah bebas siklus (DAG) agar aman dirender ECharts Sankey.
 */
export function buildSankeyEnergyData(
  result: HybridSimulateResponse,
  lang: "id" | "en",
): SankeyEnergyData {
  const pvMwh = Math.max(0, result.summary.pv_generation_kwh / 1000);
  const bioMwh = Math.max(0, result.summary.biomass_generation_kwh / 1000);
  const dieselMwh = Math.max(0, (result.summary.diesel_generation_kwh ?? 0) / 1000);
  const gridImpMwh = Math.max(0, (result.lifetime_summary.yearly?.[0]?.grid_import_kwh ?? 0) / 1000);
  const gridExpMwh = Math.max(0, (result.lifetime_summary.yearly?.[0]?.grid_export_kwh ?? 0) / 1000);
  const bessChgMwh = Math.max(0, (result.bess_summary?.total_charge_kwh ?? 0) / 1000);
  const bessDisMwh = Math.max(0, (result.bess_summary?.total_discharge_kwh ?? 0) / 1000);
  const bessLossMwh = Math.max(0, (result.bess_summary?.conversion_losses_kwh ?? 0) / 1000);
  const servedMwh = Math.max(0, result.summary.served_load_kwh / 1000);
  const curtailMwh = Math.max(0, result.summary.curtailment_kwh / 1000);
  const totalSupplyMwh = pvMwh + bioMwh + dieselMwh + gridImpMwh;
  const bessAuxMwh = Math.max(0, (result.bess_summary?.aux_load_kwh ?? 0) / 1000);
  const directSupplyToBusMwh = Math.max(0, totalSupplyMwh - bessChgMwh);

  const labels =
    lang === "en"
      ? {
          pv: "Solar PV",
          biomass: "Biomass",
          diesel: "Diesel Generator",
          gridImp: "Grid Import",
          supplyBus: "Supply Bus",
          bessChg: "BESS Storage",
          distBus: "AC Distribution",
          bessLoss: "BESS Losses",
          served: "Served Load",
          gridExp: "Grid Export",
          curtail: "Curtailment",
          parasitic: "Aux & Parasitic",
        }
      : {
          pv: "Solar PV",
          biomass: "Biomass",
          diesel: "Diesel Generator",
          gridImp: "Impor Grid",
          supplyBus: "Bus Pasokan AC",
          bessChg: "Penyimpanan BESS",
          distBus: "Distribusi AC",
          bessLoss: "Rugi Konversi BESS",
          served: "Beban Terpenuhi",
          gridExp: "Ekspor Grid",
          curtail: "Curtailment",
          parasitic: "Beban Parasitik",
        };

  const candidates: Array<{ source: string; target: string; raw: number }> = [
    { source: labels.pv, target: labels.supplyBus, raw: pvMwh },
    { source: labels.biomass, target: labels.supplyBus, raw: bioMwh },
    { source: labels.diesel, target: labels.supplyBus, raw: dieselMwh },
    { source: labels.gridImp, target: labels.supplyBus, raw: gridImpMwh },
    { source: labels.supplyBus, target: labels.bessChg, raw: bessChgMwh },
    { source: labels.supplyBus, target: labels.distBus, raw: directSupplyToBusMwh },
    { source: labels.bessChg, target: labels.distBus, raw: bessDisMwh },
    { source: labels.bessChg, target: labels.bessLoss, raw: bessLossMwh },
    { source: labels.distBus, target: labels.served, raw: servedMwh },
    { source: labels.distBus, target: labels.gridExp, raw: gridExpMwh },
    { source: labels.distBus, target: labels.curtail, raw: curtailMwh },
    { source: labels.distBus, target: labels.parasitic, raw: bessAuxMwh },
  ];

  const links: SankeyLinkItem[] = [];
  const nodeSet = new Set<string>();
  for (const item of candidates) {
    const val = Math.round(item.raw * 100) / 100;
    if (val > 0.001) {
      links.push({ source: item.source, target: item.target, value: val });
      nodeSet.add(item.source);
      nodeSet.add(item.target);
    }
  }

  return {
    nodes: Array.from(nodeSet).map((name) => ({ name })),
    links,
    rows: links.map((l) => ({ source: l.source, target: l.target, mwh: l.value })),
  };
}

export interface DurationCurveSeriesData {
  percentLabels: string[];
  loadKw: number[];
  servedKw: number[];
  pvKw: number[];
  biomassKw: number[];
  dieselKw: number[];
  stats: Array<{
    key: "load" | "served" | "pv" | "biomass" | "diesel";
    peakKw: number;
    medianKw: number;
    minKw: number;
  }>;
}

function decimateSortedDescending(sorted: number[], maxPoints: number): { indices: number[]; values: number[] } {
  const n = sorted.length;
  if (n === 0) return { indices: [], values: [] };
  if (n <= maxPoints) {
    return {
      indices: sorted.map((_, idx) => idx),
      values: sorted.map((v) => Math.round(v * 100) / 100),
    };
  }
  const indices: number[] = [];
  const values: number[] = [];
  const last = n - 1;
  for (let k = 0; k < maxPoints; k++) {
    const idx = k === maxPoints - 1 ? last : Math.round((k * last) / (maxPoints - 1));
    if (indices.length === 0 || indices[indices.length - 1] !== idx) {
      indices.push(idx);
      values.push(Math.round(sorted[idx] * 100) / 100);
    }
  }
  return { indices, values };
}

/**
 * Menyusun kurva durasi (0% sampai 100% jam setahun, terurut menurun) dengan decimation
 * tampilan agar ringan di browser sambil mempertahankan nilai puncak dan minimum eksak.
 */
export function buildDurationCurveSeries(
  hourly: NonNullable<HybridSimulateResponse["hourly_year_1"]>,
  maxPoints = 240,
): DurationCurveSeriesData {
  const dieselArr = hourly.diesel_generation_kw ?? new Array(hourly.load_kw.length).fill(0);
  const rawSeries = [
    { key: "load" as const, arr: hourly.load_kw },
    { key: "served" as const, arr: hourly.served_load_kw },
    { key: "pv" as const, arr: hourly.pv_generation_kw },
    { key: "biomass" as const, arr: hourly.biomass_generation_kw },
    { key: "diesel" as const, arr: dieselArr },
  ];

  const sortedMap = new Map<string, number[]>();
  const stats: DurationCurveSeriesData["stats"] = [];

  for (const s of rawSeries) {
    const sorted = [...s.arr].sort((a, b) => b - a);
    sortedMap.set(s.key, sorted);
    const n = sorted.length;
    stats.push({
      key: s.key,
      peakKw: n > 0 ? sorted[0] : 0,
      medianKw: n > 0 ? sorted[Math.floor(n / 2)] : 0,
      minKw: n > 0 ? sorted[n - 1] : 0,
    });
  }

  const loadSorted = sortedMap.get("load") ?? [];
  const baseDecimated = decimateSortedDescending(loadSorted, maxPoints);
  const totalLen = Math.max(loadSorted.length - 1, 1);
  const percentLabels = baseDecimated.indices.map((idx) => `${((idx / totalLen) * 100).toFixed(1)}%`);

  return {
    percentLabels,
    loadKw: baseDecimated.values,
    servedKw: baseDecimated.indices.map((idx) => Math.round(((sortedMap.get("served") ?? [])[idx] ?? 0) * 100) / 100),
    pvKw: baseDecimated.indices.map((idx) => Math.round(((sortedMap.get("pv") ?? [])[idx] ?? 0) * 100) / 100),
    biomassKw: baseDecimated.indices.map((idx) => Math.round(((sortedMap.get("biomass") ?? [])[idx] ?? 0) * 100) / 100),
    dieselKw: baseDecimated.indices.map((idx) => Math.round(((sortedMap.get("diesel") ?? [])[idx] ?? 0) * 100) / 100),
    stats,
  };
}

export interface DegradationSeriesData {
  years: string[];
  pvCapacityPct: number[];
  bessCapacityPct: number[] | null;
  events: Array<{ year: number; eventType: string; description: string }>;
  rows: Array<{
    year: number;
    pvPct: number;
    bessPct: number | null;
    eventsLabel: string;
  }>;
}

/**
 * Mengekstrak deret degradasi kapasitas PV dan BESS sepanjang umur proyek dari hasil backend.
 */
export function buildDegradationSeries(
  result: HybridSimulateResponse,
  config: HybridProjectConfig,
): DegradationSeriesData {
  const yearly = result.lifetime_summary.yearly ?? [];
  const nominalBess = config.components.bess.enabled ? config.components.bess.nominal_capacity_kwh : 0;
  const hasBess = Boolean(result.bess_summary) && nominalBess > 0;
  const eventsByYear = new Map<number, string[]>();

  for (const ev of result.lifetime_summary.lifecycle_events ?? []) {
    const arr = eventsByYear.get(ev.year) ?? [];
    arr.push(ev.event_type);
    eventsByYear.set(ev.year, arr);
  }

  const years = yearly.map((y) => `${y.year}`);
  const pvCapacityPct = yearly.map((y) => Math.round(y.pv_degradation_factor * 1000) / 10);
  const bessCapacityPct = hasBess
    ? yearly.map((y) =>
        y.bess_final_effective_capacity_kwh > 0
          ? Math.round((y.bess_final_effective_capacity_kwh / nominalBess) * 1000) / 10
          : 0,
      )
    : null;

  const rows = yearly.map((y, idx) => ({
    year: y.year,
    pvPct: pvCapacityPct[idx],
    bessPct: bessCapacityPct ? bessCapacityPct[idx] : null,
    eventsLabel: (eventsByYear.get(y.year) ?? []).join(", ") || "-",
  }));

  return {
    years,
    pvCapacityPct,
    bessCapacityPct,
    events: (result.lifetime_summary.lifecycle_events ?? []).map((ev) => ({
      year: ev.year,
      eventType: ev.event_type,
      description: ev.description,
    })),
    rows,
  };
}

export interface MonthlyDiurnalProfileData {
  month: number;
  hours: string[];
  loadKw: number[];
  pvKw: number[];
  biomassKw: number[];
  dieselKw: number[];
  bessChargeKw: number[];
  bessDischargeKw: number[];
  gridImportKw: number[];
  rows: Array<{
    hourLabel: string;
    loadKw: number;
    pvKw: number;
    biomassKw: number;
    dieselKw: number;
    bessChargeKw: number;
    bessDischargeKw: number;
    gridImportKw: number;
  }>;
}

const NON_LEAP_MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const NON_LEAP_MONTH_CUM_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];

function parseMonthAndHourFromStep(
  label: string | undefined,
  stepIndex: number,
): { month: number; hour: number } {
  if (label) {
    // Mendukung format YYYY-MM-DDTHH:mm, YYYY-MM-DD HH:mm, atau MM-DD HH:mm
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):/.exec(label);
    if (isoMatch) {
      const m = Number(isoMatch[2]);
      const h = Number(isoMatch[4]);
      if (m >= 1 && m <= 12 && h >= 0 && h <= 23) {
        return { month: m, hour: h };
      }
    }
    const shortMatch = /^(\d{2})-(\d{2})[T\s](\d{2}):/.exec(label);
    if (shortMatch) {
      const m = Number(shortMatch[1]);
      const h = Number(shortMatch[3]);
      // Jika seluruh array memakai placeholder yang sama seperti "01-01 00:00" pada langkah > 0, gunakan indeks hari
      if (!(m === 1 && Number(shortMatch[2]) === 1 && h === 0 && stepIndex > 0)) {
        if (m >= 1 && m <= 12 && h >= 0 && h <= 23) {
          return { month: m, hour: h };
        }
      }
    }
  }
  const dayOfYear = Math.floor(stepIndex / 24) % 365;
  const hour = stepIndex % 24;
  let month = 12;
  for (let m = 0; m < 12; m++) {
    if (dayOfYear >= NON_LEAP_MONTH_CUM_DAYS[m] && dayOfYear < NON_LEAP_MONTH_CUM_DAYS[m + 1]) {
      month = m + 1;
      break;
    }
  }
  return { month, hour };
}

/**
 * Mengelompokkan data deret waktu per jam menjadi profil rata-rata harian 24 titik (00:00 sampai 23:00)
 * untuk bulan terpilih (1..12) atau rata-rata sepanjang tahun (0).
 */
export function buildMonthlyDiurnalProfile(
  hourly: NonNullable<HybridSimulateResponse["hourly_year_1"]>,
  month = 0,
): MonthlyDiurnalProfileData {
  const targetMonth = month >= 1 && month <= 12 ? Math.floor(month) : 0;
  const counts = new Array<number>(24).fill(0);
  const sumLoad = new Array<number>(24).fill(0);
  const sumPv = new Array<number>(24).fill(0);
  const sumBiomass = new Array<number>(24).fill(0);
  const sumDiesel = new Array<number>(24).fill(0);
  const sumBessChg = new Array<number>(24).fill(0);
  const sumBessDis = new Array<number>(24).fill(0);
  const sumGridImp = new Array<number>(24).fill(0);

  const n = Math.min(
    hourly.steps_count || hourly.load_kw.length,
    hourly.load_kw.length,
  );
  const dieselArr = hourly.diesel_generation_kw ?? [];

  for (let i = 0; i < n; i++) {
    const { month: stepMonth, hour } = parseMonthAndHourFromStep(hourly.local_time?.[i], i);
    if (targetMonth !== 0 && stepMonth !== targetMonth) continue;
    counts[hour] += 1;
    sumLoad[hour] += hourly.load_kw[i] ?? 0;
    sumPv[hour] += hourly.pv_generation_kw[i] ?? 0;
    sumBiomass[hour] += hourly.biomass_generation_kw[i] ?? 0;
    sumDiesel[hour] += dieselArr[i] ?? 0;
    sumBessChg[hour] += hourly.bess_charge_kw[i] ?? 0;
    sumBessDis[hour] += hourly.bess_discharge_kw[i] ?? 0;
    sumGridImp[hour] += hourly.grid_import_kw[i] ?? 0;
  }

  const avg = (sumArr: number[]) =>
    sumArr.map((val, h) => (counts[h] > 0 ? Math.round((val / counts[h]) * 100) / 100 : 0));

  const hours = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);
  const loadKw = avg(sumLoad);
  const pvKw = avg(sumPv);
  const biomassKw = avg(sumBiomass);
  const dieselKw = avg(sumDiesel);
  const bessChargeKw = avg(sumBessChg);
  const bessDischargeKw = avg(sumBessDis);
  const gridImportKw = avg(sumGridImp);

  const rows = hours.map((hourLabel, h) => ({
    hourLabel,
    loadKw: loadKw[h],
    pvKw: pvKw[h],
    biomassKw: biomassKw[h],
    dieselKw: dieselKw[h],
    bessChargeKw: bessChargeKw[h],
    bessDischargeKw: bessDischargeKw[h],
    gridImportKw: gridImportKw[h],
  }));

  return {
    month: targetMonth,
    hours,
    loadKw,
    pvKw,
    biomassKw,
    dieselKw,
    bessChargeKw,
    bessDischargeKw,
    gridImportKw,
    rows,
  };
}

export interface MonthlyGeneratorOperationsRow {
  month: number;
  biomassHours: number;
  dieselHours: number;
  biomassFuelTons: number;
  dieselFuelLiters: number;
  biomassGenerationMwh: number;
  dieselGenerationMwh: number;
}

export interface MonthlyGeneratorOperationsData {
  hasBiomass: boolean;
  hasDiesel: boolean;
  months: number[];
  biomassHours: number[];
  dieselHours: number[];
  biomassFuelTons: number[];
  dieselFuelLiters: number[];
  rows: MonthlyGeneratorOperationsRow[];
  totals: {
    biomassHours: number;
    dieselHours: number;
    biomassFuelTons: number;
    dieselFuelLiters: number;
    biomassGenerationMwh: number;
    dieselGenerationMwh: number;
  };
}

/**
 * Mengagregasi jam operasi generator (Biomass dan Diesel) serta konsumsi bahan bakar bulanan
 * dari deret waktu Tahun 1 dan ringkasan bulanan mesin backend.
 */
export function buildMonthlyGeneratorOperations(
  result: HybridSimulateResponse,
): MonthlyGeneratorOperationsData {
  const hourly = result.hourly_year_1;
  const bioHours = new Array<number>(12).fill(0);
  const dslHours = new Array<number>(12).fill(0);
  const dslFuel = new Array<number>(12).fill(0);
  const bioGenKwhByMonth = new Array<number>(12).fill(0);
  const dslGenKwhByMonth = new Array<number>(12).fill(0);

  for (const mRow of result.monthly ?? []) {
    if (mRow.month >= 1 && mRow.month <= 12) {
      bioGenKwhByMonth[mRow.month - 1] = mRow.biomass_generation_kwh ?? 0;
      dslGenKwhByMonth[mRow.month - 1] = mRow.diesel_generation_kwh ?? 0;
    }
  }

  if (hourly) {
    const n = Math.min(
      hourly.steps_count || hourly.load_kw.length,
      hourly.load_kw.length,
    );
    const stepHours = (hourly.step_minutes || 60) / 60;
    const dieselKwArr = hourly.diesel_generation_kw ?? [];
    const dieselFuelArr = hourly.diesel_fuel_liters ?? [];
    const bioStatusArr = hourly.biomass_status ?? null;
    const hasMonthlyRows = (result.monthly ?? []).length === 12;

    for (let i = 0; i < n; i++) {
      const { month } = parseMonthAndHourFromStep(hourly.local_time?.[i], i);
      const mIdx = Math.min(11, Math.max(0, month - 1));
      const bioKw = hourly.biomass_generation_kw[i] ?? 0;
      const bioRunning = bioStatusArr ? bioStatusArr[i] === "running" || bioKw > 0 : bioKw > 0;
      if (bioRunning) {
        bioHours[mIdx] += stepHours;
      }
      const dslKw = dieselKwArr[i] ?? 0;
      if (dslKw > 0) {
        dslHours[mIdx] += stepHours;
      }
      dslFuel[mIdx] += dieselFuelArr[i] ?? 0;
      if (!hasMonthlyRows) {
        bioGenKwhByMonth[mIdx] += bioKw * stepHours;
        dslGenKwhByMonth[mIdx] += dslKw * stepHours;
      }
    }
  } else {
    // Fallback proporsional dari ringkasan bila hourly_year_1 tidak ada di cache
    const totalBioGen = bioGenKwhByMonth.reduce((a, b) => a + b, 0);
    const totalBioHours = result.biomass_summary?.total_operating_hours ?? 0;
    const totalDslGen = dslGenKwhByMonth.reduce((a, b) => a + b, 0);
    const totalDslHours = result.diesel_summary?.total_operating_hours ?? 0;
    const totalDslFuel = result.diesel_summary?.total_fuel_liters ?? 0;

    for (let m = 0; m < 12; m++) {
      if (totalBioGen > 0) {
        bioHours[m] = (bioGenKwhByMonth[m] / totalBioGen) * totalBioHours;
      } else if (totalBioHours > 0) {
        bioHours[m] = (NON_LEAP_MONTH_DAYS[m] / 365) * totalBioHours;
      }
      if (totalDslGen > 0) {
        dslHours[m] = (dslGenKwhByMonth[m] / totalDslGen) * totalDslHours;
        dslFuel[m] = (dslGenKwhByMonth[m] / totalDslGen) * totalDslFuel;
      } else if (totalDslHours > 0) {
        dslHours[m] = (NON_LEAP_MONTH_DAYS[m] / 365) * totalDslHours;
        dslFuel[m] = (NON_LEAP_MONTH_DAYS[m] / 365) * totalDslFuel;
      }
    }
  }

  // Distribusi ton biomassa bulanan proporsional terhadap pembangkitan bulanan
  const totalBioTons = result.biomass_summary?.total_fuel_tons ?? 0;
  const totalBioGenKwh = bioGenKwhByMonth.reduce((a, b) => a + b, 0);
  const totalBioOperatingHours = bioHours.reduce((a, b) => a + b, 0);
  const bioFuelTons = new Array<number>(12).fill(0);
  for (let m = 0; m < 12; m++) {
    if (totalBioTons > 0) {
      if (totalBioGenKwh > 0) {
        bioFuelTons[m] = (bioGenKwhByMonth[m] / totalBioGenKwh) * totalBioTons;
      } else if (totalBioOperatingHours > 0) {
        bioFuelTons[m] = (bioHours[m] / totalBioOperatingHours) * totalBioTons;
      }
    }
  }

  // Jika hourly_year_1 tidak memiliki diesel_fuel_liters namun diesel_summary punya total_fuel_liters
  const rawDslFuelSum = dslFuel.reduce((a, b) => a + b, 0);
  const summaryDslFuel = result.diesel_summary?.total_fuel_liters ?? 0;
  if (rawDslFuelSum === 0 && summaryDslFuel > 0) {
    const totalDslGenKwh = dslGenKwhByMonth.reduce((a, b) => a + b, 0);
    const totalDslOpHours = dslHours.reduce((a, b) => a + b, 0);
    for (let m = 0; m < 12; m++) {
      if (totalDslGenKwh > 0) {
        dslFuel[m] = (dslGenKwhByMonth[m] / totalDslGenKwh) * summaryDslFuel;
      } else if (totalDslOpHours > 0) {
        dslFuel[m] = (dslHours[m] / totalDslOpHours) * summaryDslFuel;
      }
    }
  }

  const biomassHours = bioHours.map((v) => Math.round(v * 10) / 10);
  const dieselHours = dslHours.map((v) => Math.round(v * 10) / 10);
  const biomassFuelTons = bioFuelTons.map((v) => Math.round(v * 100) / 100);
  const dieselFuelLiters = dslFuel.map((v) => Math.round(v * 10) / 10);

  const rows: MonthlyGeneratorOperationsRow[] = Array.from({ length: 12 }, (_, m) => ({
    month: m + 1,
    biomassHours: biomassHours[m],
    dieselHours: dieselHours[m],
    biomassFuelTons: biomassFuelTons[m],
    dieselFuelLiters: dieselFuelLiters[m],
    biomassGenerationMwh: Math.round((bioGenKwhByMonth[m] / 1000) * 100) / 100,
    dieselGenerationMwh: Math.round((dslGenKwhByMonth[m] / 1000) * 100) / 100,
  }));

  const totals = {
    biomassHours: Math.round(bioHours.reduce((a, b) => a + b, 0) * 10) / 10,
    dieselHours: Math.round(dslHours.reduce((a, b) => a + b, 0) * 10) / 10,
    biomassFuelTons: Math.round(bioFuelTons.reduce((a, b) => a + b, 0) * 100) / 100,
    dieselFuelLiters: Math.round(dslFuel.reduce((a, b) => a + b, 0) * 10) / 10,
    biomassGenerationMwh: Math.round((bioGenKwhByMonth.reduce((a, b) => a + b, 0) / 1000) * 100) / 100,
    dieselGenerationMwh: Math.round((dslGenKwhByMonth.reduce((a, b) => a + b, 0) / 1000) * 100) / 100,
  };

  const hasBiomass =
    Boolean(result.biomass_summary) ||
    totals.biomassHours > 0 ||
    totals.biomassFuelTons > 0 ||
    totals.biomassGenerationMwh > 0;
  const hasDiesel =
    Boolean(result.diesel_summary) ||
    totals.dieselHours > 0 ||
    totals.dieselFuelLiters > 0 ||
    totals.dieselGenerationMwh > 0;

  return {
    hasBiomass,
    hasDiesel,
    months: Array.from({ length: 12 }, (_, m) => m + 1),
    biomassHours,
    dieselHours,
    biomassFuelTons,
    dieselFuelLiters,
    rows,
    totals,
  };
}
