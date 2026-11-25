def test_warning_codes():
    from fastapi.testclient import TestClient
    from app.main import app
    client = TestClient(app)

    payload = {
        "project": {"project_name": "Test", "technology": "solar_pv", "project_type": "ground_mounted", "country_code": "ID", "capacity_kwp": 1000, "lifetime_years": 20, "currency_code": "IDR"},
        "technical": {"energy_method": "manual_specific_yield", "specific_yield_kwh_per_kwp_year": 3000, "yield_boundary": "gross_pre_loss", "performance_loss_fraction": 0.4, "degradation_fraction_per_year": 0.03},
        "financial": {"capex_amount": 1000000, "annual_opex_amount": 10000, "revenue_method": "fixed_tariff", "tariff_per_kwh": 1000, "discount_rate_fraction": 0.1, "tax_model": "pre_tax"}
    }
    response = client.post("/v1/pv/preliminary", json=payload)
    assert response.status_code == 200
    data = response.json()
    
    assert "high_specific_yield" in data["warning_codes"]
    assert "high_degradation" in data["warning_codes"]
    assert "high_performance_loss" in data["warning_codes"]
    assert len(data["warnings"]) == 3
