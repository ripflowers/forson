"""Version-bound, private speech assets measured from real synthesized MP3s."""
import asyncio
import hashlib
import json
import math
import re
import shutil
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import edge_tts
from pydantic import BaseModel, ConfigDict, Field

from .q26_narration import build_q26_script
from .store import Conflict, Invalid, Missing, now, uid
from .videos import approved_part, write_json


VOICE = "zh-CN-XiaoxiaoNeural"
RATE = "-8%"
FPS = 30
SCRIPT_VERSION = "q26-teacher-voice-2"
CLIP_PAUSE_FRAMES = 12
STAGE_PAUSE_FRAMES = 30


class NarrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRevision: int = Field(strict=True, ge=1)
    lessonVersion: int = Field(strict=True, ge=1)
    partId: str = Field(min_length=1, max_length=80)


class NarrationUnavailable(Exception):
    pass


def content_hash(value):
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()


def current_part(question, lesson, request):
    if question["revision"] != request.expectedRevision:
        raise Conflict("题面已有新版本，请重新加载后准备配音")
    if question["state"] != "confirmed" or question.get("missingFields"):
        raise Invalid("题面未确认或条件缺失，不能准备老师配音")
    if not lesson or lesson["status"] != "ready":
        raise Invalid("只能为已核验、当前就绪的老师讲解准备配音")
    if not all(lesson.get("checks", {}).get(key) is True for key in
               ("inputConfirmed", "coverage", "answerVerified", "reasoningReviewed")):
        raise Invalid("老师讲解尚未通过全部核验，不能准备配音")
    if (lesson["questionId"] != question["id"] or lesson["questionRevision"] != question["revision"]
            or lesson["lessonVersion"] != request.lessonVersion):
        raise Conflict("教案已有新版本，请重新加载后准备配音")
    matches = [part for part in lesson["parts"] if part["partId"] == request.partId]
    if (request.partId not in {part["id"] for part in question["parts"]}
            or request.partId not in lesson["coveredPartIds"] or len(matches) != 1):
        raise Invalid("此小问尚无完整、已核验的老师讲解")
    try:
        part = approved_part(matches[0])
        if not part["steps"]:
            raise ValueError()
        # The first acceptance lesson is deliberately scoped to this verified question.
        build_q26_script(part)
    except (KeyError, TypeError, ValueError):
        raise Invalid("当前配音仅支持已核验的第26题三角形数课堂，请先核对教案") from None
    return part


def spoken_answer(text):
    """Explicit small Q26 math vocabulary; unknown LaTeX never silently gets read."""
    if not isinstance(text, str) or not text.strip() or len(text) > 8000:
        raise Invalid("核验答复没有可用的口述内容")
    text = re.sub(r"\\\((.*?)\\\)", r"\1", text, flags=re.S)
    text = re.sub(r"\\\[(.*?)\\\]", r"\1", text, flags=re.S)
    text = re.sub(r"T_\{(\d+|n)\}|T_(\d+|n)(?![A-Za-z0-9])",
                  lambda m: "第" + (m[1] or m[2]).replace("n", "恩") + "个三角形数", text)
    text = text.replace(r"\cdots", "，依此类推，").replace(r"\ldots", "，依此类推，")
    text = text.replace(r"\left", "").replace(r"\right", "")
    for _ in range(4):
        text, changes = re.subn(r"\\frac\{([^{}]+)\}\{([^{}]+)\}", r"(\1)除以(\2)", text)
        if not changes:
            break
    for source, target in ((r"\times", "乘"), (r"\cdot", "乘"), (r"\div", "除以"),
                           (r"\geq", "大于或等于"), (r"\leq", "小于或等于"),
                           (r"\ge", "大于或等于"), (r"\le", "小于或等于"), (r"\neq", "不等于")):
        text = text.replace(source, target)
    if "\\" in text or "{" in text or "}" in text or re.search(r"[_^]", text):
        raise Invalid("答复含尚未支持的数学口述符号，已保留文字，请先核对后配音")
    text = re.sub(r"(?<=[0-9)\]数])\s*[-−]\s*(?=[0-9(第])", "减", text)
    text = text.translate(str.maketrans({"+": "加", "=": "等于", "×": "乘", "÷": "除以", "<": "小于", ">": "大于"}))
    text = re.sub(r"(?<![A-Za-z])n(?![A-Za-z])", "恩", text)
    text = text.replace("$", "").replace("`", "").replace("**", "").replace("#", "")
    return re.sub(r"\s+", " ", text).strip()


