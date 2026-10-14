import asyncio
from types import SimpleNamespace

import pytest

from test_store import store
from zhijian.jobs import JobRunner


@pytest.mark.asyncio
async def test_whole_paper_runs_six_at_a_time_keeps_partial_ready_and_continues_after_failure(store, tmp_path):
    paper = store.create_paper("六题并发测试", [])
    questions = store.save_extracted_questions(paper["id"], [
        {"number": n, "stem": f"测试题{n}", "parts": [{"id": "main", "prompt": "求值"}], "missingFields": []}
        for n in range(1, 9)])
    questions = [store.update_question(q["id"], 1, {"confirm": True}) for q in questions]
    targets = [{"id": q["id"], "revision": q["revision"]} for q in questions]
    job = store.create_job(paper["id"], None, "lessons", {"questions": targets, "total": 8})
    job = store.claim_job()
    runner = JobRunner(store, SimpleNamespace(require_key=lambda: None), SimpleNamespace(data_dir=tmp_path))
    six_started, first_ready, release_first_batch = asyncio.Event(), asyncio.Event(), asyncio.Event()
    active, peak, started = 0, 0, []

    async def controlled_generator(current_job, q):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        started.append(q["number"])
        if len(started) == 6:
            six_started.set()
        try:
            if q["number"] == 1:
                await six_started.wait()
                store.begin_lesson(q["id"], q["revision"], current_job["id"], current_job["lease"])
                store.publish_lesson(q["id"], q["revision"], current_job["id"], current_job["lease"], {"status": "ready", "coveredPartIds": ["main"], "parts": []})
                first_ready.set()
                return True
            if q["number"] <= 6:
                await release_first_batch.wait()
                return q["number"] != 4
            return True
        finally:
            active -= 1

    # A deterministic async boundary replaces paid AI calls only in this scheduling test.
    runner.generate_lesson = controlled_generator
    task = asyncio.create_task(runner.process(job))
    try:
        await asyncio.wait_for(six_started.wait(), timeout=5)
        await asyncio.wait_for(first_ready.wait(), timeout=5)
        await asyncio.sleep(0)
        assert peak == 6
        assert sorted(started) == [1, 2, 3, 4, 5, 6]
        assert store.lesson(questions[0]["id"])["status"] == "ready"
        assert store.job(job["id"])["completedUnits"] == 1
    finally:
        release_first_batch.set()
    await asyncio.wait_for(task, timeout=5)
    final = store.job(job["id"])
    assert peak == 6
    assert final["completedUnits"] == 8
    assert sorted(started) == list(range(1, 9))
    assert final["state"] == "failed"
    assert "第4题" in final["error"]


@pytest.mark.asyncio
async def test_extract_completion_uses_current_column_total_not_initial_page_count(store, tmp_path):
    paper = store.create_paper("页数转列数进度回归", [])
    job = store.create_job(paper["id"], None, "extract", {"total": 2})
    job = store.claim_job()
    runner = JobRunner(store, SimpleNamespace(require_key=lambda: None), SimpleNamespace(data_dir=tmp_path))

    async def controlled_extraction(current_job):
        store.update_job(current_job["id"], current_job["lease"], totalUnits=6, completedUnits=6, stage="extracting")

    runner.extract = controlled_extraction
    await runner.process(job)
    finished = store.job(job["id"])
    assert finished["state"] == "succeeded"
    assert finished["totalUnits"] == 6
    assert finished["completedUnits"] == 6
