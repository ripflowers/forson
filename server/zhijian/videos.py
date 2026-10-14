"""Private, versioned local Remotion exports; independent of AI generation jobs."""
import asyncio
import hashlib
import json
import math
import os
import shutil
import signal
import threading
from pathlib import Path
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from .store import Conflict, Invalid, Missing, now, uid


class VideoRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRevision: int = Field(strict=True, ge=1)
    lessonVersion: int = Field(strict=True, ge=1)
    partId: str = Field(min_length=1, max_length=80)
    pace: int = Field(default=1, strict=True, ge=1, le=2)


def write_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    temporary.chmod(0o600)
    temporary.replace(path)


def approved_part(part):
    """Export teaching content only, never user notes, media, or extra model keys."""
    fields = ("partId", "label", "goal", "known", "prerequisites", "method", "verification", "summary")
    output = {key: part[key] for key in fields}
    output["steps"] = [{key: step[key] for key in ("id", "title", "explanation", "reason", "formulaLatex")}
                       for step in part["steps"]]
    output["answer"] = {key: part["answer"][key] for key in ("kind", "value", "display")}
    output["misconceptions"] = [{key: item[key] for key in ("mistake", "correction")} for item in part["misconceptions"]]
    scene = part.get("scene")
    output["scene"] = None
    if scene and scene.get("kind") in {"number-line", "triangle-count"}:
        keys = ("left", "right", "parameterName", "parameterValue", "targetSum", "targetMinimum") if scene["kind"] == "number-line" else ("lower", "upper", "previewRows")
        output["scene"] = {"kind": scene["kind"], "params": {key: scene["params"][key] for key in keys if key in scene["params"]}}
    return output


class VideoStore:
    def __init__(self, data_dir):
        self.root = (Path(data_dir) / "runtime" / "videos").resolve()
        self.lock = threading.RLock()

    def initialize(self):
        self.root.mkdir(parents=True, exist_ok=True)
        self.root.chmod(0o700)
        # A process from a previous server run cannot publish a successful export.
        for path in self.root.glob("*/video.json"):
            try:
                video = self._read(path.parent.name)
            except Missing:
                continue
            if video["state"] == "rendering":
                self.update(video["id"], state="failed", error="上次导出被中断，请重新导出；原课堂内容已保留")
            elif video["state"] == "ready" and not (path.parent / "lesson.mp4").is_file():
                self.update(video["id"], state="failed", error="导出文件已不在本机，请重新导出")

    def directory(self, video_id):
        try:
            if str(UUID(video_id)) != video_id:
                raise ValueError()
        except (ValueError, TypeError, AttributeError):
            raise Missing("教学视频不存在") from None
        path = self.root / video_id
        if path.resolve() != path or not path.is_relative_to(self.root):
            raise Missing("教学视频不存在")
        return path

    def _read(self, video_id):
        path = self.directory(video_id) / "video.json"
        try:
            video = json.loads(path.read_text())
            if video["id"] != video_id or video["state"] not in {"queued", "rendering", "ready", "failed"}:
                raise ValueError()
            return video
        except (OSError, ValueError, KeyError, TypeError):
            raise Missing("教学视频不存在或记录不完整") from None

    def create(self, question, lesson, request: VideoRequest):
        if question["revision"] != request.expectedRevision:
            raise Conflict("题面已有新版本，请重新加载后导出")
        if question["state"] != "confirmed" or question.get("missingFields"):
            raise Invalid("题面未确认或条件缺失，不能导出讲解视频")
        if not lesson or lesson["status"] != "ready":
            raise Invalid("只能导出已核验、当前就绪的老师讲解")
        if not all(lesson.get("checks", {}).get(key) is True for key in
                   ("inputConfirmed", "coverage", "answerVerified", "reasoningReviewed")):
            raise Invalid("老师讲解尚未通过全部核验，不能导出")
        if (lesson["questionId"] != question["id"] or lesson["questionRevision"] != question["revision"]
                or lesson["lessonVersion"] != request.lessonVersion):
            raise Conflict("教案已有新版本，请重新加载后导出")
        matches = [part for part in lesson["parts"] if part["partId"] == request.partId]
        if (request.partId not in {part["id"] for part in question["parts"]}
                or request.partId not in lesson["coveredPartIds"] or len(matches) != 1):
            raise Invalid("此小问尚无完整、已核验的老师讲解")
        try:
            part = approved_part(matches[0])
            if not part["steps"]:
                raise ValueError()
        except (KeyError, TypeError, ValueError):
            raise Invalid("老师讲解内容不完整，不能导出") from None
        snapshot = {"questionId": question["id"], "questionRevision": question["revision"],
                    "lessonVersion": lesson["lessonVersion"], "partId": request.partId,
                    "inputProps": {"part": part, "pace": request.pace, "canvasOnly": False, "reducedMotion": False}}
        # Round-trip provides an immutable JSON snapshot rather than references to caller data.
        serialized = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        snapshot = json.loads(serialized)
        video = {"id": uid(), "state": "queued", "progress": 0, "stage": "queued", "error": None,
                 "questionId": question["id"], "questionRevision": question["revision"],
                 "lessonVersion": lesson["lessonVersion"], "partId": request.partId, "pace": request.pace,
                 "snapshotHash": hashlib.sha256(serialized.encode()).hexdigest(), "createdAt": now(),
                 "width": 1280, "height": 720, "hasAudio": False}
        with self.lock:
            folder = self.directory(video["id"])
            folder.mkdir(mode=0o700)
            write_json(folder / "snapshot.json", snapshot)
            write_json(folder / "video.json", video)
        return self.get(video["id"])

    def get(self, video_id):
        with self.lock:
            video = self._read(video_id)
            if video["state"] == "rendering":
                try:
                    progress = json.loads((self.directory(video_id) / "progress.json").read_text())
                    value = progress.get("progress")
                    if type(value) in {int, float} and math.isfinite(value):
                        video["progress"] = max(0, min(99, int(value)))
                    if progress.get("stage") in {"bundling", "browser", "composition", "rendering", "encoding"}:
                        video["stage"] = progress["stage"]
                except (OSError, ValueError, TypeError):
                    pass
            if video["state"] == "ready":
                video["url"] = f"/api/videos/{video_id}/file"
            return video

    def update(self, video_id, **changes):
        with self.lock:
            video = self._read(video_id)
            video.update(changes, updatedAt=now())
            write_json(self.directory(video_id) / "video.json", video)

    def next_queued(self):
        with self.lock:
            videos = []
            for path in self.root.glob("*/video.json"):
                try:
                    video = self._read(path.parent.name)
                except Missing:
                    continue
                if video["state"] == "queued":
                    videos.append(video)
            return min(videos, key=lambda video: video["createdAt"]) if videos else None

    def file(self, video_id):
        video = self.get(video_id)
        path = self.directory(video_id) / "lesson.mp4"
        if video["state"] != "ready" or not path.is_file() or path.resolve().parent != self.directory(video_id):
            raise Missing("教学视频尚未导出完成")
        return path


