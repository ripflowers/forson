import copy

from zhijian.review import remap_gold_parts, review_passes, sample_conditions_compatible


FIELD_NAMES = ("goal", "known", "prerequisites", "method", "answer", "verification", "misconceptions", "summary", "scene")


def field_checks():
    return [{"field": field, "correct": True, "issue": ""} for field in FIELD_NAMES]


def step_check(step_id):
    return {"stepId": step_id, **{field: {"correct": True, "issue": ""} for field in ("explanation", "reason", "formulaLatex")}}


def test_each_required_reasoning_item_needs_supported_evidence():
    gold = {"parts": [{"id": "main", "requiredReasoning": ["条件一", "推理二"]}]}
    reviewed = {"inputEquivalent": True, "parts": [{"partId": "main", "reasoningCorrect": True,
                 "checks": [{"index": 0, "supported": True, "evidence": "步骤一", "issue": ""}]}]}
    assert not review_passes(reviewed, gold)[0]


def test_model_overall_pass_does_not_replace_per_part_review():
    assert not review_passes({"passed": True}, {"parts": [{"id": "main", "requiredReasoning": ["推理"]}]})[0]


def test_sample_q15_changed_plus_sign_is_not_gold_compatible():
    q = {"number": 15, "stem": "abc<0，a+b+c=0，x=|b+c|/a+2|a+c|/b+3|a+b|/c", "parts": []}
    assert not sample_conditions_compatible(q)


def test_sample_q15_negative_third_term_compatible():
    q = {"number": 15, "stem": "abc<0，a+b+c=0，x=|b+c|/a+2|a+c|/b−3|a+b|/c", "parts": []}
    assert sample_conditions_compatible(q)


def test_review_cannot_pass_with_fabricated_source_quote():
    gold = {"parts": [{"id": "main", "requiredReasoning": ["新增23和24行"]}]}
    lesson = {"parts": [{"partId": "main", "steps": [{"id": "s1", "reason": "抵消前22行，再加23和24行"}]}]}
    review = {"inputEquivalent": True, "parts": [{"partId": "main", "reasoningCorrect": True, "checks": [{
        "index": 0, "supported": True, "evidence": "已有理由", "source": {"kind": "step", "stepId": "s1", "field": "reason"},
        "quote": "凭空捏造的47", "issue": ""}]}]}
    review["parts"][0].update(fieldChecks=field_checks(), stepChecks=[step_check("s1")])
    assert not review_passes(review, gold, lesson)[0]


def test_review_accepts_a_real_exact_quote_from_current_part():
    gold = {"parts": [{"id": "main", "requiredReasoning": ["新增23和24行"]}]}
    lesson = {"parts": [{"partId": "main", "steps": [{"id": "s1", "reason": "抵消前22行，再加23和24行"}]}]}
    review = {"inputEquivalent": True, "parts": [{"partId": "main", "reasoningCorrect": True, "checks": [{
        "index": 0, "supported": True, "evidence": "这句话明确讲出新增两行", "source": {"kind": "step", "stepId": "s1", "field": "reason"},
        "quote": "再加23和24行", "issue": ""}]}]}
    review["parts"][0].update(fieldChecks=field_checks(), stepChecks=[step_check("s1")])
    assert review_passes(review, gold, lesson)[0]


def test_new_stable_uuid_maps_only_from_explicit_leaf_label():
    gold = {"parts": [{"id": "1", "expectedAnswer": {"value": 3}}, {"id": "2.1", "expectedAnswer": {"value": 6}}]}
    q = {"parts": [{"id": "uuid-one", "label": "（1）"}, {"id": "uuid-two", "label": "（2）①"}]}
    mapped = remap_gold_parts(q, gold)
    assert mapped["partIdMap"] == {"1": "uuid-one", "2.1": "uuid-two"}
    assert mapped["parts"][1]["id"] == "uuid-two"
    assert mapped["parts"][1]["semanticId"] == "2.1"


def test_ambiguous_or_duplicate_labels_never_complete_coverage():
    gold = {"parts": [{"id": "1"}, {"id": "2.1"}]}
    q = {"parts": [{"id": "uuid-one", "label": "第一问"}]}
    assert remap_gold_parts(q, gold)["mappingIssues"]


def test_input_issues_block_self_contradictory_true_review():
    gold = {"parts": [{"id": "main", "requiredReasoning": ["理由"]}]}
    lesson = {"parts": [{"partId": "main", "method": "先检查条件"}]}
    review = {"inputEquivalent": True, "inputIssues": ["负号不一致"], "parts": [{"partId": "main", "reasoningCorrect": True, "checks": [{"index": 0, "supported": True, "evidence": "有依据", "source": {"kind": "field", "field": "method"}, "quote": "先检查条件", "issue": ""}], "issue": ""}]}
    assert not review_passes(review, gold, lesson)[0]


def test_part_issue_blocks_self_contradictory_true_review():
    gold = {"parts": [{"id": "main", "requiredReasoning": ["理由"]}]}
    lesson = {"parts": [{"partId": "main", "method": "先检查条件"}]}
    review = {"inputEquivalent": True, "inputIssues": [], "parts": [{"partId": "main", "reasoningCorrect": True, "checks": [{"index": 0, "supported": True, "evidence": "有依据", "source": {"kind": "field", "field": "method"}, "quote": "先检查条件", "issue": ""}], "issue": "缺少边界"}]}
    assert not review_passes(review, gold, lesson)[0]


