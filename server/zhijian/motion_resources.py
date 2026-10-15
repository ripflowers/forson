"""Codex-authored teaching visuals as bounded data, never executable code."""
import hashlib
import json
import re
import threading
from pathlib import Path
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from .store import Conflict, Invalid, Missing, now, uid
from .paper_resources import PAPER_TEMPLATES, matching_recipe


TRIANGLE_TEMPLATES = ("triangle-grow", "triangle-compare", "triangle-sum", "triangle-expand",
                      "triangle-cancel", "triangle-verify", "triangle-recap")


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class DataModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    @field_validator("*", mode="after")
    @classmethod
    def plain_text(cls, value):
        if isinstance(value, str):
            if not value.strip() or re.search(r"<\s*/?\s*[A-Za-z!][^>]*>|(?:https?|javascript|data|file):|(?:^|\s)/(?:Users|tmp|etc|var)/|[A-Za-z]:[\\/]", value, re.I):
                raise ValueError("教学资源只能包含非空文字，不接受HTML、网络地址或文件路径")
        return value


class MotionTarget(DataModel):
    questionId: str = Field(min_length=1, max_length=80)
    questionRevision: int = Field(ge=1)
    lessonVersion: int = Field(ge=1)
    partId: str = Field(min_length=1, max_length=80)
    lessonHash: str = Field(pattern=r"^[0-9a-f]{64}$")


class MotionConcept(DataModel):
    id: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=120)
    explanation: str = Field(min_length=1, max_length=2000)


class MotionStage(DataModel):
    stageIndex: int = Field(ge=0, le=31)
    template: str = Field(min_length=1, max_length=80)

    @field_validator("template")
    @classmethod
    def supported_template(cls, value):
        if value not in (*TRIANGLE_TEMPLATES, "distance-model") and value not in PAPER_TEMPLATES:
            raise ValueError("教学动画模板尚未审核支持")
        return value

    title: str = Field(min_length=1, max_length=160)
    conceptIds: list[str] = Field(min_length=1, max_length=16)
    focus: str = Field(min_length=1, max_length=500)
    explanation: str = Field(min_length=1, max_length=2000)

    @field_validator("conceptIds")
    @classmethod
    def bounded_references(cls, value):
        if any(not item.strip() or len(item) > 64 for item in value) or len(value) != len(set(value)):
            raise ValueError("知识点引用须唯一且使用有效编号")
        return value


class MotionPackInput(DataModel):
    schemaVersion: int = Field(ge=1, le=1)
    title: str = Field(min_length=1, max_length=160)
    subject: Literal["math"]
    author: Literal["Codex"]
    target: MotionTarget
    concepts: list[MotionConcept] = Field(min_length=1, max_length=16)
    stages: list[MotionStage] = Field(min_length=1, max_length=32)


def teaching_target(question, lesson, lesson_version, part_id, expected_revision=None):
    """The approved lesson supplies mathematical values; packs cannot overwrite them."""
    from .videos import approved_part

    if expected_revision is not None and question["revision"] != expected_revision:
        raise Conflict("资源包引用旧题面，请导出当前教学上下文后重新制作")
    if question["state"] != "confirmed" or question.get("missingFields"):
        raise Invalid("题面未确认或条件缺失，不能绑定教学资源")
    if not lesson or lesson["status"] != "ready" or not all(lesson.get("checks", {}).get(key) is True for key in
            ("inputConfirmed", "coverage", "answerVerified", "reasoningReviewed")):
        raise Invalid("只能为已通过全部核验的当前教案绑定教学资源")
    if (lesson["questionId"] != question["id"] or lesson["questionRevision"] != question["revision"]
            or lesson["lessonVersion"] != lesson_version):
        raise Conflict("资源包引用旧教案，请导出当前教学上下文后重新制作")
    matches = [part for part in lesson["parts"] if part["partId"] == part_id]
    if (part_id not in {part["id"] for part in question["parts"]} or part_id not in lesson["coveredPartIds"] or len(matches) != 1):
        raise Invalid("资源包引用的小问没有完整、已核验的当前教案")
    try:
        part = approved_part(matches[0])
        if not part["steps"] or len(part["steps"]) + 3 > 32:
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise Invalid("当前教案不完整或阶段数超出资源模板范围") from None
    target = {"questionId": question["id"], "questionRevision": question["revision"],
              "lessonVersion": lesson["lessonVersion"], "partId": part_id, "lessonHash": canonical_hash(part)}
    recipe = matching_recipe(target)
    if recipe:
        return part, target, [recipe["key"]] * (len(part["steps"]) + 3)
    scene = part.get("scene") or {}
    if scene.get("kind") == "triangle-count":
        params = scene["params"]
        if (type(params.get("lower")) is not int or type(params.get("upper")) is not int
                or (params["lower"], params["upper"]) != (22, 24) or len(part["steps"]) != 4):
            raise Invalid("三角形数模板当前仅适配第26题的七阶段课堂")
        templates = list(TRIANGLE_TEMPLATES)
    elif scene.get("kind") == "number-line":
        templates = ["distance-model"] * (len(part["steps"]) + 3)
    else:
        raise Invalid("当前教案尚无已支持的教学动画模板")
    target = {"questionId": question["id"], "questionRevision": question["revision"],
              "lessonVersion": lesson["lessonVersion"], "partId": part_id, "lessonHash": canonical_hash(part)}
    return part, target, templates


