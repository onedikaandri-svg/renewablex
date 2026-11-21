from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
PREFLIGHT = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"}


def test_allowed_origin_passes_preflight():
    res = client.options("/v1/pv/preliminary", headers={"Origin": "http://localhost:3000", **PREFLIGHT})
    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_unknown_origin_gets_no_cors_header():
    res = client.options("/v1/pv/preliminary", headers={"Origin": "https://evil.example", **PREFLIGHT})
    assert "access-control-allow-origin" not in res.headers
