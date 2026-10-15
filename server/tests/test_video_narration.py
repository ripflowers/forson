"""Immutable voice export contracts with explicit fake bytes; never real MP4/TTS evidence."""
import hashlib
import json
from uuid import uuid4

import pytest

from zhijian.narration import content_hash
from zhijian.store import Conflict, Invalid, Missing
from zhijian.videos import VideoRequest, VideoStore, approved_part


@pytest.fixture
def voice_source(tmp_path):
    question = {"id": "voice-question", "revision": 4, "state": "confirmed", "missingFields": [], "parts": [{"id": "main"}]}
    part = {"partId": "main", "label": "主问题", "goal": "比较三角形数", "known": ["三角形数"], "prerequisites": ["自然数求和"],
            "method": "抵消相同部分", "verification": "300-253=47", "summary": "新增两行", "answer": {"kind": "choice", "value": "B", "display": "B，47"},
            "misconceptions": [{"mistake": "直接序号相减", "correction": "相减的是点数"}],
            "steps": [{"id": f"step-{i}", "title": f"第{i}步", "explanation": "测试解题说明", "reason": "测试理由", "formulaLatex": "23+24=47"} for i in range(4)],
            "scene": {"kind": "triangle-count", "params": {"lower": 22, "upper": 24, "previewRows": 6}}}
    lesson = {"questionId": question["id"], "questionRevision": 4, "lessonVersion": 3, "status": "ready", "coveredPartIds": ["main"], "parts": [part],
              "checks": {"inputConfirmed": True, "coverage": True, "answerVerified": True, "reasoningReviewed": True}}
    voice_id = str(uuid4())
    folder = tmp_path / "explicit-fake-speech-source"
    folder.mkdir()
    clips = []
    paths = {}
    for stage in range(7):
        clip_id = f"clip-{stage + 1:03d}"
        path = folder / (clip_id + ".mp3")
        raw = f"Explicit fake fixture only, not MP3 proof, stage {stage}".encode()
        path.write_bytes(raw)
        paths[clip_id] = path
        clips.append({"id": clip_id, "stageIndex": stage, "text": f"测试第{stage}段口述", "from": stage * 79,
                      "audioFrames": 37, "durationInFrames": 49, "audioHash": hashlib.sha256(raw).hexdigest(),
                      "visualFrom": 0, "visualTo": 2, "audioUrl": f"/api/narration/{voice_id}/clips/{clip_id}.mp3"})
    voice = {"id": voice_id, "state": "ready", "questionId": question["id"], "questionRevision": 4, "lessonVersion": 3,
             "partId": "main", "lessonHash": content_hash(approved_part(part)), "voice": "zh-CN-XiaoxiaoNeural", "rate": "-8%",
             "scriptVersion": "q26-teacher-voice-2", "fps": 30, "clips": clips, "stageDurations": [79] * 7, "durationInFrames": 553}

    def clip_path(narration_id, clip_id):
        if narration_id != voice_id or clip_id not in paths or not paths[clip_id].is_file():
            raise Missing("显式测试配音片段不存在")
        return paths[clip_id]

    service = VideoStore(tmp_path / "video-artifacts")
    service.initialize()
    return service, question, lesson, voice, clip_path, paths


def request(voice, **changes):
    return VideoRequest(**{"expectedRevision": 4, "lessonVersion": 3, "partId": "main", "pace": 1, "narrationId": voice["id"], **changes})


def test_approved_voice_export_copies_immutable_binary_and_server_relative_audio_paths(voice_source):
    service, question, lesson, voice, clip_path, paths = voice_source
    video = service.create(question, lesson, request(voice), voice, clip_path)
    assert video["state"] == "queued" and video["hasAudio"] is True and video["narrationId"] == voice["id"]
    folder = service.directory(video["id"])
    snapshot = json.loads((folder / "snapshot.json").read_text())
    copy_voice = snapshot["inputProps"]["narration"]
    assert copy_voice["lessonHash"] == voice["lessonHash"]
    assert copy_voice["durationInFrames"] == 553 and copy_voice["stageDurations"] == [79] * 7
    assert len(copy_voice["clips"]) == 7
    for clip in copy_voice["clips"]:
        assert "audioUrl" not in clip
        assert clip["audioPath"] == f"_narration/{voice['id']}/{clip['id']}.mp3"
        destination = folder / "audio" / (clip["id"] + ".mp3")
        assert destination.read_bytes() == paths[clip["id"]].read_bytes()
        assert hashlib.sha256(destination.read_bytes()).hexdigest() == clip["audioHash"]
        assert destination.stat().st_mode & 0o777 == 0o600
    assert (folder / "audio").stat().st_mode & 0o777 == 0o700
    captured_text = copy_voice["clips"][0]["text"]
    voice["clips"][0]["text"] = "之后改动的文字"
    paths["clip-001"].write_bytes(b"source changed after immutable export was queued")
    lesson["parts"][0]["summary"] = "之后改动的课堂"
    after = json.loads((folder / "snapshot.json").read_text())
    assert after["inputProps"]["narration"]["clips"][0]["text"] == captured_text
    assert (folder / "audio" / "clip-001.mp3").read_bytes() != paths["clip-001"].read_bytes()
    assert content_hash(after) == video["snapshotHash"]


