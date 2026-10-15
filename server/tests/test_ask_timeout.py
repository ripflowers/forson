"""Isolated interactive AI deadline regression; no real AI, TTS or family DB."""
import asyncio
import copy
import importlib

import pytest
from fastapi.testclient import TestClient

from zhijian.config import Settings
from zhijian.store import Missing


@pytest.fixture
def ask_client(tmp_path, monkeypatch):
    application = importlib.import_module("zhijian.app")
    question = {"id": "deadline-question", "revision": 4, "state": "confirmed", "parts": [{"id": "main"}]}
    part = {"partId": "main", "goal": "显式测试目标", "known": ["测试已知条件"], "prerequisites": ["测试前置知识"],
            "method": "显式测试方法", "steps": [], "scene": None}
    lesson = {"questionId": question["id"], "questionRevision": 4, "lessonVersion": 3, "status": "ready", "parts": [part]}
    saved = []
    calls = []
    limits = []
    mode = {"timeoutStage": "answer"}

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

        def save_ask(self, question_id, payload):
            result = {**copy.deepcopy(payload), "id": "saved-timeout-ask", "questionId": question_id}
            saved.append(result)
            return result

    class NoNetworkProvider:
        async def json(self, **kwargs):
            calls.append(kwargs["name"])
            if kwargs["name"] == mode["timeoutStage"]:
                raise asyncio.TimeoutError()
            if kwargs["name"] == "answer":
                return {"answer": "EXPLICIT FIXTURE DRAFT，不能在核验超时时发布。", "claims": [{"id": "claim-one", "statement": "显式测试断言"}]}
            return {"reasoningCorrect": True, "claims": [{"id": "claim-one", "supported": True, "evidence": "显式测试审核证据", "issue": ""}]}

    original_wait_for = asyncio.wait_for

    async def observe_wait_for(awaitable, timeout):
        if getattr(getattr(awaitable, "cr_code", None), "co_name", None) == "json":
            limits.append(timeout)
        return await original_wait_for(awaitable, timeout)

    settings = Settings(database_url="unused-isolated-fixture", ai_base_url="https://api.deepseek.com", model="fixture", vision_model="fixture",
                        review_model="fixture", api_key="", data_dir=tmp_path)
    monkeypatch.setattr(application.Settings, "from_environment", classmethod(lambda cls: settings))
    monkeypatch.setattr(application, "Store", lambda url: Fixtures())
    monkeypatch.setattr(application, "Provider", lambda config: NoNetworkProvider())
    monkeypatch.setattr(application.asyncio, "wait_for", observe_wait_for)
    app = application.create_app(start_worker=False)
    speech_calls = []

    async def no_speech(*args, **kwargs):
        speech_calls.append((args, kwargs))
        raise AssertionError("未核验或超时答复不能触发 TTS")

    monkeypatch.setattr(app.state.narration, "_synthesize", no_speech)
    with TestClient(app) as client:
        yield client, saved, calls, limits, mode, speech_calls


def payload():
    return {"questionRevision": 4, "lessonVersion": 3, "partId": "main", "stepId": None,
            "mode": "teacher", "snapshot": {"stepIndex": 0, "frame": 123, "paused": True},
            "text": "显式工程测试：为什么当前板书要这样理解？"}


def test_answer_timeout_retains_question_and_frozen_scene_without_review_or_speech(ask_client):
    client, saved, calls, limits, _, speech_calls = ask_client
    response = client.post("/api/questions/deadline-question/ask", json=payload())
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "needs_review"
    assert result["text"] == payload()["text"] and result["snapshot"] == payload()["snapshot"]
    assert "AI 响应超时" in result["answer"] and "主课保持暂停" in result["answer"]
    assert "EXPLICIT FIXTURE DRAFT" not in result["answer"]
    assert result["evidence"]["responseTimeout"] is True and result["evidence"]["timeoutSeconds"] == 45
    assert result["evidence"]["review"] is None
    assert calls == ["answer"] and limits == [45] and speech_calls == [] and saved == [result]


def test_review_timeout_discards_unverified_answer_and_does_not_fake_success(ask_client):
    client, saved, calls, limits, mode, speech_calls = ask_client
    mode["timeoutStage"] = "answer-review"
    response = client.post("/api/questions/deadline-question/ask", json=payload())
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "needs_review" and result["text"] == payload()["text"]
    assert "AI 响应超时" in result["answer"] and "主课保持暂停" in result["answer"]
    assert "EXPLICIT FIXTURE DRAFT" not in result["answer"] and result["evidence"]["review"] is None
    assert calls == ["answer", "answer-review"] and limits == [45, 45]
    assert saved == [result] and speech_calls == []


def test_successful_isolated_answer_still_requires_both_checks_under_individual_deadlines(ask_client):
    client, saved, calls, limits, mode, speech_calls = ask_client
    mode["timeoutStage"] = None
    response = client.post("/api/questions/deadline-question/ask", json=payload())
    result = response.json()
    assert response.status_code == 200 and result["status"] == "checked"
    assert result["evidence"]["review"]["reasoningCorrect"] is True
    assert "responseTimeout" not in result["evidence"]
    assert calls == ["answer", "answer-review"] and limits == [45, 45]
    assert saved == [result] and speech_calls == []
