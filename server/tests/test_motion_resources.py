"""Local pure-data resource contracts; no AI/TTS, real renderer, or family DB."""
import copy
import importlib
import importlib.util
import json
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from zhijian.config import Settings
from zhijian.motion_resources import (MotionPackInput, MotionResourceStore, TRIANGLE_TEMPLATES,
                                      canonical_hash, validate_motion_pack)
from zhijian.store import Conflict, Invalid, Missing
from zhijian.videos import VideoRequest, VideoStore, approved_part


@pytest.fixture
def teaching_source():
    question = {"id": "resource-question", "revision": 4, "number": 26, "state": "confirmed", "missingFields": [],
                "stem": "三角形数：第24个与第22个的差为？", "options": [{"label": "B", "text": "47"}],
                "figureDescription": "石子排成三角形", "parts": [{"id": "main", "prompt": "求差"}], "notes": "私人草稿不进入制作上下文"}
    part = {"partId": "main", "label": "主问题", "goal": "比较两行", "known": ["三角形数"], "prerequisites": ["计数"],
            "method": "移去相同部分", "verification": "300-253=47", "summary": "只数新增行",
            "steps": [{"id": f"step-{i}", "title": f"第{i}步", "explanation": "测试已核验说明", "reason": "测试已核验理由", "formulaLatex": "23+24=47"} for i in range(4)],
            "answer": {"kind": "choice", "value": "B", "display": "B，47"},
            "misconceptions": [{"mistake": "24−22", "correction": "层数不是石子数"}],
            "scene": {"kind": "triangle-count", "params": {"lower": 22, "upper": 24, "previewRows": 6}}, "notes": "私人板书草稿"}
    lesson = {"questionId": question["id"], "questionRevision": 4, "lessonVersion": 3, "status": "ready", "coveredPartIds": ["main"], "parts": [part],
              "checks": {"inputConfirmed": True, "coverage": True, "answerVerified": True, "reasoningReviewed": True}}
    return question, lesson


def resource_data(source):
    question, lesson = source
    return {"schemaVersion": 1, "title": "三角形数：看见相同与新增", "subject": "math", "author": "Codex",
            "target": {"questionId": question["id"], "questionRevision": question["revision"], "lessonVersion": lesson["lessonVersion"],
                       "partId": "main", "lessonHash": canonical_hash(approved_part(lesson["parts"][0]))},
            "concepts": [{"id": "triangle-number", "label": "三角形数", "explanation": "按行累计点数。"},
                         {"id": "cancel-common", "label": "抵消共同部分", "explanation": "同一数量相减为零。"}],
            "stages": [{"stageIndex": index, "template": template, "title": f"教学阶段{index + 1}",
                        "conceptIds": ["triangle-number", "cancel-common"], "focus": "看新增的行", "explanation": "新增行的点数来自已核验的题目条件。"}
                       for index, template in enumerate(TRIANGLE_TEMPLATES)]}


@pytest.fixture
def motion_store(tmp_path):
    store = MotionResourceStore(tmp_path)
    store.initialize()
    return store


def test_import_has_server_identity_integrity_and_private_immutable_data(motion_store, teaching_source):
    request = MotionPackInput.model_validate(resource_data(teaching_source))
    lesson_before = copy.deepcopy(teaching_source[1])
    pack = motion_store.create(*teaching_source, request)
    assert str(UUID(pack["id"])) == pack["id"]
    assert pack["author"] == "Codex" and pack["schemaVersion"] == 1
    assert pack["packHash"] == canonical_hash({key: value for key, value in pack.items() if key != "packHash"})
    assert motion_store.get(pack["id"]) == pack
    assert motion_store.current(*teaching_source, 3, "main") == pack
    assert motion_store.root.stat().st_mode & 0o777 == 0o700
    assert motion_store.path(pack["id"]).stat().st_mode & 0o777 == 0o600
    request.stages[0].focus = "之后修改请求不改已存资源"
    pack["concepts"][0]["label"] = "之后修改返回不改已存资源"
    assert motion_store.get(pack["id"])["stages"][0]["focus"] != request.stages[0].focus
    assert motion_store.get(pack["id"])["concepts"][0]["label"] != pack["concepts"][0]["label"]
    assert teaching_source[1] == lesson_before


