from zhijian.app import scene_facts


def test_ask_uses_current_part_snapshot_not_whole_scene_state():
    part = {"partId": "2.3", "scene": {"kind": "number-line", "params": {"left": 1, "right": 3, "parameterName": "a", "parameterValue": -1, "targetMinimum": 2}}}
    snapshot = {"x": 4, "a": -5, "sceneState": {"1": {"x": 0}, "2.3": {"x": 4, "a": -5}}}
    facts = scene_facts(part, snapshot)
    assert facts["left"] == 5
    assert facts["x"] == 4
    assert facts["sum"] == 2


def test_triangle_ask_keeps_original_22_to_24_not_preview_rows():
    part = {"partId": "main", "scene": {"kind": "triangle-count", "params": {"lower": 22, "upper": 24, "previewRows": 6}}}
    assert scene_facts(part, {"rows": 8})["difference"] == 47


def test_triangle_ask_separates_eight_row_preview_from_original_47():
    part = {"partId": "main", "scene": {"kind": "triangle-count", "params": {"lower": 22, "upper": 24, "previewRows": 6}}}
    facts = scene_facts(part, {"rows": 8})
    assert facts["previewComparison"]["totalPoints"] == 36
    assert facts["previewComparison"]["difference"] == 15
    assert facts["previewComparison"]["addedRows"] == [7, 8]
    assert facts["originalComparison"]["difference"] == 47


def test_teacher_growing_triangle_one_row_matches_actual_visible_one_point():
    part = {"partId": "main", "scene": {"kind": "triangle-count", "params": {"lower": 22, "upper": 24, "previewRows": 6}}}
    facts = scene_facts(part, {"rows": 1, "teacherAnimation": True, "teacherPhase": "growth"})
    assert facts["growth"]["rows"] == 1
    assert facts["growth"]["totalPoints"] == 1
    assert facts["growth"]["rowCounts"] == [1]
    assert "previewComparison" not in facts
    assert facts["originalComparison"]["difference"] == 47


def test_one_row_is_not_silently_accepted_as_two_row_difference_exploration():
    import pytest
    from zhijian.store import Invalid
    part = {"partId": "main", "scene": {"kind": "triangle-count", "params": {"lower": 22, "upper": 24, "previewRows": 6}}}
    with pytest.raises(Invalid):
        scene_facts(part, {"rows": 1})


def test_original_teacher_frame_uses_confirmed_counts_without_trusting_client_totals():
    part = {"partId": "main", "scene": {"kind": "triangle-count", "params": {"lower": 22, "upper": 24, "previewRows": 6}}}
    facts = scene_facts(part, {"rows": 24, "teacherAnimation": True, "teacherPhase": "original", "pointCount": 999})
    assert facts["visibleOriginal"] == {"rows": 24, "visibleRowCounts": [23, 24], "visiblePoints": 47, "commonPoints": 253, "totalPoints": 300}
    assert "previewComparison" not in facts


def test_original_frame_rejects_wrong_row_count_and_does_not_expand_exploration():
    import pytest
    from zhijian.store import Invalid
    part = {"partId": "main", "scene": {"kind": "triangle-count", "params": {"lower": 22, "upper": 24, "previewRows": 6}}}
    for snapshot in [{"rows": 23, "teacherAnimation": True, "teacherPhase": "original"}, {"rows": 24}]:
        with pytest.raises(Invalid):
            scene_facts(part, snapshot)
