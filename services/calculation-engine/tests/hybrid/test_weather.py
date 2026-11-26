"""Tes unit untuk WeatherDataset dan PVGISTMYWeatherProvider (offline mock)."""

import httpx
import numpy as np
import pytest

from app.errors import EngineError
from app.hybrid.time_grid import TimeConfig
from app.hybrid.weather import (
    PVGISTMYWeatherProvider,
    WeatherDataset,
    WeatherMetadata,
    shift_utc_to_local,
)
from app.providers.base import ResourceError, ResourceErrorKind


def _build_pvgis_tmy_payload(peak_utc_hour: int = 5) -> dict:
    """Membuat respons PVGIS TMY sintetis 8760 jam dengan puncak matahari di jam UTC tertentu."""
    rows = []
    for i in range(8760):
        hour_utc = i % 24
        ghi = 900.0 if hour_utc == peak_utc_hour else (100.0 if abs(hour_utc - peak_utc_hour) <= 3 else 0.0)
        rows.append(
            {
                "time(UTC)": f"20090101:{hour_utc:02d}00",
                "T2m": 28.0 if hour_utc == peak_utc_hour else 24.0,
                "RH": 75.0,
                "G(h)": ghi,
                "Gb(n)": ghi * 0.7,
                "Gd(h)": ghi * 0.3,
                "IR(h)": 380.0,
                "WS10m": 2.5,
                "WD10m": 180.0,
                "SP": 101000.0,
            }
        )
    return {
        "inputs": {
            "location": {"latitude": -6.2, "longitude": 106.8, "elevation": 16.0},
            "meteo_data": {"radiation_db": "PVGIS-ERA5"},
        },
        "outputs": {
            "months_selected": [{"month": 1, "year": 2005}, {"month": 12, "year": 2023}],
            "tmy_hourly": rows,
        },
    }


def _mock_client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


