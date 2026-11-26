"""Model PV detail 8 tahap berbasis NumPy murni setara kedalaman SAM."""

from dataclasses import dataclass
import math
from typing import Any, Literal

import numpy as np

from app.errors import EngineError
from app.hybrid.components import (
    ComponentStepResult,
    EnergyComponent,
    LifecycleEvent,
    PVHourlyOutput,
)
from app.hybrid.weather import WeatherDataset

# Konstanta fisika dan astronomi standar.
_SOLAR_CONSTANT_W_M2 = 1366.1
_BOLTZMANN_EV_PER_K = 8.617333262145179e-5
_EG_REF_EV = 1.121
_DEG_DT_PER_K = -0.0002677
_T_REF_K = 298.15
_IRRAD_REF_W_M2 = 1000.0

# Koefisien Perez 1990 (allsitescomposite1990) untuk 8 kelas epsilon.
_PEREZ_EPSILON_BINS = (0.0, 1.065, 1.23, 1.5, 1.95, 2.8, 4.5, 6.2)
_PEREZ_F1_COEFFS = np.array(
    [
        [-0.0080, 0.5880, -0.0620],
        [0.1300, 0.6830, -0.1510],
        [0.3300, 0.4870, -0.2210],
        [0.5680, 0.1870, -0.2950],
        [0.8730, -0.3920, -0.3620],
        [1.1320, -1.2370, -0.4120],
        [1.0600, -1.6000, -0.3590],
        [0.6780, -0.3270, -0.2500],
    ],
    dtype=np.float64,
)
_PEREZ_F2_COEFFS = np.array(
    [
        [-0.0600, 0.0720, -0.0220],
        [-0.0190, 0.0660, -0.0290],
        [0.0550, -0.0640, -0.0260],
        [0.1090, -0.1520, -0.0140],
        [0.2260, -0.4620, 0.0010],
        [0.2880, -0.8230, 0.0560],
        [0.2640, -1.1270, 0.1310],
        [0.1560, -1.3770, 0.2510],
    ],
    dtype=np.float64,
)


def solar_position_spencer(weather: WeatherDataset) -> dict[str, np.ndarray]:
    """Menghitung posisi matahari, radiasi ekstraterestrial, dan massa udara.

    Konvensi azimuth:
    - sun_az_pvgis_deg: 0 = Selatan, +90 = Barat, -90 = Timur, +-180 = Utara.
    - sun_az_compass_deg: 0 = Utara, 90 = Timur, 180 = Selatan, 270 = Barat.
    """
    tc = weather.time_config
    doy = tc.day_indices().astype(np.float64) + 1.0
    hours = tc.hour_of_day()

    # Persamaan Spencer (1971) untuk deklinasi, EoT, dan jarak Bumi-Matahari.
    b = 2.0 * math.pi * (doy - 1.0) / 365.0
    eot_min = 229.18 * (
        0.000075
        + 0.001868 * np.cos(b)
        - 0.032077 * np.sin(b)
        - 0.014615 * np.cos(2.0 * b)
        - 0.04089 * np.sin(2.0 * b)
    )
    decl_rad = (
        0.006918
        - 0.399912 * np.cos(b)
        + 0.070257 * np.sin(b)
        - 0.006758 * np.cos(2.0 * b)
        + 0.000907 * np.sin(2.0 * b)
        - 0.002697 * np.cos(3.0 * b)
        + 0.00148 * np.sin(3.0 * b)
    )
    dni_extra_w_m2 = _SOLAR_CONSTANT_W_M2 * (
        1.00011
        + 0.034221 * np.cos(b)
        + 0.00128 * np.sin(b)
        + 0.000719 * np.cos(2.0 * b)
        + 0.000077 * np.sin(2.0 * b)
    )

    std_meridian_deg = 15.0 * tc.utc_offset_hours
    time_offset_min = eot_min + 4.0 * (weather.metadata.longitude - std_meridian_deg)
    solar_time_hours = hours + time_offset_min / 60.0
    hour_angle_rad = np.deg2rad(15.0 * (solar_time_hours - 12.0))

    lat_rad = math.radians(weather.metadata.latitude)
    cos_z = np.sin(lat_rad) * np.sin(decl_rad) + np.cos(lat_rad) * np.cos(decl_rad) * np.cos(hour_angle_rad)
    cos_z = np.clip(cos_z, -1.0, 1.0)
    zenith_deg = np.rad2deg(np.arccos(cos_z))
    sin_z = np.sqrt(np.maximum(1.0 - cos_z**2, 0.0))

    with np.errstate(divide="ignore", invalid="ignore"):
        if abs(math.cos(lat_rad)) > 1e-9:
            cos_az_sun = np.where(
                sin_z > 1e-9,
                (math.sin(lat_rad) * cos_z - np.sin(decl_rad)) / (math.cos(lat_rad) * sin_z),
                0.0,
            )
        else:
            cos_az_sun = np.zeros_like(cos_z)
    cos_az_sun = np.clip(cos_az_sun, -1.0, 1.0)
    sun_az_pvgis_rad = np.where(hour_angle_rad >= 0.0, np.arccos(cos_az_sun), -np.arccos(cos_az_sun))
    if abs(math.cos(lat_rad)) <= 1e-9:
        sun_az_pvgis_rad = np.zeros_like(cos_z)
    sun_az_pvgis_deg = np.rad2deg(sun_az_pvgis_rad)
    sun_az_compass_deg = (180.0 + sun_az_pvgis_deg) % 360.0

    # Massa udara relatif Kasten dan Young (1989) pada permukaan laut.
    above_horizon = zenith_deg <= 90.0
    z_safe = np.where(above_horizon, zenith_deg, 0.0)
    denom = np.cos(np.deg2rad(z_safe)) + 0.50572 * np.power(np.maximum(6.07995 + (90.0 - z_safe), 1e-9), -1.6364)
    airmass_relative = np.where(above_horizon, 1.0 / denom, np.nan)

    elev = weather.metadata.elevation_m if weather.metadata.elevation_m is not None else 0.0
    elev_clamped = max(min(float(elev), 10000.0), -500.0)
    pressure_ratio = (1.0 - 2.25577e-5 * elev_clamped) ** 5.25588
    airmass_absolute = airmass_relative * pressure_ratio

    return {
        "doy": doy,
        "decl_rad": decl_rad,
        "eot_min": eot_min,
        "hour_angle_rad": hour_angle_rad,
        "cos_z": cos_z,
        "zenith_deg": zenith_deg,
        "sun_az_pvgis_deg": sun_az_pvgis_deg,
        "sun_az_compass_deg": sun_az_compass_deg,
        "dni_extra_w_m2": dni_extra_w_m2,
        "airmass_relative": airmass_relative,
        "airmass_absolute": airmass_absolute,
    }


