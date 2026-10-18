import pytest
from fastapi.testclient import TestClient

from deadlock.main import create_app


def test_liveness_works_without_dependencies(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://invalid:secret@127.0.0.1:1/missing")
    monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:1/0")
    with TestClient(create_app()) as client:
        response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_reports_unavailable_without_leaking_secrets(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://invalid:secret@127.0.0.1:1/missing")
    monkeypatch.setenv("REDIS_URL", "redis://:secret@127.0.0.1:1/0")
    with TestClient(create_app()) as client:
        response = client.get("/health/ready")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "dependencies_unavailable"
    assert response.json()["error"]["request_id"]
    assert "secret" not in response.text
    assert "127.0.0.1" not in response.text


def test_readiness_with_real_dependencies(live_dependencies):
    with TestClient(create_app()) as client:
        response = client.get("/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize("dependency", ["DATABASE_URL", "REDIS_URL"])
def test_readiness_when_one_dependency_fails(live_dependencies, monkeypatch, dependency):
    url = "postgresql+psycopg://invalid:secret@127.0.0.1:1/missing" if dependency == "DATABASE_URL" else "redis://:secret@127.0.0.1:1/0"
    monkeypatch.setenv(dependency, url)
    with TestClient(create_app()) as client:
        assert client.get("/health/live").status_code == 200
        response = client.get("/health/ready")
    assert response.status_code == 503
    assert "secret" not in response.text
