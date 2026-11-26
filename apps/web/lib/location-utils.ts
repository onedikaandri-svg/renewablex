export interface ParsedCoordinates {
  latitude: number;
  longitude: number;
}

export type ParseCoordinateResult =
  | { ok: true; data: ParsedCoordinates }
  | { ok: false; error: string };

export interface GeocodeSuggestion {
  id: string;
  displayName: string;
  shortName: string;
  categoryLabel: string;
  latitude: number;
  longitude: number;
}

interface NominatimRawItem {
  place_id?: number | string;
  osm_id?: number | string;
  lat?: string;
  lon?: string;
  display_name?: string;
  name?: string;
  type?: string;
  class?: string;
  addresstype?: string;
}

export function isValidCoordinatePair(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function roundCoordinate(value: number, decimals = 4): number {
  const factor = Math.pow(10, decimals);
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(value) + Number.EPSILON) * factor)) / factor;
}

export function formatCoordinatePair(latitude: number, longitude: number, decimals = 4): string {
  const latStr = Number.isFinite(latitude) ? latitude.toFixed(decimals) : "0.0000";
  const lonStr = Number.isFinite(longitude) ? longitude.toFixed(decimals) : "0.0000";
  return `${latStr}, ${lonStr}`;
}

export function parseCoordinateInput(raw: string): ParseCoordinateResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "Masukkan koordinat dalam format 'lintang, bujur' (contoh: -6.2834, 107.1521) atau tautan Google Maps.",
    };
  }

  let lat: number | null = null;
  let lon: number | null = null;

  // 1. Tautan Google Maps dengan pola !3d<lat>!4d<lon> (koordinat pin spesifik)
  const bangMatch = trimmed.match(/!3d([+-]?\d+(?:\.\d+)?)!4d([+-]?\d+(?:\.\d+)?)/i);
  if (bangMatch) {
    lat = Number(bangMatch[1]);
    lon = Number(bangMatch[2]);
  }

  // 2. Tautan Google Maps dengan pola @<lat>,<lon>
  if (lat === null || lon === null) {
    const atMatch = trimmed.match(/@([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)/);
    if (atMatch) {
      lat = Number(atMatch[1]);
      lon = Number(atMatch[2]);
    }
  }

  // 3. Tautan dengan query q=<lat>,<lon> atau ll=<lat>,<lon> atau center=<lat>,<lon>
  if (lat === null || lon === null) {
    const queryMatch = trimmed.match(/(?:[?&](?:q|ll|center|query)=)([+-]?\d+(?:\.\d+)?)(?:%2C|,|\s+)([+-]?\d+(?:\.\d+)?)/i);
    if (queryMatch) {
      lat = Number(queryMatch[1]);
      lon = Number(queryMatch[2]);
    }
  }

  // 4. Format langsung dua angka yang dipisahkan koma, titik koma, atau spasi
  if (lat === null || lon === null) {
    const directMatch = trimmed.match(
      /^[\s([]*([+-]?\d+(?:\.\d+)?)\s*(?:,|;|\s)\s*([+-]?\d+(?:\.\d+)?)[\s)\]]*$/
    );
    if (directMatch) {
      lat = Number(directMatch[1]);
      lon = Number(directMatch[2]);
    }
  }

  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return {
      ok: false,
      error: "Format koordinat tidak dikenali. Gunakan 'lintang, bujur' (contoh: -6.2834, 107.1521) atau tempel URL Google Maps.",
    };
  }

  if (lat < -90 || lat > 90) {
    return {
      ok: false,
      error: `Nilai lintang (${lat}) di luar batas valid (-90 sampai 90).`,
    };
  }

  if (lon < -180 || lon > 180) {
    return {
      ok: false,
      error: `Nilai bujur (${lon}) di luar batas valid (-180 sampai 180).`,
    };
  }

  return {
    ok: true,
    data: {
      latitude: roundCoordinate(lat, 5),
      longitude: roundCoordinate(lon, 5),
    },
  };
}

/**
 * Menyarankan zona waktu Indonesia (WIB, WITA, WIT) berdasarkan koordinat
 * bila titik berada di sekitar wilayah Indonesia (lintang -12 s/d 7, bujur 94 s/d 142).
 * Mengembalikan null bila berada di luar cakupan Indonesia agar zona waktu pengguna tidak ditimpa paksa.
 */
export function suggestIndonesiaTimezone(latitude: number, longitude: number): string | null {
  if (!isValidCoordinatePair(latitude, longitude)) {
    return null;
  }
  const inIndonesiaBounds = latitude >= -12.5 && latitude <= 7.5 && longitude >= 94.0 && longitude <= 142.0;
  if (!inIndonesiaBounds) {
    return null;
  }
  if (longitude < 114.5) {
    return "Asia/Jakarta";
  }
  if (longitude < 129.5) {
    return "Asia/Makassar";
  }
  return "Asia/Jayapura";
}

function mapCategoryLabel(raw: NominatimRawItem): string {
  const kind = (raw.addresstype || raw.type || raw.class || "").toLowerCase();
  if (kind.includes("city") || kind.includes("town") || kind.includes("municipality")) return "Kota";
  if (kind.includes("county") || kind.includes("regency") || kind.includes("administrative")) return "Kabupaten / Wilayah";
  if (kind.includes("industrial") || kind.includes("commercial")) return "Kawasan Industri";
  if (kind.includes("village") || kind.includes("suburb") || kind.includes("district")) return "Kecamatan / Desa";
  if (kind.includes("island")) return "Pulau";
  return "Lokasi";
}

export function normalizeNominatimResults(payload: unknown): GeocodeSuggestion[] {
  if (!Array.isArray(payload)) return [];
  const results: GeocodeSuggestion[] = [];

  for (let i = 0; i < payload.length; i += 1) {
    const item = payload[i] as NominatimRawItem;
    const lat = Number(item?.lat);
    const lon = Number(item?.lon);
    if (!isValidCoordinatePair(lat, lon)) continue;

    const displayName = typeof item?.display_name === "string" && item.display_name.trim()
      ? item.display_name.trim()
      : `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    const firstPart = displayName.split(",")[0]?.trim() || displayName;
    const shortName = typeof item?.name === "string" && item.name.trim() ? item.name.trim() : firstPart;

    results.push({
      id: String(item?.place_id ?? item?.osm_id ?? `${i}-${lat}-${lon}`),
      displayName,
      shortName,
      categoryLabel: mapCategoryLabel(item),
      latitude: roundCoordinate(lat, 5),
      longitude: roundCoordinate(lon, 5),
    });
  }

  return results;
}

export async function searchLocationsNominatim(
  query: string,
  signal?: AbortSignal
): Promise<GeocodeSuggestion[]> {
  const cleaned = query.trim();
  if (cleaned.length < 2) {
    return [];
  }

  const params = new URLSearchParams({
    q: cleaned,
    format: "jsonv2",
    addressdetails: "1",
    limit: "6",
    "accept-language": "id,en",
  });

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Layanan pencarian lokasi mengembalikan status HTTP ${response.status}.`);
  }

  const json: unknown = await response.json();
  return normalizeNominatimResults(json);
}
