"""Queue/contract tests use an explicit fake renderer, not MP4 acceptance proof."""
import asyncio
import copy
import hashlib
import json

import pytest
from pydantic import ValidationError

from zhijian.store import Conflict, Invalid, Missing
from zhijian.videos import VideoRequest, VideoRunner, VideoStore, write_json


@pytest.fixture
def source():
    question = {"id": "question-one", "revision": 4, "state": "confirmed", "missingFields": [],
                "parts": [{"id": "main"}], "notes": "private note", "image": "private image"}
    part = {"partId": "main", "label": "主问题", "goal": "比较两行", "known": ["三角形数"],
            "prerequisites": ["计数"], "method": "移去相同部分", "verification": "23+24=47", "summary": "只数新增行",
            "steps": [{"id": "step-one", "title": "找新增行", "explanation": "共有部分消去", "reason": "相减",
                       "formulaLatex": "23+24=47", "notes": "private step note"}],
            "answer": {"kind": "numbers", "value": 47, "display": "47", "apiKey": "private key"},
            "misconceptions": [{"mistake": "24−22", "correction": "层数不是石子数"}],
            "scene": {"kind": "triangle-count", "params": {"lower": 22, "upper": 24, "previewRows": 6, "private": "private"}},
            "notes": "private part note", "sceneState": {"rows": 8}}
    lesson = {"questionId": question["id"], "questionRevision": 4, "lessonVersion": 3, "status": "ready",
              "coveredPartIds": ["main"], "parts": [part], "notes": "private lesson note",
              "checks": {"inputConfirmed": True, "coverage": True, "answerVerified": True, "reasoningReviewed": True}}
    return question, lesson


@pytest.fixture
def store(tmp_path):
    result = VideoStore(tmp_path)
    result.initialize()
    return result


def request(**changes):
    return VideoRequest(**{"expectedRevision": 4, "lessonVersion": 3, "partId": "main", **changes})


def test_snapshot_is_immutable_versioned_and_excludes_private_fields(store, source):
    question, lesson = source
    video = store.create(question, lesson, request())
    lesson["parts"][0]["goal"] = "changed after queuing"
    snapshot = json.loads((store.directory(video["id"]) / "snapshot.json").read_text())
    assert snapshot["inputProps"]["part"]["goal"] == "比较两行"
    assert snapshot["questionRevision"] == 4 and snapshot["lessonVersion"] == 3
    raw = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    assert hashlib.sha256(raw.encode()).hexdigest() == video["snapshotHash"]
    assert "private" not in raw and "sceneState" not in raw
    assert video["state"] == "queued" and video["progress"] == 0 and "url" not in video
    assert video["hasAudio"] is False


@pytest.mark.parametrize("change,error", [
    ({"expectedRevision": 3}, Conflict), ({"lessonVersion": 2}, Conflict), ({"partId": "unknown"}, Invalid)])
def test_stale_versions_and_missing_parts_are_blocked(store, source, change, error):
    with pytest.raises(error):
        store.create(*source, request(**change))
    assert store.next_queued() is None


@pytest.mark.parametrize("defect", ["missing-definition", "unconfirmed", "draft", "missing-coverage", "duplicate-part", "no-steps", "unchecked"])
def test_only_current_complete_approved_parts_export(store, source, defect):
    question, lesson = copy.deepcopy(source)
    if defect == "missing-definition":
        question["missingFields"] = ["定义缺失"]
    elif defect == "unconfirmed":
        question["state"] = "needs_completion"
    elif defect == "draft":
        lesson["status"] = "needs_review"
    elif defect == "missing-coverage":
        lesson["coveredPartIds"] = []
    elif defect == "duplicate-part":
        lesson["parts"] *= 2
    elif defect == "no-steps":
        lesson["parts"][0]["steps"] = []
    else:
        lesson["checks"]["reasoningReviewed"] = False
    with pytest.raises(Invalid):
        store.create(question, lesson, request())


def test_numberline_export_preserves_target_and_parameter_conditions(store, source):
    question, lesson = source
    params = {"left": 3, "right": 3, "parameterName": "a", "parameterValue": -3, "targetMinimum": 2}
    lesson["parts"][0]["scene"] = {"kind": "number-line", "params": params}
    video = store.create(question, lesson, request())
    snapshot = json.loads((store.directory(video["id"]) / "snapshot.json").read_text())
    assert snapshot["inputProps"]["part"]["scene"]["params"] == params


@pytest.mark.parametrize("pace", [True, 0, 3, 1.5, "1"])
def test_export_request_requires_supported_integer_pace(pace):
    with pytest.raises(ValidationError):
        request(pace=pace)


