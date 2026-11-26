"""Tes unit dan fisika untuk model PV detail 8 tahap (PVDetailedComponent)."""

import numpy as np
import pytest

from app.errors import EngineError
from app.hybrid.pv_detailed import (
    PVDetailedComponent,
    PVDetailedConfig,
    ashrae_iam,
    cell_temperature_faiman,
    compute_tracking_angles,
    erbs_decompose,
    fit_desoto_parameters,
    single_diode_mpp_power_w,
    solar_position_spencer,
    transpose_poa,
)
from app.hybrid.time_grid import TimeConfig
from app.hybrid.weather import WeatherDataset, WeatherMetadata


def _make_weather(
    tc: TimeConfig,
    lat: float = -6.2,
    lon: float = 106.8,
    elev: float = 16.0,
    temp_c: float = 29.0,
    wind_ms: float = 2.2,
    zero_dni_dhi: bool = False,
) -> WeatherDataset:
    n = tc.steps_per_year
    hours = tc.hour_of_day()
    daytime = (hours >= 6.0) & (hours <= 18.0)
    angle = np.where(daytime, np.sin(np.pi * (hours - 6.0) / 12.0), 0.0)
    ghi = 900.0 * angle
    dni = np.zeros(n) if zero_dni_dhi else 780.0 * angle
    dhi = np.zeros(n) if zero_dni_dhi else 180.0 * angle
    meta = WeatherMetadata(
        provider="test",
        dataset="clear",
        dataset_version="1.0",
        period="test",
        latitude=lat,
        longitude=lon,
        elevation_m=elev,
        timezone=tc.timezone,
        timezone_offset_hours=tc.utc_offset_hours,
        retrieved_at="now",
    )
    return WeatherDataset(
        ghi_w_m2=ghi,
        dni_w_m2=dni,
        dhi_w_m2=dhi,
        temp_air_c=np.full(n, temp_c),
        wind_speed_m_s=np.full(n, wind_ms),
        time_config=tc,
        metadata=meta,
    )


class TestPVDetailedValidation:
    def test_rejects_invalid_configurations(self):
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        weather = _make_weather(tc)

        bad_cases = [
            PVDetailedConfig(capacity_kwp=0.0, inverter_ac_kw=100.0),
            PVDetailedConfig(capacity_kwp=100.0, inverter_ac_kw=100.0, soiling_monthly=(0.02,) * 11),
            PVDetailedConfig(capacity_kwp=100.0, inverter_ac_kw=100.0, snow_loss_monthly=(1.0,) * 12),
            PVDetailedConfig(capacity_kwp=100.0, inverter_ac_kw=100.0, gcr=1.2),
            PVDetailedConfig(capacity_kwp=100.0, inverter_ac_kw=100.0, dc_model="single_diode", n_modules_series=20),
            PVDetailedConfig(capacity_kwp=100.0, inverter_ac_kw=100.0, inverter_model="efficiency_curve"),
            PVDetailedConfig(capacity_kwp=100.0, inverter_ac_kw=100.0, night_tare_kw=-0.5),
            PVDetailedConfig(capacity_kwp=100.0, inverter_ac_kw=100.0, simulation_year=0),
        ]
        for cfg in bad_cases:
            with pytest.raises(EngineError) as exc_info:
                PVDetailedComponent(cfg).compute_hourly(weather)
            assert exc_info.value.code == "invalid_pv_config"