class TestPVGISTMYWeatherProvider:
    def test_parses_8760_rows_and_shifts_utc_to_local_jakarta(self):
        captured_urls: list[httpx.URL] = []
        payload = _build_pvgis_tmy_payload(peak_utc_hour=5)

        def handler(request: httpx.Request) -> httpx.Response:
            captured_urls.append(request.url)
            return httpx.Response(200, json=payload)

        provider = PVGISTMYWeatherProvider(client=_mock_client(handler))
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        ds = provider.get_weather(-6.2, 106.8, tc)

        assert isinstance(ds, WeatherDataset)
        assert len(ds.ghi_w_m2) == 8760
        assert ds.metadata.provider == "pvgis_tmy"
        assert ds.metadata.dataset == "PVGIS-ERA5"
        assert ds.metadata.dataset_version == "v5_3"
        assert ds.metadata.period == "2005-2023 TMY"
        assert ds.metadata.elevation_m == 16.0
        assert ds.metadata.timezone == "Asia/Jakarta"
        assert ds.metadata.timezone_offset_hours == 7.0

        # Puncak 05:00 UTC harus bergeser ke 12:00 WIB (indeks 12).
        assert ds.ghi_w_m2[12] == pytest.approx(900.0)
        assert ds.ghi_w_m2[5] == pytest.approx(0.0)
        assert ds.temp_air_c[12] == pytest.approx(28.0)

        assert len(captured_urls) == 1
        assert captured_urls[0].params["lat"] == "-6.2"
        assert captured_urls[0].params["lon"] == "106.8"
        assert captured_urls[0].params["outputformat"] == "json"

    def test_in_memory_cache_avoids_duplicate_http_calls(self):
        calls = 0
        payload = _build_pvgis_tmy_payload()

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(200, json=payload)

        provider = PVGISTMYWeatherProvider(cache_ttl_seconds=60.0, client=_mock_client(handler))
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        ds1 = provider.get_weather(-6.2, 106.8, tc)
        ds2 = provider.get_weather(-6.2, 106.8, tc)

        assert calls == 1
        assert np.array_equal(ds1.ghi_w_m2, ds2.ghi_w_m2)

    def test_rejects_non_60_minute_step(self):
        provider = PVGISTMYWeatherProvider()
        tc = TimeConfig(step_minutes=30, timezone="Asia/Jakarta")
        with pytest.raises(EngineError) as exc_info:
            provider.get_weather(-6.2, 106.8, tc)
        assert exc_info.value.code == "unsupported_step_minutes"

    def test_over_the_sea_maps_to_out_of_coverage(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                400,
                json={"message": "Location over the sea. Please, select another location", "status": 400},
            )

        provider = PVGISTMYWeatherProvider(max_retries=0, client=_mock_client(handler))
        with pytest.raises(ResourceError) as exc_info:
            provider.get_weather(85.0, 0.0, TimeConfig())
        assert exc_info.value.kind == ResourceErrorKind.OUT_OF_COVERAGE

    def test_timeout_retries_then_raises_timeout(self):
        calls = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            raise httpx.ReadTimeout("timeout", request=request)

        provider = PVGISTMYWeatherProvider(max_retries=2, client=_mock_client(handler))
        with pytest.raises(ResourceError) as exc_info:
            provider.get_weather(-6.2, 106.8, TimeConfig())
        assert calls == 3
        assert exc_info.value.kind == ResourceErrorKind.TIMEOUT

    def test_529_overloaded_retries_then_succeeds_or_fails_unavailable(self):
        calls = 0
        payload = _build_pvgis_tmy_payload()

        def handler_recover(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            if calls == 1:
                return httpx.Response(529, json={"message": "Site is overloaded"})
            return httpx.Response(200, json=payload)

        provider = PVGISTMYWeatherProvider(max_retries=1, client=_mock_client(handler_recover))
        ds = provider.get_weather(-6.2, 106.8, TimeConfig())
        assert calls == 2
        assert len(ds.ghi_w_m2) == 8760

        def handler_down(request: httpx.Request) -> httpx.Response:
            return httpx.Response(529, json={"message": "Site is overloaded"})

        provider2 = PVGISTMYWeatherProvider(max_retries=1, client=_mock_client(handler_down))
        with pytest.raises(ResourceError) as exc_info:
            provider2.get_weather(-6.2, 106.8, TimeConfig())
        assert exc_info.value.kind == ResourceErrorKind.UNAVAILABLE

    def test_corrupt_json_or_wrong_row_count_maps_to_invalid_response(self):
        def handler_bad_json(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=b"{bad")

        p1 = PVGISTMYWeatherProvider(client=_mock_client(handler_bad_json))
        with pytest.raises(ResourceError) as e1:
            p1.get_weather(-6.2, 106.8, TimeConfig())
        assert e1.value.kind == ResourceErrorKind.INVALID_RESPONSE

        short_payload = _build_pvgis_tmy_payload()
        short_payload["outputs"]["tmy_hourly"] = short_payload["outputs"]["tmy_hourly"][:100]

        def handler_short(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=short_payload)

        p2 = PVGISTMYWeatherProvider(client=_mock_client(handler_short))
        with pytest.raises(ResourceError) as e2:
            p2.get_weather(-6.2, 106.8, TimeConfig())
        assert e2.value.kind == ResourceErrorKind.INVALID_RESPONSE


class TestWeatherValidationAndShift:
    def test_shift_utc_to_local_cyclic(self):
        arr = np.arange(24, dtype=np.float64)
        shifted = shift_utc_to_local(arr, offset_hours=7.0, step_minutes=60)
        assert shifted[12] == pytest.approx(5.0)
        assert shifted[0] == pytest.approx(17.0)

    def test_rejects_negative_irradiance_in_dataset(self):
        tc = TimeConfig()
        n = tc.steps_per_year
        meta = WeatherMetadata("test", None, None, None, -6.2, 106.8, None, "Asia/Jakarta", 7.0, "now")
        bad_ghi = np.zeros(n)
        bad_ghi[10] = -1.0
        with pytest.raises(EngineError) as exc_info:
            WeatherDataset(bad_ghi, np.zeros(n), np.zeros(n), np.full(n, 25.0), np.ones(n), tc, meta)
        assert exc_info.value.code == "negative_weather_value"
