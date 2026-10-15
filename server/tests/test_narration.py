"""Speech gates and measured timeline tests; fixture bytes are not real TTS proof."""
import asyncio
import copy
import importlib
import json

import pytest
from pydantic import ValidationError

from zhijian import narration
from zhijian.narration import NarrationRequest, NarrationStore, NarrationUnavailable, audio_frames, spoken_answer
from zhijian.store import Conflict, Invalid, Missing


@pytest.fixture
def source():
    question = {"id": "question-one", "revision": 4, "state": "confirmed", "missingFields": [], "parts": [{"id": "main"}]}
    part = {"partId": "main", "label": "主问题", "goal": "比较两行", "known": ["三角形数"],
            "prerequisites": ["计数"], "method": "移去相同部分", "verification": "23+24=47", "summary": "只数新增行",
            "steps": [{"id": "step-one", "title": "找新增行", "explanation": "共有部分消去", "reason": "相减", "formulaLatex": "23+24=47"}],
            "answer": {"kind": "numbers", "value": 47, "display": "47"},
            "misconceptions": [{"mistake": "24−22", "correction": "层数不是石子数"}],
            "scene": {"kind": "triangle-count", "params": {"lower": 22, "upper": 24, "previewRows": 6}}}
    lesson = {"questionId": question["id"], "questionRevision": 4, "lessonVersion": 3, "status": "ready", "coveredPartIds": ["main"],
              "parts": [part], "checks": {"inputConfirmed": True, "coverage": True, "answerVerified": True, "reasoningReviewed": True}}
    return question, lesson


def request(**changes):
    return NarrationRequest(**{"expectedRevision": 4, "lessonVersion": 3, "partId": "main", **changes})


@pytest.fixture
def speech(tmp_path, monkeypatch):
    # Semantic Q26 script acceptance has its own real-schema tests in test_q26_narration.
    stages = [{"stageIndex": i, "clips": [{"text": f"第{i}段显式测试口述", "visualFrom": 0, "visualTo": i / 10}]} for i in range(7)]
    monkeypatch.setattr(narration, "build_q26_script", lambda part: copy.deepcopy(stages))
    service = NarrationStore(tmp_path)
    service.initialize()
    calls = []

    async def fake_speech(text, path):
        calls.append(text)
        path.write_bytes(("explicit fixture, not MP3: " + text).encode())
        path.chmod(0o600)
        return 31

    monkeypatch.setattr(service, "_synthesize", fake_speech)
    return service, calls


@pytest.mark.asyncio
async def test_measured_clip_frames_drive_whole_lesson_and_private_files(speech, source):
    service, calls = speech
    question, lesson = source
    result = await service.prepare(question, lesson, request())
    assert result["state"] == "ready" and result["fps"] == 30
    assert len(calls) == 7 and len(result["clips"]) == 7
    assert result["stageDurations"] == [31 + 12 + 30] * 7
    assert result["durationInFrames"] == 73 * 7
    assert [clip["from"] for clip in result["clips"]] == [i * 73 for i in range(7)]
    assert all(clip["audioFrames"] == 31 and clip["durationInFrames"] == 43 for clip in result["clips"])
    assert result["clips"][4]["visualTo"] == .4
    assert "cacheKey" not in result
    folder = service.directory(result["id"])
    assert folder.stat().st_mode & 0o777 == 0o700
    assert (folder / "narration.json").stat().st_mode & 0o777 == 0o600
    assert service.clip_path(result["id"], "clip-001").stat().st_mode & 0o777 == 0o600


@pytest.mark.asyncio
async def test_concurrent_same_request_uses_one_measured_current_cache(speech, source):
    service, calls = speech
    question, lesson = source
    first, second = await asyncio.gather(service.prepare(question, lesson, request()), service.prepare(question, lesson, request()))
    assert first == second and len(calls) == 7
    assert service.get_current(question, lesson, request()) == first
    changed = copy.deepcopy(lesson)
    changed["parts"][0]["summary"] = "新的已核验老师说明"
    assert service.get_current(question, changed, request()) is None
    third = await service.prepare(question, changed, request())
    assert third["id"] != first["id"] and third["lessonHash"] != first["lessonHash"]


