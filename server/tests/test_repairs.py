import copy
import json
from types import SimpleNamespace

import pytest

from test_store import store
from zhijian.jobs import JobRunner


def lesson_fixture():
    return {"questionRevision": 2, "coveredPartIds": ["1"], "concepts": ["距离"], "parts": [{
        "partId": "1", "label": "(1)", "goal": "求最小值", "known": ["固定点为-1和2"], "prerequisites": ["绝对值表示距离"],
        "method": "区间内的距离和等于两固定点间距离。", "steps": [{"id": "s1", "title": "比较位置", "explanation": "在区间内拼成固定距离，区间外还需往返。", "reason": "绝对值表示到固定点的距离。", "formulaLatex": "2-(-1)=3"}],
        "answer": {"kind": "minimum", "value": {"minimum": 3, "attainedWhen": {"min": -1, "max": 2, "includeMin": True, "includeMax": True}}, "display": "3，整个[-1,2]取得"},
        "verification": "端点和区间内的和均为3，区间外增加往返。", "misconceptions": [{"mistake": "只取中点", "correction": "整个闭区间都满足"}],
        "summary": "把绝对值读成距离，再比较点的位置。", "scene": {"kind": "number-line", "params": {"left": -1, "right": 2}}}]}


class ControlledProvider:
    def __init__(self, repair_succeeds):
        self.repair_succeeds = repair_succeeds
        self.calls = []

    async def json(self, **request):
        self.calls.append(request)
        if "reasoning-review" in request["name"]:
            result = {"inputEquivalent": True, "inputIssues": [], "parts": [{"partId": "1", "reasoningCorrect": True, "issue": "", "checks": [{
                "index": 0, "supported": True, "evidence": "距离法已解释", "source": {"kind": "field", "field": "method"}, "quote": "区间内的距离和等于两固定点间距离。", "issue": ""}]}]}
            result["parts"][0]["fieldChecks"] = [{"field": field, "correct": True, "issue": ""} for field in ("goal", "known", "prerequisites", "method", "answer", "verification", "misconceptions", "summary", "scene")]
            result["parts"][0]["stepChecks"] = [{"stepId": "s1", **{field: {"correct": True, "issue": ""} for field in ("explanation", "reason", "formulaLatex")}}]
        else:
            result = lesson_fixture()
            if "repair" not in request["name"] or not self.repair_succeeds:
                result["parts"][0]["scene"] = {"type": "number-line", "params": {"left": -1, "right": 2}}
                result["parts"][0]["answer"] = {"kind": "numbers", "value": 3, "display": "3"}
        request["evidence_dir"].mkdir(parents=True, exist_ok=True)
        (request["evidence_dir"] / (request["name"] + "-response.json")).write_text(json.dumps(result, ensure_ascii=False))
        return copy.deepcopy(result)


def setup_runner(store, tmp_path, monkeypatch, repair_succeeds):
    paper = store.create_paper("限定一次修复测试", [])
    question = store.save_extracted_questions(paper["id"], [{"number": 19, "stem": "|x+1|+|x-2|的最小值", "parts": [{"id": "1", "label": "(1)", "prompt": "求最小值"}], "missingFields": []}])[0]
    question = store.update_question(question["id"], 1, {"confirm": True})
    job = store.create_job(paper["id"], question["id"], "lesson", {"revision": question["revision"]})
    job = store.claim_job()
    gold = {"parts": [{"id": "1", "semanticId": "1", "expectedAnswer": lesson_fixture()["parts"][0]["answer"], "requiredReasoning": ["REFERENCE_ONLY_SENTINEL：解释距离法"]}]}
    monkeypatch.setattr("zhijian.jobs.sample_gold", lambda paper, question: gold)
    provider = ControlledProvider(repair_succeeds)
    runner = JobRunner(store, provider, SimpleNamespace(data_dir=tmp_path, model="test-only", review_model="test-only"))
    return runner, provider, job, question


@pytest.mark.asyncio
async def test_first_bad_shape_repaired_once_then_all_gates_pass(store, tmp_path, monkeypatch):
    runner, provider, job, question = setup_runner(store, tmp_path, monkeypatch, True)
    assert await runner.generate_lesson(job, question)
    lesson = store.lesson(question["id"])
    assert lesson["status"] == "ready"
    assert lesson["checks"]["reasoningReviewed"] and lesson["checks"]["answerVerified"]
    generation = [call for call in provider.calls if "reasoning-review" not in call["name"]]
    assert len(generation) == 2
    assert "repair" in generation[1]["name"]
    assert all("expectedAnswer" not in call["prompt"] and "REFERENCE_ONLY_SENTINEL" not in call["prompt"] for call in generation)
    assert store.lesson(question["id"], 1)["status"] == "needs_repair"
    assert len(list((tmp_path / "runtime" / "evidence" / job["id"]).glob("*-response.json"))) == 4
    store.update_job(job["id"], job["lease"], state="succeeded")


@pytest.mark.asyncio
async def test_second_bad_shape_stays_blocked_without_third_generation(store, tmp_path, monkeypatch):
    runner, provider, job, question = setup_runner(store, tmp_path, monkeypatch, False)
    assert not await runner.generate_lesson(job, question)
    assert store.lesson(question["id"])["status"] == "needs_repair"
    assert len([call for call in provider.calls if "reasoning-review" not in call["name"]]) == 2
    store.update_job(job["id"], job["lease"], state="failed")