class VideoRunner:
    def __init__(self, store, project_root):
        self.store, self.project_root = store, Path(project_root).resolve()
        self.task = None
        self.process = None
        self.current_id = None

    def start(self):
        if self.task and not self.task.done():
            return
        self.store.initialize()
        self.task = asyncio.create_task(self.dispatch())

    async def dispatch(self):
        while True:
            video = self.store.next_queued()
            if not video:
                await asyncio.sleep(0.4)
                continue
            self.current_id = video["id"]
            self.store.update(video["id"], state="rendering", stage="bundling", error=None)
            try:
                metadata = await self._render(video["id"])
                self.store.update(video["id"], state="ready", stage="ready", progress=100, error=None, **metadata)
            except asyncio.CancelledError:
                self.store.update(video["id"], state="failed", error="导出被中断，请重新导出；原课堂内容已保留")
                raise
            except Exception:
                stage = self.store.get(video["id"])["stage"]
                labels = {"bundling": "课堂组件打包", "browser": "本机渲染浏览器准备", "composition": "课堂时间线读取",
                          "rendering": "课堂画面渲染", "encoding": "MP4编码"}
                self.store.update(video["id"], state="failed", stage=stage, error=labels.get(stage, "视频导出") + "失败，请检查本机视频运行环境后重新导出")
            finally:
                self.current_id = None

    async def _render(self, video_id):
        node = shutil.which("node")
        if not node:
            raise RuntimeError("Node unavailable")
        folder = self.store.directory(video_id)
        snapshot = json.loads((folder / "snapshot.json").read_text())
        serialized = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        if hashlib.sha256(serialized.encode()).hexdigest() != self.store.get(video_id)["snapshotHash"]:
            raise RuntimeError("Snapshot changed")
        # The renderer receives no .env, AI key, database credentials, or user's notes.
        environment = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR", "LANG", "LC_ALL") if key in os.environ}
        self.process = await asyncio.create_subprocess_exec(
            node, str(self.project_root / "scripts" / "render_lesson.mjs"), str(folder),
            cwd=self.project_root / "web", env=environment, stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL, start_new_session=True)
        try:
            code = await self.process.wait()
            if code != 0 or not (folder / "lesson.mp4").is_file() or (folder / "lesson.mp4").stat().st_size == 0:
                raise RuntimeError("Render failed")
            result = json.loads((folder / "progress.json").read_text())
            return {key: result[key] for key in ("durationSeconds", "fps", "frameCount", "width", "height")}
        finally:
            if self.process and self.process.returncode is not None:
                self.process = None

    async def stop(self):
        if self.task:
            self.task.cancel()
        if self.process and self.process.returncode is None:
            try:
                os.killpg(self.process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                await asyncio.wait_for(self.process.wait(), 5)
            except asyncio.TimeoutError:
                try:
                    os.killpg(self.process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                await self.process.wait()
        if self.task:
            await asyncio.gather(self.task, return_exceptions=True)
        self.process = None