@pytest.mark.asyncio
@pytest.mark.parametrize("corruption", ["hash", "audio", "missing"])
async def test_corrupted_manifest_hash_or_audio_cannot_be_reused(speech, source, corruption):
    service, calls = speech
    question, lesson = source
    first = await service.prepare(question, lesson, request())
    folder = service.directory(first["id"])
    if corruption == "hash":
        private = json.loads((folder / "narration.json").read_text())
        private["lessonHash"] = "wrong-current-course"
        narration.write_json(folder / "narration.json", private)
    elif corruption == "audio":
        service.file(first["id"], "clip-001").write_bytes(b"corrupt fixture")
    else:
        service.file(first["id"], "clip-001").unlink()
    assert service.get_current(question, lesson, request()) is None
    second = await service.prepare(question, lesson, request())
    assert second["id"] != first["id"] and len(calls) == 14


@pytest.mark.asyncio
@pytest.mark.parametrize("change,error", [({"expectedRevision": 3}, Conflict), ({"lessonVersion": 2}, Conflict), ({"partId": "other"}, Invalid)])
async def test_old_revision_old_lesson_and_wrong_leaf_do_not_synthesize(speech, source, change, error):
    service, calls = speech
    with pytest.raises(error):
        await service.prepare(*source, request(**change))
    assert calls == [] and list(service.root.iterdir()) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("defect", ["missing", "unchecked", "not-ready", "not-confirmed", "not-covered"])
async def test_unapproved_or_missing_content_has_no_audio(speech, source, defect):
    service, calls = speech
    question, lesson = source
    if defect == "missing":
        question["missingFields"] = ["题干缺失"]
    elif defect == "unchecked":
        lesson["checks"]["reasoningReviewed"] = False
    elif defect == "not-ready":
        lesson["status"] = "needs_review"
    elif defect == "not-confirmed":
        question["state"] = "extracted"
    else:
        lesson["coveredPartIds"] = []
    with pytest.raises(Invalid):
        await service.prepare(question, lesson, request())
    assert calls == []


@pytest.mark.asyncio
async def test_real_speech_failure_never_publishes_ready_or_sensitive_error(speech, source, monkeypatch):
    service, _ = speech

    async def failure(text, path):
        raise RuntimeError("Authorization secret /Users/private/secret-network-stack")

    monkeypatch.setattr(service, "_synthesize", failure)
    with pytest.raises(NarrationUnavailable) as caught:
        await service.prepare(*source, request())
    assert "secret" not in str(caught.value) and "/Users" not in str(caught.value)
    manifest = json.loads(next(service.root.glob("*/narration.json")).read_text())
    assert manifest["state"] == "failed" and manifest["clips"] == []
    assert service.get_current(*source, request()) is None
    diagnostics = next(service.root.glob("*/diagnostics.json"))
    assert diagnostics.stat().st_mode & 0o777 == 0o600 and "secret" not in diagnostics.read_text()
    with pytest.raises(Missing):
        service.file(manifest["id"], "clip-001")


@pytest.mark.asyncio
async def test_incomplete_speech_is_failed_when_server_restarts(speech):
    service, _ = speech
    narration_id = narration.uid()
    folder = service.directory(narration_id)
    folder.mkdir()
    narration.write_json(folder / "narration.json", {"id": narration_id, "state": "preparing"})
    service.initialize()
    assert service.get(narration_id)["state"] == "failed"


def checked_ask(**changes):
    return {"id": "ask-one", "questionId": "question-one", "questionRevision": 4, "lessonVersion": 3,
            "partId": "main", "status": "checked", "answer": r"$T_{24}-T_{22}=23+24=47$，不是 $24-22=2$ 个点。", **changes}


@pytest.mark.asyncio
async def test_checked_answer_has_its_own_bound_measured_audio(speech, source):
    service, calls = speech
    answer = checked_ask()
    first = await service.prepare_answer(*source, request(), [answer], answer["id"])
    assert first["askId"] == answer["id"] and len(first["clips"]) == 1
    assert first["clips"][0]["from"] == 0 and first["clips"][0]["stageIndex"] == 0
    assert first["stageDurations"] == [73] and first["durationInFrames"] == 73
    assert "第24个三角形数减第22个三角形数等于23加24等于47" in calls[0]
    assert service.get_current(*source, request()) is None
    changed = {**answer, "answer": "第24个多出二十三和二十四两个新增行。"}
    second = await service.prepare_answer(*source, request(), [changed], answer["id"])
    assert second["id"] != first["id"] and second["answerHash"] != first["answerHash"]


@pytest.mark.asyncio
@pytest.mark.parametrize("change,error", [({"status": "needs_review"}, Invalid), ({"questionId": "other"}, Missing),
                                          ({"lessonVersion": 2}, Conflict), ({"questionRevision": 3}, Conflict), ({"partId": "other"}, Conflict)])
