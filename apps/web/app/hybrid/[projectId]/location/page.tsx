"use client";

import dynamic from "next/dynamic";
import { use, useEffect, useMemo, useState } from "react";
import EChart, { getChartThemeColors, type EChartsOption } from "@/components/hybrid/EChart";
import HybridShell from "@/components/hybrid/HybridShell";
import { IconClipboard, IconClose, IconCopy, IconMapPin, IconSearch } from "@/components/Icons";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/lib/api";
import { SLOW_ENGINE_NOTE, formatNumber } from "@/lib/format";
import { fetchHybridPresets, previewHybridWeather } from "@/lib/hybrid-api";
import type { HybridPresetsResponse } from "@/lib/hybrid-types";
import {
  formatCoordinatePair,
  parseCoordinateInput,
  searchLocationsNominatim,
  suggestIndonesiaTimezone,
  type GeocodeSuggestion,
} from "@/lib/location-utils";
import { parseWeatherFileContent } from "@/lib/weather-file-utils";
import { usePreferences } from "@/lib/preferences";
import { MissingProjectState, useHybridProject } from "@/lib/use-hybrid-project";

const LocationMapPicker = dynamic(() => import("@/components/hybrid/LocationMapPicker"), {
  ssr: false,
  loading: () => (
    <div className="state" role="status" style={{ minHeight: "17.5rem", display: "grid", placeItems: "center" }}>
      <p>Memuat peta interaktif OpenStreetMap&hellip;</p>
    </div>
  ),
});

