"""Uji banding langsung sub-model PV NumPy murni terhadap pvlib pada Jakarta dan lintang sedang."""

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pvlib
import pytest

from app.hybrid.pv_detailed import (
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
from app.hybrid.weather import WeatherDataset, WeatherMetadata, load_weather_from_json

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _build_local_times(tc: TimeConfig) -> pd.DatetimeIndex:
    # Bangun indeks waktu lokal tahun non-kabisat 2023 di titik tengah tiap langkah.
    base = pd.date_range("2023-01-01 00:30:00", periods=tc.steps_per_year, freq=f"{tc.step_minutes}min")
    offset_minutes = int(round(tc.utc_offset_hours * 60))
    sign = "+" if offset_minutes >= 0 else "-"
    hh, mm = divmod(abs(offset_minutes), 60)
    return base.tz_localize(f"UTC{sign}{hh:02d}:{mm:02d}" if offset_minutes != 0 else "UTC")


def _make_midlatitude_weather() -> WeatherDataset:
    tc = TimeConfig(step_minutes=60, timezone="UTC-7")
    lat, lon, elev = 39.74, -105.18, 1829.0  # Golden, Colorado (lintang sedang).
    times = _build_local_times(tc)
    loc = pvlib.location.Location(latitude=lat, longitude=lon, altitude=elev)
    cs = loc.get_clearsky(times, model="ineichen")
    n = tc.steps_per_year
    meta = WeatherMetadata(
        provider="pvlib_clearsky_test",
        dataset="ineichen",
        dataset_version="1.0",
        period="2023",
        latitude=lat,
        longitude=lon,
        elevation_m=elev,
        timezone=tc.timezone,
        timezone_offset_hours=tc.utc_offset_hours,
        retrieved_at="now",
    )
    return WeatherDataset(
        ghi_w_m2=cs["ghi"].to_numpy(dtype=np.float64),
        dni_w_m2=cs["dni"].to_numpy(dtype=np.float64),
        dhi_w_m2=cs["dhi"].to_numpy(dtype=np.float64),
        temp_air_c=np.full(n, 15.0, dtype=np.float64),
        wind_speed_m_s=np.full(n, 3.0, dtype=np.float64),
        time_config=tc,
        metadata=meta,
    )


def _load_jakarta_weather() -> WeatherDataset:
    tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
    return load_weather_from_json(FIXTURES / "golden_jakarta_weather.json", tc)


@pytest.mark.parametrize("site_name", ["jakarta", "golden_co"])
class TestPVBenchmarkAgainstPvlib:
    def _get_weather(self, site_name: str) -> WeatherDataset:
        if site_name == "jakarta":
            return _load_jakarta_weather()
        return _make_midlatitude_weather()

    def test_solar_position_tracks_pvlib_spa_closely(self, site_name):
        weather = self._get_weather(site_name)
        times = _build_local_times(weather.time_config)
        sol_rx = solar_position_spencer(weather)
        spa = pvlib.solarposition.get_solarposition(
            times,
            weather.metadata.latitude,
            weather.metadata.longitude,
            altitude=weather.metadata.elevation_m or 0.0,
        )

        day_mask = spa["zenith"].to_numpy() < 85.0
        mae_zenith = float(np.mean(np.abs(sol_rx["zenith_deg"][day_mask] - spa["zenith"].to_numpy()[day_mask])))
        assert mae_zenith < 0.35  # Spencer 1971 berada dalam 0.35 derajat terhadap NREL SPA.

    def test_erbs_decomposition_matches_pvlib(self, site_name):
        weather = self._get_weather(site_name)
        sol_rx = solar_position_spencer(weather)
        dni_rx, dhi_rx, _ = erbs_decompose(weather.ghi_w_m2, sol_rx["zenith_deg"], sol_rx["dni_extra_w_m2"])
        erbs_pv = pvlib.irradiance.erbs(weather.ghi_w_m2, sol_rx["zenith_deg"], sol_rx["doy"])

        assert float(np.max(np.abs(dni_rx - erbs_pv["dni"]))) < 1e-6
        assert float(np.max(np.abs(dhi_rx - erbs_pv["dhi"]))) < 1e-6

    def test_transposition_isotropic_haydavies_and_perez_match_pvlib(self, site_name):
        weather = self._get_weather(site_name)
        sol_rx = solar_position_spencer(weather)
        tilt = 10.0 if site_name == "jakarta" else 35.0
        az_pvgis = 0.0  # Selatan -> kompas 180.
        az_compass = 180.0
        trk = compute_tracking_angles(
            sol_rx["zenith_deg"],
            sol_rx["sun_az_compass_deg"],
            tracking_mode="fixed",
            tilt_degrees=tilt,
            azimuth_pvgis_degrees=az_pvgis,
        )

        for model_name in ("isotropic", "hay_davies", "perez"):
            poa_rx, _, sky_rx, _ = transpose_poa(
                model_name,  # type: ignore[arg-type]
                weather.ghi_w_m2,
                weather.dni_w_m2,
                weather.dhi_w_m2,
                sol_rx["dni_extra_w_m2"],
                sol_rx["zenith_deg"],
                trk["surface_tilt_deg"],
                trk["cos_aoi"],
                sol_rx["airmass_relative"],
                albedo=0.2,
            )
            if model_name == "isotropic":
                sky_pv = pvlib.irradiance.isotropic(tilt, weather.dhi_w_m2)
            elif model_name == "hay_davies":
                sky_pv = pvlib.irradiance.haydavies(
                    tilt,
                    az_compass,
                    weather.dhi_w_m2,
                    weather.dni_w_m2,
                    sol_rx["dni_extra_w_m2"],
                    solar_zenith=sol_rx["zenith_deg"],
                    solar_azimuth=sol_rx["sun_az_compass_deg"],
                )
            else:
                sky_pv = pvlib.irradiance.perez(
                    tilt,
                    az_compass,
                    weather.dhi_w_m2,
                    weather.dni_w_m2,
                    sol_rx["dni_extra_w_m2"],
                    sol_rx["zenith_deg"],
                    sol_rx["sun_az_compass_deg"],
                    sol_rx["airmass_relative"],
                )

            day_mask = (sol_rx["zenith_deg"] < 85.0) & (weather.ghi_w_m2 > 10.0)
            mae_sky = float(np.mean(np.abs(sky_rx[day_mask] - sky_pv[day_mask])))
            rel_sum = abs(float(np.sum(sky_rx)) - float(np.sum(sky_pv))) / float(np.sum(sky_pv))
            assert mae_sky < 1e-4
            assert rel_sum < 1e-5
            assert float(np.sum(poa_rx)) > 0.0

    def test_single_axis_backtracking_and_ashrae_iam_and_faiman_match_pvlib(self, site_name):
        weather = self._get_weather(site_name)
        sol_rx = solar_position_spencer(weather)

        trk_rx = compute_tracking_angles(
            sol_rx["zenith_deg"],
            sol_rx["sun_az_compass_deg"],
            tracking_mode="single_axis",
            max_angle_deg=60.0,
            backtracking=True,
            gcr=0.35,
        )
        trk_pv = pvlib.tracking.singleaxis(
            apparent_zenith=sol_rx["zenith_deg"],
            solar_azimuth=sol_rx["sun_az_compass_deg"],
            axis_tilt=0.0,
            axis_azimuth=180.0,
            max_angle=60.0,
            backtrack=True,
            gcr=0.35,
        )
        day_mask = sol_rx["zenith_deg"] < 87.0
        mae_theta = float(np.mean(np.abs(trk_rx["tracker_theta_deg"][day_mask] - trk_pv["tracker_theta"][day_mask])))
        assert mae_theta < 1e-6

        iam_rx = ashrae_iam(trk_rx["cos_aoi"], sol_rx["zenith_deg"], iam_b0=0.05)
        iam_pv = np.nan_to_num(pvlib.iam.ashrae(trk_pv["aoi"], b=0.05), nan=0.0)
        assert float(np.max(np.abs(iam_rx[day_mask] - iam_pv[day_mask]))) < 1e-6

        t_rx = cell_temperature_faiman(weather.ghi_w_m2, weather.temp_air_c, weather.wind_speed_m_s)
        t_pv = pvlib.temperature.faiman(weather.ghi_w_m2, weather.temp_air_c, weather.wind_speed_m_s)
        assert float(np.max(np.abs(t_rx - t_pv))) < 1e-12

    def test_single_diode_desoto_matches_pvlib_within_tight_tolerance(self, site_name):
        weather = self._get_weather(site_name)
        i_sc, v_oc, i_mp, v_mp = 13.8, 49.5, 13.0, 41.5
        alpha_sc = 0.0005 * i_sc
        beta_voc = -0.0028 * v_oc

        params_rx = fit_desoto_parameters(i_sc, v_oc, i_mp, v_mp, alpha_sc, beta_voc, cells_in_series=72)
        params_pv, _ = pvlib.ivtools.sdm.fit_desoto(
            v_mp=v_mp,
            i_mp=i_mp,
            v_oc=v_oc,
            i_sc=i_sc,
            alpha_sc=alpha_sc,
            beta_voc=beta_voc,
            cells_in_series=72,
            root_kwargs={"method": "lm", "options": {"xtol": 1e-10}},
        )

        g_eff = weather.ghi_w_m2
        t_cell = cell_temperature_faiman(g_eff, weather.temp_air_c, weather.wind_speed_m_s)

        p_rx = single_diode_mpp_power_w(g_eff, t_cell, params_rx, alpha_sc)

        il, io, rs, rsh, a = pvlib.pvsystem.calcparams_desoto(
            g_eff,
            t_cell,
            alpha_sc=params_pv["alpha_sc"],
            a_ref=params_pv["a_ref"],
            I_L_ref=params_pv["I_L_ref"],
            I_o_ref=params_pv["I_o_ref"],
            R_sh_ref=params_pv["R_sh_ref"],
            R_s=params_pv["R_s"],
        )
        sd_pv = pvlib.pvsystem.singlediode(il, io, rs, rsh, a)
        p_pv = np.where(g_eff > 1e-6, np.nan_to_num(sd_pv["p_mp"], nan=0.0), 0.0)

        rel_energy_diff = abs(float(np.sum(p_rx)) - float(np.sum(p_pv))) / float(np.sum(p_pv))
        assert rel_energy_diff < 1e-3  # Di bawah 0.1% selisih energi tahunan terhadap pvlib.