class TestPVDetailedSubmodels:
    def test_erbs_decomposition_runs_when_dni_and_dhi_missing(self):
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        weather = _make_weather(tc, zero_dni_dhi=True)
        pv = PVDetailedComponent(
            PVDetailedConfig(capacity_kwp=100.0, inverter_ac_kw=90.0, decompose_ghi_if_missing=True)
        )
        out = pv.compute_hourly(weather)
        assert float(np.sum(out.poa_beam_w_m2)) > 0.0
        assert float(np.sum(out.poa_sky_w_m2)) > 0.0
        assert float(np.sum(out.ac_net_kw)) > 0.0

    def test_tracking_modes_and_backtracking_reduce_horizon_shading_angle(self):
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        weather = _make_weather(tc)
        solar = solar_position_spencer(weather)

        no_bt = compute_tracking_angles(
            solar["zenith_deg"],
            solar["sun_az_compass_deg"],
            tracking_mode="single_axis",
            max_angle_deg=60.0,
            backtracking=False,
            gcr=0.4,
        )
        with_bt = compute_tracking_angles(
            solar["zenith_deg"],
            solar["sun_az_compass_deg"],
            tracking_mode="single_axis",
            max_angle_deg=60.0,
            backtracking=True,
            gcr=0.4,
        )
        two_axis = compute_tracking_angles(
            solar["zenith_deg"],
            solar["sun_az_compass_deg"],
            tracking_mode="two_axis",
        )

        # Backtracking membuat sudut tracker saat matahari rendah lebih kecil daripada tanpa backtracking.
        day_mask = solar["zenith_deg"] < 85.0
        assert np.all(np.abs(with_bt["tracker_theta_deg"][day_mask]) <= np.abs(no_bt["tracker_theta_deg"][day_mask]) + 1e-9)
        assert float(np.max(np.abs(with_bt["tracker_theta_deg"]))) <= 60.0 + 1e-9
        # Two-axis selalu mengejar matahari langsung sehingga AOI mendekati 0 di siang hari (batas presisi arccos float64).
        assert float(np.max(two_axis["aoi_deg"][day_mask])) < 1e-4

    def test_all_three_transposition_models_and_faiman_temperature(self):
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        weather = _make_weather(tc)
        solar = solar_position_spencer(weather)
        trk = compute_tracking_angles(solar["zenith_deg"], solar["sun_az_compass_deg"], tracking_mode="fixed")

        poa_iso, _, _, _ = transpose_poa(
            "isotropic",
            weather.ghi_w_m2,
            weather.dni_w_m2,
            weather.dhi_w_m2,
            solar["dni_extra_w_m2"],
            solar["zenith_deg"],
            trk["surface_tilt_deg"],
            trk["cos_aoi"],
            solar["airmass_relative"],
        )
        poa_hd, _, _, _ = transpose_poa(
            "hay_davies",
            weather.ghi_w_m2,
            weather.dni_w_m2,
            weather.dhi_w_m2,
            solar["dni_extra_w_m2"],
            solar["zenith_deg"],
            trk["surface_tilt_deg"],
            trk["cos_aoi"],
            solar["airmass_relative"],
        )
        poa_pz, _, _, _ = transpose_poa(
            "perez",
            weather.ghi_w_m2,
            weather.dni_w_m2,
            weather.dhi_w_m2,
            solar["dni_extra_w_m2"],
            solar["zenith_deg"],
            trk["surface_tilt_deg"],
            trk["cos_aoi"],
            solar["airmass_relative"],
        )
        assert float(np.sum(poa_iso)) > 0.0
        assert float(np.sum(poa_hd)) > 0.0
        assert float(np.sum(poa_pz)) > 0.0

        t_calm = cell_temperature_faiman(poa_pz, weather.temp_air_c, np.full_like(poa_pz, 0.5))
        t_windy = cell_temperature_faiman(poa_pz, weather.temp_air_c, np.full_like(poa_pz, 6.0))
        assert float(np.max(t_windy)) < float(np.max(t_calm))

        iam = ashrae_iam(trk["cos_aoi"], solar["zenith_deg"], iam_b0=0.05)
        assert np.all((iam >= 0.0) & (iam <= 1.0))

    def test_single_diode_matches_datasheet_stc_and_scales_with_array_geometry(self):
        i_sc, v_oc, i_mp, v_mp = 13.8, 49.5, 13.0, 41.5
        alpha_sc = 0.0005 * i_sc
        beta_voc = -0.0028 * v_oc
        params = fit_desoto_parameters(i_sc, v_oc, i_mp, v_mp, alpha_sc, beta_voc, cells_in_series=72)

        p_stc = single_diode_mpp_power_w(np.array([1000.0]), np.array([25.0]), params, alpha_sc)
        assert float(p_stc[0]) == pytest.approx(i_mp * v_mp, rel=1e-4)

        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        weather = _make_weather(tc)
        cfg = PVDetailedConfig(
            capacity_kwp=1.0,  # Diabaikan bila n_modules_series & n_strings_parallel disetel.
            inverter_ac_kw=400.0,
            dc_model="single_diode",
            n_modules_series=20,
            n_strings_parallel=40,
            i_sc=i_sc,
            v_oc=v_oc,
            i_mp=i_mp,
            v_mp=v_mp,
            alpha_sc=alpha_sc,
            beta_voc=beta_voc,
            cells_in_series=72,
        )
        assert cfg.effective_dc_capacity_kwp == pytest.approx(20 * 40 * i_mp * v_mp / 1000.0, rel=1e-9)
        out = PVDetailedComponent(cfg).compute_hourly(weather)
        assert float(np.max(out.ac_net_kw)) > 0.0

    def test_waterfall_closes_with_degradation_efficiency_curve_and_night_tare(self):
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        weather = _make_weather(tc)
        curve = (
            (0.05, 0.90),
            (0.10, 0.94),
            (0.20, 0.965),
            (0.50, 0.975),
            (0.75, 0.972),
            (1.00, 0.965),
        )
        cfg_y1 = PVDetailedConfig(
            capacity_kwp=500.0,
            inverter_ac_kw=350.0,
            dc_model="single_diode",
            inverter_model="efficiency_curve",
            efficiency_curve_points=curve,
            night_tare_kw=0.5,
            annual_degradation_fraction=0.01,
            simulation_year=1,
            snow_loss_monthly=(0.01,) * 12,
            shading_fraction=0.02,
        )
        cfg_y5 = PVDetailedConfig(
            capacity_kwp=500.0,
            inverter_ac_kw=350.0,
            dc_model="single_diode",
            inverter_model="efficiency_curve",
            efficiency_curve_points=curve,
            night_tare_kw=0.5,
            annual_degradation_fraction=0.01,
            simulation_year=5,
            snow_loss_monthly=(0.01,) * 12,
            shading_fraction=0.02,
        )

        out_y1 = PVDetailedComponent(cfg_y1).compute_hourly(weather)
        out_y5 = PVDetailedComponent(cfg_y5).compute_hourly(weather)

        assert out_y1.loss_breakdown_kwh["degradation_loss_kwh"] == pytest.approx(0.0, abs=1e-12)
        assert out_y5.loss_breakdown_kwh["degradation_loss_kwh"] > 0.0
        assert out_y5.loss_breakdown_kwh["ac_gross_kwh"] < out_y1.loss_breakdown_kwh["ac_gross_kwh"]
        assert out_y1.loss_breakdown_kwh["night_tare_kwh"] > 0.0
        assert out_y1.loss_breakdown_kwh["clipping_loss_kwh"] > 0.0

        losses = out_y5.loss_breakdown_kwh
        sum_losses = (
            losses["iam_loss_kwh"]
            + losses["soiling_loss_kwh"]
            + losses["snow_loss_kwh"]
            + losses["module_irradiance_loss_kwh"]
            + losses["temperature_loss_kwh"]
            + losses["lid_loss_kwh"]
            + losses["shading_loss_kwh"]
            + losses["mismatch_loss_kwh"]
            + losses["dc_wiring_loss_kwh"]
            + losses["availability_loss_kwh"]
            + losses["degradation_loss_kwh"]
            + losses["inverter_loss_kwh"]
            + losses["clipping_loss_kwh"]
            + losses["night_tare_kwh"]
        )
        assert losses["dc_nominal_kwh"] - sum_losses == pytest.approx(losses["ac_net_kwh"], rel=1e-9, abs=1e-6)
        assert losses["ac_gross_kwh"] - losses["night_tare_kwh"] == pytest.approx(losses["ac_net_kwh"], rel=1e-9, abs=1e-6)