const FALLBACK_LOCATIONS = [
  { id: "jakarta", name: "Jakarta (Jawa Barat) [REAL DATA]", latitude: -6.20, longitude: 106.80, elevation_m: 12, timezone: "Asia/Jakarta" },
  { id: "cikarang", name: "Cikarang Kawasan Industri [REAL DATA]", latitude: -6.28, longitude: 107.15, elevation_m: 25, timezone: "Asia/Jakarta" },
  { id: "surabaya", name: "Surabaya (Jawa Timur) [REAL DATA]", latitude: -7.25, longitude: 112.75, elevation_m: 5, timezone: "Asia/Jakarta" },
  { id: "medan", name: "Medan (Sumatera Utara) [REAL DATA]", latitude: 3.59, longitude: 98.67, elevation_m: 25, timezone: "Asia/Jakarta" },
  { id: "makassar", name: "Makassar (Sulawesi Selatan) [REAL DATA]", latitude: -5.14, longitude: 119.43, elevation_m: 8, timezone: "Asia/Makassar" },
  { id: "kupang", name: "Kupang (NTT) [REAL DATA]", latitude: -10.17, longitude: 123.61, elevation_m: 45, timezone: "Asia/Makassar" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export default function HybridLocationPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { project, result, ready, updateProject } = useHybridProject(projectId);
  const { pushToast } = useToast();
  const { theme, lang } = usePreferences();
  const colors = useMemo(() => getChartThemeColors(theme), [theme]);

  const [presets, setPresets] = useState<HybridPresetsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // State pencarian kota/kabupaten Nominatim
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GeocodeSuggestion[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  // State tempel koordinat 1-baris
  const [pasteInput, setPasteInput] = useState("");
  const [pasteError, setPasteError] = useState("");
  const [uploadError, setUploadError] = useState("");

  useEffect(() => {
    fetchHybridPresets().then(setPresets).catch(() => {});
  }, []);

  useEffect(() => {
    if (!loading) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, [loading]);

  // Debounce >= 550 ms untuk pencarian lokasi Nominatim
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError("");
      setHasSearched(false);
      return;
    }

    const controller = new AbortController();
    setSearchLoading(true);
    setSearchError("");

    const timer = window.setTimeout(async () => {
      try {
        const list = await searchLocationsNominatim(trimmed, controller.signal);
        if (!controller.signal.aborted) {
          setSearchResults(list);
          setHasSearched(true);
          setSearchLoading(false);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setSearchResults([]);
        setHasSearched(true);
        setSearchLoading(false);
        setSearchError(
          err instanceof Error
            ? err.message
            : "Tidak dapat menghubungi layanan geocoding OpenStreetMap Nominatim. Gunakan preset kota atau ketik koordinat manual."
        );
      }
    }, 550);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  const weatherPreview = project?.weatherPreview ?? null;

  const weatherOption = useMemo<EChartsOption>(() => {
    if (!weatherPreview) return {};
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { color: colors.text } },
      grid: { left: 48, right: 48, top: 40, bottom: 28 },
      xAxis: { type: "category", data: MONTHS, axisLabel: { color: colors.muted } },
      yAxis: [
        { type: "value", name: "kWh/m2", nameTextStyle: { color: colors.muted }, axisLabel: { color: colors.muted }, splitLine: { lineStyle: { color: colors.border } } },
        { type: "value", name: "C", nameTextStyle: { color: colors.muted }, axisLabel: { color: colors.muted }, splitLine: { show: false } },
      ],
      series: [
        { name: "GHI (kWh/m2)", type: "bar", color: colors.pv, data: weatherPreview.monthly.map((m) => m.ghi_kwh_m2) },
        { name: "DNI (kWh/m2)", type: "bar", color: colors.bess, data: weatherPreview.monthly.map((m) => m.dni_kwh_m2) },
        { name: "Suhu Rata-rata (C)", type: "line", yAxisIndex: 1, color: colors.biomass, data: weatherPreview.monthly.map((m) => m.avg_temp_c) },
      ],
    };
  }, [weatherPreview, colors]);

  if (!ready) {
    return <div className="state"><p>Memuat proyek&hellip;</p></div>;
  }
  if (!project) {
    return <MissingProjectState />;
  }

  const locations = presets?.location_presets ?? FALLBACK_LOCATIONS;
  const formattedActiveCoords = formatCoordinatePair(project.project.latitude, project.project.longitude, 4);

  function applyCoordinates(nextLat: number, nextLon: number, sourceLabel?: string) {
    const suggestedTz = suggestIndonesiaTimezone(nextLat, nextLon);
    updateProject((p) => ({
      ...p,
      project: {
        ...p.project,
        latitude: nextLat,
        longitude: nextLon,
        timezone: suggestedTz ?? p.project.timezone,
      },
      weatherPreview: null,
    }));
    if (sourceLabel) {
      const tzNote = suggestedTz ? ` (${suggestedTz})` : "";
      pushToast(`Lokasi diperbarui ke ${sourceLabel}: ${formatCoordinatePair(nextLat, nextLon, 4)}${tzNote}.`, "success");
    }
  }

  async function handleCopyCoordinates() {
    if (!project) return;
    const text = formatCoordinatePair(project.project.latitude, project.project.longitude, 4);
    try {
      await navigator.clipboard.writeText(text);
      pushToast(`Koordinat ${text} disalin ke papan klip.`, "success");
    } catch {
      pushToast(`Salin manual koordinat: ${text}`, "info");
    }
  }

  function handleApplyPasteInput(rawText: string) {
    const parsed = parseCoordinateInput(rawText);
    if (!parsed.ok) {
      setPasteError(parsed.error);
      return;
    }
    setPasteError("");
    setPasteInput(`${parsed.data.latitude}, ${parsed.data.longitude}`);
    applyCoordinates(parsed.data.latitude, parsed.data.longitude, "koordinat tempel");
  }

  async function handleWeatherFileUpload(file: File | undefined) {
    if (!file || !project) return;
    setUploadError("");
    setErrorMsg("");
    try {
      const text = await file.text();
      const parsed = parseWeatherFileContent(text, file.name);
      const nextLat = parsed.locationMeta?.latitude ?? project.project.latitude;
      const nextLon = parsed.locationMeta?.longitude ?? project.project.longitude;
      const nextElev = parsed.locationMeta?.elevation_m ?? project.project.elevation_m;
      const suggestedTz = suggestIndonesiaTimezone(nextLat, nextLon);

      updateProject((p) => ({
        ...p,
        project: {
          ...p.project,
          latitude: nextLat,
          longitude: nextLon,
          elevation_m: nextElev,
          timezone: suggestedTz ?? p.project.timezone,
        },
        simulation: {
          ...p.simulation,
          weather_source: "custom_json",
          weather_data: parsed.weatherData,
          weather_filename: file.name,
        },
        weatherPreview: null,
      }));
      const metaInfo =
        parsed.locationMeta?.latitude !== undefined && parsed.locationMeta?.longitude !== undefined
          ? ` (koordinat ${formatCoordinatePair(nextLat, nextLon, 4)})`
          : "";
      pushToast(`Berkas cuaca "${file.name}" (8.760 jam)${metaInfo} berhasil dimuat.`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Gagal membaca berkas cuaca kustom.";
      setUploadError(msg);
      pushToast(msg, "error");
    }
  }

  async function handleFetchWeather() {
    if (!project) return;
    const isCustom = project.simulation.weather_source === "custom_json";
    if (isCustom && !project.simulation.weather_data) {
      const msg = "Silakan unggah berkas cuaca kustom (CSV, JSON, atau EPW 8.760 jam) terlebih dahulu.";
      setErrorMsg(msg);
      pushToast(msg, "error");
      return;
    }
    setLoading(true);
    setErrorMsg("");
    try {
      const preview = await previewHybridWeather(project);
      updateProject((p) => ({
        ...p,
        project: {
          ...p.project,
          elevation_m: preview.weather_source.elevation_m ?? p.project.elevation_m,
        },
        weatherPreview: preview,
      }));
      pushToast(
        isCustom
          ? "Pratinjau data cuaca kustom 8.760 jam berhasil divalidasi oleh mesin."
          : "Data cuaca PVGIS v5.3 TMY berhasil diambil.",
        "success",
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMsg([...err.problems.general, ...Object.values(err.problems.fields)].join(" "));
      } else {
        setErrorMsg(err instanceof Error ? err.message : "Gagal mengambil data cuaca.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <HybridShell
      project={project}
      activeStep="location"
      title={lang === "en" ? "Location & Solar Resource" : "Lokasi & Sumber Daya Cuaca"}
      subtitle="Cari kota atau kawasan industri, pilih titik pada peta interaktif, lalu ambil data cuaca TMY per jam dari PVGIS v5.3."
      result={result}
    >
      <div className="grid-hybrid">
        <section className="card" aria-labelledby="h-loc">
          <div className="card-header">
            <h2 id="h-loc">Identitas &amp; Koordinat Lokasi</h2>
          </div>

          <div className="fld" style={{ marginTop: 0 }}>
            <label htmlFor="loc-name">Nama Proyek</label>
            <input
              id="loc-name"
              type="text"
              value={project.project.project_name}
              onChange={(e) => updateProject((p) => ({ ...p, project: { ...p.project, project_name: e.target.value } }))}
            />
          </div>

          <div className="fld search-box-wrap">
            <div className="label-row">
              <label htmlFor="loc-search">Cari Kota / Kabupaten / Kawasan Industri</label>
              <span className="unit">OpenStreetMap</span>
            </div>
            <div className="search-input-row">
              <input
                id="loc-search"
                type="search"
                placeholder="Ketik mis. Cikarang, Gresik, Morowali, Balikpapan..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoComplete="off"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="btn ghost btn-sm btn-icon"
                  aria-label="Bersihkan pencarian lokasi"
                  title="Bersihkan pencarian lokasi"
                  onClick={() => {
                    setSearchQuery("");
                    setSearchResults([]);
                    setSearchError("");
                    setHasSearched(false);
                  }}
                >
                  <IconClose size={15} />
                </button>
              )}
            </div>

            {searchLoading && (
              <p className="note" role="status" style={{ marginTop: "0.375rem" }}>
                <IconSearch size={13} /> Mencari wilayah &ldquo;{searchQuery.trim()}&rdquo; di OpenStreetMap Nominatim&hellip;
              </p>
            )}

            {!searchLoading && searchError && (
              <p className="err" role="alert">
                {searchError}
              </p>
            )}

            {!searchLoading && !searchError && hasSearched && searchResults.length === 0 && (
              <p className="note" role="status" style={{ marginTop: "0.375rem" }}>
                Lokasi tidak ditemukan untuk &ldquo;{searchQuery.trim()}&rdquo;. Coba kata kunci kota/kabupaten lain atau klik langsung pada peta.
              </p>
            )}

            {!searchLoading && searchResults.length > 0 && (
              <ul className="search-results-list" role="listbox" aria-label="Hasil pencarian lokasi OpenStreetMap">
                {searchResults.map((item) => (
                  <li key={item.id} className="search-result-item" role="option" aria-selected="false">
                    <button
                      type="button"
                      className="search-result-btn"
                      onClick={() => {
                        applyCoordinates(item.latitude, item.longitude, item.shortName);
                        setSearchQuery(item.shortName);
                        setSearchResults([]);
                        setHasSearched(false);
                      }}
                    >
                      <span className="search-result-top">
                        <span className="search-result-title">{item.shortName}</span>
                        <span className="search-result-coords">
                          {item.categoryLabel} &middot; {formatCoordinatePair(item.latitude, item.longitude, 4)}
                        </span>
                      </span>
                      <span className="search-result-sub">{item.displayName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <p className="osm-attribution">
              Geocoding oleh{" "}
              <a href="https://nominatim.openstreetmap.org/" target="_blank" rel="noopener noreferrer">
                OpenStreetMap Nominatim
              </a>{" "}
              (&copy; kontributor OpenStreetMap, lisensi ODbL).
            </p>
          </div>

          <div className="fld">
            <label htmlFor="loc-preset">Jalan Pintas Preset Kota Indonesia [REAL DATA]</label>
            <select
              id="loc-preset"
              defaultValue=""
              onChange={(e) => {
                const hit = locations.find((l) => l.id === e.target.value);
                if (!hit) return;
                updateProject((p) => ({
                  ...p,
                  project: {
                    ...p.project,
                    latitude: hit.latitude,
                    longitude: hit.longitude,
                    elevation_m: hit.elevation_m,
                    timezone: hit.timezone,
                  },
                  weatherPreview: null,
                }));
                pushToast(`Preset ${hit.name} diterapkan.`, "info");
              }}
            >
              <option value="">Pilih kota preset (tersedia saat offline)...</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.latitude}, {l.longitude})
                </option>
              ))}
            </select>
          </div>

          <div className="fld">
            <div className="label-row">
              <label htmlFor="loc-paste">Tempel Koordinat Cepat / URL Google Maps</label>
              <span className="unit">Lat, Lon</span>
            </div>
            <div className="coord-paste-row">
              <input
                id="loc-paste"
                type="text"
                placeholder="Contoh: -6.2834, 107.1521 atau URL Google Maps"
                value={pasteInput}
                aria-invalid={pasteError ? "true" : "false"}
                onChange={(e) => {
                  setPasteInput(e.target.value);
                  if (pasteError) setPasteError("");
                }}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData("text");
                  if (!pasted) return;
                  const check = parseCoordinateInput(pasted);
                  if (check.ok) {
                    e.preventDefault();
                    setPasteInput(`${check.data.latitude}, ${check.data.longitude}`);
                    setPasteError("");
                    applyCoordinates(check.data.latitude, check.data.longitude, "koordinat tempel");
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleApplyPasteInput(pasteInput);
                  }
                }}
              />
              <button
                type="button"
                className="btn ghost btn-sm"
                onClick={() => handleApplyPasteInput(pasteInput)}
              >
                <IconClipboard size={15} /> Terapkan
              </button>
            </div>
            {pasteError && (
              <p className="err" role="alert">
                {pasteError}
              </p>
            )}
          </div>

          <div className="grid-2">
            <div className="fld">
              <label htmlFor="loc-lat">Lintang (Latitude)</label>
              <input
                id="loc-lat"
                type="number"
                step="0.0001"
                min="-90"
                max="90"
                value={project.project.latitude}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= -90 && v <= 90) {
                    const suggestedTz = suggestIndonesiaTimezone(v, project.project.longitude);
                    updateProject((p) => ({
                      ...p,
                      project: {
                        ...p.project,
                        latitude: v,
                        timezone: suggestedTz ?? p.project.timezone,
                      },
                      weatherPreview: null,
                    }));
                  }
                }}
              />
            </div>
            <div className="fld">
              <label htmlFor="loc-lon">Bujur (Longitude)</label>
              <input
                id="loc-lon"
                type="number"
                step="0.0001"
                min="-180"
                max="180"
                value={project.project.longitude}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= -180 && v <= 180) {
                    const suggestedTz = suggestIndonesiaTimezone(project.project.latitude, v);
                    updateProject((p) => ({
                      ...p,
                      project: {
                        ...p.project,
                        longitude: v,
                        timezone: suggestedTz ?? p.project.timezone,
                      },
                      weatherPreview: null,
                    }));
                  }
                }}
              />
            </div>
          </div>

          <div className="coord-badge-bar" aria-label="Koordinat aktif proyek">
            <span className="coord-badge-value">
              <IconMapPin size={16} />
              <span>Koordinat aktif: {formattedActiveCoords}</span>
            </span>
            <button
              type="button"
              className="btn ghost btn-sm"
              onClick={() => void handleCopyCoordinates()}
              aria-label={`Salin koordinat ${formattedActiveCoords}`}
              title="Salin koordinat ke papan klip"
            >
              <IconCopy size={14} /> Salin Koordinat
            </button>
          </div>

          <div className="fld">
            <label htmlFor="loc-tz">Zona Waktu Lokal</label>
            <select
              id="loc-tz"
              value={project.project.timezone}
              onChange={(e) => updateProject((p) => ({ ...p, project: { ...p.project, timezone: e.target.value }, weatherPreview: null }))}
            >
              <option value="Asia/Jakarta">WIB (Asia/Jakarta, UTC+7)</option>
              <option value="Asia/Makassar">WITA (Asia/Makassar, UTC+8)</option>
              <option value="Asia/Jayapura">WIT (Asia/Jayapura, UTC+9)</option>
              <option value="UTC">UTC</option>
            </select>
          </div>

          <div className="fld">
            <label htmlFor="loc-weather-src">Sumber Data Cuaca 8.760 Jam</label>
            <select
              id="loc-weather-src"
              value={project.simulation.weather_source}
              onChange={(e) => {
                const nextSrc = e.target.value as "pvgis_tmy" | "custom_json";
                setUploadError("");
                setErrorMsg("");
                updateProject((p) => ({
                  ...p,
                  simulation: {
                    ...p.simulation,
                    weather_source: nextSrc,
                  },
                  weatherPreview: null,
                }));
              }}
            >
              <option value="pvgis_tmy">PVGIS v5.3 TMY (Otomatis dari Koordinat)</option>
              <option value="custom_json">Unggah Berkas Cuaca Kustom (CSV / JSON / EPW 8.760 Jam)</option>
            </select>
          </div>

          {project.simulation.weather_source === "custom_json" && (
            <div className="fld">
              <label htmlFor="loc-weather-file">Pilih Berkas Cuaca Kustom (CSV / JSON / EPW 8.760 Jam)</label>
              <input
                id="loc-weather-file"
                type="file"
                accept=".csv,.json,.epw,text/csv,application/json,text/plain"
                onChange={(e) => void handleWeatherFileUpload(e.target.files?.[0])}
              />
              <p className="note" style={{ marginTop: "0.375rem" }}>
                Mendukung CSV (kolom <code>ghi</code>, <code>dni</code>, <code>dhi</code>, <code>temp</code>, <code>wind</code>), JSON (array 8.760 jam), atau EnergyPlus EPW.
              </p>
              {project.simulation.weather_filename && project.simulation.weather_data && (
                <p className="note" style={{ color: "var(--success)", fontWeight: 600 }}>
                  Berkas termuat: {project.simulation.weather_filename} (8.760 jam tervalidasi)
                </p>
              )}
              {uploadError && (
                <p className="err" role="alert">
                  {uploadError}
                </p>
              )}
            </div>
          )}

          <div className="row">
            <button type="button" className="btn primary" disabled={loading} onClick={() => void handleFetchWeather()}>
              {loading
                ? "Memproses Data Cuaca..."
                : project.simulation.weather_source === "custom_json"
                  ? "Pratinjau & Validasi Cuaca Kustom"
                  : "Ambil Data Cuaca PVGIS"}
            </button>
          </div>
        </section>

        <section aria-labelledby="h-weather-out">
          <div className="card location-map-card" aria-labelledby="h-map-picker">
            <div className="card-header">
              <div>
                <h2 id="h-map-picker">Peta Interaktif Titik Proyek</h2>
                <p className="note" style={{ fontSize: "0.8125rem", marginTop: "0.1875rem" }}>
                  Klik pada peta atau geser pin ungu untuk memilih lokasi tepat proyek Anda.
                </p>
              </div>
              <span className="chip tabular-nums">{formattedActiveCoords}</span>
            </div>

            <LocationMapPicker
              latitude={project.project.latitude}
              longitude={project.project.longitude}
              onChange={(nextLat, nextLon) => {
                applyCoordinates(nextLat, nextLon);
              }}
            />
          </div>

          <h2 id="h-weather-out" style={{ marginTop: 0 }}>Pratinjau Sumber Daya Cuaca</h2>

          {loading && (
            <div className="state" role="status">
              <p>Menghubungi mesin hitung dan PVGIS v5.3 TMY&hellip;</p>
              {slow && <p className="note" style={{ marginTop: "0.75rem" }}>{SLOW_ENGINE_NOTE}</p>}
            </div>
          )}

          {!loading && errorMsg && (
            <div className="state bad" role="alert">
              <h3>Gagal mengambil data cuaca</h3>
              <p>{errorMsg}</p>
            </div>
          )}

          {!loading && !errorMsg && !weatherPreview && (
            <div className="state">
              <h3>Belum ada pratinjau cuaca untuk titik ini</h3>
              <p>Tekan tombol &ldquo;Ambil Data Cuaca PVGIS&rdquo; di panel kiri untuk melihat irradiansi dan suhu tahunan pada koordinat {formattedActiveCoords}.</p>
            </div>
          )}

          {!loading && weatherPreview && (
            <>
              <div className="kpis">
                <div className="kpi">
                  <span>GHI Tahunan</span>
                  <b className="accent">{formatNumber(weatherPreview.annual_summary.total_ghi_kwh_m2, lang, 0)} kWh/m2</b>
                  <span>{weatherPreview.weather_source.dataset ?? "PVGIS-ERA5"}</span>
                </div>
                <div className="kpi">
                  <span>DNI Tahunan</span>
                  <b>{formatNumber(weatherPreview.annual_summary.total_dni_kwh_m2, lang, 0)} kWh/m2</b>
                  <span>DHI: {formatNumber(weatherPreview.annual_summary.total_dhi_kwh_m2, lang, 0)} kWh/m2</span>
                </div>
                <div className="kpi">
                  <span>Suhu Udara Rata-rata</span>
                  <b>{formatNumber(weatherPreview.annual_summary.avg_temp_c, lang, 1)} C</b>
                  <span>Min {weatherPreview.annual_summary.min_temp_c} C / Maks {weatherPreview.annual_summary.max_temp_c} C</span>
                </div>
                <div className="kpi">
                  <span>Elevasi &amp; Angin</span>
                  <b>{weatherPreview.weather_source.elevation_m ?? "-"} m</b>
                  <span>Angin rata-rata {weatherPreview.annual_summary.avg_wind_m_s} m/s</span>
                </div>
              </div>

              <div className="sec chart-card">
                <div className="chart-head">
                  <h3>Radiasi Surya &amp; Suhu Bulanan (TMY)</h3>
                  <span className="chip">{weatherPreview.weather_source.period ?? "2005-2023"}</span>
                </div>
                <EChart
                  option={weatherOption}
                  height={320}
                  ariaLabel="Grafik irradiansi GHI, DNI, dan suhu udara rata-rata bulanan dari PVGIS TMY."
                />
              </div>
            </>
          )}
        </section>
      </div>
    </HybridShell>
  );
}
