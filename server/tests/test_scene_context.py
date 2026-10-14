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
