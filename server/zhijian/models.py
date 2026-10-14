from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Option(StrictModel):
    label: str = Field(min_length=1, max_length=20)
    text: str = Field(min_length=1)


class Part(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    label: str = ""
    prompt: str = Field(min_length=1)


class SourceRegion(StrictModel):
    pageIndex: int = Field(strict=True, ge=0)
    x: float = Field(ge=0, le=1, allow_inf_nan=False)
    y: float = Field(ge=0, le=1, allow_inf_nan=False)
    width: float = Field(gt=0, le=1, allow_inf_nan=False)
    height: float = Field(gt=0, le=1, allow_inf_nan=False)


class PatchQuestion(StrictModel):
    expectedRevision: int = Field(ge=1)
    stem: str | None = None
    options: list[Option] | None = None
    figureDescription: str | None = None
    missingFields: list[str] | None = None
    parts: list[Part] | None = None
    sourceRegions: list[SourceRegion] | None = None
    confirm: bool = False


class LessonRequest(StrictModel):
    expectedRevision: int = Field(ge=1)


class AskRequest(StrictModel):
    questionRevision: int = Field(ge=1)
    lessonVersion: int = Field(ge=1)
    partId: str
    stepId: str | None = None
    mode: Literal["teacher", "explore", "exercise"]
    snapshot: dict[str, Any] = Field(default_factory=dict)
    text: str = Field(min_length=1, max_length=5000)


class EventRequest(StrictModel):
    questionId: str
    questionRevision: int = Field(ge=1)
    lessonVersion: int | None = None
    partId: str | None = None
    kind: Literal["note", "observation", "lesson-part-viewed", "question-finished", "help-used", "answer-exposed"]
    authorKind: Literal["learner", "system-observation", "system"]
    text: str = Field(default="", max_length=30000)
    payload: dict[str, Any] = Field(default_factory=dict)


class SessionRequest(StrictModel):
    questionId: str | None = None
    questionRevision: int = Field(ge=1)
    lessonVersion: int = Field(ge=1)
    expectedSessionRevision: int = Field(ge=0)
    partId: str
    stepIndex: int = Field(ge=0)
    mode: Literal["teacher", "explore", "exercise"]
    sceneState: dict[str, Any] = Field(default_factory=dict)
    reflection: str = Field(default="", max_length=30000)
    returnTarget: dict[str, Any] | None = None
