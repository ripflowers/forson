from copy import deepcopy

from zhijian.rules import answers_equal, check_lesson, check_question, publication_allowed


def question():
    return {"id": "q15", "number": 15, "revision": 1, "state": "confirmed",
            "stem": "已知条件，计算。", "missingFields": [], "parts": [{"id": "main", "prompt": "求值"}]}


def package():
    return {"questionRevision": 1, "coveredPartIds": ["main"], "parts": [{
        "partId": "main", "label": "计算", "goal": "求表达式的值", "known": ["题目条件"],
        "prerequisites": ["绝对值"], "method": "先判符号再化简", "steps": [{"id": "s1", "title": "化简",
        "explanation": "根据负数绝对值化简", "reason": "负数的绝对值取相反数", "formulaLatex": "-24"}],
        "answer": {"kind": "number", "value": -24, "display": "−24"}, "verification": "把条件代回核对",
        "misconceptions": [{"mistake": "忽略减号", "correction": "按原式逐项核对减号"}], "summary": "先判定符号",
        "scene": None}]}


def test_missing_definition_cannot_be_confirmed_or_ready():
    q = question()
    q.update(number=11, missingFields=["新运算的定义缺失"], state="needs_completion")
    assert check_question(q)
    assert not check_lesson(q, package(), None)["inputConfirmed"]


def test_missing_leaf_part_rejects_ready():
    q = question()
    q["parts"].append({"id": "second", "prompt": "求第二问"})
    result = check_lesson(q, package(), None)
    assert not result["coverage"]
    assert any("second" in issue for issue in result["issues"])


def test_q15_zero_cannot_pass_correct_negative_24():
    lesson = package()
    lesson["parts"][0]["answer"]["value"] = 0
    gold = {"parts": [{"id": "main", "expectedAnswer": {"kind": "number", "value": -24}}]}
    result = check_lesson(question(), lesson, gold)
    assert not result["answerVerified"]
    assert result["coverage"]


def test_complete_package_passes_independent_answer_check():
    gold = {"parts": [{"id": "main", "expectedAnswer": {"kind": "number", "value": -24}}]}
    result = check_lesson(question(), package(), gold)
    assert result["inputConfirmed"] and result["coverage"] and result["answerVerified"]
    assert not result["reasoningReviewed"]


def test_blank_reason_blocks_even_correct_answer():
    lesson = package()
    lesson["parts"][0]["steps"][0]["reason"] = ""
    assert check_lesson(question(), lesson, None)["issues"]


def test_modified_revision_cannot_publish_late_result():
    assert not publication_allowed(question_revision=2, generated_revision=1, job_state="running", lease_matches=True)


def test_cancelled_job_cannot_publish_late_result():
    for state in ("cancel_requested", "cancelled", "failed"):
        assert not publication_allowed(question_revision=1, generated_revision=1, job_state=state, lease_matches=True)


def test_old_lease_cannot_publish_late_result():
    assert not publication_allowed(question_revision=1, generated_revision=1, job_state="running", lease_matches=False)


def test_non_finite_scene_values_cannot_pass():
    for value in (float("nan"), float("inf")):
        lesson = package()
        lesson["parts"][0]["scene"] = {"kind": "number-line", "params": {"left": value, "right": 3}}
        assert check_lesson(question(), lesson, None)["issues"]
        assert any("参数" in x for x in check_lesson(question(), lesson, None)["issues"])


def test_parameter_scene_requires_finite_a_and_fixed_right_three():
    for params in ({"left": 0, "right": 3, "parameterName": "a"},
                   {"left": 1, "right": 2, "parameterName": "a", "parameterValue": -1},
                   {"left": 1, "right": 3, "targetMinimum": -1}):
        lesson = package()
        lesson["parts"][0]["scene"] = {"kind": "number-line", "params": params}
        assert any("参数" in x for x in check_lesson(question(), lesson, None)["issues"])


def test_parameter_a_negative_five_allows_fixed_points_to_swap():
    lesson = package()
    lesson["parts"][0]["answer"] = {"kind": "numbers", "value": [-1, -5], "display": "−1或−5"}
    lesson["parts"][0]["scene"] = {"kind": "number-line", "params": {"left": 5, "right": 3, "parameterName": "a", "parameterValue": -5, "targetMinimum": 2}}
    assert not any("参数" in x for x in check_lesson(question(), lesson, None)["issues"])


def test_point_coordinate_scalar_is_equivalent_to_gold_value():
    assert answers_equal(1, {"point": "P", "coordinate": 1})


def test_linear_expression_equivalence_without_eval():
    assert answers_equal("-2*b-a+1", "1-a-2*b")
    assert answers_equal("(2*m-2)/2", "m-1")
    assert not answers_equal("m+1", "m-1")
    assert not answers_equal("__import__('os').system('anything')", "m-1")


def test_scene_minimum_and_full_interval_must_match_checked_answer():
    lesson = package()
    lesson["parts"][0]["answer"] = {"kind": "minimum", "value": {"minimum": 3, "attainedWhen": {"min": -1, "max": 2, "includeMin": True, "includeMax": True}}, "display": "3"}
    lesson["parts"][0]["scene"] = {"kind": "number-line", "params": {"left": 0, "right": 5}}
    assert any("场景" in x for x in check_lesson(question(), lesson, None)["issues"])


def test_scene_target_sum_solutions_are_checked_deterministically():
    lesson = package()
    lesson["parts"][0]["answer"] = {"kind": "numbers", "value": [-3, 5], "display": "−3或5"}
    lesson["parts"][0]["scene"] = {"kind": "number-line", "params": {"left": -2, "right": 4, "targetSum": 10}}
    assert any("场景" in x for x in check_lesson(question(), lesson, None)["issues"])


def test_sample_q15_cannot_publish_unrelated_triangle_scene():
    lesson = package()
    lesson["parts"][0]["scene"] = {"kind": "triangle-count", "params": {"lower": 1, "upper": 3}}
    gold = {"parts": [{"id": "main", "expectedAnswer": {"kind": "number", "value": -24}}]}
    assert any("本样卷" in x for x in check_lesson(question(), lesson, gold)["issues"])


def test_sample_q19_scene_cannot_use_another_leafs_fixed_points():
    q = question()
    q.update(number=19, parts=[{"id": "uuid-leaf", "prompt": "求最小值"}])
    lesson = package()
    lesson["coveredPartIds"] = ["uuid-leaf"]
    part = lesson["parts"][0]
    part.update(partId="uuid-leaf", answer={"kind": "minimum", "value": {"minimum": 6, "attainedWhen": {"min": -2, "max": 4, "includeMin": True, "includeMax": True}}, "display": "6"}, scene={"kind": "number-line", "params": {"left": -2, "right": 4}})
    gold = {"parts": [{"id": "uuid-leaf", "semanticId": "1", "expectedAnswer": part["answer"]}]}
    assert any("本样卷" in x for x in check_lesson(q, lesson, gold)["issues"])


def test_sample_q26_requires_supported_interaction_for_this_core_flow():
    q = question()
    q.update(number=26)
    lesson = package()
    lesson["parts"][0]["answer"] = {"kind": "choice", "value": "B", "display": "B"}
    gold = {"parts": [{"id": "main", "expectedAnswer": {"kind": "choice", "value": "B"}}]}
    assert any("互动" in x for x in check_lesson(q, lesson, gold)["issues"])