def test_context_exports_approved_part_and_exact_templates_without_private_drafts(motion_store, teaching_source):
    context = motion_store.context(*teaching_source, 3, "main")
    assert context["question"]["stem"] == teaching_source[0]["stem"]
    assert context["part"] == approved_part(teaching_source[1]["parts"][0])
    assert context["target"] == resource_data(teaching_source)["target"]
    assert context["templateConstraints"]["stageCount"] == 7
    assert [item["template"] for item in context["templateConstraints"]["templates"]] == list(TRIANGLE_TEMPLATES)
    assert context["validation"] == {"kind": "local-structure", "teacherReviewed": False}
    assert "notes" not in context["question"] and "notes" not in context["part"]


@pytest.mark.parametrize("change", [{"questionId": "other"}, {"questionRevision": 3}, {"lessonVersion": 2}, {"lessonHash": "f" * 64}])
def test_wrong_question_revision_lesson_or_content_hash_cannot_import(motion_store, teaching_source, change):
    data = resource_data(teaching_source)
    data["target"].update(change)
    with pytest.raises(Conflict):
        motion_store.create(*teaching_source, MotionPackInput.model_validate(data))
    assert list(motion_store.root.iterdir()) == []


def test_wrong_leaf_cannot_import(motion_store, teaching_source):
    data = resource_data(teaching_source)
    data["target"]["partId"] = "wrong-leaf"
    with pytest.raises(Invalid):
        motion_store.create(*teaching_source, MotionPackInput.model_validate(data))


@pytest.mark.parametrize("defect", ["duplicate-stage", "missing-stage", "wrong-template", "unknown-concept", "duplicate-concept"])
def test_incomplete_or_ambiguous_teaching_bindings_are_rejected(motion_store, teaching_source, defect):
    data = resource_data(teaching_source)
    if defect == "duplicate-stage":
        data["stages"][-1]["stageIndex"] = 0
    elif defect == "missing-stage":
        data["stages"].pop()
    elif defect == "wrong-template":
        data["stages"][0]["template"] = "triangle-cancel"
    elif defect == "unknown-concept":
        data["stages"][0]["conceptIds"] = ["not-in-this-pack"]
    else:
        data["concepts"].append(copy.deepcopy(data["concepts"][0]))
    with pytest.raises(Invalid):
        motion_store.create(*teaching_source, MotionPackInput.model_validate(data))


@pytest.mark.parametrize("where,key,value", [("root", "id", "client-id"), ("root", "packHash", "pretend-approved"),
    ("root", "createdAt", "client-timestamp"), ("root", "script", "alert(1)"), ("stage", "html", "<div>unsafe</div>"),
    ("stage", "url", "https://external.invalid/scene"), ("stage", "path", "/tmp/arbitrary-scene"),
    ("target", "params", {"lower": 21, "upper": 25})])
def test_schema_rejects_server_fields_executable_fields_and_math_parameter_override(teaching_source, where, key, value):
    data = resource_data(teaching_source)
    destination = data if where == "root" else data["stages"][0] if where == "stage" else data["target"]
    destination[key] = value
    with pytest.raises(ValidationError):
        MotionPackInput.model_validate(data)


@pytest.mark.parametrize("text", ["<script>alert(1)</script>", "https://external.invalid/scene", "javascript:alert(1)", "/Users/private/scene.js"])
def test_plain_text_fields_do_not_accept_html_urls_or_paths(teaching_source, text):
    data = resource_data(teaching_source)
    data["stages"][0]["explanation"] = text
    with pytest.raises(ValidationError):
        MotionPackInput.model_validate(data)


@pytest.mark.parametrize("field,value", [("schemaVersion", True), ("subject", "biology"), ("author", "教师审核"),
    ("concepts", [{"id": str(i), "label": "过量", "explanation": "过量"} for i in range(17)]), ("stages", []), ("title", " " * 10)])
def test_bounded_schema_does_not_coerce_or_fake_authorship(teaching_source, field, value):
    data = resource_data(teaching_source)
    data[field] = value
    with pytest.raises(ValidationError):
        MotionPackInput.model_validate(data)


@pytest.mark.parametrize("defect", ["missing-fields", "unconfirmed", "unchecked", "not-ready", "not-covered"])
def test_unapproved_lessons_have_no_resource_binding(motion_store, teaching_source, defect):
    question, lesson = teaching_source
    data = resource_data(teaching_source)
    if defect == "missing-fields":
        question["missingFields"] = ["图示缺失"]
    elif defect == "unconfirmed":
        question["state"] = "extracted"
    elif defect == "unchecked":
        lesson["checks"]["reasoningReviewed"] = False
    elif defect == "not-ready":
        lesson["status"] = "needs_review"
    else:
        lesson["coveredPartIds"] = []
    with pytest.raises(Invalid):
        motion_store.create(question, lesson, MotionPackInput.model_validate(data))