def complete_review_fixture():
    gold = {"parts": [{"id": "main", "requiredReasoning": ["负数的平方为正"]}]}
    lesson = {"parts": [{"partId": "main", "steps": [
        {"id": "s1", "explanation": "取x=-1/2，其平方为1/4。", "reason": "负数的平方为正。", "formulaLatex": "(-1/2)^2=1/4"},
        {"id": "s2", "explanation": "对正数也需要按0<x<1、x=1、x>1分段。", "reason": "乘以小于1的正数会缩小，大于1的正数会放大。", "formulaLatex": "0<x<1\\Rightarrow x^3<x^2<x"}]}]}
    review = {"inputEquivalent": True, "inputIssues": [], "parts": [{"partId": "main", "reasoningCorrect": True, "issue": "",
        "fieldChecks": field_checks(), "stepChecks": [step_check("s1"), step_check("s2")],
        "checks": [{"index": 0, "supported": True, "evidence": "负数平方已解释", "source": {"kind": "step", "stepId": "s1", "field": "reason"}, "quote": "负数的平方为正。", "issue": ""}]}]}
    return gold, lesson, review


def test_step_audit_must_include_every_actual_step():
    gold, lesson, review = complete_review_fixture()
    review["parts"][0]["stepChecks"].pop()
    assert not review_passes(review, gold, lesson)[0]


def test_correct_anchor_does_not_hide_extra_wrong_reason():
    gold, lesson, review = complete_review_fixture()
    lesson["parts"][0]["steps"][1]["reason"] = "对任意x>0都有x<x²<x³。"
    review["parts"][0]["stepChecks"][1]["reason"] = {"correct": False, "issue": "没有讨论0<x<1的反例"}
    assert not review_passes(review, gold, lesson)[0]


def test_step_audit_rejects_duplicate_ids_and_missing_field():
    gold, lesson, review = complete_review_fixture()
    review["parts"][0]["stepChecks"][1] = copy.deepcopy(review["parts"][0]["stepChecks"][0])
    assert not review_passes(review, gold, lesson)[0]
    gold, lesson, review = complete_review_fixture()
    del review["parts"][0]["stepChecks"][1]["formulaLatex"]
    assert not review_passes(review, gold, lesson)[0]


def test_nonempty_step_issue_blocks_even_correct_true():
    gold, lesson, review = complete_review_fixture()
    review["parts"][0]["stepChecks"][1]["explanation"]["issue"] = "边界未说明"
    assert not review_passes(review, gold, lesson)[0]


def test_method_error_cannot_hide_behind_correct_steps():
    gold, lesson, review = complete_review_fixture()
    review["parts"][0]["fieldChecks"][3] = {"field": "method", "correct": False, "issue": "两个分支结果并不相同"}
    assert not review_passes(review, gold, lesson)[0]


def test_nonempty_verification_issue_blocks_even_field_correct_true():
    gold, lesson, review = complete_review_fixture()
    verification = next(item for item in review["parts"][0]["fieldChecks"] if item["field"] == "verification")
    verification["issue"] = "只用两个例子不能证明对所有条件成立"
    assert not review_passes(review, gold, lesson)[0]


def test_field_audit_requires_unique_exact_nine_fields():
    gold, lesson, review = complete_review_fixture()
    review["parts"][0]["fieldChecks"].pop()
    assert not review_passes(review, gold, lesson)[0]
    gold, lesson, review = complete_review_fixture()
    review["parts"][0]["fieldChecks"][8] = copy.deepcopy(review["parts"][0]["fieldChecks"][0])
    assert not review_passes(review, gold, lesson)[0]


def test_complete_correct_step_and_field_audits_pass():
    gold, lesson, review = complete_review_fixture()
    assert review_passes(review, gold, lesson)[0]


def test_q16_unsupported_reason_with_null_source_returns_failure_not_exception():
    gold, lesson, review = complete_review_fixture()
    # Shape returned by the real q16-r4-reasoning-review-repair response.
    review["parts"][0]["checks"][0] = {"index": 0, "supported": False, "evidence": "", "source": None,
        "quote": "", "issue": "教案采用分段线性函数讨论，未出现两组路径长度的表达式。"}
    passed, issues = review_passes(review, gold, lesson)
    assert not passed
    assert any("关键理由0未被教案支持" in issue for issue in issues)
    assert any("关键理由0引用来源" in issue for issue in issues)


def test_non_object_source_cannot_pass_even_when_reviewer_claims_supported():
    for source in (None, [], "s1", 0):
        gold, lesson, review = complete_review_fixture()
        review["parts"][0]["checks"][0]["source"] = source
        passed, issues = review_passes(review, gold, lesson)
        assert not passed
        assert any("关键理由0引用来源" in issue for issue in issues)


def test_q15_equivalent_negative_third_term_forms_allowed_but_not_inversion():
    prefix = "abc<0，a+b+c=0，x=|b+c|/a+2|a+c|/b"
    for term in (r"-3\frac{|a+b|}{c}", r"-\frac{3|a+b|}{c}", "−3|a+b|/c"):
        assert sample_conditions_compatible({"number": 15, "stem": prefix + term, "parts": []})
    for term in (r"+\frac{3|a+b|}{c}", r"-\frac{3c}{|a+b|}", r"-3\frac{c}{|a+b|}"):
        assert not sample_conditions_compatible({"number": 15, "stem": prefix + term, "parts": []})
