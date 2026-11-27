import { describe, expect, it } from "vitest";
import {
  EXPECTED_WEATHER_STEPS,
  parseWeatherCsvText,
  parseWeatherEpwText,
  parseWeatherFileContent,
  parseWeatherJsonText,
} from "./weather-file-utils";

function makeSeries(val: number, len = EXPECTED_WEATHER_STEPS): number[] {
  return Array.from({ length: len }, () => val);
}

describe("weather-file-utils", () => {
  it("membaca berkas JSON cuaca 8.760 jam pada objek langsung maupun di bawah hourly", () => {
    const directJson = JSON.stringify({
      ghi_w_m2: makeSeries(250),
      dni_w_m2: makeSeries(180),
      dhi_w_m2: makeSeries(70),
      temp_air_c: makeSeries(28.5),
      wind_speed_m_s: makeSeries(2.4),
    });
    const res1 = parseWeatherJsonText(directJson, "jakarta.json");
    expect(res1.weatherData.hourly.ghi_w_m2).toHaveLength(EXPECTED_WEATHER_STEPS);
    expect(res1.weatherData.hourly.temp_air_c[0]).toBe(28.5);
    expect(res1.weatherData.metadata?.dataset).toBe("jakarta.json");

    const nestedJson = JSON.stringify({
      metadata: { latitude: -6.28, longitude: 107.15, elevation_m: 25 },
      hourly: {
        ghi_w_m2: makeSeries(300),
        dni_w_m2: makeSeries(200),
        dhi_w_m2: makeSeries(100),
        temp_air_c: makeSeries(29.0),
        wind_speed_m_s: makeSeries(3.1),
      },
    });
    const res2 = parseWeatherFileContent(nestedJson, "cikarang.json");
    expect(res2.locationMeta?.latitude).toBe(-6.28);
    expect(res2.locationMeta?.longitude).toBe(107.15);
    expect(res2.locationMeta?.elevation_m).toBe(25);
    expect(res2.weatherData.hourly.ghi_w_m2[8759]).toBe(300);
  });

  it("membaca berkas CSV 8.760 baris dengan nama kolom panjang maupun alias pendek", () => {
    const header = "ghi,dni,dhi,temp,wind";
    const rows = Array.from({ length: EXPECTED_WEATHER_STEPS }, () => "400,250,150,27.2,1.8");
    const csvText = [header, ...rows].join("\n");
    const parsed = parseWeatherCsvText(csvText, "surabaya.csv");
    expect(parsed.weatherData.hourly.ghi_w_m2).toHaveLength(EXPECTED_WEATHER_STEPS);
    expect(parsed.weatherData.hourly.dni_w_m2[10]).toBe(250);
    expect(parsed.weatherData.hourly.temp_air_c[100]).toBe(27.2);
    expect(parsed.weatherData.hourly.wind_speed_m_s[8759]).toBe(1.8);
  });

  it("membaca berkas EPW beserta baris metadata LOCATION dan 8.760 baris data", () => {
    const headerLines = [
      "LOCATION,Surabaya,Jawa Timur,IDN,TMY,969350,-7.25,112.75,7.0,5.0",
      "DESIGN CONDITIONS,0",
      "TYPICAL/EXTREME PERIODS,0",
      "GROUND TEMPERATURES,0",
      "HOLIDAYS/DAYLIGHT SAVINGS,No,0,0,0",
      "COMMENTS 1,Sample EPW",
      "COMMENTS 2,Sample EPW",
      "DATA PERIODS,1,1,Data,Sunday,1/1,12/31",
    ];
    // 22+ kolom EPW: col 6 = dry bulb, col 13 = GHI, col 14 = DNI, col 15 = DHI, col 21 = wind speed
    const epwRow = [
      "2023", "1", "1", "1", "60", "?9?9?9?9E0?9?9?9?9?9?9?9?9?9?9?9?9?9?9?9*9*9?9?9?9",
      "29.4", "22.0", "65", "101325", "0", "0", "350",
      "510", "320", "190", "50000", "30000", "20000", "2000",
      "180", "3.4", "5", "5", "20", "77777", "9", "999999999", "0", "0.05", "0", "88", "0", "0", "0",
    ].join(",");
    const dataRows = Array.from({ length: EXPECTED_WEATHER_STEPS }, () => epwRow);
    const epwText = [...headerLines, ...dataRows].join("\n");

    const parsed = parseWeatherEpwText(epwText, "IDN_Surabaya.epw");
    expect(parsed.locationMeta?.city).toBe("Surabaya");
    expect(parsed.locationMeta?.latitude).toBe(-7.25);
    expect(parsed.locationMeta?.longitude).toBe(112.75);
    expect(parsed.locationMeta?.elevation_m).toBe(5.0);
    expect(parsed.weatherData.hourly.temp_air_c[0]).toBe(29.4);
    expect(parsed.weatherData.hourly.ghi_w_m2[0]).toBe(510);
    expect(parsed.weatherData.hourly.dni_w_m2[0]).toBe(320);
    expect(parsed.weatherData.hourly.dhi_w_m2[0]).toBe(190);
    expect(parsed.weatherData.hourly.wind_speed_m_s[0]).toBe(3.4);
  });

  it("menolak berkas cuaca dengan panjang bukan 8.760 jam, nilai NaN, atau irradiansi negatif", () => {
    const shortJson = JSON.stringify({
      ghi_w_m2: makeSeries(100, 100),
      dni_w_m2: makeSeries(100, 100),
      dhi_w_m2: makeSeries(100, 100),
      temp_air_c: makeSeries(25, 100),
      wind_speed_m_s: makeSeries(2, 100),
    });
    expect(() => parseWeatherJsonText(shortJson)).toThrow(/8760 jam/);

    const negGhi = makeSeries(100);
    negGhi[42] = -5;
    const negJson = JSON.stringify({
      ghi_w_m2: negGhi,
      dni_w_m2: makeSeries(50),
      dhi_w_m2: makeSeries(50),
      temp_air_c: makeSeries(25),
      wind_speed_m_s: makeSeries(2),
    });
    expect(() => parseWeatherJsonText(negJson)).toThrow(/tidak boleh negatif pada jam ke-43/);

    const nanCsvRows = Array.from({ length: EXPECTED_WEATHER_STEPS }, (_, i) =>
      i === 12 ? "100,abc,50,25,2" : "100,80,50,25,2",
    );
    const nanCsv = ["ghi_w_m2,dni_w_m2,dhi_w_m2,temp_air_c,wind_speed_m_s", ...nanCsvRows].join("\n");
    expect(() => parseWeatherCsvText(nanCsv)).toThrow(/tidak valid atau NaN pada jam ke-13/);
  });
});