def erbs_decompose(
    ghi_w_m2: np.ndarray,
    zenith_deg: np.ndarray,
    dni_extra_w_m2: np.ndarray,
    min_cos_zenith: float = 0.065,
    max_zenith: float = 87.0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Mendekomposisi GHI menjadi DNI dan DHI menggunakan model Erbs (1982)."""
    cos_z = np.cos(np.deg2rad(zenith_deg))
    ghi_horiz_extra = dni_extra_w_m2 * np.maximum(cos_z, min_cos_zenith)
    with np.errstate(divide="ignore", invalid="ignore"):
        kt = np.where(ghi_horiz_extra > 0.0, ghi_w_m2 / ghi_horiz_extra, 0.0)
    kt = np.clip(kt, 0.0, 1.0)

    df = 1.0 - 0.09 * kt
    mid_mask = (kt > 0.22) & (kt <= 0.8)
    df = np.where(
        mid_mask,
        0.9511 - 0.1604 * kt + 4.388 * (kt**2) - 16.638 * (kt**3) + 12.336 * (kt**4),
        df,
    )
    df = np.where(kt > 0.8, 0.165, df)

    dhi = df * ghi_w_m2
    with np.errstate(divide="ignore", invalid="ignore"):
        dni = np.where(cos_z > 0.0, (ghi_w_m2 - dhi) / cos_z, 0.0)

    bad_values = (zenith_deg > max_zenith) | (ghi_w_m2 <= 0.0) | (dni < 0.0)
    dni = np.where(bad_values, 0.0, dni)
    dhi = np.where(bad_values, np.maximum(ghi_w_m2, 0.0), dhi)
    return dni, dhi, kt


def compute_tracking_angles(
    zenith_deg: np.ndarray,
    sun_az_compass_deg: np.ndarray,
    tracking_mode: Literal["fixed", "single_axis", "two_axis"],
    tilt_degrees: float = 10.0,
    azimuth_pvgis_degrees: float = 0.0,
    max_angle_deg: float = 60.0,
    backtracking: bool = True,
    gcr: float = 0.35,
) -> dict[str, np.ndarray]:
    """Menghitung orientasi panel dinamis dan cos(AOI) untuk fixed, 1-sumbu, dan 2-sumbu."""
    z_rad = np.deg2rad(zenith_deg)
    az_sun_rad = np.deg2rad(sun_az_compass_deg)
    cos_z = np.cos(z_rad)
    sin_z = np.sin(z_rad)
    n = len(zenith_deg)

    if tracking_mode == "fixed":
        surface_tilt_deg = np.full(n, float(tilt_degrees), dtype=np.float64)
        surf_az_compass = (180.0 + float(azimuth_pvgis_degrees)) % 360.0
        surface_azimuth_compass_deg = np.full(n, surf_az_compass, dtype=np.float64)
        tracker_theta_deg = np.zeros(n, dtype=np.float64)
    elif tracking_mode == "single_axis":
        # Sumbu horizontal utara-selatan: rotasi ke Timur negatif, ke Barat positif.
        x_east = sin_z * np.sin(az_sun_rad)
        z_up = cos_z
        omega_ideal = np.arctan2(-x_east, z_up)

        if backtracking:
            temp = np.abs(np.cos(omega_ideal) / gcr)
            with np.errstate(invalid="ignore"):
                omega_corr = np.where(
                    temp < 1.0,
                    -np.sign(omega_ideal) * np.arccos(np.clip(temp, -1.0, 1.0)),
                    0.0,
                )
            theta_rad = omega_ideal + omega_corr
        else:
            theta_rad = omega_ideal

        theta_deg = np.clip(np.rad2deg(theta_rad), -float(max_angle_deg), float(max_angle_deg))
        sun_below = zenith_deg >= 90.0
        tracker_theta_deg = np.where(sun_below, 0.0, theta_deg)
        surface_tilt_deg = np.abs(tracker_theta_deg)
        surface_azimuth_compass_deg = np.where(tracker_theta_deg > 0.0, 270.0, 90.0)
    elif tracking_mode == "two_axis":
        sun_below = zenith_deg >= 90.0
        surface_tilt_deg = np.where(sun_below, 0.0, zenith_deg)
        surface_azimuth_compass_deg = np.where(sun_below, 180.0, sun_az_compass_deg)
        tracker_theta_deg = np.zeros(n, dtype=np.float64)
    else:
        raise EngineError("invalid_pv_config", f"tracking_mode tidak dikenal: {tracking_mode}.")

    tilt_rad = np.deg2rad(surface_tilt_deg)
    surf_az_rad = np.deg2rad(surface_azimuth_compass_deg)
    cos_aoi = cos_z * np.cos(tilt_rad) + sin_z * np.sin(tilt_rad) * np.cos(az_sun_rad - surf_az_rad)
    cos_aoi = np.clip(cos_aoi, -1.0, 1.0)
    aoi_deg = np.rad2deg(np.arccos(cos_aoi))

    return {
        "tracker_theta_deg": tracker_theta_deg,
        "surface_tilt_deg": surface_tilt_deg,
        "surface_azimuth_compass_deg": surface_azimuth_compass_deg,
        "cos_aoi": cos_aoi,
        "aoi_deg": aoi_deg,
    }


def transpose_poa(
    transposition_model: Literal["isotropic", "hay_davies", "perez"],
    ghi_w_m2: np.ndarray,
    dni_w_m2: np.ndarray,
    dhi_w_m2: np.ndarray,
    dni_extra_w_m2: np.ndarray,
    zenith_deg: np.ndarray,
    surface_tilt_deg: np.ndarray,
    cos_aoi: np.ndarray,
    airmass_relative: np.ndarray,
    albedo: float = 0.2,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Mentransposisikan irradiansi horizontal ke bidang panel (beam, sky, ground)."""
    z_rad = np.deg2rad(zenith_deg)
    cos_z = np.cos(z_rad)
    tilt_rad = np.deg2rad(surface_tilt_deg)
    cos_tilt = np.cos(tilt_rad)
    sin_tilt = np.sin(tilt_rad)

    sun_up_beam = (zenith_deg < 87.5) & (cos_aoi > 0.0)
    daytime = (ghi_w_m2 > 0.0) | (dni_w_m2 > 0.0) | (dhi_w_m2 > 0.0)

    poa_beam = np.where(sun_up_beam, dni_w_m2 * np.maximum(cos_aoi, 0.0), 0.0)
    vf_sky = 0.5 * (1.0 + cos_tilt)
    vf_ground = 0.5 * (1.0 - cos_tilt)
    poa_ground = np.where(daytime, ghi_w_m2 * albedo * vf_ground, 0.0)

    if transposition_model == "isotropic":
        poa_sky = np.where(daytime, dhi_w_m2 * vf_sky, 0.0)
    elif transposition_model == "hay_davies":
        ai = np.where(dni_extra_w_m2 > 0.0, dni_w_m2 / dni_extra_w_m2, 0.0)
        rb = np.maximum(cos_aoi, 0.0) / np.maximum(cos_z, 0.01745)
        poa_sky = np.where(daytime, dhi_w_m2 * (ai * rb + (1.0 - ai) * vf_sky), 0.0)
        poa_sky = np.maximum(poa_sky, 0.0)
    elif transposition_model == "perez":
        kappa = 1.041
        z_cubed = z_rad**3
        with np.errstate(divide="ignore", invalid="ignore"):
            delta = dhi_w_m2 * airmass_relative / dni_extra_w_m2
            eps = (np.divide(dhi_w_m2 + dni_w_m2, dhi_w_m2) + kappa * z_cubed) / (1.0 + kappa * z_cubed)

        ebin = np.digitize(eps, _PEREZ_EPSILON_BINS) - 1
        invalid_eps = np.isnan(eps) | (ebin < 0) | (ebin > 7)
        ebin_safe = np.where(invalid_eps, 0, ebin)

        f1_c = _PEREZ_F1_COEFFS[ebin_safe]
        f2_c = _PEREZ_F2_COEFFS[ebin_safe]

        f1 = np.maximum(f1_c[:, 0] + f1_c[:, 1] * delta + f1_c[:, 2] * z_rad, 0.0)
        f2 = f2_c[:, 0] + f2_c[:, 1] * delta + f2_c[:, 2] * z_rad

        a_term = np.maximum(cos_aoi, 0.0)
        b_term = np.maximum(cos_z, math.cos(math.radians(85.0)))

        term1 = 0.5 * (1.0 - f1) * (1.0 + cos_tilt)
        term2 = f1 * a_term / b_term
        term3 = f2 * sin_tilt

        poa_sky_raw = np.maximum(dhi_w_m2 * (term1 + term2 + term3), 0.0)
        valid_sky = (~invalid_eps) & (~np.isnan(airmass_relative)) & (dhi_w_m2 > 0.0) & (zenith_deg <= 90.0)
        poa_sky = np.where(valid_sky, poa_sky_raw, 0.0)
    else:
        raise EngineError("invalid_pv_config", f"transposition_model tidak dikenal: {transposition_model}.")

    poa_global = np.maximum(poa_beam + poa_sky + poa_ground, 0.0)
    return poa_global, poa_beam, poa_sky, poa_ground


def ashrae_iam(cos_aoi: np.ndarray, zenith_deg: np.ndarray, iam_b0: float = 0.05) -> np.ndarray:
    """Menghitung faktor pengali sudut datang ASHRAE untuk irradiansi langsung."""
    active = (zenith_deg < 87.5) & (cos_aoi > 1e-6)
    safe_cos = np.where(active, cos_aoi, 1.0)
    iam = 1.0 - iam_b0 * (1.0 / safe_cos - 1.0)
    return np.where(active, np.clip(iam, 0.0, 1.0), 0.0)


def cell_temperature_faiman(
    poa_w_m2: np.ndarray,
    temp_air_c: np.ndarray,
    wind_speed_m_s: np.ndarray,
    u0: float = 25.0,
    u1: float = 6.84,
) -> np.ndarray:
    """Menghitung suhu sel (C) dengan model termal Faiman (2008)."""
    return temp_air_c + poa_w_m2 / (u0 + u1 * wind_speed_m_s)


def _desoto_residuals(
    x: np.ndarray,
    i_sc: float,
    v_oc: float,
    i_mp: float,
    v_mp: float,
    alpha_sc: float,
    beta_voc: float,
) -> np.ndarray:
    """Lima persamaan De Soto untuk mencari (I_L_ref, I_o_ref, R_s, R_sh_ref, a_ref).

    Vektor x memakai transformasi log untuk I_o dan R_sh:
    x = [I_L, ln(I_o), R_s, ln(R_sh), a].
    """
    i_l = float(x[0])
    i_o = math.exp(float(np.clip(x[1], -80.0, 20.0)))
    r_s = float(x[2])
    r_sh = math.exp(float(np.clip(x[3], -10.0, 30.0)))
    a = max(float(x[4]), 1e-4)

    def expm1_clamped(arg: float) -> float:
        return math.expm1(max(min(arg, 500.0), -500.0))

    def exp_clamped(arg: float) -> float:
        return math.exp(max(min(arg, 500.0), -500.0))

    # 1. Arus hubung singkat pada STC.
    y0 = i_sc - i_l + i_o * expm1_clamped(i_sc * r_s / a) + i_sc * r_s / r_sh

    # 2. Tegangan rangkaian terbuka pada STC.
    y1 = -i_l + i_o * expm1_clamped(v_oc / a) + v_oc / r_sh

    # 3. Titik daya maksimum (I_mp, V_mp).
    arg_mp = (v_mp + i_mp * r_s) / a
    y2 = i_mp - i_l + i_o * expm1_clamped(arg_mp) + (v_mp + i_mp * r_s) / r_sh

    # 4. Turunan daya dP/dV = 0 pada titik daya maksimum.
    exp_mp = exp_clamped(arg_mp)
    num = (i_o / a) * exp_mp + 1.0 / r_sh
    den = 1.0 + (i_o * r_s / a) * exp_mp + r_s / r_sh
    y3 = i_mp - v_mp * (num / den)

    # 5. Tegangan rangkaian terbuka pada T2 = T_ref + 2 K sesuai beta_voc.
    t2 = _T_REF_K + 2.0
    v_oc_2 = v_oc + beta_voc * 2.0
    a2 = a * (t2 / _T_REF_K)
    i_l_2 = i_l + alpha_sc * 2.0
    eg2 = _EG_REF_EV * (1.0 + _DEG_DT_PER_K * 2.0)
    i_o_2 = i_o * ((t2 / _T_REF_K) ** 3) * exp_clamped((1.0 / _BOLTZMANN_EV_PER_K) * (_EG_REF_EV / _T_REF_K - eg2 / t2))
    y4 = -i_l_2 + i_o_2 * expm1_clamped(v_oc_2 / a2) + v_oc_2 / r_sh

    return np.array([y0, y1, y2, y3, y4], dtype=np.float64)


def fit_desoto_parameters(
    i_sc: float,
    v_oc: float,
    i_mp: float,
    v_mp: float,
    alpha_sc: float,
    beta_voc: float,
    cells_in_series: int,
) -> dict[str, float]:
    """Menurunkan 5 parameter referensi model satu-dioda De Soto memakai NumPy murni."""
    a0 = 1.3 * _BOLTZMANN_EV_PER_K * _T_REF_K * float(cells_in_series)
    i_o_0 = max(i_sc * math.exp(-v_oc / a0), 1e-18)
    r_s_0 = max((a0 * math.log1p(max((i_sc - i_mp) / i_o_0, 0.0)) - v_mp) / i_mp, 1e-4)
    r_sh_0 = 200.0

    x = np.array([i_sc, math.log(i_o_0), r_s_0, math.log(r_sh_0), a0], dtype=np.float64)
    scale = max(i_sc, 1.0)

    def eval_scaled(vec: np.ndarray) -> np.ndarray:
        return _desoto_residuals(vec, i_sc, v_oc, i_mp, v_mp, alpha_sc, beta_voc) / scale

    r = eval_scaled(x)
    cost = 0.5 * float(np.dot(r, r))
    damping = 1e-6

    for _ in range(250):
        if float(np.max(np.abs(r))) < 1e-12:
            break

        jac = np.zeros((5, 5), dtype=np.float64)
        for j in range(5):
            eps = 1e-6 * max(abs(x[j]), 1.0)
            x_plus = x.copy()
            x_minus = x.copy()
            x_plus[j] += eps
            x_minus[j] -= eps
            jac[:, j] = (eval_scaled(x_plus) - eval_scaled(x_minus)) / (2.0 * eps)

        jtj = jac.T @ jac
        jtr = jac.T @ r
        diag = np.maximum(np.diag(jtj), 1e-12)

        accepted = False
        for _try in range(20):
            lhs = jtj + damping * np.diag(diag)
            try:
                step = -np.linalg.solve(lhs, jtr)
            except np.linalg.LinAlgError:
                damping *= 10.0
                continue

            # Batasi ukuran langkah agar eksponensial dan R_s tetap stabil.
            max_step = float(np.max(np.abs(step)))
            if max_step > 2.0:
                step = step * (2.0 / max_step)

            x_cand = x + step
            if x_cand[0] <= 0.0 or x_cand[4] <= 1e-4:
                damping *= 10.0
                continue

            r_cand = eval_scaled(x_cand)
            cost_cand = 0.5 * float(np.dot(r_cand, r_cand))
            if cost_cand < cost:
                x = x_cand
                r = r_cand
                cost = cost_cand
                damping = max(damping * 0.3, 1e-12)
                accepted = True
                break
            damping *= 5.0

        if not accepted and float(np.max(np.abs(r))) < 1e-8:
            break

    max_err = float(np.max(np.abs(r))) * scale
    if not math.isfinite(max_err) or max_err > 1e-3 * scale:
        raise EngineError(
            "single_diode_fit_failed",
            f"Solver parameter satu-dioda De Soto tidak konvergen (galat sisa {max_err:.3e}).",
        )

    return {
        "I_L_ref": float(x[0]),
        "I_o_ref": float(math.exp(float(x[1]))),
        "R_s": float(x[2]),
        "R_sh_ref": float(math.exp(float(x[3]))),
        "a_ref": float(x[4]),
    }


def single_diode_mpp_power_w(
    g_eff_w_m2: np.ndarray,
    cell_temp_c: np.ndarray,
    params: dict[str, float],
    alpha_sc: float,
) -> np.ndarray:
    """Menghitung daya MPP per modul (Watt) dengan model De Soto dan metode Bishop vektorisasi."""
    g_eff = np.asarray(g_eff_w_m2, dtype=np.float64)
    t_cell_c = np.asarray(cell_temp_c, dtype=np.float64)
    out = np.zeros_like(g_eff, dtype=np.float64)

    active = g_eff > 1e-6
    if not np.any(active):
        return out

    g_act = g_eff[active]
    t_k = t_cell_c[active] + 273.15
    dt = t_k - _T_REF_K

    i_l_ref = params["I_L_ref"]
    i_o_ref = params["I_o_ref"]
    r_s = params["R_s"]
    r_sh_ref = params["R_sh_ref"]
    a_ref = params["a_ref"]

    e_g = _EG_REF_EV * (1.0 + _DEG_DT_PER_K * dt)
    a = a_ref * (t_k / _T_REF_K)
    i_l = (g_act / _IRRAD_REF_W_M2) * (i_l_ref + alpha_sc * dt)
    i_o = i_o_ref * ((t_k / _T_REF_K) ** 3) * np.exp((_EG_REF_EV / (_BOLTZMANN_EV_PER_K * _T_REF_K)) - (e_g / (_BOLTZMANN_EV_PER_K * t_k)))
    r_sh = r_sh_ref * (_IRRAD_REF_W_M2 / g_act)

    # Hanya hitung bila arus foto positif.
    pos = i_l > 1e-12
    p_act = np.zeros_like(g_act)
    if not np.any(pos):
        out[active] = p_act
        return out

    i_l_p = i_l[pos]
    i_o_p = np.maximum(i_o[pos], 1e-300)
    a_p = a[pos]
    r_sh_p = r_sh[pos]
    g_sh = a_p / r_sh_p

    # Parameterisasi Bishop: u = (V + I * R_s) / a.
    # Cari u_oc di mana I(u) = I_L - I_o*(exp(u) - 1) - (a/R_sh)*u = 0.
    u_lo = np.zeros_like(i_l_p)
    u_hi = np.log1p(i_l_p / i_o_p)
    u_oc = 0.5 * (u_lo + u_hi)
    for _ in range(55):
        exp_u = np.exp(np.minimum(u_oc, 500.0))
        f_val = i_l_p - i_o_p * (exp_u - 1.0) - g_sh * u_oc
        df_val = -i_o_p * exp_u - g_sh
        u_lo = np.where(f_val > 0.0, u_oc, u_lo)
        u_hi = np.where(f_val <= 0.0, u_oc, u_hi)
        newton_u = u_oc - f_val / df_val
        inside = (newton_u > u_lo) & (newton_u < u_hi)
        u_oc = np.where(inside, newton_u, 0.5 * (u_lo + u_hi))

    # Cari u_mp di [0, u_oc] di mana dP/du = V'(u)*I(u) + V(u)*I'(u) = 0.
    lo = np.zeros_like(u_oc)
    hi = u_oc.copy()
    u_mp = 0.8 * u_oc
    for _ in range(60):
        exp_u = np.exp(np.minimum(u_mp, 500.0))
        cur = i_l_p - i_o_p * (exp_u - 1.0) - g_sh * u_mp
        dcur = -i_o_p * exp_u - g_sh
        d2cur = -i_o_p * exp_u
        volt = a_p * u_mp - r_s * cur
        dvolt = a_p - r_s * dcur
        d2volt = -r_s * d2cur

        dp = dvolt * cur + volt * dcur
        d2p = d2volt * cur + 2.0 * dvolt * dcur + volt * d2cur

        lo = np.where(dp > 0.0, u_mp, lo)
        hi = np.where(dp <= 0.0, u_mp, hi)
        newton_u = np.where(np.abs(d2p) > 1e-18, u_mp - dp / d2p, 0.5 * (lo + hi))
        inside = (newton_u > lo) & (newton_u < hi)
        u_mp = np.where(inside, newton_u, 0.5 * (lo + hi))

    exp_mp = np.exp(np.minimum(u_mp, 500.0))
    i_mp_val = i_l_p - i_o_p * (exp_mp - 1.0) - g_sh * u_mp
    v_mp_val = a_p * u_mp - r_s * i_mp_val
    p_pos = np.maximum(v_mp_val * i_mp_val, 0.0)

    p_act[pos] = p_pos
    out[active] = p_act
    return out


@dataclass(frozen=True)
class PVDetailedConfig:
    """Konfigurasi model PV detail 8 tahap untuk simulasi hybrid Tahap 2.

    Nilai default berasal dari asumsi sementara di docs/assumptions.md [REAL DATA].
    """

    capacity_kwp: float
    inverter_ac_kw: float
    decompose_ghi_if_missing: bool = True
    transposition_model: Literal["isotropic", "hay_davies", "perez"] = "perez"
    albedo: float = 0.2
    tracking_mode: Literal["fixed", "single_axis", "two_axis"] = "fixed"
    tilt_degrees: float = 10.0
    azimuth_degrees: float = 0.0  # Konvensi PVGIS: 0 = Selatan, +90 = Barat, -90 = Timur, +-180 = Utara.
    max_angle_deg: float = 60.0
    backtracking: bool = True
    gcr: float = 0.35
    iam_b0: float = 0.05
    soiling_monthly: tuple[float, ...] = (0.02,) * 12
    snow_loss_monthly: tuple[float, ...] = (0.0,) * 12
    cell_temp_model: Literal["noct", "faiman"] = "faiman"
    noct_c: float = 45.0
    faiman_u0: float = 25.0
    faiman_u1: float = 6.84
    dc_model: Literal["pvwatts", "single_diode"] = "pvwatts"
    temp_coeff_per_c: float = -0.004
    # Parameter modul satu-dioda ilustratif [REAL DATA].
    i_sc: float = 13.8
    v_oc: float = 49.5
    i_mp: float = 13.0
    v_mp: float = 41.5
    alpha_sc: float = 0.0069
    beta_voc: float = -0.1386
    cells_in_series: int = 72
    n_modules_series: int | None = None
    n_strings_parallel: int | None = None
    # Rincian rugi sistem Tahap 2 [REAL DATA].
    mismatch_fraction: float = 0.02
    dc_wiring_fraction: float = 0.02
    shading_fraction: float = 0.0
    availability_fraction: float = 0.01
    lid_fraction: float = 0.015
    annual_degradation_fraction: float = 0.005
    simulation_year: int = 1
    # Inverter (Tahap 8).
    inverter_model: Literal["constant", "efficiency_curve"] = "constant"
    inverter_efficiency: float = 0.96
    efficiency_curve_points: tuple[tuple[float, float], ...] | None = None
    night_tare_kw: float = 0.0

    @property
    def effective_dc_capacity_kwp(self) -> float:
        """Kapasitas DC nominal efektif (kWp) berdasarkan jumlah modul jika disetel."""
        if (
            self.dc_model == "single_diode"
            and self.n_modules_series is not None
            and self.n_strings_parallel is not None
        ):
            return float(self.n_modules_series * self.n_strings_parallel) * (self.i_mp * self.v_mp / 1000.0)
        return float(self.capacity_kwp)


def _validate_monthly_fractions(values: tuple[float, ...] | list[float], name: str) -> None:
    if len(values) != 12:
        raise EngineError("invalid_pv_config", f"{name} harus berisi tepat 12 angka bulanan.")
    for val in values:
        if not math.isfinite(val) or not 0.0 <= val < 1.0:
            raise EngineError("invalid_pv_config", f"Setiap nilai {name} harus antara 0 dan kurang dari 1.")


class PVDetailedComponent(EnergyComponent):
    """Komponen PV detail 8 tahap dengan pencatatan rugi waterfall tertutup."""

    def __init__(self, config: PVDetailedConfig):
        self.config = config
        self._cached_weather_id: int | None = None
        self._cached_output: PVHourlyOutput | None = None
        self._cached_desoto_params: dict[str, float] | None = None

    def validate(self) -> None:
        c = self.config
        if not math.isfinite(c.capacity_kwp) or c.capacity_kwp <= 0:
            raise EngineError("invalid_pv_config", "capacity_kwp harus lebih besar dari 0.")
        if not math.isfinite(c.inverter_ac_kw) or c.inverter_ac_kw <= 0:
            raise EngineError("invalid_pv_config", "inverter_ac_kw harus lebih besar dari 0.")
        if c.transposition_model not in ("isotropic", "hay_davies", "perez"):
            raise EngineError("invalid_pv_config", "transposition_model harus isotropic, hay_davies, atau perez.")
        if not math.isfinite(c.albedo) or not 0.0 <= c.albedo <= 1.0:
            raise EngineError("invalid_pv_config", "albedo harus berada antara 0 dan 1.")
        if c.tracking_mode not in ("fixed", "single_axis", "two_axis"):
            raise EngineError("invalid_pv_config", "tracking_mode harus fixed, single_axis, atau two_axis.")
        if not 0.0 <= c.tilt_degrees <= 90.0:
            raise EngineError("invalid_pv_config", "tilt_degrees harus berada antara 0 dan 90.")
        if not -180.0 <= c.azimuth_degrees <= 180.0:
            raise EngineError("invalid_pv_config", "azimuth_degrees harus berada antara -180 dan 180.")
        if not 0.0 < c.max_angle_deg <= 90.0:
            raise EngineError("invalid_pv_config", "max_angle_deg harus berada antara 0 dan 90.")
        if not 0.0 < c.gcr <= 1.0:
            raise EngineError("invalid_pv_config", "gcr harus berada antara 0 dan 1.")
        if not 0.0 <= c.iam_b0 <= 0.5:
            raise EngineError("invalid_pv_config", "iam_b0 harus berada antara 0 dan 0.5.")

        _validate_monthly_fractions(c.soiling_monthly, "soiling_monthly")
        _validate_monthly_fractions(c.snow_loss_monthly, "snow_loss_monthly")

        if c.cell_temp_model not in ("noct", "faiman"):
            raise EngineError("invalid_pv_config", "cell_temp_model harus noct atau faiman.")
        if not 20.0 <= c.noct_c <= 70.0:
            raise EngineError("invalid_pv_config", "noct_c harus berada antara 20 dan 70 C.")
        if not math.isfinite(c.faiman_u0) or c.faiman_u0 <= 0.0:
            raise EngineError("invalid_pv_config", "faiman_u0 harus lebih besar dari 0.")
        if not math.isfinite(c.faiman_u1) or c.faiman_u1 < 0.0:
            raise EngineError("invalid_pv_config", "faiman_u1 tidak boleh negatif.")

        if c.dc_model not in ("pvwatts", "single_diode"):
            raise EngineError("invalid_pv_config", "dc_model harus pvwatts atau single_diode.")
        if not -0.02 <= c.temp_coeff_per_c <= 0.0:
            raise EngineError("invalid_pv_config", "temp_coeff_per_c harus berada antara -0.02 dan 0.")

        if c.dc_model == "single_diode":
            if c.i_sc <= 0 or c.v_oc <= 0 or c.i_mp <= 0 or c.v_mp <= 0:
                raise EngineError("invalid_pv_config", "Parameter datasheet satu-dioda harus positif.")
            if c.i_mp >= c.i_sc or c.v_mp >= c.v_oc:
                raise EngineError("invalid_pv_config", "i_mp harus < i_sc dan v_mp harus < v_oc.")
            if c.cells_in_series <= 0:
                raise EngineError("invalid_pv_config", "cells_in_series harus lebih besar dari 0.")
            if c.beta_voc >= 0.0:
                raise EngineError("invalid_pv_config", "beta_voc harus bernilai negatif (V/K).")
            if (c.n_modules_series is None) != (c.n_strings_parallel is None):
                raise EngineError(
                    "invalid_pv_config",
                    "n_modules_series dan n_strings_parallel harus diisi bersamaan.",
                )
            if c.n_modules_series is not None and (c.n_modules_series <= 0 or c.n_strings_parallel <= 0):
                raise EngineError("invalid_pv_config", "Jumlah modul seri dan string paralel harus positif.")

        for field_name, frac in (
            ("mismatch_fraction", c.mismatch_fraction),
            ("dc_wiring_fraction", c.dc_wiring_fraction),
            ("shading_fraction", c.shading_fraction),
            ("availability_fraction", c.availability_fraction),
            ("lid_fraction", c.lid_fraction),
            ("annual_degradation_fraction", c.annual_degradation_fraction),
        ):
            if not math.isfinite(frac) or not 0.0 <= frac < 1.0:
                raise EngineError("invalid_pv_config", f"{field_name} harus antara 0 dan kurang dari 1.")

        if c.simulation_year < 1:
            raise EngineError("invalid_pv_config", "simulation_year harus minimal 1.")

        if c.inverter_model not in ("constant", "efficiency_curve"):
            raise EngineError("invalid_pv_config", "inverter_model harus constant atau efficiency_curve.")
        if not 0.0 < c.inverter_efficiency <= 1.0:
            raise EngineError("invalid_pv_config", "inverter_efficiency harus lebih dari 0 hingga 1.")
        if c.inverter_model == "efficiency_curve":
            pts = c.efficiency_curve_points
            if not pts or len(pts) < 2:
                raise EngineError(
                    "invalid_pv_config",
                    "efficiency_curve_points wajib memiliki minimal 2 titik (load_fraction, efficiency).",
                )
            prev_x = -1.0
            for x_pt, y_pt in pts:
                if not (0.0 <= x_pt <= 1.5) or not (0.0 < y_pt <= 1.0):
                    raise EngineError("invalid_pv_config", "Titik kurva efisiensi inverter di luar rentang wajar.")
                if x_pt <= prev_x:
                    raise EngineError("invalid_pv_config", "Titik load_fraction pada kurva efisiensi harus naik.")
                prev_x = x_pt
        if not math.isfinite(c.night_tare_kw) or c.night_tare_kw < 0.0:
            raise EngineError("invalid_pv_config", "night_tare_kw tidak boleh negatif.")

    def _get_desoto_params(self) -> dict[str, float]:
        if self._cached_desoto_params is None:
            c = self.config
            self._cached_desoto_params = fit_desoto_parameters(
                i_sc=c.i_sc,
                v_oc=c.v_oc,
                i_mp=c.i_mp,
                v_mp=c.v_mp,
                alpha_sc=c.alpha_sc,
                beta_voc=c.beta_voc,
                cells_in_series=c.cells_in_series,
            )
        return self._cached_desoto_params

    def compute_hourly(self, weather: WeatherDataset) -> PVHourlyOutput:
        """Menghitung rantai PV 8 tahap secara vektorisasi dan mencatat waterfall rugi tertutup."""
        self.validate()
        c = self.config
        tc = weather.time_config
        step_hours = tc.step_hours

        # Tahap 1: Posisi matahari dan dekomposisi Erbs bila DNI/DHI tidak tersedia.
        solar = solar_position_spencer(weather)
        zenith_deg = solar["zenith_deg"]
        dni_extra = solar["dni_extra_w_m2"]
        airmass_rel = solar["airmass_relative"]

        ghi = weather.ghi_w_m2
        dni = weather.dni_w_m2
        dhi = weather.dhi_w_m2
        missing_beam_diff = (np.max(dni) == 0.0 and np.max(dhi) == 0.0 and np.max(ghi) > 0.0)
        if c.decompose_ghi_if_missing and missing_beam_diff:
            dni, dhi, _ = erbs_decompose(ghi, zenith_deg, dni_extra)

        # Tahap 2 & 3: Geometri tracking dan transposisi POA.
        tracking = compute_tracking_angles(
            zenith_deg=zenith_deg,
            sun_az_compass_deg=solar["sun_az_compass_deg"],
            tracking_mode=c.tracking_mode,
            tilt_degrees=c.tilt_degrees,
            azimuth_pvgis_degrees=c.azimuth_degrees,
            max_angle_deg=c.max_angle_deg,
            backtracking=c.backtracking,
            gcr=c.gcr,
        )
        poa_global, poa_beam, poa_sky, poa_ground = transpose_poa(
            transposition_model=c.transposition_model,
            ghi_w_m2=ghi,
            dni_w_m2=dni,
            dhi_w_m2=dhi,
            dni_extra_w_m2=dni_extra,
            zenith_deg=zenith_deg,
            surface_tilt_deg=tracking["surface_tilt_deg"],
            cos_aoi=tracking["cos_aoi"],
            airmass_relative=airmass_rel,
            albedo=c.albedo,
        )

        dc_cap_kwp = c.effective_dc_capacity_kwp
        dc_nominal_kw = dc_cap_kwp * (poa_global / 1000.0)

        # Tahap 4: IAM, soiling bulanan, dan salju bulanan.
        iam_factor = ashrae_iam(tracking["cos_aoi"], zenith_deg, c.iam_b0)
        poa_after_iam = poa_beam * iam_factor + poa_sky + poa_ground
        iam_loss_kw = dc_cap_kwp * ((poa_global - poa_after_iam) / 1000.0)

        month_zero = tc.month_indices() - 1
        soiling_arr = np.array(c.soiling_monthly, dtype=np.float64)[month_zero]
        snow_arr = np.array(c.snow_loss_monthly, dtype=np.float64)[month_zero]

        poa_after_soiling = poa_after_iam * (1.0 - soiling_arr)
        soiling_loss_kw = dc_cap_kwp * ((poa_after_iam - poa_after_soiling) / 1000.0)

        poa_effective = poa_after_soiling * (1.0 - snow_arr)
        snow_loss_kw = dc_cap_kwp * ((poa_after_soiling - poa_effective) / 1000.0)
        dc_after_optical_kw = dc_cap_kwp * (poa_effective / 1000.0)

        # Tahap 5: Suhu sel (NOCT atau Faiman).
        if c.cell_temp_model == "noct":
            cell_temp_c = weather.temp_air_c + ((c.noct_c - 20.0) / 800.0) * poa_global
        else:
            cell_temp_c = cell_temperature_faiman(
                poa_w_m2=poa_global,
                temp_air_c=weather.temp_air_c,
                wind_speed_m_s=weather.wind_speed_m_s,
                u0=c.faiman_u0,
                u1=c.faiman_u1,
            )

        # Tahap 6: Daya DC modul (PVWatts atau satu-dioda De Soto).
        if c.dc_model == "pvwatts":
            module_irradiance_loss_kw = np.zeros_like(dc_after_optical_kw)
            temp_factor = np.maximum(1.0 + c.temp_coeff_per_c * (cell_temp_c - 25.0), 0.0)
            dc_after_temp_kw = dc_after_optical_kw * temp_factor
            temperature_loss_kw = dc_after_optical_kw - dc_after_temp_kw
        else:
            desoto_params = self._get_desoto_params()
            mod_stc_kw = (c.i_mp * c.v_mp) / 1000.0
            scale_factor = dc_cap_kwp / mod_stc_kw

            p_mod_stc_temp_w = single_diode_mpp_power_w(
                poa_effective,
                np.full_like(poa_effective, 25.0),
                desoto_params,
                c.alpha_sc,
            )
            p_mod_actual_w = single_diode_mpp_power_w(
                poa_effective,
                cell_temp_c,
                desoto_params,
                c.alpha_sc,
            )
            dc_at_25c_kw = (p_mod_stc_temp_w / 1000.0) * scale_factor
            dc_after_temp_kw = (p_mod_actual_w / 1000.0) * scale_factor
            module_irradiance_loss_kw = dc_after_optical_kw - dc_at_25c_kw
            temperature_loss_kw = dc_at_25c_kw - dc_after_temp_kw

        # Tahap 7: Rugi sistem terurai dan degradasi tahunan mulai tahun ke-2.
        d1 = dc_after_temp_kw * (1.0 - c.lid_fraction)
        lid_loss_kw = dc_after_temp_kw - d1

        d2 = d1 * (1.0 - c.shading_fraction)
        shading_loss_kw = d1 - d2

        d3 = d2 * (1.0 - c.mismatch_fraction)
        mismatch_loss_kw = d2 - d3

        d4 = d3 * (1.0 - c.dc_wiring_fraction)
        dc_wiring_loss_kw = d3 - d4

        d5 = d4 * (1.0 - c.availability_fraction)
        availability_loss_kw = d4 - d5

        deg_factor = (1.0 - c.annual_degradation_fraction) ** max(c.simulation_year - 1, 0)
        dc_after_system_loss_kw = d5 * deg_factor
        degradation_loss_kw = d5 - dc_after_system_loss_kw

        # Tahap 8: Inverter (efisiensi konstan atau kurva beban parsial, clipping, dan tare malam).
        if c.inverter_model == "constant":
            eff_arr = np.full_like(dc_after_system_loss_kw, c.inverter_efficiency)
        else:
            assert c.efficiency_curve_points is not None
            xs = np.array([p[0] for p in c.efficiency_curve_points], dtype=np.float64)
            ys = np.array([p[1] for p in c.efficiency_curve_points], dtype=np.float64)
            max_eff = float(np.max(ys))
            p_dc_nom = c.inverter_ac_kw / max_eff
            load_frac = np.clip(dc_after_system_loss_kw / p_dc_nom, 0.0, xs[-1])
            eff_arr = np.interp(load_frac, xs, ys)

        ac_before_clip_kw = np.where(dc_after_system_loss_kw > 0.0, dc_after_system_loss_kw * eff_arr, 0.0)
        inverter_loss_kw = dc_after_system_loss_kw - ac_before_clip_kw

        ac_gross_kw = np.minimum(ac_before_clip_kw, c.inverter_ac_kw)
        clipping_loss_kw = ac_before_clip_kw - ac_gross_kw

        night_tare_arr = np.where(ac_gross_kw <= 0.0, c.night_tare_kw, 0.0)
        ac_gross_kwh = float(np.sum(ac_gross_kw) * step_hours)
        night_tare_kwh = float(np.sum(night_tare_arr) * step_hours)
        ac_net_kwh = ac_gross_kwh - night_tare_kwh

        loss_breakdown_kwh = {
            "dc_nominal_kwh": float(np.sum(dc_nominal_kw) * step_hours),
            "iam_loss_kwh": float(np.sum(iam_loss_kw) * step_hours),
            "soiling_loss_kwh": float(np.sum(soiling_loss_kw) * step_hours),
            "snow_loss_kwh": float(np.sum(snow_loss_kw) * step_hours),
            "module_irradiance_loss_kwh": float(np.sum(module_irradiance_loss_kw) * step_hours),
            "temperature_loss_kwh": float(np.sum(temperature_loss_kw) * step_hours),
            "lid_loss_kwh": float(np.sum(lid_loss_kw) * step_hours),
            "shading_loss_kwh": float(np.sum(shading_loss_kw) * step_hours),
            "mismatch_loss_kwh": float(np.sum(mismatch_loss_kw) * step_hours),
            "dc_wiring_loss_kwh": float(np.sum(dc_wiring_loss_kw) * step_hours),
            "availability_loss_kwh": float(np.sum(availability_loss_kw) * step_hours),
            "degradation_loss_kwh": float(np.sum(degradation_loss_kw) * step_hours),
            "inverter_loss_kwh": float(np.sum(inverter_loss_kw) * step_hours),
            "clipping_loss_kwh": float(np.sum(clipping_loss_kw) * step_hours),
            "night_tare_kwh": night_tare_kwh,
            "ac_gross_kwh": ac_gross_kwh,
            "ac_net_kwh": ac_net_kwh,
        }

        output = PVHourlyOutput(
            poa_w_m2=poa_global,
            cell_temp_c=cell_temp_c,
            dc_nominal_kw=dc_nominal_kw,
            dc_after_temp_kw=dc_after_temp_kw,
            dc_after_system_loss_kw=dc_after_system_loss_kw,
            ac_before_clip_kw=ac_before_clip_kw,
            ac_net_kw=ac_gross_kw,
            loss_breakdown_kwh=loss_breakdown_kwh,
            night_tare_kw=night_tare_arr,
            poa_beam_w_m2=poa_beam,
            poa_sky_w_m2=poa_sky,
            poa_ground_w_m2=poa_ground,
        )
        self._cached_weather_id = id(weather)
        self._cached_output = output
        return output

    def prepare(self, weather: WeatherDataset) -> PVHourlyOutput:
        """Memastikan deret vektor potensi PV sudah dihitung dan di-cache."""
        if self._cached_weather_id == id(weather) and self._cached_output is not None:
            return self._cached_output
        return self.compute_hourly(weather)

    def set_precomputed_output(self, weather: WeatherDataset, output: PVHourlyOutput) -> PVHourlyOutput:
        """Menyematkan hasil PVHourlyOutput yang sudah dihitung sebelumnya untuk cuaca yang sama."""
        self.validate()
        self._cached_weather_id = id(weather)
        self._cached_output = output
        return output

    def available_power_kw(
        self,
        step_idx: int,
        weather: WeatherDataset,
        state: dict[str, Any],
    ) -> float:
        _ = state
        output = self.prepare(weather)
        return float(output.ac_net_kw[step_idx])

    def night_tare_power_kw(self, step_idx: int, weather: WeatherDataset) -> float:
        """Mengembalikan konsumsi daya malam inverter (kW) pada langkah waktu ini."""
        output = self.prepare(weather)
        if output.night_tare_kw is None:
            return 0.0
        return float(output.night_tare_kw[step_idx])

    def step(
        self,
        step_idx: int,
        command_kw: float,
        weather: WeatherDataset,
        state: dict[str, Any],
    ) -> ComponentStepResult:
        _ = state
        output = self.prepare(weather)
        available = float(output.ac_net_kw[step_idx])
        target = min(max(float(command_kw), 0.0), available)
        return ComponentStepResult(
            available_kw=available,
            generation_kw=available,
            charge_kw=0.0,
            discharge_kw=0.0,
            losses_kw=0.0,
            state_out={"dispatched_kw": target},
        )

    def lifecycle_events(self, year: int) -> list[LifecycleEvent]:
        _ = year
        return []
