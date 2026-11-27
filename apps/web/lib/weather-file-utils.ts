import type { HybridCustomWeatherData } from "@/lib/hybrid-types";

export const EXPECTED_WEATHER_STEPS = 8760;

export interface ParsedWeatherFileResult {
  weatherData: HybridCustomWeatherData;
  locationMeta?: {
    city?: string;
    latitude?: number;
    longitude?: number;
    timezoneOffsetHours?: number;
    elevation_m?: number;
  };
}

function validateHourlySeries(
  name: string,
  labelId: string,
  values: unknown,
  options: { allowNegative: boolean; minPhysical?: number; maxPhysical?: number },
): number[] {
  if (!Array.isArray(values)) {
    throw new Error(`Deret ${labelId} (${name}) tidak ditemukan atau bukan daftar angka.`);
  }
  if (values.length !== EXPECTED_WEATHER_STEPS) {
    throw new Error(
      `Panjang deret ${labelId} (${name}) harus tepat ${EXPECTED_WEATHER_STEPS} jam, ditemukan ${values.length} baris.`,
    );
  }

  const out: number[] = new Array(EXPECTED_WEATHER_STEPS);
  for (let i = 0; i < EXPECTED_WEATHER_STEPS; i++) {
    const raw = values[i];
    const num = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    if (!Number.isFinite(num)) {
      throw new Error(`Nilai ${labelId} (${name}) tidak valid atau NaN pada jam ke-${i + 1}.`);
    }
    if (!options.allowNegative && num < 0) {
      throw new Error(`Nilai ${labelId} (${name}) tidak boleh negatif pada jam ke-${i + 1} (ditemukan ${num}).`);
    }
    if (options.minPhysical !== undefined && num < options.minPhysical) {
      throw new Error(`Nilai ${labelId} (${name}) di luar batas fisik wajar pada jam ke-${i + 1} (${num}).`);
    }
    if (options.maxPhysical !== undefined && num > options.maxPhysical) {
      throw new Error(`Nilai ${labelId} (${name}) di luar batas fisik wajar pada jam ke-${i + 1} (${num}).`);
    }
    out[i] = num;
  }
  return out;
}

export function parseWeatherJsonText(text: string, filename = "custom.json"): ParsedWeatherFileResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Berkas JSON cuaca tidak valid (gagal membaca struktur JSON).");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Berkas JSON cuaca harus berupa objek.");
  }

  const root = parsed as Record<string, unknown>;
  const hourlySource =
    typeof root.hourly === "object" && root.hourly !== null && !Array.isArray(root.hourly)
      ? (root.hourly as Record<string, unknown>)
      : root;

  const ghi = validateHourlySeries("ghi_w_m2", "Irradiansi Global (GHI)", hourlySource.ghi_w_m2, {
    allowNegative: false,
  });
  const dni = validateHourlySeries("dni_w_m2", "Irradiansi Langsung (DNI)", hourlySource.dni_w_m2, {
    allowNegative: false,
  });
  const dhi = validateHourlySeries("dhi_w_m2", "Irradiansi Baur (DHI)", hourlySource.dhi_w_m2, {
    allowNegative: false,
  });
  const temp = validateHourlySeries("temp_air_c", "Suhu Udara", hourlySource.temp_air_c, {
    allowNegative: true,
    minPhysical: -90,
    maxPhysical: 70,
  });
  const wind = validateHourlySeries("wind_speed_m_s", "Kecepatan Angin", hourlySource.wind_speed_m_s, {
    allowNegative: false,
  });

  const metaRaw =
    typeof root.metadata === "object" && root.metadata !== null && !Array.isArray(root.metadata)
      ? (root.metadata as Record<string, unknown>)
      : {};

  const lat = typeof metaRaw.latitude === "number" && Number.isFinite(metaRaw.latitude) ? metaRaw.latitude : undefined;
  const lon = typeof metaRaw.longitude === "number" && Number.isFinite(metaRaw.longitude) ? metaRaw.longitude : undefined;
  const elev =
    typeof metaRaw.elevation_m === "number" && Number.isFinite(metaRaw.elevation_m) ? metaRaw.elevation_m : undefined;

  return {
    weatherData: {
      metadata: {
        provider: typeof metaRaw.provider === "string" ? metaRaw.provider : "custom_json",
        dataset: typeof metaRaw.dataset === "string" ? metaRaw.dataset : filename,
        dataset_version: typeof metaRaw.dataset_version === "string" ? metaRaw.dataset_version : "custom",
        period: typeof metaRaw.period === "string" ? metaRaw.period : "8760 jam",
        ...(lat !== undefined ? { latitude: lat } : {}),
        ...(lon !== undefined ? { longitude: lon } : {}),
        ...(elev !== undefined ? { elevation_m: elev } : {}),
      },
      hourly: {
        ghi_w_m2: ghi,
        dni_w_m2: dni,
        dhi_w_m2: dhi,
        temp_air_c: temp,
        wind_speed_m_s: wind,
      },
    },
    locationMeta:
      lat !== undefined || lon !== undefined || elev !== undefined
        ? { latitude: lat, longitude: lon, elevation_m: elev }
        : undefined,
  };
}