def test_old_pack_never_flows_to_new_revision_or_changed_part(motion_store, teaching_source):
    question, lesson = teaching_source
    first = motion_store.create(question, lesson, MotionPackInput.model_validate(resource_data(teaching_source)))
    lesson["parts"][0]["summary"] = "同版本内容已更新"
    assert motion_store.current(question, lesson, 3, "main") is None
    with pytest.raises(Conflict):
        validate_motion_pack(first, question, lesson, 3, "main")
    question["revision"] = lesson["questionRevision"] = 5
    lesson["lessonVersion"] = 4
    assert motion_store.current(question, lesson, 4, "main") is None
    with pytest.raises(Conflict):
        validate_motion_pack(first, question, lesson, 4, "main")


def test_tampered_storage_is_not_published_or_leaked(motion_store, teaching_source):
    pack = motion_store.create(*teaching_source, MotionPackInput.model_validate(resource_data(teaching_source)))
    pack["stages"][0]["focus"] = "磁盘中被修改但摘要没变"
    motion_store.path(pack["id"]).write_text(json.dumps(pack, ensure_ascii=False))
    with pytest.raises(Missing) as caught:
        motion_store.get(pack["id"])
    assert str(motion_store.root) not in str(caught.value)
    assert motion_store.current(*teaching_source, 3, "main") is None
    with pytest.raises(Missing):
        motion_store.get("../../outside")


def test_number_line_context_uses_fixed_scene_and_distance_templates(motion_store, teaching_source):
    question, lesson = teaching_source
    part = lesson["parts"][0]
    part["steps"] = part["steps"][:2]
    part["scene"] = {"kind": "number-line", "params": {"left": -2, "right": 4, "targetSum": 8}}
    context = motion_store.context(question, lesson, 3, "main")
    assert context["part"]["scene"]["params"] == {"left": -2, "right": 4, "targetSum": 8}
    assert context["templateConstraints"]["stageCount"] == 5
    assert {item["template"] for item in context["templateConstraints"]["templates"]} == {"distance-model"}
    data = resource_data(teaching_source)
    data["stages"] = [{**data["stages"][0], "stageIndex": index, "template": "distance-model"} for index in range(5)]
    assert motion_store.create(question, lesson, MotionPackInput.model_validate(data))["target"] == context["target"]


def test_video_freezes_validated_motion_data_and_view(motion_store, teaching_source, tmp_path):
    pack = motion_store.create(*teaching_source, MotionPackInput.model_validate(resource_data(teaching_source)))
    videos = VideoStore(tmp_path)
    videos.initialize()
    request = VideoRequest(expectedRevision=4, lessonVersion=3, partId="main", motionPackId=pack["id"], motionView="flat")
    video = videos.create(*teaching_source, request, motion_pack=pack)
    assert video["motionPackId"] == pack["id"] and video["motionView"] == "flat"
    snapshot = json.loads((videos.directory(video["id"]) / "snapshot.json").read_text())
    assert snapshot["inputProps"]["motionPack"] == pack and snapshot["inputProps"]["motionView"] == "flat"
    pack["stages"][0]["title"] = "之后修改不应改已排队视频"
    assert json.loads((videos.directory(video["id"]) / "snapshot.json").read_text()) == snapshot
    assert video["snapshotHash"] == canonical_hash(snapshot)


@pytest.mark.parametrize("defect", ["old-version", "forged-hash", "wrong-id", "missing-resource"])
def test_video_rejects_old_or_forged_motion_resources(motion_store, teaching_source, tmp_path, defect):
    pack = motion_store.create(*teaching_source, MotionPackInput.model_validate(resource_data(teaching_source)))
    videos = VideoStore(tmp_path)
    videos.initialize()
    request = VideoRequest(expectedRevision=4, lessonVersion=3, partId="main", motionPackId=pack["id"])
    expected = Invalid
    if defect == "old-version":
        teaching_source[0]["revision"] = teaching_source[1]["questionRevision"] = 5
        teaching_source[1]["lessonVersion"] = 4
        request = request.model_copy(update={"expectedRevision": 5, "lessonVersion": 4})
        expected = Conflict
    elif defect == "forged-hash":
        pack["packHash"] = "f" * 64
    elif defect == "wrong-id":
        request = request.model_copy(update={"motionPackId": "00000000-0000-0000-0000-000000000000"})
    else:
        pack = None
    with pytest.raises(expected):
        videos.create(*teaching_source, request, motion_pack=pack)
    assert videos.next_queued() is None


