import pytest

from zhijian.app import teaching_position
from zhijian.store import Invalid


def part():
    return {"partId": "main", "goal": "求距离和最小值", "known": ["两固定点为-1和2"], "prerequisites": ["绝对值表示距离"],
            "method": "比较点在区间内外的位置。", "steps": [
                {"id": "s1", "title": "读距离", "explanation": "读成到两个点的距离。", "reason": "绝对值是距离。", "formulaLatex": "|x+1|+|x-2|"},
                {"id": "s2", "title": "比较位置", "explanation": "区间内距离和等于3，区间外更大。", "reason": "线段外增加往返距离。", "formulaLatex": "2-(-1)=3"}],
            "answer": {"display": "3，整个[-1,2]取得"}, "verification": "端点代入都是3。", "misconceptions": [{"mistake": "只取中点", "correction": "闭区间每个点都满足"}], "summary": "把式子读成距离，再比较位置。"}


def test_read_and_method_do_not_reference_first_computation_step():
    read = teaching_position(part(), {"stepIndex": 0}, None)
    method = teaching_position(part(), {"stepIndex": 1}, None)
    assert read["currentStep"] is None
    assert read["currentTeachingSlide"]["kind"] == "read-known"
    assert read["currentTeachingSlide"]["known"] == ["两固定点为-1和2"]
    assert method["currentStep"] is None
    assert method["currentTeachingSlide"]["kind"] == "method"
    assert method["currentTeachingSlide"]["method"] == part()["method"]


def test_middle_computation_uses_actual_step_id_and_reason():
    position = teaching_position(part(), {"stepIndex": 3}, "s2")
    assert position["currentTeachingSlide"]["kind"] == "step"
    assert position["currentStep"]["id"] == "s2"
    assert position["currentStep"]["reason"] == "线段外增加往返距离。"


def test_final_slide_contains_verification_and_summary_not_a_step():
    position = teaching_position(part(), {"stepIndex": 4}, None)
    assert position["currentStep"] is None
    assert position["currentTeachingSlide"]["kind"] == "summary"
    assert position["currentTeachingSlide"]["verification"] == part()["verification"]
    assert position["currentTeachingSlide"]["summary"] == part()["summary"]


def test_position_and_step_mismatches_are_rejected_without_guessing():
    for index, step_id in ((0, "s1"), (1, "s1"), (2, "s2"), (3, None), (4, "s2"), (-1, None), (5, None), (True, None), ("2", "s1"), (None, None)):
        with pytest.raises(Invalid):
            teaching_position(part(), {"stepIndex": index}, step_id)
