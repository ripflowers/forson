import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

import psycopg
from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse

from .config import ROOT, Settings
from .jobs import DATA_SYSTEM, JobRunner
from .media import MAX_BYTES, save_uploads
from .models import AskRequest, EventRequest, LessonRequest, PatchQuestion, SessionRequest
from .motion_resources import MotionPackInput, MotionResourceStore
from .paper_resources import paper_scene_context
from .narration import NarrationRequest, NarrationStore, NarrationUnavailable, content_hash, current_part
from .provider import AIError, AIUnavailable, Provider
from .rules import check_question
from .store import Conflict, Invalid, Missing, Store, uid
from .videos import VideoRequest, VideoRunner, VideoStore


def public_paper(paper):
    return {key: paper[key] for key in ("id", "title", "createdAt", "state", "questionCount", "partCount")} | {
        "pages": [{key: page[key] for key in ("index", "url", "width", "height")} for page in paper["pages"]]}


def scene_facts(part, snapshot):
    paper_context = paper_scene_context(part, snapshot)
    if paper_context is not None:
        return paper_context
    scene = part.get("scene")
    if not scene:
        return {}
    params = scene["params"]
    all_state = snapshot.get("sceneState", {})
    selected = all_state.get(part.get("partId"), all_state) if isinstance(all_state, dict) else {}
    state = {**selected, **{key: snapshot[key] for key in ("x", "a", "rows") if key in snapshot}}
    facts = {"kind": scene["kind"], "fixedParams": params}
    if scene["kind"] == "number-line":
        left, right = params["left"], params["right"]
        if params.get("parameterName") == "a" and isinstance(state.get("a"), (int, float)):
            if not -10 <= state["a"] <= 10:
                raise Invalid("现场参数a超出已支持范围")
            left = -state["a"]
            facts["a"] = state["a"]
        x = state.get("x")
        if x is not None:
            if not isinstance(x, (int, float)) or not -100 <= x <= 100:
                raise Invalid("现场数轴位置不合法")
            facts.update(x=x, distanceLeft=abs(x - left), distanceRight=abs(x - right), sum=abs(x - left) + abs(x - right))
        facts.update(left=left, right=right, minimum=abs(right - left), attainedInterval=[min(left, right), max(left, right)])
    else:
        lower, upper = params["lower"], params["upper"]
        facts.update(lower=lower, upper=upper, addedRows=list(range(lower + 1, upper + 1)),
                     difference=(upper * (upper + 1) - lower * (lower + 1)) // 2)
        rows = state.get("rows", params.get("previewRows", 6))
        growth = snapshot.get("teacherAnimation") is True and snapshot.get("teacherPhase") == "growth"
        original = snapshot.get("teacherAnimation") is True and snapshot.get("teacherPhase") == "original"
        if type(rows) is not int or (rows != upper if original else not (1 if growth else 2) <= rows <= 8):
            raise Invalid("原题点阵行数须与题面一致；成长须为1至8行，探索须为2至8行")
        facts["originalComparison"] = {"label": "原题比较，省略共同部分", "lower": lower, "upper": upper,
                                       "addedRows": list(range(lower + 1, upper + 1)), "difference": facts["difference"]}
        if original:
            facts["visibleOriginal"] = {"rows": upper, "visibleRowCounts": list(range(lower + 1, upper + 1)),
                                        "visiblePoints": facts["difference"], "commonPoints": lower * (lower + 1) // 2,
                                        "totalPoints": upper * (upper + 1) // 2}
        elif growth:
            facts["growth"] = {"label": "教师当前逐行成长的点阵，尚未进行相减比较", "rows": rows,
                               "totalPoints": rows * (rows + 1) // 2, "rowCounts": list(range(1, rows + 1))}
        else:
            facts["previewComparison"] = {"label": "当前可见小点阵示例，和原题层数分开", "rows": rows, "previousRows": rows - 2,
                                          "totalPoints": rows * (rows + 1) // 2, "sharedPoints": (rows - 2) * (rows - 1) // 2,
                                          "addedRows": [rows - 1, rows], "difference": rows * 2 - 1}
    return facts


def teaching_position(part, snapshot, step_id):
    steps = part["steps"]
    index = snapshot.get("stepIndex")
    if type(index) is not int or not 0 <= index <= len(steps) + 2:
        raise Invalid("追问需包含当前有效课堂片段位置，请重新加载课堂现场")
    current_step = steps[index - 2] if 2 <= index < len(steps) + 2 else None
    expected_id = current_step["id"] if current_step else None
    if step_id != expected_id:
        raise Invalid("追问的步骤编号与当前课堂片段不一致，请保留疑问并重新加载")
    slide = {"index": index, "partId": part["partId"]}
    if index == 0:
        slide.update(kind="read-known", title="读题与条件", goal=part["goal"], known=part["known"], prerequisites=part["prerequisites"])
    elif index == 1:
        slide.update(kind="method", title="选思路", method=part["method"])
    elif current_step:
        slide.update(kind="step", title=current_step["title"], stepId=current_step["id"])
    else:
        slide.update(kind="summary", title="检验与方法收束", answer=part["answer"], verification=part["verification"], misconceptions=part["misconceptions"], summary=part["summary"])
    return {"currentTeachingSlide": slide, "currentStep": current_step}


def create_app(*, start_worker=True):
    settings = Settings.from_environment()
    store = Store(settings.database_url)
    provider = Provider(settings)
    runner = JobRunner(store, provider, settings)
    video_store = VideoStore(settings.data_dir)
    video_runner = VideoRunner(video_store, ROOT)
    narration_store = NarrationStore(settings.data_dir)
    motion_store = MotionResourceStore(settings.data_dir)

    @asynccontextmanager
    async def lifespan(app):
        task = None
        try:
            store.initialize()
            if start_worker:
                task = asyncio.create_task(runner.dispatch())
        except psycopg.Error:
            # Health remains inspectable without exposing connection strings or passwords.
            pass
        if start_worker:
            video_runner.start()
        else:
            video_store.initialize()
        narration_store.initialize()
        motion_store.initialize()
        yield
        await video_runner.stop()
        await runner.stop()
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    app = FastAPI(title="知间真实核心流程", lifespan=lifespan)
    app.state.store = store
    app.state.video_store = video_store
    app.state.video_runner = video_runner
    app.state.narration = narration_store
    app.state.motion_resources = motion_store

    @app.exception_handler(Conflict)
    async def conflict_handler(request, exc):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(Invalid)
    async def invalid_handler(request, exc):
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.exception_handler(Missing)
    async def missing_handler(request, exc):
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(AIUnavailable)
    async def ai_unavailable_handler(request, exc):
        return JSONResponse(status_code=503, content={"detail": str(exc)})

    @app.exception_handler(AIError)
    async def ai_error_handler(request, exc):
        return JSONResponse(status_code=502, content={"detail": str(exc)})

    @app.exception_handler(NarrationUnavailable)
    async def narration_unavailable_handler(request, exc):
        return JSONResponse(status_code=503, content={"detail": str(exc)})

    @app.exception_handler(psycopg.Error)
    async def database_handler(request, exc):
        return JSONResponse(status_code=503, content={"detail": "本机数据库暂不可用，未宣称保存成功，请检查启动状态"})

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request, exc):
        fields = [".".join(str(x) for x in error["loc"]) for error in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": "请求格式不完整或不合法：" + "、".join(fields)})

    @app.get("/api/status")
    def status():
        return {"aiConfigured": bool(settings.api_key), "provider": "DeepSeek", "model": settings.model,
                "visionModel": settings.vision_model, "dbReady": store.ready(), "scope": "local-family"}

    @app.get("/api/papers")
    def papers():
        return {"items": [public_paper(p) for p in store.papers()]}

    def import_files(files, title, sample=False):
        pages, hashes = save_uploads(settings.data_dir, files, sample=sample)
        paper = store.create_paper(title, pages, sample=sample)
        paper = store.update_paper(paper["id"], {"sourceHashes": hashes})
        job = store.create_job(paper["id"], None, "extract", {"total": len(pages)})
        if not settings.api_key:
            error = "原图已保存。尚未在本机 .env 配置 DEEPSEEK_API_KEY；不会生成模拟题面或教案。配置并重启后可重试此任务。"
            store.update_job(job["id"], None, state="failed", stage="configuration", error=error)
            job = store.job(job["id"])
            paper = store.update_paper(paper["id"], {"state": "extraction_failed"})
        return {"paper": public_paper(paper), "job": job}

    @app.post("/api/papers")
    async def upload(files: list[UploadFile] = File(..., alias="files[]"), title: str = Form("我的试卷")):
        if not 1 <= len(files) <= 10:
            raise Invalid("本批最多10张图片或一份PDF，不会静默截断文件")
        content = []
        total = 0
        for file in files:
            raw = await file.read(MAX_BYTES + 1)
            total += len(raw)
            if total > MAX_BYTES:
                raise Invalid("本批超过100MB，请分批上传")
            content.append((file.filename or "image.jpg", raw))
        return import_files(content, title)

    @app.post("/api/sample-import")
    def sample_import():
        names = [settings.data_dir / "sample-images" / f"page-{index}.jpg" for index in (1, 2)]
        if not all(path.exists() for path in names):
            raise Missing("两张样卷原照未找到，请选择原图上传")
        return import_files([(path.name, path.read_bytes()) for path in names], "重难题型卷（一）·有理数及其运算", sample=True)

    @app.get("/api/media/{folder}/{filename}")
    def media(folder: str, filename: str):
        root = (settings.data_dir / "imports").resolve()
        path = (root / folder / filename).resolve()
        if not path.is_relative_to(root) or not filename.startswith("page-") or path.suffix != ".jpg" or not path.exists():
            raise Missing("原图不存在")
        return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, no-store"})

    @app.get("/api/papers/{paper_id}")
    def paper(paper_id: str):
        return {"paper": public_paper(store.paper(paper_id)), "questions": store.questions(paper_id), **{"coverage": store.coverage(paper_id)["coverage"]}}

    @app.patch("/api/questions/{question_id}")
    def patch_question(question_id: str, request: PatchQuestion):
        patch = request.model_dump(exclude_none=True, exclude={"expectedRevision"})
        return {"question": store.update_question(question_id, request.expectedRevision, patch)}

    @app.post("/api/papers/{paper_id}/confirm-all")
    def confirm_all(paper_id: str):
        store.paper(paper_id)
        questions = store.confirm_all(paper_id)
        return {"questions": questions, "coverage": store.coverage(paper_id)["coverage"]}

    @app.post("/api/questions/{question_id}/lesson")
    def generate_lesson(question_id: str, request: LessonRequest):
        q = store.question(question_id)
        if q["revision"] != request.expectedRevision:
            raise Conflict("题面已更新，请按当前版本准备课程")
        if check_question(q):
            raise Invalid("题面缺项：" + "；".join(check_question(q)))
        if q["state"] != "confirmed":
            raise Conflict("请先核对并确认题面，不能从未确认题面开课")
        provider.require_key()
        return {"job": store.create_job(q["paperId"], q["id"], "lesson", {"revision": q["revision"]})}

    @app.post("/api/papers/{paper_id}/lessons")
    def generate_lessons(paper_id: str):
        store.paper(paper_id)
        targets = [{"id": q["id"], "revision": q["revision"]} for q in store.questions(paper_id) if q["state"] == "confirmed" and not check_question(q)]
        if not targets:
            raise Conflict("当前没有已确认且条件完整的题目")
        provider.require_key()
        return {"job": store.create_job(paper_id, None, "lessons", {"questions": targets, "total": len(targets)})}

    @app.get("/api/questions/{question_id}/lesson")
    def lesson(question_id: str):
        return {"lesson": store.lesson(question_id)}

    @app.post("/api/questions/{question_id}/videos")
    def export_video(question_id: str, request: VideoRequest):
        narration = narration_store.get(request.narrationId) if request.narrationId else None
        motion_pack = motion_store.get(request.motionPackId) if request.motionPackId else None
        return {"video": video_store.create(store.question(question_id), store.lesson(question_id), request,
                                           narration, narration_store.clip_path, motion_pack)}

    @app.get("/api/questions/{question_id}/motion-resource")
    def current_motion_resource(question_id: str, lessonVersion: int = Query(ge=1),
                                partId: str = Query(default="main", min_length=1, max_length=80)):
        return {"motionPack": motion_store.current(store.question(question_id), store.lesson(question_id), lessonVersion, partId)}

    @app.get("/api/questions/{question_id}/teaching-context")
    def teaching_context(question_id: str, lessonVersion: int = Query(ge=1),
                         partId: str = Query(default="main", min_length=1, max_length=80)):
        return motion_store.context(store.question(question_id), store.lesson(question_id), lessonVersion, partId)

    @app.post("/api/questions/{question_id}/motion-resources")
    def import_motion_resource(question_id: str, request: MotionPackInput):
        return {"motionPack": motion_store.create(store.question(question_id), store.lesson(question_id), request)}

    @app.get("/api/motion-resources/{pack_id}")
    def motion_resource(pack_id: str):
        return {"motionPack": motion_store.get(pack_id)}

    @app.get("/api/videos/{video_id}")
    def video(video_id: str):
        return {"video": video_store.get(video_id)}

    @app.get("/api/videos/{video_id}/file")
    def video_file(video_id: str):
        exported = video_store.get(video_id)
        filename = f"lesson-r{exported['questionRevision']}-v{exported['lessonVersion']}.mp4"
        return FileResponse(video_store.file(video_id), media_type="video/mp4", filename=filename,
                            headers={"Cache-Control": "private, no-store"})

    @app.get("/api/jobs/{job_id}")
    def job(job_id: str):
        return {"job": store.job(job_id)}

    @app.post("/api/jobs/{job_id}/cancel")
    def cancel(job_id: str):
        return {"job": store.cancel_job(job_id)}

    @app.post("/api/jobs/{job_id}/retry")
    def retry(job_id: str):
        original = store.job(job_id, internal=True)
        if original["state"] not in {"failed", "cancelled"}:
            raise Conflict("只有失败或已取消的任务可以重试")
        provider.require_key()
        payload = dict(original["payload"])
        if original["type"] == "lesson":
            q = store.question(original["questionId"])
            if q["state"] != "confirmed" or q["revision"] != payload["revision"] or check_question(q):
                raise Conflict("原任务对应旧题面或条件不完整，请先校对并从当前题准备课程")
        if original["type"] == "lessons":
            payload["questions"] = [{"id": q["id"], "revision": q["revision"]} for q in store.questions(original["paperId"]) if q["state"] == "confirmed" and not check_question(q)]
            payload["total"] = len(payload["questions"])
            if not payload["total"]:
                raise Conflict("当前没有已确认完整题")
        return {"job": store.create_job(original["paperId"], original["questionId"], original["type"], payload)}

    @app.get("/api/papers/{paper_id}/coverage")
    def coverage(paper_id: str):
        store.paper(paper_id)
        return store.coverage(paper_id)

    @app.get("/api/records")
    def records(paperId: str | None = None):
        return {"items": store.events(paperId)}

    @app.post("/api/events")
    def event(request: EventRequest):
        return {"event": store.add_event(request.model_dump())}

    @app.get("/api/sessions/{question_id}")
    def session(question_id: str):
        return {"session": store.session(question_id)}

    @app.put("/api/sessions/{question_id}")
    def save_session(question_id: str, request: SessionRequest):
        if request.questionId and request.questionId != question_id:
            raise Invalid("课堂题目与路径不一致")
        payload = request.model_dump(exclude={"expectedSessionRevision", "questionId"})
        return {"session": store.save_session(question_id, request.expectedSessionRevision, payload)}

    @app.post("/api/questions/{question_id}/ask")
    async def ask(question_id: str, request: AskRequest):
        q = store.question(question_id)
        current_lesson = store.lesson(question_id)
        if q["revision"] != request.questionRevision or not current_lesson or current_lesson["lessonVersion"] != request.lessonVersion or current_lesson["status"] != "ready":
            raise Conflict("课堂内容已有新版本，请保留追问草稿并重新加载")
        part = next((p for p in current_lesson["parts"] if p["partId"] == request.partId), None)
        if part is None or (request.stepId and request.stepId not in {step["id"] for step in part["steps"]}):
            raise Invalid("追问引用的小问或步骤不属于当前课")
        if len(json.dumps(request.snapshot)) > 30000:
            raise Invalid("课堂现场过大，请只提交当前场景和草稿")
        position = teaching_position(part, request.snapshot, request.stepId)
        facts = scene_facts(part, request.snapshot)
        context = {"question": q, "part": part, "mode": request.mode, "snapshot": {key: value for key, value in request.snapshot.items() if key != "paperFacts"}, "computedSceneFacts": facts, "learnerQuestion": request.text, **position}
        evidence_dir = settings.data_dir / "runtime" / "evidence" / ("ask-" + uid())
        answer = ""
        checked = False
        evidence = {"stepId": request.stepId, "snapshot": request.snapshot, "computedSceneFacts": facts, "review": None, **position}
        try:
            raw = await asyncio.wait_for(provider.json(prompt="回答这个孩子的追问，绑定给定现场，不改变原题条件。围绕currentTeachingSlide与currentStep标明的当前片段解释；currentStep=null表示读题、选思路或收束，不能当成第一条计算步骤。图中的数值必须遵守computedSceneFacts；改数字举例明确说是另一例。不确定或缺条件就说明并给补全动作，不能猜。老师先接住问题，再解释关键原因，用初中表达。输出JSON {answer:完整答复,claims:[{id:唯一编号,statement:需要核验的数学断言}]}。\n课堂上下文：" + json.dumps(context, ensure_ascii=False), model=settings.model, system=DATA_SYSTEM, evidence_dir=evidence_dir, name="answer", interactive=True), timeout=45)
            answer = raw.get("answer", "")
            claims = raw.get("claims", [])
            review = await asyncio.wait_for(provider.json(prompt="作为独立审核员，逐断言核验下面追问答复是否符合题设、当前现场计算和初中数学。不得自己补缺失理由后称原回答正确。输出JSON {reasoningCorrect:boolean,claims:[{id:对应原id,supported:boolean,evidence:具体理由,issue:问题或空字符串}]}。\n上下文：" + json.dumps(context, ensure_ascii=False) + "\n待审答复：" + json.dumps(raw, ensure_ascii=False), model=settings.review_model, system=DATA_SYSTEM, evidence_dir=evidence_dir, name="answer-review", interactive=True), timeout=45)
            items = review.get("claims", [])
            ids = [claim.get("id") for claim in claims]
            checked = bool(answer) and bool(claims) and len(ids) == len(set(ids)) and review.get("reasoningCorrect") is True and len(items) == len(claims) and {item.get("id") for item in items} == set(ids) and all(item.get("supported") is True and item.get("evidence") and not item.get("issue") for item in items)
            evidence["review"] = review
        except asyncio.TimeoutError:
            answer = "追问已保留，AI 响应超时；主课保持暂停，暂未产生已核验答复，请稍后重试答疑。"
            evidence["responseTimeout"] = True
            evidence["timeoutSeconds"] = 45
        except (AIError, AIUnavailable) as exc:
            answer = "追问已保留，回答暂未完成核验：" + str(exc)
        # Do not publish an old response after the question changed during its two AI calls.
        latest = store.question(question_id)
        latest_lesson = store.lesson(question_id)
        if latest["revision"] != request.questionRevision or not latest_lesson or latest_lesson["lessonVersion"] != request.lessonVersion or latest_lesson["status"] != "ready":
            checked = False
            evidence["versionIssue"] = "提问后课程或题面已变化，保留为历史答复，不能用于当前授课"
        return store.save_ask(question_id, {**request.model_dump(), "answer": answer or "回答结构不完整，已保留原话待复核", "status": "checked" if checked else "needs_review", "evidence": evidence})

    @app.get("/api/questions/{question_id}/asks")
    def asks(question_id: str):
        return {"items": store.asks(question_id)}

    def verify_narration_current(question_id, request, manifest):
        latest = store.question(question_id)
        lesson = store.lesson(question_id)
        part = current_part(latest, lesson, request)
        if content_hash(part) != manifest["lessonHash"]:
            raise Conflict("配音准备期间教案内容已变化，请重新准备当前课堂配音")

    @app.get("/api/questions/{question_id}/narration")
    def current_narration(question_id: str, lessonVersion: int = Query(ge=1),
                          partId: str = Query(default="main", min_length=1, max_length=80)):
        question = store.question(question_id)
        request = NarrationRequest(expectedRevision=question["revision"], lessonVersion=lessonVersion, partId=partId)
        return {"narration": narration_store.get_current(question, store.lesson(question_id), request)}

    @app.post("/api/questions/{question_id}/narration")
    async def prepare_narration(question_id: str, request: NarrationRequest):
        manifest = await narration_store.prepare(store.question(question_id), store.lesson(question_id), request)
        verify_narration_current(question_id, request, manifest)
        return {"narration": manifest}

    @app.get("/api/narration/{narration_id}/clips/{clip_id}.mp3")
    def narration_clip(narration_id: str, clip_id: str):
        return FileResponse(narration_store.clip_path(narration_id, clip_id), media_type="audio/mpeg",
                            headers={"Cache-Control": "private, no-store"})

    @app.post("/api/questions/{question_id}/asks/{ask_id}/narration")
    async def prepare_answer_narration(question_id: str, ask_id: str, request: NarrationRequest):
        manifest = await narration_store.prepare_answer(store.question(question_id), store.lesson(question_id), request,
                                                        store.asks(question_id), ask_id)
        verify_narration_current(question_id, request, manifest)
        latest_ask = next((item for item in store.asks(question_id) if item.get("id") == ask_id), None)
        if (not latest_ask or latest_ask.get("status") != "checked"
                or content_hash(latest_ask.get("answer")) != manifest["answerHash"]):
            raise Conflict("配音准备期间答复内容或核验状态已变化，请重新加载答复")
        return {"narration": manifest}

    return app


app = create_app()