@pytest.mark.parametrize("change", [{"questionId": "different"}, {"questionRevision": 3}, {"lessonVersion": 2},
                                    {"partId": "other"}, {"lessonHash": "wrong-course-hash"}])
def test_wrong_voice_question_revision_lesson_leaf_or_content_hash_is_rejected(voice_source, change):
    service, question, lesson, voice, clip_path, _ = voice_source
    voice.update(change)
    with pytest.raises(Conflict, match="配音与当前课堂"):
        service.create(question, lesson, request(voice), voice, clip_path)
    assert service.next_queued() is None


@pytest.mark.parametrize("change", [{"state": "preparing"}, {"state": "failed"}, {"id": str(uuid4())}])
def test_missing_or_not_ready_selected_voice_cannot_claim_audio_export(voice_source, change):
    service, question, lesson, voice, clip_path, _ = voice_source
    selected = request(voice)
    voice.update(change)
    with pytest.raises(Invalid):
        service.create(question, lesson, selected, voice, clip_path)
    assert service.next_queued() is None


def test_checked_answer_narration_cannot_replace_whole_classroom(voice_source):
    service, question, lesson, voice, clip_path, _ = voice_source
    voice["askId"] = "checked-answer-id"
    voice["answerHash"] = "some-checked-answer-hash"
    with pytest.raises(Invalid, match="答疑补讲"):
        service.create(question, lesson, request(voice), voice, clip_path)
    assert service.next_queued() is None


@pytest.mark.parametrize("stage_count", [1, 6, 8])
def test_voice_needs_all_classroom_stage_durations(voice_source, stage_count):
    service, question, lesson, voice, clip_path, _ = voice_source
    voice["stageDurations"] = [79] * stage_count
    with pytest.raises(Invalid):
        service.create(question, lesson, request(voice), voice, clip_path)
    assert service.next_queued() is None


def test_empty_clips_never_create_a_voice_video(voice_source):
    service, question, lesson, voice, clip_path, _ = voice_source
    voice["clips"] = []
    with pytest.raises(Invalid, match="实际音频"):
        service.create(question, lesson, request(voice), voice, clip_path)
    assert service.next_queued() is None


def test_partial_voice_missing_one_teaching_stage_is_not_complete_export(voice_source):
    service, question, lesson, voice, clip_path, _ = voice_source
    voice["clips"] = [clip for clip in voice["clips"] if clip["stageIndex"] != 4]
    with pytest.raises(Invalid):
        service.create(question, lesson, request(voice), voice, clip_path)
    assert service.next_queued() is None


def test_missing_clip_binary_is_not_queued_as_success(voice_source):
    service, question, lesson, voice, clip_path, paths = voice_source
    paths["clip-005"].unlink()
    with pytest.raises(Missing):
        service.create(question, lesson, request(voice), voice, clip_path)
    assert service.next_queued() is None


def test_tampered_audio_does_not_match_approved_speech_hash(voice_source):
    service, question, lesson, voice, clip_path, paths = voice_source
    paths["clip-004"].write_bytes(b"modified fake speech after voice approval")
    with pytest.raises(Invalid):
        service.create(question, lesson, request(voice), voice, clip_path)
    assert service.next_queued() is None


def test_empty_audio_even_with_its_hash_is_not_voice_success(voice_source):
    service, question, lesson, voice, clip_path, paths = voice_source
    paths["clip-004"].write_bytes(b"")
    voice["clips"][3]["audioHash"] = hashlib.sha256(b"").hexdigest()
    with pytest.raises(Invalid):
        service.create(question, lesson, request(voice), voice, clip_path)
    assert service.next_queued() is None


def test_legacy_mute_export_does_not_implicitly_attach_supplied_voice(voice_source):
    service, question, lesson, voice, clip_path, _ = voice_source
    video = service.create(question, lesson, request(voice, narrationId=None), voice, clip_path)
    assert video["hasAudio"] is False and video["narrationId"] is None
    snapshot = json.loads((service.directory(video["id"]) / "snapshot.json").read_text())
    assert "narration" not in snapshot["inputProps"]