async def audio_frames(path, fps=FPS):
    probe = shutil.which("ffprobe")
    if not probe:
        raise NarrationUnavailable("本机音频时长工具不可用，未发布配音，请安装 ffprobe 后重试")
    process = await asyncio.create_subprocess_exec(
        probe, "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", str(path),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
    try:
        raw, _ = await asyncio.wait_for(process.communicate(), timeout=15)
        value = json.loads(raw)
        duration = float(value["format"]["duration"])
        if process.returncode != 0 or not math.isfinite(duration) or not 0 < duration <= 180:
            raise ValueError()
        if not any(stream.get("codec_type") == "audio" for stream in value.get("streams", [])):
            raise ValueError()
        return math.ceil(Decimal(value["format"]["duration"]) * fps)
    except (ValueError, KeyError, TypeError, asyncio.TimeoutError):
        raise NarrationUnavailable("配音文件未通过音频时长核验，未发布课堂配音，请重试") from None
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()


class NarrationStore:
    def __init__(self, data_dir):
        self.root = (Path(data_dir) / "runtime" / "narration").resolve()
        self.lock = asyncio.Lock()

    def initialize(self):
        self.root.mkdir(parents=True, exist_ok=True)
        self.root.chmod(0o700)
        for path in self.root.glob("*/narration.json"):
            try:
                manifest = self._read(path.parent.name)
            except Missing:
                continue
            if manifest["state"] == "preparing":
                manifest.update(state="failed", error="上次配音准备被中断，请重新准备")
                write_json(path, manifest)

    def directory(self, narration_id):
        try:
            if str(UUID(narration_id)) != narration_id:
                raise ValueError()
        except (ValueError, TypeError, AttributeError):
            raise Missing("老师配音不存在") from None
        path = self.root / narration_id
        if path.resolve() != path or not path.is_relative_to(self.root):
            raise Missing("老师配音不存在")
        return path

    def _read(self, narration_id):
        try:
            value = json.loads((self.directory(narration_id) / "narration.json").read_text())
            if value["id"] != narration_id or value["state"] not in {"preparing", "ready", "failed"}:
                raise ValueError()
            return value
        except (OSError, ValueError, KeyError, TypeError):
            raise Missing("老师配音不存在或记录不完整") from None

    def _cached(self, cache_key):
        for path in self.root.glob("*/narration.json"):
            try:
                manifest = self._read(path.parent.name)
                if manifest["state"] == "ready" and manifest.get("cacheKey") == cache_key:
                    keys = ("questionId", "questionRevision", "lessonVersion", "partId", "lessonHash", "voice", "rate", "scriptVersion", "fps")
                    identity = {key: manifest[key] for key in keys}
                    if manifest.get("askId"):
                        identity.update(askId=manifest["askId"], answerHash=manifest["answerHash"])
                    if content_hash(identity) != cache_key:
                        continue
                    if manifest["clips"] and all(hashlib.sha256(self.file(manifest["id"], clip["id"]).read_bytes()).hexdigest()
                                                 == clip["audioHash"] for clip in manifest["clips"]):
                        return manifest
            except (Missing, KeyError, OSError):
                continue
        return None

    def _identity(self, question, lesson, request, part, ask=None):
        identity = {"questionId": question["id"], "questionRevision": question["revision"],
                    "lessonVersion": lesson["lessonVersion"], "partId": request.partId,
                    "lessonHash": content_hash(part), "voice": VOICE, "rate": RATE,
                    "scriptVersion": SCRIPT_VERSION, "fps": FPS}
        if ask:
            identity.update(askId=ask["id"], answerHash=content_hash(ask["answer"]))
        return identity

    @staticmethod
    def public(manifest):
        result = {key: value for key, value in manifest.items() if key not in {"cacheKey", "errorType"}}
        result["clips"] = [{**clip, "audioUrl": f"/api/narration/{manifest['id']}/clips/{clip['id']}.mp3"}
                           for clip in manifest.get("clips", [])]
        return result

    def get(self, narration_id):
        return self.public(self._read(narration_id))

    def clip_path(self, narration_id, clip_id):
        return self.file(narration_id, clip_id)

    def get_current(self, question, lesson, request):
        part = current_part(question, lesson, request)
        identity = self._identity(question, lesson, request, part)
        result = self._cached(content_hash(identity))
        return self.public(result) if result else None

    async def prepare(self, question, lesson, request):
        part = current_part(question, lesson, request)
        identity = self._identity(question, lesson, request, part)
        return await self._prepare(identity, build_q26_script(part))

    async def prepare_answer(self, question, lesson, request, asks, ask_id):
        part = current_part(question, lesson, request)
        ask = next((item for item in asks if item.get("id") == ask_id), None)
        if ask is None or ask.get("questionId") != question["id"]:
            raise Missing("此题的核验答复不存在")
        if (ask.get("questionRevision") != question["revision"] or ask.get("lessonVersion") != lesson["lessonVersion"]
                or ask.get("partId") != request.partId):
            raise Conflict("答复不属于当前题面、教案或小问，请重新加载")
        if ask.get("status") != "checked":
            raise Invalid("答复尚未通过核验，不能作为老师配音播放")
        text = spoken_answer(ask.get("answer"))
        identity = self._identity(question, lesson, request, part, ask)
        return await self._prepare(identity, [{"stageIndex": 0, "clips": [{"text": text, "visualFrom": 0, "visualTo": 0}]}])

    async def _synthesize(self, text, path):
        await asyncio.wait_for(edge_tts.Communicate(text, VOICE, rate=RATE).save(str(path)), timeout=45)
        path.chmod(0o600)
        return await audio_frames(path)

    async def _prepare(self, identity, stages):
        async with self.lock:
            cache_key = content_hash(identity)
            cached = self._cached(cache_key)
            if cached:
                return self.public(cached)
            narration_id = uid()
            directory = self.directory(narration_id)
            directory.mkdir(mode=0o700)
            manifest = {"id": narration_id, **identity, "state": "preparing", "cacheKey": cache_key,
                        "createdAt": now(), "clips": [], "stageDurations": [], "durationInFrames": 0}
            write_json(directory / "narration.json", manifest)
            semaphore = asyncio.Semaphore(2)
            sources = [(stage_index, clip) for stage_index, stage in enumerate(stages) for clip in stage["clips"]]
            if not sources:
                raise Invalid("老师口述脚本为空，未发布配音")

            async def synthesize(index, source):
                stage_index, clip = source
                clip_id = f"clip-{index + 1:03d}"
                async with semaphore:
                    measured_frames = await self._synthesize(clip["text"], directory / f"{clip_id}.mp3")
                if type(measured_frames) is not int or measured_frames < 1:
                    raise NarrationUnavailable("配音时长核验失败，未发布课堂配音")
                return {"id": clip_id, "stageIndex": stage_index, "text": clip["text"], "audioFrames": measured_frames,
                        "durationInFrames": measured_frames + CLIP_PAUSE_FRAMES,
                        "audioHash": hashlib.sha256((directory / f"{clip_id}.mp3").read_bytes()).hexdigest(),
                        "audioUrl": f"/api/narration/{narration_id}/clips/{clip_id}.mp3",
                        "visualFrom": clip["visualFrom"], "visualTo": clip["visualTo"]}

            tasks = [asyncio.create_task(synthesize(index, source)) for index, source in enumerate(sources)]
            try:
                clips = await asyncio.gather(*tasks)
                offset = 0
                for stage_index in range(len(stages)):
                    stage_start = offset
                    for clip in clips:
                        if clip["stageIndex"] == stage_index:
                            clip["from"] = offset
                            offset += clip["durationInFrames"]
                    offset += STAGE_PAUSE_FRAMES
                    manifest["stageDurations"].append(offset - stage_start)
                manifest.update(state="ready", clips=clips, durationInFrames=offset)
                write_json(directory / "narration.json", manifest)
                return self.public(manifest)
            except (Exception, asyncio.CancelledError) as exc:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                manifest.update(state="failed", error="真实配音准备失败，未发布缺失音频的课堂，请检查语音网络后重试")
                write_json(directory / "narration.json", manifest)
                write_json(directory / "diagnostics.json", {"stage": "speech-and-duration", "errorType": type(exc).__name__, "createdAt": now()})
                if isinstance(exc, asyncio.CancelledError):
                    raise
                if isinstance(exc, NarrationUnavailable):
                    raise
                raise NarrationUnavailable(manifest["error"]) from None

    def file(self, narration_id, clip_id):
        if not re.fullmatch(r"clip-\d{3}", clip_id):
            raise Missing("老师配音片段不存在")
        manifest = self._read(narration_id)
        if manifest["state"] != "ready" or clip_id not in {clip["id"] for clip in manifest.get("clips", [])}:
            raise Missing("老师配音片段尚未准备完成")
        path = self.directory(narration_id) / f"{clip_id}.mp3"
        if not path.is_file() or path.resolve().parent != self.directory(narration_id):
            raise Missing("老师配音片段不存在")
        return path
