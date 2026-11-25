import copy
import json
import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.middleware import MAX_BODY_BYTES, request_log
from app.version import ENGINE_VERSION

client = TestClient(app)
SAMPLE = json.loads((Path(__file__).parents[3] / "examples" / "sample-pv-project.json").read_text())
URL = "/v1/pv/preliminary"
ORIGIN = {"Origin": "http://localhost:3000"}


def oversized_body() -> bytes:
    body = copy.deepcopy(SAMPLE)
    body["notes"] = "x" * MAX_BODY_BYTES
    return json.dumps(body).encode()


def test_body_over_the_limit_gets_413_with_a_stable_code():
    res = client.post(URL, content=oversized_body(), headers={"Content-Type": "application/json"})
    assert res.status_code == 413
    item = res.json()["detail"][0]
    assert item["code"] == "request_too_large" and item["loc"] == ["body"]
    assert str(MAX_BODY_BYTES) in item["msg"]


def test_chunked_body_without_content_length_is_limited_too():
    data = oversized_body()
    chunks = (data[i:i + 8192] for i in range(0, len(data), 8192))
    res = client.post(URL, content=chunks, headers={"Content-Type": "application/json"})
    assert res.status_code == 413
    assert res.json()["detail"][0]["code"] == "request_too_large"


def test_413_carries_cors_headers_for_an_allowed_origin():
    res = client.post(URL, content=oversized_body(), headers={"Content-Type": "application/json", **ORIGIN})
    assert res.status_code == 413
    assert res.headers["access-control-allow-origin"] == ORIGIN["Origin"]


def test_a_normal_request_is_not_affected():
    assert client.post(URL, json=SAMPLE).status_code == 200
    assert len(json.dumps(SAMPLE)) < MAX_BODY_BYTES / 10


def test_a_body_just_under_the_limit_is_read_in_full():
    # Notes are capped at 2,000 characters, so a 422 (not 413) proves the body was parsed, not cut.
    body = copy.deepcopy(SAMPLE)
    body["notes"] = "x" * 3000
    res = client.post(URL, json=body)
    assert res.status_code == 422
    assert res.json()["detail"][0]["code"] == "string_too_long"


class Capture(logging.Handler):
    def __init__(self):
        super().__init__()
        self.lines: list[str] = []

    def emit(self, record):
        self.lines.append(record.getMessage())


@pytest.fixture
def captured():
    handler = Capture()
    request_log.addHandler(handler)
    yield handler.lines
    request_log.removeHandler(handler)


def test_log_line_has_only_method_path_status_duration_and_version(captured):
    client.post(URL, json=SAMPLE)
    entry = json.loads(captured[-1])
    assert set(entry) == {"method", "path", "status", "duration_ms", "engine_version"}
    assert entry["method"] == "POST" and entry["path"] == URL and entry["status"] == 200
    assert entry["engine_version"] == ENGINE_VERSION and entry["duration_ms"] >= 0


def test_log_never_contains_the_body_or_the_query(captured):
    body = copy.deepcopy(SAMPLE)
    body["notes"] = "RAHASIA-BISNIS-123"
    body["project"]["project_name"] = "NAMA-PROYEK-RAHASIA"
    client.post(URL + "?token=abc", json=body)
    text = "\n".join(captured)
    assert "RAHASIA" not in text and "abc" not in text and "capex" not in text


def test_rejected_requests_are_logged_with_their_status(captured):
    client.post(URL, content=oversized_body(), headers={"Content-Type": "application/json"})
    bad = copy.deepcopy(SAMPLE)
    bad["project"]["capacity_kwp"] = 0
    client.post(URL, json=bad)
    assert [json.loads(line)["status"] for line in captured[-2:]] == [413, 422]


@pytest.mark.parametrize("path", ["/docs", "/openapi.json"])
def test_interactive_docs_stay_open(path):
    assert client.get(path).status_code == 200
