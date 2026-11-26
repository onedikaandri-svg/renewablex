import { describe, expect, it } from "vitest";
import {
  formatCoordinatePair,
  isValidCoordinatePair,
  normalizeNominatimResults,
  parseCoordinateInput,
  suggestIndonesiaTimezone,
} from "./location-utils";

describe("location-utils", () => {
  describe("parseCoordinateInput", () => {
    it("memisahkan format lintang dan bujur dengan koma", () => {
      const res = parseCoordinateInput("-6.2834, 107.1521");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.latitude).toBeCloseTo(-6.2834, 4);
        expect(res.data.longitude).toBeCloseTo(107.1521, 4);
      }
    });

    it("memisahkan format dengan spasi atau tanda kurung", () => {
      const res = parseCoordinateInput("(-7.2575 112.7521)");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.latitude).toBeCloseTo(-7.2575, 4);
        expect(res.data.longitude).toBeCloseTo(112.7521, 4);
      }
    });

    it("mengekstrak koordinat dari URL Google Maps dengan pola @lat,lon", () => {
      const url = "https://www.google.com/maps/place/Cikarang/@-6.284512,107.150321,14z/data=!4m5";
      const res = parseCoordinateInput(url);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.latitude).toBeCloseTo(-6.28451, 5);
        expect(res.data.longitude).toBeCloseTo(107.15032, 5);
      }
    });

    it("mengutamakan pin spesifik !3d!4d pada URL Google Maps jika tersedia", () => {
      const url = "https://www.google.com/maps/place/Kawasan/@-6.28,107.14,12z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d-6.30125!4d107.16875";
      const res = parseCoordinateInput(url);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.latitude).toBeCloseTo(-6.30125, 5);
        expect(res.data.longitude).toBeCloseTo(107.16875, 5);
      }
    });

    it("mengekstrak koordinat dari parameter query q=lat,lon", () => {
      const url = "https://maps.google.com/?q=-5.147665,119.432731";
      const res = parseCoordinateInput(url);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.latitude).toBeCloseTo(-5.14767, 5);
        expect(res.data.longitude).toBeCloseTo(119.43273, 5);
      }
    });

    it("menolak nilai lintang di luar rentang -90 sampai 90", () => {
      const res = parseCoordinateInput("-95.12, 107.15");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("lintang");
      }
    });

    it("menolak nilai bujur di luar rentang -180 sampai 180", () => {
      const res = parseCoordinateInput("-6.20, 195.00");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("bujur");
      }
    });

    it("menolak input kosong atau teks yang bukan koordinat", () => {
      expect(parseCoordinateInput("   ").ok).toBe(false);
      expect(parseCoordinateInput("Kawasan Industri Cikarang").ok).toBe(false);
    });
  });

  describe("suggestIndonesiaTimezone", () => {
    it("menyarankan Asia/Jakarta (WIB) untuk wilayah Sumatera, Jawa, dan Kalimantan Barat/Tengah", () => {
      expect(suggestIndonesiaTimezone(-6.20, 106.80)).toBe("Asia/Jakarta");
      expect(suggestIndonesiaTimezone(3.59, 98.67)).toBe("Asia/Jakarta");
      expect(suggestIndonesiaTimezone(-0.02, 109.34)).toBe("Asia/Jakarta");
    });

    it("menyarankan Asia/Makassar (WITA) untuk Bali, NTB, NTT, Kalimantan Timur, dan Sulawesi", () => {
      expect(suggestIndonesiaTimezone(-8.65, 115.21)).toBe("Asia/Makassar");
      expect(suggestIndonesiaTimezone(-5.14, 119.43)).toBe("Asia/Makassar");
      expect(suggestIndonesiaTimezone(-10.17, 123.61)).toBe("Asia/Makassar");
    });

    it("menyarankan Asia/Jayapura (WIT) untuk Maluku dan Papua", () => {
      expect(suggestIndonesiaTimezone(-2.53, 140.71)).toBe("Asia/Jayapura");
      expect(suggestIndonesiaTimezone(-0.86, 134.06)).toBe("Asia/Jayapura");
    });

    it("mengembalikan null untuk lokasi di luar wilayah Indonesia", () => {
      expect(suggestIndonesiaTimezone(35.68, 139.76)).toBeNull();
      expect(suggestIndonesiaTimezone(51.50, -0.12)).toBeNull();
    });
  });

  describe("formatCoordinatePair & isValidCoordinatePair", () => {
    it("memformat pasangan koordinat menjadi 4 desimal yang rapi", () => {
      expect(formatCoordinatePair(-6.28, 107.15)).toBe("-6.2800, 107.1500");
      expect(isValidCoordinatePair(-6.28, 107.15)).toBe(true);
      expect(isValidCoordinatePair(91, 107)).toBe(false);
    });
  });

  describe("normalizeNominatimResults", () => {
    it("menormalisasi respons JSON Nominatim dan mengabaikan item tidak valid", () => {
      const sample = [
        {
          place_id: 101,
          lat: "-6.2834",
          lon: "107.1521",
          name: "Cikarang",
          display_name: "Cikarang, Kabupaten Bekasi, Jawa Barat, Indonesia",
          addresstype: "town",
        },
        {
          place_id: 102,
          lat: "invalid",
          lon: "107.0",
        },
      ];
      const list = normalizeNominatimResults(sample);
      expect(list).toHaveLength(1);
      expect(list[0]?.shortName).toBe("Cikarang");
      expect(list[0]?.categoryLabel).toBe("Kota");
      expect(list[0]?.latitude).toBeCloseTo(-6.2834, 4);
      expect(list[0]?.longitude).toBeCloseTo(107.1521, 4);
    });
  });
});
