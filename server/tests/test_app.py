import os
import shutil
from dataclasses import replace
import pytest
from fastapi.testclient import TestClient

from zhijian.config import Settings, load_environment


load_environment()


@pytest.fixture
def client(monkeypatch, tmp_path):
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("isolated TEST_DATABASE_URL unavailable")
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("DEEPSEEK_API_KEY", "")
    settings = Settings.from_environment()
    sample_dir = tmp_path / "sample-images"
    sample_dir.mkdir()
    for index in (1, 2):
        source = settings.data_dir / "sample-images" / f"page-{index}.jpg"
        if source.exists():
            shutil.copy2(source, sample_dir / source.name)
    isolated = replace(settings, data_dir=tmp_path)
    monkeypatch.setattr(Settings, "from_environment", classmethod(lambda cls: isolated))
    from zhijian.app import create_app
    with TestClient(create_app(start_worker=False)) as test_client:
        yield test_client


def test_no_secret_or_mock_appears_in_status(client):
    response = client.get("/api/status")
    assert response.status_code == 200
    assert response.json()["aiConfigured"] is False
    assert response.json()["dbReady"] is True
    assert "api_key" not in response.text.lower() and "password" not in response.text.lower()


def test_missing_key_preserves_originals_without_fake_questions(client):
    before = len(client.get("/api/papers").json()["items"])
    response = client.post("/api/sample-import")
    assert response.status_code == 200
    payload = response.json()
    assert payload["job"]["state"] == "failed"
    assert "DEEPSEEK_API_KEY" in payload["job"]["error"]
    assert len(payload["paper"]["pages"]) == 2
    saved = client.get("/api/papers/" + payload["paper"]["id"]).json()
    assert saved["questions"] == []
    assert len(client.get("/api/papers").json()["items"]) == before + 1
    assert client.get(payload["paper"]["pages"][0]["url"]).status_code == 200
    assert client.post("/api/jobs/" + payload["job"]["id"] + "/retry").status_code == 503


def test_invalid_request_has_safe_string_detail(client):
    response = client.post("/api/events", json={"authorKind": "learner"})
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], str)


def test_patch_source_region_uses_same_revision_and_rejects_bad_geometry(client):
    store = client.app.state.store
    paper = store.create_paper("API来源定位校对", [{"index": 0, "url": "/api/media/test/page-0.jpg", "width": 1200, "height": 900}])
    q = store.save_extracted_questions(paper["id"], [{"number": 1, "stem": "原题", "parts": [{"id": "main", "prompt": "求值"}], "missingFields": []}])[0]
    region = {"pageIndex": 0, "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4}
    response = client.patch("/api/questions/" + q["id"], json={"expectedRevision": 1, "sourceRegions": [region]})
    assert response.status_code == 200
    assert response.json()["question"]["revision"] == 2
    assert response.json()["question"]["sourceRegions"] == [region]
    assert client.patch("/api/questions/" + q["id"], json={"expectedRevision": 1, "sourceRegions": [region]}).status_code == 409
    assert client.patch("/api/questions/" + q["id"], json={"expectedRevision": 2, "sourceRegions": [{**region, "width": 1}]}).status_code == 422
