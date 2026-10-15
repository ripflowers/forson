"""Script tests validate teaching/synchronization plans, not synthesized voice quality."""
import copy

import pytest

from zhijian.q26_narration import build_q26_script


@pytest.fixture
def approved_part():
    # Structure and formulas from the currently approved Q26 r4/v3 part.
    return {
        "partId": "main", "label": "主问题",
        "goal": "求第24个三角形数与第22个三角形数的差，并选出正确选项",
        "known": ["三角形数序列为1，3，6，10，15，21，…", "1称为第1个三角形数，3称为第2个三角形数，依此类推",
                  "这些数量的石子可以排成三角形，图中展示第1个到第4个三角形，后面省略",
                  "题目要求第24个与第22个三角形数的差", "选项：A.2，B.47，C.23，D.24"],
        "prerequisites": ["第n个三角形数等于前n个正整数之和，即1+2+…+n", "两个和式相减时，相同部分可以抵消"],
        "method": "把第24个和第22个三角形数都写成连续自然数之和，再抵消相同部分并独立检验。",
        "verification": "24×25÷2=300，22×23÷2=253，300-253=47。",
        "summary": "先表示三角形数，再约去相同部分，并用公式复算。",
        "answer": {"kind": "choice", "value": "B", "display": "B（47）"},
        "misconceptions": [{"mistake": "序号相减24-22=2", "correction": "差应包含23和24两行"},
                           {"mistake": "只算23或24", "correction": "两行都要计算"}],
        "scene": {"kind": "triangle-count", "params": {"lower": 22, "upper": 24, "previewRows": 3}},
        "steps": [
            {"id": "p1-step1", "title": "把三角形数写成连续自然数和", "reason": "每行依次有1、2、3个点。",
             "explanation": "第n个有n行，各行相加得到总点数。", "formulaLatex": r"T_n=1+2+3+\\cdots+n"},
            {"id": "p1-step2", "title": "展开第24个和第22个三角形数", "reason": "公共部分可以抵消。",
             "explanation": "两者前22行完全相同。", "formulaLatex": r"T_{24}=1+2+\\cdots+22+23+24,\\quad T_{22}=1+2+\\cdots+22"},
            {"id": "p1-step3", "title": "抵消公共部分并求差", "reason": "多出23、24两行。",
             "explanation": "两行共有47个点。", "formulaLatex": r"T_{24}-T_{22}=23+24=47"},
            {"id": "p1-step4", "title": "用求和公式检验", "reason": "独立算法检查漏项。",
             "explanation": "先分别求和，再相减。", "formulaLatex": r"T_{24}=\\frac{24\\times25}{2}=300,\\quad T_{22}=\\frac{22\\times23}{2}=253,\\quad 300-253=47"},
        ],
    }


def test_script_covers_all_seven_approved_chapters_without_mutating_source(approved_part):
    before = copy.deepcopy(approved_part)
    stages = build_q26_script(approved_part)
    assert approved_part == before
    assert [stage["stageIndex"] for stage in stages] == list(range(7))
    assert all(stage["clips"] for stage in stages)
    text = "".join(clip["text"] for stage in stages for clip in stage["clips"])
    for spoken in ("第几个", "行数", "总点数", "一、三、六、十、十五、二十一", "选项B",
                   "前二十二行", "省略块", "二十三加二十四", "三百减二百五十三", "面积",
                   "序号", "少算", "相同部分", "独立检验"):
        assert spoken in text
    assert not any(token in text for token in ("\\", "$", "[暂停]", "visualFrom", "formulaLatex"))


def test_growth_audio_adds_each_row_at_its_actual_canonical_start(approved_part):
    growth = build_q26_script(approved_part)[0]["clips"]
    row_clips = [clip for clip in growth if clip["text"].startswith("看第")]
    assert len(row_clips) == 6
    for row, clip in enumerate(row_clips, 1):
        # TeachingVisual: min(6, floor(canonicalSeconds / .48) + 1).
        assert clip["visualFrom"] == pytest.approx((row - 1) * .48)
        assert int(clip["visualFrom"] / .48 + 1e-8) + 1 == row
        assert clip["visualTo"] < row * .48


def test_common_blocks_stay_before_the_true_cancel_windows(approved_part):
    stages = build_q26_script(approved_part)
    method = stages[1]["clips"]
    assert method[0]["visualTo"] < .8
    assert method[1]["visualFrom"] == .8 and method[1]["visualTo"] == 1.6
    original = stages[3]["clips"]
    assert all(clip["visualFrom"] >= 0 for clip in original)
    assert "二百五十三" in original[1]["text"] and "省略块" in original[1]["text"]
    cancel = stages[4]["clips"]
    assert cancel[0]["visualTo"] < .3
    assert cancel[1]["visualFrom"] == .3 and cancel[1]["visualTo"] == 1.1
    assert cancel[2]["visualFrom"] >= 1.1 and cancel[2]["visualTo"] >= 2.1


def test_each_clip_has_real_text_and_nonnegative_monotone_visual_time(approved_part):
    for stage in build_q26_script(approved_part):
        previous = 0
        for clip in stage["clips"]:
            assert set(clip) == {"text", "visualFrom", "visualTo"}
            assert isinstance(clip["text"], str) and clip["text"].strip()
            assert previous <= clip["visualFrom"] <= clip["visualTo"]
            previous = clip["visualTo"]


@pytest.mark.parametrize("defect", ["other-part", "other-scene", "malformed-scene", "other-bounds", "boolean-bound", "fewer-steps", "reordered-steps", "changed-formula", "wrong-answer", "missing-field", "missing-reason", "missing-misconception"])
def test_different_or_incomplete_lessons_fail_explicitly(approved_part, defect):
    if defect == "other-part":
        approved_part["partId"] = "2.1"
    elif defect == "other-scene":
        approved_part["scene"]["kind"] = "number-line"
    elif defect == "malformed-scene":
        approved_part["scene"] = []
    elif defect == "other-bounds":
        approved_part["scene"]["params"]["lower"] = 20
    elif defect == "boolean-bound":
        approved_part["scene"]["params"]["upper"] = True
    elif defect == "fewer-steps":
        approved_part["steps"].pop()
    elif defect == "reordered-steps":
        approved_part["steps"].reverse()
    elif defect == "changed-formula":
        approved_part["steps"][2]["formulaLatex"] = "24-22=2"
    elif defect == "wrong-answer":
        approved_part["answer"]["value"] = "A"
    elif defect == "missing-reason":
        approved_part["steps"][1]["reason"] = ""
    elif defect == "missing-misconception":
        approved_part["misconceptions"].pop()
    else:
        approved_part["verification"] = ""
    with pytest.raises(ValueError, match="第26题"):
        build_q26_script(approved_part)


def test_equivalent_single_backslash_latex_is_accepted(approved_part):
    for step in approved_part["steps"]:
        step["formulaLatex"] = step["formulaLatex"].replace("\\\\", "\\")
    assert len(build_q26_script(approved_part)) == 7


def test_spoken_variables_and_sum_formula_have_unambiguous_order(approved_part):
    stages = build_q26_script(approved_part)
    speech = "".join(clip["text"] for stage in stages for clip in stage["clips"])
    assert "字母恩代表序号" in speech and "大写字母提，下标写字母恩" in speech
    assert "n" not in speech and "T" not in speech
    verification = stages[5]["clips"][0]["text"]
    assert "恩乘括号里的恩加一，再除以二" in verification
    assert "先把括号里的恩加一，再乘恩，最后除以二" in verification
    assert "恩乘恩加一" not in verification