def check_stages(pack, templates):
    stages = pack["stages"]
    expected_indices = list(range(len(templates)))
    if sorted(stage["stageIndex"] for stage in stages) != expected_indices:
        raise Invalid("教学资源须逐一覆盖全部课堂阶段，阶段编号不能重复或缺失")
    concepts = [concept["id"] for concept in pack["concepts"]]
    if len(concepts) != len(set(concepts)):
        raise Invalid("教学资源的知识点编号不能重复")
    for stage in stages:
        if stage["template"] != templates[stage["stageIndex"]]:
            raise Invalid("教学资源模板与当前课堂阶段不匹配，不能改变已核验解题顺序")
        if not set(stage["conceptIds"]).issubset(set(concepts)):
            raise Invalid("课堂阶段引用了资源包中不存在的知识点")


def validate_motion_pack(pack, question, lesson, lesson_version, part_id):
    """Validate stored identity, integrity and current binding before video freezing."""
    try:
        metadata = {key: pack[key] for key in ("id", "createdAt", "packHash")}
        if str(UUID(metadata["id"])) != metadata["id"] or not isinstance(metadata["createdAt"], str):
            raise ValueError()
        data = MotionPackInput.model_validate({key: value for key, value in pack.items() if key not in metadata}).model_dump()
        expected_hash = canonical_hash({**data, "id": metadata["id"], "createdAt": metadata["createdAt"]})
        if metadata["packHash"] != expected_hash:
            raise ValueError()
    except (KeyError, ValueError, TypeError, AttributeError, ValidationError):
        raise Invalid("教学资源内容或校验摘要不完整，请重新导入原资源包") from None
    _, target, templates = teaching_target(question, lesson, lesson_version, part_id, data["target"]["questionRevision"])
    if data["target"] != target:
        raise Conflict("教学资源与当前题面、教案或内容摘要不一致，请重新导入当前资源")
    check_stages(data, templates)
    return {**data, **metadata}


class MotionResourceStore:
    def __init__(self, data_dir):
        self.root = (Path(data_dir) / "runtime" / "motion-resources").resolve()
        self.lock = threading.RLock()

    def initialize(self):
        self.root.mkdir(parents=True, exist_ok=True)
        self.root.chmod(0o700)

    def path(self, pack_id):
        try:
            if str(UUID(pack_id)) != pack_id:
                raise ValueError()
        except (ValueError, TypeError, AttributeError):
            raise Missing("教学资源包不存在") from None
        path = self.root / (pack_id + ".json")
        if path.resolve() != path or not path.is_relative_to(self.root):
            raise Missing("教学资源包不存在")
        return path

    def get(self, pack_id):
        try:
            pack = json.loads(self.path(pack_id).read_text())
            if pack["id"] != pack_id:
                raise ValueError()
            metadata = {key: pack[key] for key in ("id", "createdAt", "packHash")}
            data = MotionPackInput.model_validate({key: value for key, value in pack.items() if key not in metadata}).model_dump()
            if canonical_hash({**data, "id": metadata["id"], "createdAt": metadata["createdAt"]}) != metadata["packHash"]:
                raise ValueError()
            return {**data, **metadata}
        except (OSError, ValueError, TypeError, KeyError, ValidationError):
            raise Missing("教学资源包不存在或校验未通过，请重新导入") from None

    def create(self, question, lesson, request: MotionPackInput):
        from .videos import write_json

        data = request.model_dump()
        _, target, templates = teaching_target(question, lesson, data["target"]["lessonVersion"], data["target"]["partId"], data["target"]["questionRevision"])
        if data["target"] != target:
            raise Conflict("资源包与当前题面、教案或内容摘要不一致，请重新导出教学上下文")
        check_stages(data, templates)
        pack = {**data, "id": uid(), "createdAt": now()}
        pack["packHash"] = canonical_hash(pack)
        with self.lock:
            write_json(self.path(pack["id"]), pack)
        return json.loads(json.dumps(pack, ensure_ascii=False))

    def current(self, question, lesson, lesson_version, part_id):
        _, target, _ = teaching_target(question, lesson, lesson_version, part_id)
        with self.lock:
            matches = []
            for path in self.root.glob("*.json"):
                try:
                    pack = self.get(path.stem)
                    if pack["target"] == target:
                        validate_motion_pack(pack, question, lesson, lesson_version, part_id)
                        matches.append(pack)
                except (Missing, Invalid, Conflict):
                    continue
        return max(matches, key=lambda pack: (pack["createdAt"], pack["id"])) if matches else None

    def context(self, question, lesson, lesson_version, part_id):
        part, target, templates = teaching_target(question, lesson, lesson_version, part_id)
        original = {key: question[key] for key in ("id", "revision", "number", "stem", "options", "figureDescription", "parts") if key in question}
        return {"question": original, "part": part, "target": target,
                "templateConstraints": {"stageCount": len(templates), "templates": [{"stageIndex": index, "template": template} for index, template in enumerate(templates)]},
                "validation": {"kind": "local-structure", "teacherReviewed": False}}