def test_uuid_paths_and_directory_symlinks_cannot_escape(store, tmp_path, source):
    for bad in ("../secret", "/tmp/secret", "123", "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"):
        with pytest.raises(Missing):
            store.get(bad)
    video = store.create(*source, request())
    folder = store.directory(video["id"])
    hidden = tmp_path / "elsewhere"
    folder.rename(hidden)
    folder.symlink_to(hidden, target_is_directory=True)
    with pytest.raises(Missing):
        store.get(video["id"])


def test_interrupted_and_lost_exports_recover_without_false_ready(store, source):
    active = store.create(*source, request())
    finished = store.create(*source, request())
    queued = store.create(*source, request(pace=2))
    store.update(active["id"], state="rendering")
    store.update(finished["id"], state="ready")
    store.initialize()
    assert store.get(active["id"])["state"] == "failed"
    assert "中断" in store.get(active["id"])["error"]
    assert store.get(finished["id"])["state"] == "failed"
    assert store.get(queued["id"])["state"] == "queued"


def test_only_real_renderer_progress_is_exposed_and_files_require_ready(store, source):
    video = store.create(*source, request())
    store.update(video["id"], state="rendering")
    folder = store.directory(video["id"])
    write_json(folder / "progress.json", {"stage": "rendering", "progress": 42.9, "secret": "never exposed"})
    read = store.get(video["id"])
    assert read["progress"] == 42 and read["stage"] == "rendering" and "secret" not in read
    (folder / "lesson.mp4").write_bytes(b"explicit fake engineering fixture")
    with pytest.raises(Missing):
        store.file(video["id"])
    store.update(video["id"], state="ready", progress=100)
    assert store.get(video["id"])["url"] == f"/api/videos/{video['id']}/file"
    assert store.file(video["id"]).name == "lesson.mp4"


@pytest.mark.asyncio
async def test_runner_is_serial_and_failure_does_not_block_next_export(store, source, monkeypatch, tmp_path):
    videos = [store.create(*source, request()) for _ in range(3)]
    runner = VideoRunner(store, tmp_path)
    active, maximum, calls = 0, 0, 0

    async def fake_render(video_id):
        nonlocal active, maximum, calls
        active += 1
        maximum = max(maximum, active)
        calls += 1
        await asyncio.sleep(0.01)
        active -= 1
        if calls == 1:
            write_json(store.directory(video_id) / "progress.json", {"stage": "composition", "progress": 10})
            raise RuntimeError("private-secret-must-not-leak")
        (store.directory(video_id) / "lesson.mp4").write_bytes(b"fake engineering fixture, not a rendered MP4")
        return {"durationSeconds": 40, "fps": 30, "frameCount": 1200, "width": 1280, "height": 720}

    monkeypatch.setattr(runner, "_render", fake_render)
    runner.start()
    runner.start()
    try:
        for _ in range(100):
            if store.get(videos[-1]["id"])["state"] == "ready":
                break
            await asyncio.sleep(0.01)
        assert maximum == 1 and calls == 3
        assert store.get(videos[0]["id"])["state"] == "failed"
        assert store.get(videos[0]["id"])["stage"] == "composition"
        assert "private-secret" not in store.get(videos[0]["id"])["error"]
        assert store.get(videos[1]["id"])["state"] == "ready"
        assert store.get(videos[2]["id"])["durationSeconds"] == 40
    finally:
        await runner.stop()


@pytest.mark.asyncio
async def test_stopping_runner_marks_active_failed(store, source, monkeypatch, tmp_path):
    video = store.create(*source, request())
    runner = VideoRunner(store, tmp_path)
    started = asyncio.Event()

    async def fake_render(video_id):
        started.set()
        await asyncio.Future()

    monkeypatch.setattr(runner, "_render", fake_render)
    runner.start()
    await asyncio.wait_for(started.wait(), 1)
    await runner.stop()
    assert store.get(video["id"])["state"] == "failed"


@pytest.mark.asyncio
async def test_completed_render_clears_a_previous_interruption_error(store, source, monkeypatch, tmp_path):
    video = store.create(*source, request())
    runner = VideoRunner(store, tmp_path)

    async def fake_render(video_id):
        assert store.get(video_id)["state"] == "rendering"
        # Simulate an external recovery marking interruption while the renderer continues.
        store.update(video_id, state="failed", error="上次导出被中断")
        await asyncio.sleep(0)
        (store.directory(video_id) / "lesson.mp4").write_bytes(b"explicit fake engineering fixture, not MP4 acceptance")
        return {"durationSeconds": 40, "fps": 30, "frameCount": 1200, "width": 1280, "height": 720}

    monkeypatch.setattr(runner, "_render", fake_render)
    runner.start()
    try:
        for _ in range(100):
            if store.get(video["id"])["state"] == "ready":
                break
            await asyncio.sleep(0.01)
        finished = store.get(video["id"])
        assert finished["state"] == "ready" and finished["progress"] == 100
        assert finished["error"] is None
    finally:
        await runner.stop()


