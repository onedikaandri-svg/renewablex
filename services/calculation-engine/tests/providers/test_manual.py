"""Tes unit untuk ManualProvider."""

import pytest

from app.providers.base import ResourceError, ResourceErrorKind, ResourceResult
from app.providers.manual import ManualProvider


class TestManualProvider:
    """ManualProvider meneruskan nilai pengguna tanpa memanggil layanan luar."""

    def test_returns_user_yield_net(self):
        p = ManualProvider(1470.0, "net_ac_at_delivery")
        r = p.get_resource(latitude=-6.2, longitude=106.8, tilt_degrees=10, azimuth_degrees=180)

        assert r.specific_yield_kwh_per_kwp_year == 1470.0
        assert r.yield_boundary == "net_ac_at_delivery"
        assert r.provider_name == "manual"
        assert r.dataset is None
        assert r.dataset_version is None
        assert r.period is None

    def test_returns_user_yield_gross(self):
        p = ManualProvider(1600.0, "gross_pre_loss")
        r = p.get_resource(latitude=0, longitude=0, tilt_degrees=0, azimuth_degrees=0)

        assert r.specific_yield_kwh_per_kwp_year == 1600.0
        assert r.yield_boundary == "gross_pre_loss"

    def test_ignores_coordinates(self):
        """Koordinat dan sudut tidak mempengaruhi hasil manual."""
        p = ManualProvider(1500.0, "net_ac_at_delivery")
        r1 = p.get_resource(latitude=-6.2, longitude=106.8, tilt_degrees=10, azimuth_degrees=180)
        r2 = p.get_resource(latitude=35.6, longitude=139.7, tilt_degrees=30, azimuth_degrees=0)

        assert r1.specific_yield_kwh_per_kwp_year == r2.specific_yield_kwh_per_kwp_year
        assert r1.yield_boundary == r2.yield_boundary
        assert r1.provider_name == r2.provider_name

    def test_metadata_has_iso_timestamp(self):
        p = ManualProvider(1470.0, "net_ac_at_delivery")
        r = p.get_resource(latitude=0, longitude=0, tilt_degrees=0, azimuth_degrees=0)

        assert isinstance(r.retrieval_timestamp, str)
        # ISO 8601 selalu mengandung "T" sebagai pemisah tanggal dan waktu.
        assert "T" in r.retrieval_timestamp

    def test_result_is_frozen_dataclass(self):
        """ResourceResult tidak bisa diubah setelah dibuat (frozen=True)."""
        p = ManualProvider(1470.0, "net_ac_at_delivery")
        r = p.get_resource(latitude=0, longitude=0, tilt_degrees=0, azimuth_degrees=0)

        assert isinstance(r, ResourceResult)
        with pytest.raises(AttributeError):
            r.specific_yield_kwh_per_kwp_year = 999  # type: ignore[misc]

    def test_result_is_instance_of_resource_result(self):
        p = ManualProvider(1470.0, "net_ac_at_delivery")
        r = p.get_resource(latitude=0, longitude=0, tilt_degrees=0, azimuth_degrees=0)

        assert isinstance(r, ResourceResult)


class TestResourceErrorTypes:
    """ResourceError dan ResourceErrorKind bisa dipakai oleh adapter mana pun."""

    def test_error_carries_kind_and_message(self):
        err = ResourceError(ResourceErrorKind.TIMEOUT, "batas waktu 10 detik terlampaui")

        assert err.kind == ResourceErrorKind.TIMEOUT
        assert "10 detik" in str(err)

    def test_error_is_an_exception(self):
        err = ResourceError(ResourceErrorKind.UNAVAILABLE, "layanan mati")

        assert isinstance(err, Exception)
        with pytest.raises(ResourceError):
            raise err

    def test_all_error_kinds_exist(self):
        expected = {"unavailable", "out_of_coverage", "invalid_response", "timeout"}
        actual = {k.value for k in ResourceErrorKind}

        assert actual == expected