function findColumnIndex(headers: string[], candidates: string[], labelId: string): number {
  for (const cand of candidates) {
    const idx = headers.indexOf(cand);
    if (idx !== -1) return idx;
  }
  throw new Error(
    `Header kolom ${labelId} tidak ditemukan pada CSV. Gunakan nama kolom: ${candidates.join(" atau ")}.`,
  );
}

export function parseWeatherCsvText(text: string, filename = "custom.csv"): ParsedWeatherFileResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    throw new Error("Berkas CSV cuaca kosong.");
  }

  const headerCells = lines[0].split(",").map((c) => c.trim().toLowerCase());
  const ghiIdx = findColumnIndex(headerCells, ["ghi_w_m2", "ghi"], "GHI");
  const dniIdx = findColumnIndex(headerCells, ["dni_w_m2", "dni"], "DNI");
  const dhiIdx = findColumnIndex(headerCells, ["dhi_w_m2", "dhi"], "DHI");
  const tempIdx = findColumnIndex(headerCells, ["temp_air_c", "temp"], "Suhu Udara");
  const windIdx = findColumnIndex(headerCells, ["wind_speed_m_s", "wind"], "Kecepatan Angin");

  const dataLines = lines.slice(1);
  if (dataLines.length !== EXPECTED_WEATHER_STEPS) {
    throw new Error(
      `Jumlah baris data CSV cuaca harus tepat ${EXPECTED_WEATHER_STEPS} baris, ditemukan ${dataLines.length} baris.`,
    );
  }

  const ghiRaw: unknown[] = new Array(EXPECTED_WEATHER_STEPS);
  const dniRaw: unknown[] = new Array(EXPECTED_WEATHER_STEPS);
  const dhiRaw: unknown[] = new Array(EXPECTED_WEATHER_STEPS);
  const tempRaw: unknown[] = new Array(EXPECTED_WEATHER_STEPS);
  const windRaw: unknown[] = new Array(EXPECTED_WEATHER_STEPS);

  const maxRequiredIdx = Math.max(ghiIdx, dniIdx, dhiIdx, tempIdx, windIdx);

  for (let i = 0; i < EXPECTED_WEATHER_STEPS; i++) {
    const cells = dataLines[i].split(",");
    if (cells.length <= maxRequiredIdx) {
      throw new Error(`Baris data CSV ke-${i + 1} tidak memiliki kolom cuaca yang lengkap.`);
    }
    ghiRaw[i] = cells[ghiIdx];
    dniRaw[i] = cells[dniIdx];
    dhiRaw[i] = cells[dhiIdx];
    tempRaw[i] = cells[tempIdx];
    windRaw[i] = cells[windIdx];
  }

  const ghi = validateHourlySeries("ghi_w_m2", "Irradiansi Global (GHI)", ghiRaw, { allowNegative: false });
  const dni = validateHourlySeries("dni_w_m2", "Irradiansi Langsung (DNI)", dniRaw, { allowNegative: false });
  const dhi = validateHourlySeries("dhi_w_m2", "Irradiansi Baur (DHI)", dhiRaw, { allowNegative: false });
  const temp = validateHourlySeries("temp_air_c", "Suhu Udara", tempRaw, {
    allowNegative: true,
    minPhysical: -90,
    maxPhysical: 70,
  });
  const wind = validateHourlySeries("wind_speed_m_s", "Kecepatan Angin", windRaw, { allowNegative: false });

  return {
    weatherData: {
      metadata: {
        provider: "custom_csv",
        dataset: filename,
        dataset_version: "custom",
        period: "8760 jam",
      },
      hourly: {
        ghi_w_m2: ghi,
        dni_w_m2: dni,
        dhi_w_m2: dhi,
        temp_air_c: temp,
        wind_speed_m_s: wind,
      },
    },
  };
}

