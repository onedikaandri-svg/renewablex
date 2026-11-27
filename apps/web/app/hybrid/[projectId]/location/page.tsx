"use client";

import dynamic from "next/dynamic";
import { use, useEffect, useMemo, useState } from "react";
import EChart, { getChartThemeColors, type EChartsOption } from "@/components/hybrid/EChart";
import HybridShell from "@/components/hybrid/HybridShell";
import { IconClipboard, IconClose, IconCopy, IconMapPin, IconSearch } from "@/components/Icons";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/lib/api";
import { slowEngineNoteFor, formatNumber } from "@/lib/format";
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
import { tr, usePreferences } from "@/lib/preferences";
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
          ? tr(
              lang,
              "8,760-hour custom weather data validated by the engine.",
              "Mantap! Data cuaca kustom 8.760 jam sudah lolos validasi mesin.",
              "8,760時間のカスタム気象データがエンジンで検証されました。",
            )
          : tr(
              lang,
              "PVGIS v5.3 TMY weather data fetched.",
              "Mantap! Data cuaca PVGIS v5.3 TMY berhasil ditarik.",
              "PVGIS v5.3 TMY 気象データを取得しました。",
            ),
        "success",
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMsg([...err.problems.general, ...Object.values(err.problems.fields)].join(" "));
      } else {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : tr(lang, "Failed to fetch weather data.", "Gagal mengambil data cuaca.", "気象データの取得に失敗しました。"),
        );
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <HybridShell
      project={project}
      activeStep="location"
      title={tr(
        lang,
        "Location & Solar Resource",
        "Lokasi & Sumber Daya Cuaca",
        "プロジェクト地点・日射気象リソース",
      )}
      subtitle={tr(
        lang,
        "Search a city or industrial estate, pick a point on the interactive map, and fetch hourly TMY weather data from PVGIS v5.3.",
        "Cari kota atau kawasan industri, klik titiknya di peta interaktif, lalu tarik data cuaca 8.760 jam dari PVGIS v5.3.",
        "都市・工業団地を検索するか地図上で地点を選択し、PVGIS v5.3 から時間別TMY気象データを取得します。",
      )}
      result={result}
    >
      <div className="grid-hybrid">
        <section className="card" aria-labelledby="h-loc">
          <div className="card-header">
            <h2 id="h-loc">
              {tr(lang, "Project Identity & Coordinates", "Identitas & Koordinat Lokasi", "プロジェクト名・地点座標")}
            </h2>
          </div>

          <div className="fld" style={{ marginTop: 0 }}>
            <label htmlFor="loc-name">{tr(lang, "Project Name", "Nama Proyek", "プロジェクト名")}</label>
            <input
              id="loc-name"
              type="text"
              value={project.project.project_name}
              onChange={(e) => updateProject((p) => ({ ...p, project: { ...p.project, project_name: e.target.value } }))}
            />
          </div>

          <div className="fld search-box-wrap">
            <div className="label-row">
              <label htmlFor="loc-search">
                {tr(
                  lang,
                  "Search City / Regency / Industrial Estate",
                  "Cari Kota / Kabupaten / Kawasan Industri",
                  "都市・県・工業団地を検索",
                )}
              </label>
              <span className="unit">OpenStreetMap</span>
            </div>
            <div className="search-input-row">
              <input
                id="loc-search"
                type="search"
                placeholder={tr(
                  lang,
                  "Type e.g. Cikarang, Gresik, Morowali, Balikpapan...",
                  "Ketik mis. Cikarang, Gresik, Morowali, Balikpapan...",
                  "例: Cikarang, Surabaya, Tokyo, Osaka...",
                )}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoComplete="off"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="btn ghost btn-sm btn-icon"
                  aria-label={tr(lang, "Clear location search", "Bersihkan pencarian lokasi", "検索キーワードをクリア")}
                  title={tr(lang, "Clear location search", "Bersihkan pencarian lokasi", "検索キーワードをクリア")}
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
                <IconSearch size={13} />{" "}
                {tr(
                  lang,
                  `Searching "${searchQuery.trim()}" on OpenStreetMap Nominatim...`,
                  `Lagi mencari "${searchQuery.trim()}" di OpenStreetMap Nominatim...`,
                  `OpenStreetMap Nominatim で「${searchQuery.trim()}」を検索中...`,
                )}
              </p>
            )}

            {!searchLoading && searchError && (
              <p className="err" role="alert">
                {searchError}
              </p>
            )}

            {!searchLoading && !searchError && hasSearched && searchResults.length === 0 && (
              <p className="note" role="status" style={{ marginTop: "0.375rem" }}>
                {tr(
                  lang,
                  `No location found for "${searchQuery.trim()}". Try another city name or click directly on the map.`,
                  `Lokasi "${searchQuery.trim()}" belum ketemu. Coba kata kunci kota lain atau klik langsung di peta ya.`,
                  `「${searchQuery.trim()}」に一致する地点が見つかりませんでした。別の都市名を試すか地図上をクリックしてください。`,
                )}
              </p>
            )}

            {!searchLoading && searchResults.length > 0 && (
              <ul className="search-results-list" role="listbox" aria-label={tr(lang, "OpenStreetMap location results", "Hasil pencarian lokasi OpenStreetMap", "OpenStreetMap 検索結果")}>
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
              {tr(lang, "Geocoding by", "Geocoding oleh", "ジオコーディング提供:")}{" "}
              <a href="https://nominatim.openstreetmap.org/" target="_blank" rel="noopener noreferrer">
                OpenStreetMap Nominatim
              </a>{" "}
              (&copy; OpenStreetMap contributors, ODbL).
            </p>
          </div>

          <div className="fld">
            <label htmlFor="loc-preset">
              {tr(
                lang,
                "Indonesian City Presets [REAL DATA]",
                "Pintasan Preset Kota Indonesia [REAL DATA]",
                "インドネシア主要都市プリセット [REAL DATA]",
              )}
            </label>
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
                pushToast(
                  tr(
                    lang,
                    `Preset ${hit.name} applied.`,
                    `Sip, preset ${hit.name} sudah dipasang.`,
                    `プリセット「${hit.name}」を適用しました。`,
                  ),
                  "info",
                );
              }}
            >
              <option value="">
                {tr(
                  lang,
                  "Select a city preset (available offline)...",
                  "Pilih kota preset (bisa dipakai saat offline)...",
                  "都市プリセットを選択（オフライン利用可）...",
                )}
              </option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.latitude}, {l.longitude})
                </option>
              ))}
            </select>
          </div>

          <div className="fld">
            <div className="label-row">
              <label htmlFor="loc-paste">
                {tr(
                  lang,
                  "Quick Paste Coordinates / Google Maps URL",
                  "Tempel Koordinat Cepat / Link Google Maps",
                  "座標または Google マップURLの貼り付け",
                )}
              </label>
              <span className="unit">Lat, Lon</span>
            </div>
            <div className="coord-paste-row">
              <input
                id="loc-paste"
                type="text"
                placeholder={tr(
                  lang,
                  "e.g. -6.2834, 107.1521 or Google Maps URL",
                  "Contoh: -6.2834, 107.1521 atau link Google Maps",
                  "例: -6.2834, 107.1521 または GoogleマップURL",
                )}
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
                    applyCoordinates(check.data.latitude, check.data.longitude, "pasted coordinates");
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
                <IconClipboard size={15} /> {tr(lang, "Apply", "Terapkan", "適用")}
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
              <label htmlFor="loc-lat">{tr(lang, "Latitude", "Lintang (Latitude)", "緯度 (Latitude)")}</label>
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
              <label htmlFor="loc-lon">{tr(lang, "Longitude", "Bujur (Longitude)", "経度 (Longitude)")}</label>
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

          <div className="coord-badge-bar" aria-label={tr(lang, "Active project coordinates", "Koordinat aktif proyek", "現在のプロジェクト座標")}>
            <span className="coord-badge-value">
              <IconMapPin size={16} />
              <span>{tr(lang, "Active coordinates", "Koordinat aktif", "現在座標")}: {formattedActiveCoords}</span>
            </span>
            <button
              type="button"
              className="btn ghost btn-sm"
              onClick={() => void handleCopyCoordinates()}
              aria-label={tr(lang, `Copy coordinates ${formattedActiveCoords}`, `Salin koordinat ${formattedActiveCoords}`, `座標 ${formattedActiveCoords} をコピー`)}
              title={tr(lang, "Copy coordinates to clipboard", "Salin koordinat ke papan klip", "座標をクリップボードにコピー")}
            >
              <IconCopy size={14} /> {tr(lang, "Copy Coordinates", "Salin Koordinat", "座標をコピー")}
            </button>
          </div>

          <div className="fld">
            <label htmlFor="loc-tz">{tr(lang, "Local Timezone", "Zona Waktu Lokal", "ローカルタイムゾーン")}</label>
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
            <label htmlFor="loc-weather-src">
              {tr(lang, "8,760-Hour Weather Data Source", "Sumber Data Cuaca 8.760 Jam", "8,760時間 気象データソース")}
            </label>
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
              <option value="pvgis_tmy">
                {tr(
                  lang,
                  "PVGIS v5.3 TMY (Automatic from Coordinates)",
                  "PVGIS v5.3 TMY (Otomatis dari Koordinat)",
                  "PVGIS v5.3 TMY（座標から自動取得）",
                )}
              </option>
              <option value="custom_json">
                {tr(
                  lang,
                  "Upload Custom Weather File (CSV / JSON / EPW 8,760h)",
                  "Unggah File Cuaca Kustom (CSV / JSON / EPW 8.760 Jam)",
                  "カスタム気象ファイルをアップロード (CSV / JSON / EPW 8,760時間)",
                )}
              </option>
            </select>
          </div>

          {project.simulation.weather_source === "custom_json" && (
            <div className="fld">
              <label htmlFor="loc-weather-file">
                {tr(
                  lang,
                  "Choose Custom Weather File (CSV / JSON / EPW 8,760h)",
                  "Pilih File Cuaca Kustom (CSV / JSON / EPW 8.760 Jam)",
                  "カスタム気象ファイルを選択 (CSV / JSON / EPW 8,760時間)",
                )}
              </label>
              <input
                id="loc-weather-file"
                type="file"
                accept=".csv,.json,.epw,text/csv,application/json,text/plain"
                onChange={(e) => void handleWeatherFileUpload(e.target.files?.[0])}
              />
              <p className="note" style={{ marginTop: "0.375rem" }}>
                {tr(
                  lang,
                  <>Supports CSV (columns <code>ghi</code>, <code>dni</code>, <code>dhi</code>, <code>temp</code>, <code>wind</code>), JSON (8,760-hour array), or EnergyPlus EPW.</>,
                  <>Mendukung CSV (kolom <code>ghi</code>, <code>dni</code>, <code>dhi</code>, <code>temp</code>, <code>wind</code>), JSON (array 8.760 jam), atau EnergyPlus EPW.</>,
                  <>CSV（<code>ghi</code>, <code>dni</code>, <code>dhi</code>, <code>temp</code>, <code>wind</code> 列）、JSON（8,760時間配列）、または EnergyPlus EPW に対応します。</>,
                )}
              </p>
              {project.simulation.weather_filename && project.simulation.weather_data && (
                <p className="note" style={{ color: "var(--success)", fontWeight: 600 }}>
                  {tr(
                    lang,
                    `Loaded file: ${project.simulation.weather_filename} (8,760 hours validated)`,
                    `File siap: ${project.simulation.weather_filename} (8.760 jam tervalidasi)`,
                    `読込済ファイル: ${project.simulation.weather_filename}（8,760時間検証済）`,
                  )}
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
                ? tr(lang, "Fetching Weather Data...", "Lagi Mengambil Data Cuaca...", "気象データを取得中...")
                : project.simulation.weather_source === "custom_json"
                  ? tr(lang, "Preview & Validate Custom Weather", "Cek & Validasi Cuaca Kustom", "カスタム気象データを検証")
                  : tr(lang, "Fetch PVGIS Weather Data", "Tarik Data Cuaca PVGIS", "PVGIS気象データを取得")}
            </button>
          </div>
        </section>

        <section aria-labelledby="h-weather-out">
          <div className="card location-map-card" aria-labelledby="h-map-picker">
            <div className="card-header">
              <div>
                <h2 id="h-map-picker">
                  {tr(lang, "Interactive Project Location Map", "Peta Interaktif Titik Proyek", "インタラクティブ地点マップ")}
                </h2>
                <p className="note" style={{ fontSize: "0.8125rem", marginTop: "0.1875rem" }}>
                  {tr(
                    lang,
                    "Click on the map or drag the purple pin to pick your exact project site.",
                    "Klik di peta atau geser pin ungu buat pilih titik lokasi proyekmu.",
                    "地図上をクリックするか紫のピンをドラッグして地点を指定してください。",
                  )}
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

          <h2 id="h-weather-out" style={{ marginTop: 0 }}>
            {tr(lang, "Solar & Weather Resource Preview", "Pratinjau Sumber Daya Cuaca", "日射・気象リソースプレビュー")}
          </h2>

          {loading && (
            <div className="state" role="status">
              <p>{tr(lang, "Contacting calculation engine and PVGIS v5.3 TMY...", "Lagi menghubungi mesin hitung dan PVGIS v5.3 TMY...", "計算エンジンおよび PVGIS v5.3 TMY に接続中...")}</p>
              {slow && <p className="note" style={{ marginTop: "0.75rem" }}>{slowEngineNoteFor(lang)}</p>}
            </div>
          )}

          {!loading && errorMsg && (
            <div className="state bad" role="alert">
              <h3>{tr(lang, "Failed to fetch weather data", "Gagal mengambil data cuaca", "気象データの取得に失敗しました")}</h3>
              <p>{errorMsg}</p>
            </div>
          )}

          {!loading && !errorMsg && !weatherPreview && (
            <div className="state">
              <h3>
                {tr(
                  lang,
                  "No weather preview for this location yet",
                  "Belum ada pratinjau cuaca buat titik ini",
                  "この地点の気象プレビューがまだありません",
                )}
              </h3>
              <p>
                {tr(
                  lang,
                  `Press "Fetch PVGIS Weather Data" on the left panel to inspect annual solar irradiance and temperature at ${formattedActiveCoords}.`,
                  `Klik tombol "Tarik Data Cuaca PVGIS" di panel kiri buat lihat radiasi surya dan suhu tahunan di koordinat ${formattedActiveCoords}.`,
                  `左パネルの「PVGIS気象データを取得」を押すと、座標 ${formattedActiveCoords} の年間日射量と気温を表示します。`,
                )}
              </p>
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