@pytest.fixture
def resource_client(tmp_path, monkeypatch, teaching_source):
    application = importlib.import_module("zhijian.app")
    question, lesson = teaching_source

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

    settings = Settings(database_url="unused-local-fixture", ai_base_url="https://api.deepseek.com", model="fixture", vision_model="fixture",
                        review_model="fixture", api_key="", data_dir=tmp_path)
    monkeypatch.setattr(application.Settings, "from_environment", classmethod(lambda cls: settings))
    monkeypatch.setattr(application, "Store", lambda url: Fixtures())
    with TestClient(application.create_app(start_worker=False)) as client:
        yield client, question, lesson


def test_http_context_import_current_and_video_bridge(resource_client):
    client, question, lesson = resource_client
    path = f"/api/questions/{question['id']}"
    assert client.get(path + "/motion-resource?lessonVersion=3&partId=main").json() == {"motionPack": None}
    context = client.get(path + "/teaching-context?lessonVersion=3&partId=main").json()
    assert context["target"] == resource_data((question, lesson))["target"]
    result = client.post(path + "/motion-resources", json=resource_data((question, lesson)))
    assert result.status_code == 200
    pack = result.json()["motionPack"]
    assert client.get(path + "/motion-resource?lessonVersion=3&partId=main").json() == {"motionPack": pack}
    assert client.get(f"/api/motion-resources/{pack['id']}").json() == {"motionPack": pack}
    video = client.post(path + "/videos", json={"expectedRevision": 4, "lessonVersion": 3, "partId": "main", "motionPackId": pack["id"], "motionView": "space"})
    assert video.status_code == 200 and video.json()["video"]["motionPackId"] == pack["id"]
    assert video.json()["video"]["motionView"] == "space"


def test_http_rejects_injection_and_old_versions_with_safe_errors(resource_client):
    client, question, lesson = resource_client
    path = f"/api/questions/{question['id']}"
    data = resource_data((question, lesson))
    data["script"] = "alert(1)"
    response = client.post(path + "/motion-resources", json=data)
    assert response.status_code == 422 and "alert" not in response.text
    assert client.get(path + "/teaching-context?lessonVersion=2&partId=main").status_code == 409
    assert client.get(path + "/motion-resource?lessonVersion=0&partId=main").status_code == 422
    assert client.get("/api/questions/unknown/teaching-context?lessonVersion=3").status_code == 404
    assert client.get("/api/motion-resources/not-uuid").status_code == 404
    data = resource_data((question, lesson))
    data["target"]["lessonHash"] = "f" * 64
    assert client.post(path + "/motion-resources", json=data).status_code == 409


@pytest.fixture
def cli():
    path = Path(__file__).resolve().parents[2] / "scripts" / "teaching_resources.py"
    spec = importlib.util.spec_from_file_location("teaching_resource_cli_fixture", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_cli_exports_context_without_model_or_key_and_imports_pure_data(cli, monkeypatch, tmp_path, teaching_source, capsys):
    calls = []
    context = {"target": resource_data(teaching_source)["target"], "validation": {"teacherReviewed": False}}

    def no_network(base_url, path, payload=None):
        calls.append((base_url, path, payload))
        if path.endswith("/lesson"):
            return {"lesson": {"status": "ready", "lessonVersion": 3}}
        if "/teaching-context?" in path:
            return context
        return {"motionPack": {"id": "fixture-imported-pack"}}

    monkeypatch.setattr(cli, "api", no_network)
    output = tmp_path / "context.json"
    assert cli.main(["export-context", "--question-id", "resource-question", "--part-id", "main", "--out", str(output), "--base-url", "http://127.0.0.1:8787"]) == 0
    assert json.loads(output.read_text()) == context and output.stat().st_mode & 0o777 == 0o600
    pack_file = tmp_path / "pack.json"
    pack_file.write_text(json.dumps(resource_data(teaching_source), ensure_ascii=False))
    assert cli.main(["--base-url", "http://localhost:8787", "import", str(pack_file)]) == 0
    assert calls[-1][2] == resource_data(teaching_source)
    assert all("lesson" in path or "motion-resources" in path or "teaching-context" in path for _, path, _ in calls)
    assert "未冒充教师审核" in capsys.readouterr().out


def test_cli_rejects_external_api_and_invalid_files_without_network(cli, tmp_path, capsys):
    with pytest.raises(ValueError, match="本机"):
        cli.api("https://external.invalid", "/api/questions/example")
    bad = tmp_path / "bad.json"
    bad.write_text("not-json")
    assert cli.main(["import", str(bad)]) == 1
    assert "不是合法JSON" in capsys.readouterr().err