export function parseWeatherEpwText(text: string, filename = "custom.epw"): ParsedWeatherFileResult {
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (rawLines.length === 0) {
    throw new Error("Berkas EPW kosong.");
  }

  let locationMeta: ParsedWeatherFileResult["locationMeta"];
  const locationLine = rawLines.find((line) => line.toUpperCase().startsWith("LOCATION,"));
  if (locationLine) {
    const parts = locationLine.split(",").map((p) => p.trim());
    // Format EPW LOCATION: LOCATION,City,State,Country,Source,WMO,Latitude,Longitude,TimeZone,Elevation
    const city = parts[1] || undefined;
    const lat = parts.length > 6 ? Number(parts[6]) : NaN;
    const lon = parts.length > 7 ? Number(parts[7]) : NaN;
    const tz = parts.length > 8 ? Number(parts[8]) : NaN;
    const elev = parts.length > 9 ? Number(parts[9]) : NaN;
    locationMeta = {
      ...(city ? { city } : {}),
      ...(Number.isFinite(lat) && lat >= -90 && lat <= 90 ? { latitude: lat } : {}),
      ...(Number.isFinite(lon) && lon >= -180 && lon <= 180 ? { longitude: lon } : {}),
      ...(Number.isFinite(tz) ? { timezoneOffsetHours: tz } : {}),
      ...(Number.isFinite(elev) ? { elevation_m: elev } : {}),
    };
  }

  // Baris data EPW dimulai dengan tahun 4-digit atau angka diikuti bulan (1..12), hari (1..31), jam (1..24)
  const dataLines = rawLines.filter((line) => /^\d{4}\s*,/.test(line) || /^-?\d+\s*,\s*(?:[1-9]|1[0-2])\s*,/.test(line));
  if (dataLines.length !== EXPECTED_WEATHER_STEPS) {
    throw new Error(
      `Jumlah baris data cuaca EPW harus tepat ${EXPECTED_WEATHER_STEPS} jam, ditemukan ${dataLines.length} baris.`,
    );
  }

  const ghiRaw: unknown[] = new Array(EXPECTED_WEATHER_STEPS);
  const dniRaw: unknown[] = new Array(EXPECTED_WEATHER_STEPS);
  const dhiRaw: unknown[] = new Array(EXPECTED_WEATHER_STEPS);
  const tempRaw: unknown[] = new Array(EXPECTED_WEATHER_STEPS);
  const windRaw: unknown[] = new Array(EXPECTED_WEATHER_STEPS);

  // Indeks kolom standar EnergyPlus EPW:
  // 6: Dry Bulb Temperature (C)
  // 13: Global Horizontal Radiation (Wh/m2)
  // 14: Direct Normal Radiation (Wh/m2)
  // 15: Diffuse Horizontal Radiation (Wh/m2)
  // 21: Wind Speed (m/s)
  for (let i = 0; i < EXPECTED_WEATHER_STEPS; i++) {
    const cells = dataLines[i].split(",");
    if (cells.length < 22) {
      throw new Error(`Baris data EPW ke-${i + 1} tidak memiliki minimal 22 kolom standar EnergyPlus.`);
    }
    tempRaw[i] = cells[6];
    ghiRaw[i] = cells[13];
    dniRaw[i] = cells[14];
    dhiRaw[i] = cells[15];
    windRaw[i] = cells[21];
  }

  const ghi = validateHourlySeries("ghi_w_m2", "Irradiansi Global (GHI)", ghiRaw, { allowNegative: false });
  const dni = validateHourlySeries("dni_w_m2", "Irradiansi Langsung (DNI)", dniRaw, { allowNegative: false });
  const dhi = validateHourlySeries("dhi_w_m2", "Irradiansi Baur (DHI)", dhiRaw, { allowNegative: false });
  const temp = validateHourlySeries("temp_air_c", "Suhu Bola Kering", tempRaw, {
    allowNegative: true,
    minPhysical: -90,
    maxPhysical: 70,
  });
  const wind = validateHourlySeries("wind_speed_m_s", "Kecepatan Angin", windRaw, { allowNegative: false });

  return {
    weatherData: {
      metadata: {
        provider: "custom_epw",
        dataset: locationMeta?.city ? `${filename} (${locationMeta.city})` : filename,
        dataset_version: "EPW",
        period: "8760 jam",
        ...(locationMeta?.latitude !== undefined ? { latitude: locationMeta.latitude } : {}),
        ...(locationMeta?.longitude !== undefined ? { longitude: locationMeta.longitude } : {}),
        ...(locationMeta?.elevation_m !== undefined ? { elevation_m: locationMeta.elevation_m } : {}),
      },
      hourly: {
        ghi_w_m2: ghi,
        dni_w_m2: dni,
        dhi_w_m2: dhi,
        temp_air_c: temp,
        wind_speed_m_s: wind,
      },
    },
    locationMeta,
  };
}

export function parseWeatherFileContent(text: string, filename: string): ParsedWeatherFileResult {
  const lower = filename.trim().toLowerCase();
  const trimmedText = text.trim();

  if (lower.endsWith(".json") || trimmedText.startsWith("{")) {
    return parseWeatherJsonText(text, filename);
  }
  if (lower.endsWith(".epw") || /^LOCATION,/i.test(trimmedText)) {
    return parseWeatherEpwText(text, filename);
  }
  return parseWeatherCsvText(text, filename);
}
