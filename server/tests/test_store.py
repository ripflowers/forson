import os
from uuid import uuid4

import pytest

from zhijian.store import Conflict, Invalid, Store
from zhijian.config import load_environment

load_environment()


@pytest.fixture
def store():
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL must point at the isolated test database")
    s = Store(url)
    s.initialize()
    return s


def test_events_survive_new_store_connection(store):
    paper = store.create_paper("持久化测试", [])
    q = store.save_extracted_questions(paper["id"], [{"number": 1, "stem": "1+1", "parts": [{"id": "main", "prompt": "求和"}], "missingFields": []}])[0]
    event = store.add_event({"questionId": q["id"], "questionRevision": 1, "lessonVersion": None,
                            "partId": "main", "kind": "note", "authorKind": "learner", "text": "我自己的解释", "payload": {}})
    reopened = Store(store.url)
    assert event in reopened.events()


def test_database_publication_cas_rejects_revision_change(store):
    p = store.create_paper("CAS测试", [])
    q = store.save_extracted_questions(p["id"], [{"number": 15, "stem": "原题", "parts": [{"id": "main", "prompt": "求值"}], "missingFields": []}])[0]
    q = store.update_question(q["id"], 1, {**q, "confirm": True})
    job = store.create_job(p["id"], q["id"], "lesson", {"revision": q["revision"]})
    claimed = store.claim_job()
    assert claimed["id"] == job["id"]
    store.update_question(q["id"], q["revision"], {**q, "stem": "新题", "confirm": True})
    assert not store.publish_lesson(q["id"], q["revision"], job["id"], claimed["lease"], {"status": "ready", "parts": []})


def test_database_publication_cas_rejects_cancellation(store):
    p = store.create_paper("取消测试", [])
    q = store.save_extracted_questions(p["id"], [{"number": 1, "stem": "原题", "parts": [{"id": "main", "prompt": "求值"}], "missingFields": []}])[0]
    job = store.create_job(p["id"], q["id"], "lesson", {"revision": 1})
    claimed = store.claim_job()
    assert claimed["id"] == job["id"]
    store.cancel_job(job["id"])
    assert not store.publish_lesson(q["id"], 1, job["id"], claimed["lease"], {"status": "ready", "parts": []})


def test_newer_generation_lease_rejects_old_same_revision_job(store):
    p = store.create_paper("同版本租约测试", [])
    q = store.save_extracted_questions(p["id"], [{"number": 1, "stem": "原题", "parts": [{"id": "main", "prompt": "求值"}], "missingFields": []}])[0]
    q = store.update_question(q["id"], 1, {"confirm": True})
    first = store.create_job(p["id"], q["id"], "lesson", {"revision": q["revision"]})
    first = store.claim_job()
    store.begin_lesson(q["id"], q["revision"], first["id"], first["lease"])
    second = store.create_job(p["id"], None, "lessons", {"questions": [{"id": q["id"], "revision": q["revision"]}], "total": 1})
    second = store.claim_job()
    store.begin_lesson(q["id"], q["revision"], second["id"], second["lease"])
    assert not store.publish_lesson(q["id"], q["revision"], first["id"], first["lease"], {"status": "ready", "parts": []})
    assert store.publish_lesson(q["id"], q["revision"], second["id"], second["lease"], {"status": "ready", "parts": []})
    store.update_job(first["id"], first["lease"], state="succeeded")
    store.update_job(second["id"], second["lease"], state="succeeded")


