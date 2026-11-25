import json
from unittest.mock import patch

import pytest
from httpx import MockTransport, Response

from app.providers.base import ResourceError, ResourceErrorKind
from app.providers.nasa import NASAProvider


# Rekaman respons JSON asli dari NASA POWER untuk Jakarta (disederhanakan)
MOCK_NASA_RESPONSE = {
    "properties": {
        "parameter": {
            "ALLSKY_SFC_SW_DWN": {
                "20230101": 5.2,
                "20230102": 5.5,
                "20230103": 5.1,
                # ... (di produksi, ada 365 nilai)
            }
        }
    }
}


def test_nasa_provider_success():
    with patch("app.providers.nasa.httpx.Client") as mock_client:
        mock_client.return_value.__enter__.return_value.get.return_value = Response(
            200, json=MOCK_NASA_RESPONSE
        )
        provider = NASAProvider()
        result = provider.get_resource(-6.2, 106.8, 10, 180)

        # Rata-rata GHI = (5.2 + 5.5 + 5.1) / 3 = 5.2667 kWh/m2/day
        # Specific yield = 5.2667 * 365 * 0.75 = 1441.75 kWh/kWp/tahun
        assert 1400 < result.specific_yield_kwh_per_kwp_year < 1450
        assert result.yield_boundary == "net_ac_at_delivery"
        assert result.provider_name == "nasa"


def test_nasa_provider_invalid_response():
    with patch("app.providers.nasa.httpx.Client") as mock_client:
        mock_client.return_value.__enter__.return_value.get.return_value = Response(
            200, json={"error": "not found"}
        )
        provider = NASAProvider()
        with pytest.raises(ResourceError) as exc_info:
            provider.get_resource(-6.2, 106.8, 10, 180)
        assert exc_info.value.kind == ResourceErrorKind.INVALID_RESPONSE
