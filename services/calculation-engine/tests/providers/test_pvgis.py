"""Tes unit untuk PVGISProvider menggunakan respons tiruan dan rekaman JSON asli."""

import json

import httpx
import pytest

from app.providers.base import ResourceError, ResourceErrorKind, ResourceResult
from app.providers.pvgis import PVGISProvider

# Rekaman JSON asli dari API PVGIS v5.3 untuk Jakarta (-6.2, 106.8), diambil 2026-11-25.
JAKARTA_PVGIS_RESPONSE = {
    "inputs": {
        "location": {"latitude": -6.2, "longitude": 106.8, "elevation": 16.0},
        "meteo_data": {
            "radiation_db": "PVGIS-ERA5",
            "meteo_db": "ERA5",
            "year_min": 2005,
            "year_max": 2023,
            "use_horizon": True,
            "horizon_db": "DEM-calculated",
        },
        "mounting_system": {
            "fixed": {
                "slope": {"value": 10, "optimal": False},
                "azimuth": {"value": 0, "optimal": False},
                "type": "free-standing",
            }
        },
        "pv_module": {"technology": "c-Si", "peak_power": 1.0, "system_loss": 14.0},
    },
    "outputs": {
        "totals": {
            "fixed": {
                "E_d": 3.9,
                "E_m": 118.74,
                "E_y": 1424.93,
                "H(i)_d": 5.19,
                "H(i)_m": 157.81,
                "H(i)_y": 1893.78,
                "SD_m": 4.3,
                "SD_y": 51.58,
                "l_aoi": -2.89,
                "l_spec": "1.07",
                "l_tg": -10.86,
                "l_total": -24.76,
            }
        }
    },
}


def _mock_client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


class TestPVGISProviderSuccess:
    def test_parses_jakarta_response_and_metadata(self):
        captured_urls: list[httpx.URL] = []

        def handler(request: httpx.Request) -> httpx.Response:
            captured_urls.append(request.url)
            return httpx.Response(200, json=JAKARTA_PVGIS_RESPONSE)

        provider = PVGISProvider(client=_mock_client(handler))
        result = provider.get_resource(
            latitude=-6.2,
            longitude=106.8,
            tilt_degrees=10.0,
            azimuth_degrees=0.0,
        )

        assert isinstance(result, ResourceResult)
        assert result.specific_yield_kwh_per_kwp_year == pytest.approx(1424.93)
        assert result.yield_boundary == "net_ac_at_delivery"
        assert result.provider_name == "pvgis"
        assert result.dataset == "PVGIS-ERA5"
        assert result.dataset_version == "v5_3"
        assert result.period == "2005-2023"
        assert "T" in result.retrieval_timestamp

        assert len(captured_urls) == 1
        params = captured_urls[0].params
        assert params["lat"] == "-6.2"
        assert params["lon"] == "106.8"
        assert params["peakpower"] == "1"
        assert params["loss"] == "14.0"
        assert params["angle"] == "10.0"
        assert params["aspect"] == "0.0"
        assert params["outputformat"] == "json"

    def test_in_memory_cache_avoids_duplicate_requests(self):
        calls = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(200, json=JAKARTA_PVGIS_RESPONSE)

        provider = PVGISProvider(cache_ttl_seconds=60.0, client=_mock_client(handler))
        r1 = provider.get_resource(-6.2, 106.8, 10.0, 0.0)
        r2 = provider.get_resource(-6.2, 106.8, 10.0, 0.0)

        assert calls == 1
        assert r1 == r2


class TestPVGISProviderErrors:
    def test_over_the_sea_maps_to_out_of_coverage(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                400,
                json={"message": "Location over the sea. Please, select another location", "status": 400},
            )

        provider = PVGISProvider(max_retries=0, client=_mock_client(handler))
        with pytest.raises(ResourceError) as exc_info:
            provider.get_resource(85.0, 0.0, 10.0, 0.0)

        assert exc_info.value.kind == ResourceErrorKind.OUT_OF_COVERAGE

    def test_timeout_maps_to_timeout_after_retries(self):
        calls = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            raise httpx.ReadTimeout("timed out", request=request)

        provider = PVGISProvider(max_retries=2, client=_mock_client(handler))
        with pytest.raises(ResourceError) as exc_info:
            provider.get_resource(-6.2, 106.8, 10.0, 0.0)

        assert calls == 3
        assert exc_info.value.kind == ResourceErrorKind.TIMEOUT

    def test_529_overloaded_retries_then_succeeds(self):
        calls = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            if calls == 1:
                return httpx.Response(529, json={"message": "Site is overloaded"})
            return httpx.Response(200, json=JAKARTA_PVGIS_RESPONSE)

        provider = PVGISProvider(max_retries=1, client=_mock_client(handler))
        result = provider.get_resource(-6.2, 106.8, 10.0, 0.0)

        assert calls == 2
        assert result.specific_yield_kwh_per_kwp_year == pytest.approx(1424.93)

    def test_529_exhausted_maps_to_unavailable(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(529, json={"message": "Site is overloaded"})

        provider = PVGISProvider(max_retries=1, client=_mock_client(handler))
        with pytest.raises(ResourceError) as exc_info:
            provider.get_resource(-6.2, 106.8, 10.0, 0.0)

        assert exc_info.value.kind == ResourceErrorKind.UNAVAILABLE

    def test_network_error_maps_to_unavailable(self):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection refused", request=request)

        provider = PVGISProvider(max_retries=0, client=_mock_client(handler))
        with pytest.raises(ResourceError) as exc_info:
            provider.get_resource(-6.2, 106.8, 10.0, 0.0)

        assert exc_info.value.kind == ResourceErrorKind.UNAVAILABLE

    def test_corrupt_json_maps_to_invalid_response(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=b"{not-valid-json")

        provider = PVGISProvider(client=_mock_client(handler))
        with pytest.raises(ResourceError) as exc_info:
            provider.get_resource(-6.2, 106.8, 10.0, 0.0)

        assert exc_info.value.kind == ResourceErrorKind.INVALID_RESPONSE

    def test_missing_ey_field_maps_to_invalid_response(self):
        broken = json.loads(json.dumps(JAKARTA_PVGIS_RESPONSE))
        del broken["outputs"]["totals"]["fixed"]["E_y"]

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=broken)

        provider = PVGISProvider(client=_mock_client(handler))
        with pytest.raises(ResourceError) as exc_info:
            provider.get_resource(-6.2, 106.8, 10.0, 0.0)

        assert exc_info.value.kind == ResourceErrorKind.INVALID_RESPONSE