async def test_answer_identity_and_review_gates_cannot_be_bypassed(speech, source, change, error):
    service, calls = speech
    with pytest.raises(error):
        await service.prepare_answer(*source, request(), [checked_ask(**change)], "ask-one")
    assert calls == []


def test_spoken_math_is_explicit_and_unknown_latex_stops_audio():
    assert spoken_answer(r"$T_2=3$，$24-22=2$，$1,3,6,\cdots$") == "第2个三角形数等于3，24减22等于2，1,3,6,，依此类推，"
    assert "24乘25" in spoken_answer(r"$\frac{24\times25}{2}=300$")
    with pytest.raises(Invalid, match="口述符号"):
        spoken_answer(r"$\int_0^1 x dx$")
    with pytest.raises(Invalid):
        spoken_answer("")


@pytest.mark.parametrize("text", [r"\(T_{24}-T_{22}=23+24=47\)", r"\[T_{24}-T_{22}=23+24=47\]",
                                  "\\[T_{24}-T_{22}\n=23+24=47\\]"])
def test_spoken_answer_accepts_paired_inline_and_display_math_delimiters(text):
    assert spoken_answer(text).replace(" ", "") == "第24个三角形数减第22个三角形数等于23加24等于47"


@pytest.mark.parametrize("text", [r"\(\int_0^1 x dx\)", r"\[\unknown{47}\]", r"\(23+24=47", r"23+24=47\]"])
def test_math_delimiters_do_not_hide_unknown_commands_or_unpaired_markup(text):
    with pytest.raises(Invalid, match="口述符号"):
        spoken_answer(text)


@pytest.mark.asyncio
async def test_speech_work_has_at_most_two_concurrent_provider_calls(speech, source, monkeypatch):
    service, _ = speech
    simultaneous = 0
    peak = 0

    async def observed(text, path):
        nonlocal simultaneous, peak
        simultaneous += 1
        peak = max(peak, simultaneous)
        await asyncio.sleep(.005)
        path.write_bytes(b"explicit concurrent fake speech")
        simultaneous -= 1
        return 30

    monkeypatch.setattr(service, "_synthesize", observed)
    result = await service.prepare(*source, request())
    assert result["state"] == "ready" and peak == 2 and simultaneous == 0


@pytest.mark.asyncio
async def test_audio_urls_are_server_owned_even_if_cache_metadata_is_modified(speech, source):
    service, _ = speech
    result = await service.prepare(*source, request())
    path = service.directory(result["id"]) / "narration.json"
    private = json.loads(path.read_text())
    private["clips"][0]["audioUrl"] = "https://external.invalid/audio.mp3"
    narration.write_json(path, private)
    assert service.get_current(*source, request())["clips"][0]["audioUrl"] == result["clips"][0]["audioUrl"]


@pytest.mark.asyncio
@pytest.mark.parametrize("duration,expected", [("1.0001", 31), ("1.0", 30), ("1.1", 33), ("2.345", 71)])
async def test_ffprobe_actual_duration_rounds_up_to_frame(duration, expected, tmp_path, monkeypatch):
    class Probe:
        returncode = 0

        async def communicate(self):
            return json.dumps({"format": {"duration": duration}, "streams": [{"codec_type": "audio"}]}).encode(), b""

    arguments = []

    async def process(*args, **kwargs):
        arguments.extend(args)
        return Probe()

    monkeypatch.setattr(narration.shutil, "which", lambda name: "/fixture/ffprobe")
    monkeypatch.setattr(narration.asyncio, "create_subprocess_exec", process)
    path = tmp_path / "clip.mp3"
    assert await audio_frames(path) == expected
    assert arguments[-1] == str(path) and "format=duration:stream=codec_type" in arguments


@pytest.mark.asyncio
@pytest.mark.parametrize("duration,streams", [("nan", [{"codec_type": "audio"}]), ("0", [{"codec_type": "audio"}]),
                                            ("2", [{"codec_type": "video"}])])
async def test_ffprobe_invalid_or_non_audio_is_not_published(duration, streams, tmp_path, monkeypatch):
    class Probe:
        returncode = 0

        async def communicate(self):
            return json.dumps({"format": {"duration": duration}, "streams": streams}).encode(), b""

    async def process(*args, **kwargs):
        return Probe()

    monkeypatch.setattr(narration.shutil, "which", lambda name: "/fixture/ffprobe")
    monkeypatch.setattr(narration.asyncio, "create_subprocess_exec", process)
    with pytest.raises(NarrationUnavailable):
        await audio_frames(tmp_path / "clip.mp3")


