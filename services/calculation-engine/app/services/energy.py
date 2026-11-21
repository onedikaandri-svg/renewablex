def net_specific_yield(yield_kwh_per_kwp: float, boundary: str, loss_fraction: float) -> float:
    """Apply the performance loss once, and only to a gross yield."""
    if boundary == "gross_pre_loss":
        return yield_kwh_per_kwp * (1 - loss_fraction)
    return yield_kwh_per_kwp


def annual_energy_kwh(capacity_kwp: float, net_yield: float, degradation: float, years: int) -> list[float]:
    """Energy for years 1..years. Degradation starts in year 2."""
    year_1 = capacity_kwp * net_yield
    return [year_1 * (1 - degradation) ** (t - 1) for t in range(1, years + 1)]