@pytest.fixture
def video_client(source, monkeypatch, tmp_path):
    """HTTP contracts with isolated teaching fixtures; no AI or real rendering."""
    import importlib
    from fastapi.testclient import TestClient
    from zhijian.config import Settings

    application = importlib.import_module("zhijian.app")
    question, lesson = copy.deepcopy(source)

    class TeachingFixtures:
        def initialize(self):
            pass

        def question(self, question_id):
            if question_id != question["id"]:
                raise Missing("题目不存在")
            return copy.deepcopy(question)

        def lesson(self, question_id):
            self.question(question_id)
            return copy.deepcopy(lesson)

    settings = Settings(database_url="unused-fixture", ai_base_url="https://api.deepseek.com", model="fixture",
                        vision_model="fixture", review_model="fixture", api_key="", data_dir=tmp_path)
    monkeypatch.setattr(application.Settings, "from_environment", classmethod(lambda cls: settings))
    monkeypatch.setattr(application, "Store", lambda url: TeachingFixtures())
    with TestClient(application.create_app(start_worker=False)) as client:
        yield client, question, lesson


def export_request(**changes):
    return {"expectedRevision": 4, "lessonVersion": 3, "partId": "main", "pace": 1, **changes}


def test_video_http_creates_versioned_queue_and_never_claims_file_ready(video_client):
    client, question, _ = video_client
    response = client.post(f"/api/questions/{question['id']}/videos", json=export_request())
    assert response.status_code == 200
    video = response.json()["video"]
    assert video["state"] == "queued" and video["progress"] == 0 and "url" not in video
    assert video["questionRevision"] == 4 and video["lessonVersion"] == 3
    assert client.get(f"/api/videos/{video['id']}").json()["video"] == video
    assert client.get(f"/api/videos/{video['id']}/file").status_code == 404
    assert client.app.state.video_runner.task is None


@pytest.mark.parametrize("change,status", [({"expectedRevision": 3}, 409), ({"lessonVersion": 2}, 409),
                                          ({"partId": "missing-leaf"}, 422), ({"pace": 3}, 422),
                                          ({"outputPath": "/tmp/private"}, 422)])
def test_video_http_rejects_old_versions_unknown_leaf_and_arbitrary_output(video_client, change, status):
    client, question, _ = video_client
    response = client.post(f"/api/questions/{question['id']}/videos", json=export_request(**change))
    assert response.status_code == status
    assert client.app.state.video_store.next_queued() is None


@pytest.mark.parametrize("defect", ["missing-definition", "draft-lesson", "missing-coverage", "unchecked"])
def test_video_http_blocks_unapproved_content(video_client, defect):
    client, question, lesson = video_client
    if defect == "missing-definition":
        question["missingFields"] = ["缺失定义"]
        question["state"] = "needs_completion"
    elif defect == "draft-lesson":
        lesson["status"] = "needs_review"
    elif defect == "missing-coverage":
        lesson["coveredPartIds"] = []
    else:
        lesson["checks"]["reasoningReviewed"] = False
    response = client.post(f"/api/questions/{question['id']}/videos", json=export_request())
    assert response.status_code == 422
    assert client.app.state.video_store.next_queued() is None


def test_ready_video_http_file_is_private_and_retains_original_version(video_client):
    client, question, lesson = video_client
    video = client.post(f"/api/questions/{question['id']}/videos", json=export_request()).json()["video"]
    video_store = client.app.state.video_store
    (video_store.directory(video["id"]) / "lesson.mp4").write_bytes(b"explicit fake fixture, not MP4 acceptance")
    video_store.update(video["id"], state="ready", progress=100)
    question["revision"] = 5
    lesson["lessonVersion"] = 4
    result = client.get(f"/api/videos/{video['id']}").json()["video"]
    assert result["questionRevision"] == 4 and result["lessonVersion"] == 3
    response = client.get(result["url"])
    assert response.status_code == 200 and response.content.startswith(b"explicit fake")
    assert response.headers["content-type"] == "video/mp4"
    assert response.headers["cache-control"] == "private, no-store"
    assert "lesson-r4-v3.mp4" in response.headers["content-disposition"]
    assert client.get("/api/videos/not-a-uuid").status_code == 404
    assert client.get("/api/videos/not-a-uuid/file").status_code == 404
    assert client.post("/api/questions/unknown/videos", json=export_request()).status_code == 404