@pytest.fixture
def narration_client(tmp_path, monkeypatch, source, speech):
    from fastapi.testclient import TestClient
    from zhijian.config import Settings

    application = importlib.import_module("zhijian.app")
    question, lesson = source
    asks = [checked_ask()]

    class Fixtures:
        def initialize(self):
            pass

        def question(self, question_id):
            if question_id != question["id"]:
                raise Missing("题目不存在")
            return copy.deepcopy(question)

        def lesson(self, question_id):
            self.question(question_id)
            return copy.deepcopy(lesson)

        def asks(self, question_id):
            self.question(question_id)
            return copy.deepcopy(asks)

    settings = Settings(database_url="unused-test", ai_base_url="https://api.deepseek.com", model="fixture", vision_model="fixture",
                        review_model="fixture", api_key="", data_dir=tmp_path)
    monkeypatch.setattr(application.Settings, "from_environment", classmethod(lambda cls: settings))
    monkeypatch.setattr(application, "Store", lambda url: Fixtures())
    monkeypatch.setattr(application, "NarrationStore", lambda path: speech[0])
    with TestClient(application.create_app(start_worker=False)) as client:
        yield client, question, lesson, asks


def body(**changes):
    return {"expectedRevision": 4, "lessonVersion": 3, "partId": "main", **changes}


def test_http_get_null_prepare_voice_and_private_audio(narration_client):
    client, question, _, _ = narration_client
    endpoint = f"/api/questions/{question['id']}/narration"
    assert client.get(endpoint + "?lessonVersion=3&partId=main").json() == {"narration": None}
    result = client.post(endpoint, json=body())
    assert result.status_code == 200
    manifest = result.json()["narration"]
    assert client.get(endpoint + "?lessonVersion=3&partId=main").json()["narration"]["id"] == manifest["id"]
    response = client.get(manifest["clips"][0]["audioUrl"])
    assert response.status_code == 200 and response.headers["content-type"] == "audio/mpeg"
    assert response.headers["cache-control"] == "private, no-store"
    assert response.content.startswith(b"explicit fixture, not MP3")
    assert client.get("/api/narration/not-uuid/clips/clip-001.mp3").status_code == 404
    assert client.get(f"/api/narration/{manifest['id']}/clips/not-member.mp3").status_code == 404


@pytest.mark.parametrize("change,status", [({"expectedRevision": 3}, 409), ({"lessonVersion": 2}, 409), ({"partId": "other"}, 422),
                                          ({"audioUrl": "https://evil.invalid/voice.mp3"}, 422), ({"expectedRevision": True}, 422)])
def test_http_rejects_old_or_injected_narration(narration_client, change, status):
    client, question, _, _ = narration_client
    assert client.post(f"/api/questions/{question['id']}/narration", json=body(**change)).status_code == status
    assert client.post("/api/questions/unknown/narration", json=body()).status_code == 404


def test_http_answer_only_current_checked(narration_client):
    client, question, _, asks = narration_client
    endpoint = f"/api/questions/{question['id']}/asks/ask-one/narration"
    response = client.post(endpoint, json=body())
    assert response.status_code == 200 and response.json()["narration"]["askId"] == "ask-one"
    asks[0]["status"] = "needs_review"
    assert client.post(endpoint, json=body()).status_code == 422
    assert client.post(endpoint.replace("ask-one", "unknown"), json=body()).status_code == 404


def test_http_rechecks_changed_content_after_speech(narration_client, monkeypatch):
    client, question, lesson, _ = narration_client
    service = client.app.state.narration
    original = service._synthesize

    async def changed(text, path):
        result = await original(text, path)
        lesson["parts"][0]["summary"] = "配音期间发生内容变化"
        return result

    monkeypatch.setattr(service, "_synthesize", changed)
    response = client.post(f"/api/questions/{question['id']}/narration", json=body())
    assert response.status_code == 409
    assert client.get(f"/api/questions/{question['id']}/narration?lessonVersion=3&partId=main").json()["narration"] is None


def test_http_rechecks_answer_review_after_speech(narration_client, monkeypatch):
    client, question, _, asks = narration_client
    service = client.app.state.narration
    original = service._synthesize

    async def changed(text, path):
        result = await original(text, path)
        asks[0]["status"] = "needs_review"
        return result

    monkeypatch.setattr(service, "_synthesize", changed)
    response = client.post(f"/api/questions/{question['id']}/asks/ask-one/narration", json=body())
    assert response.status_code == 409