def test_older_ready_lesson_cannot_overwrite_session_after_new_ready_version(store):
    p = store.create_paper("现场版本测试", [])
    q = store.save_extracted_questions(p["id"], [{"number": 1, "stem": "原题", "parts": [{"id": "main", "prompt": "求值"}], "missingFields": []}])[0]
    q = store.update_question(q["id"], 1, {"confirm": True})
    first = store.create_job(p["id"], q["id"], "lesson", {"revision": q["revision"]})
    first = store.claim_job()
    store.begin_lesson(q["id"], q["revision"], first["id"], first["lease"])
    lesson = {"status": "ready", "parts": [{"partId": "main", "steps": []}]}
    v1 = store.publish_lesson(q["id"], q["revision"], first["id"], first["lease"], lesson)
    store.update_job(first["id"], first["lease"], state="succeeded")
    payload = {"questionRevision": q["revision"], "lessonVersion": v1["lessonVersion"], "partId": "main", "stepIndex": 0, "mode": "teacher", "sceneState": {}, "reflection": "草稿", "returnTarget": None}
    store.save_session(q["id"], 0, payload)
    second = store.create_job(p["id"], q["id"], "lesson", {"revision": q["revision"]})
    second = store.claim_job()
    store.begin_lesson(q["id"], q["revision"], second["id"], second["lease"])
    store.publish_lesson(q["id"], q["revision"], second["id"], second["lease"], lesson)
    store.update_job(second["id"], second["lease"], state="succeeded")
    with pytest.raises(Conflict):
        store.save_session(q["id"], 1, payload)
    assert store.session(q["id"])["reflection"] == "草稿"


def test_correcting_source_region_increments_revision_and_preserves_old_source(store):
    p = store.create_paper("原图定位校对测试", [{"index": 0, "url": "/api/media/test/page-0.jpg", "width": 1200, "height": 900}])
    q = store.save_extracted_questions(p["id"], [{"number": 1, "stem": "原题", "sourceRegions": [{"pageIndex": 0, "x": 0, "y": 0, "width": 0.1, "height": 0.1}], "parts": [{"id": "main", "prompt": "求值"}], "missingFields": []}])[0]
    region = {"pageIndex": 0, "x": 0.2, "y": 0.3, "width": 0.3, "height": 0.2}
    updated = store.update_question(q["id"], 1, {"sourceRegions": [region]})
    assert updated["sourceRegions"] == [region]
    assert updated["revision"] == 2
    assert store.question(q["id"], 1)["sourceRegions"] == q["sourceRegions"]
    with pytest.raises(Invalid):
        store.update_question(q["id"], 2, {"sourceRegions": [{**region, "x": 0.9}]})
    with pytest.raises(Invalid):
        store.update_question(q["id"], 2, {"sourceRegions": [{**region, "pageIndex": 8}]})


def test_coverage_keeps_partial_blocked_and_stale_revision_semantics(store):
    p = store.create_paper("覆盖计数一致性测试", [])
    questions = store.save_extracted_questions(p["id"], [
        {"number": 1, "stem": "完整题", "parts": [{"id": "main", "prompt": "求值"}], "missingFields": []},
        {"number": 2, "stem": "两小问题", "parts": [{"id": "1", "prompt": "第一问"}, {"id": "2", "prompt": "第二问"}], "missingFields": []},
        {"number": 3, "stem": "缺定义题", "parts": [{"id": "main", "prompt": "求值"}], "missingFields": ["定义缺失"]}])
    for q in questions[:2]:
        q.update(store.update_question(q["id"], 1, {"confirm": True}))
        job = store.create_job(p["id"], q["id"], "lesson", {"revision": q["revision"]})
        job = store.claim_job()
        store.begin_lesson(q["id"], q["revision"], job["id"], job["lease"])
        store.publish_lesson(q["id"], q["revision"], job["id"], job["lease"], {"status": "ready", "coveredPartIds": [q["parts"][0]["id"]], "parts": []})
        store.update_job(job["id"], job["lease"], state="succeeded")
    first = store.coverage(p["id"])
    assert first["coverage"] == {"questionCount": 3, "partCount": 4, "confirmedQuestions": 2, "readyQuestions": 1, "readyParts": 2, "blockedParts": 1}
    assert first["questions"][1]["parts"][1]["status"] == "not_generated"
    assert first["questions"][2]["parts"][0] == {"partId": "main", "status": "blocked", "issues": ["定义缺失"]}
    q = questions[0]
    store.update_question(q["id"], q["revision"], {"stem": "改过条件", "confirm": True})
    later = store.coverage(p["id"])
    assert later["coverage"]["readyQuestions"] == 0
    assert later["coverage"]["readyParts"] == 1
    assert later["questions"][0]["parts"][0]["status"] == "stale"
