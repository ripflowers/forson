import ast
import math
import re
from fractions import Fraction
from typing import Any


def check_question(question: dict) -> list[str]:
    issues = list(question.get("missingFields") or [])
    if not str(question.get("stem", "")).strip():
        issues.append("题干为空")
    parts = question.get("parts", [])
    ids = [p.get("id") for p in parts]
    if not parts or len(ids) != len(set(ids)) or any(not x for x in ids):
        issues.append("小问标识为空或重复")
    for p in parts:
        if not str(p.get("prompt", "")).strip():
            issues.append(f"小问{p.get('id')}题面为空")
    return issues


def publication_allowed(*, question_revision: int, generated_revision: int, job_state: str, lease_matches: bool) -> bool:
    return question_revision == generated_revision and job_state == "running" and lease_matches


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    if isinstance(value, str):
        clean = value.replace("−", "-").replace("，", ",").strip()
        try:
            numeric = float(Fraction(clean))
            return numeric if math.isfinite(numeric) else None
        except (ValueError, ZeroDivisionError):
            return None
    return None


def answers_equal(actual: Any, expected: Any) -> bool:
    """Compare checked answer values, accepting equivalent fractions and unordered solution sets."""
    if isinstance(expected, dict):
        if set(expected) == {"point", "coordinate"} and not isinstance(actual, dict):
            return answers_equal(actual, expected["coordinate"])
        if "acceptedRange" in expected:
            numeric = _number(actual if not isinstance(actual, dict) else actual.get("example", actual.get("value")))
            if numeric is None:
                return False
            bounds = expected["acceptedRange"]
            low = bounds.get("min", -math.inf)
            high = bounds.get("max", math.inf)
            return (numeric >= low if bounds.get("includeMin") else numeric > low) and (numeric <= high if bounds.get("includeMax") else numeric < high)
        if "fraction" in expected:
            candidate = actual.get("fraction", actual.get("decimal")) if isinstance(actual, dict) else actual
            return answers_equal(candidate, expected["fraction"])
        if not isinstance(actual, dict):
            return False
        return all(key in actual and answers_equal(actual[key], value) for key, value in expected.items())
    if isinstance(expected, list):
        if not isinstance(actual, list) or len(actual) != len(expected):
            return False
        unmatched = list(actual)
        for item in expected:
            index = next((i for i, val in enumerate(unmatched) if answers_equal(val, item)), None)
            if index is None:
                return False
            unmatched.pop(index)
        return True
    a, b = _number(actual), _number(expected)
    if a is not None and b is not None:
        return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)
    if isinstance(actual, str) and isinstance(expected, str):
        def clean(s):
            return re.sub(r"\s+", "", s).replace("−", "-").replace("＞", ">").replace("＜", "<").strip("。.")
        left, right = clean(actual), clean(expected)
        if left == right:
            return True
        a, b = _linear_expression(left), _linear_expression(right)
        return a is not None and b is not None and a == b
    return actual == expected and type(actual) is type(expected)


def _linear_expression(text):
    """Parse a small arithmetic AST without eval, calls, attributes or arbitrary names."""
    if len(text) > 300 or not re.fullmatch(r"[abc m n x t0-9+*/().-]+", text):
        return None
    text = re.sub(r"(?<=\d)(?=[abcmnxt])", "*", text.replace(" ", ""))
    def scale(poly, scalar):
        return {key: value * scalar for key, value in poly.items() if value * scalar}
    def combine(left, right, sign=1):
        result = dict(left)
        for key, value in right.items():
            result[key] = result.get(key, Fraction(0)) + value * sign
        return {key: value for key, value in result.items() if value}
    def parse(node):
        if isinstance(node, ast.Constant) and type(node.value) in (int, float) and math.isfinite(node.value):
            return {"": Fraction(str(node.value))} if node.value else {}
        if isinstance(node, ast.Name) and node.id in set("abcmnxt"):
            return {node.id: Fraction(1)}
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            return scale(parse(node.operand), -1 if isinstance(node.op, ast.USub) else 1)
        if isinstance(node, ast.BinOp):
            left, right = parse(node.left), parse(node.right)
            if isinstance(node.op, ast.Add):
                return combine(left, right)
            if isinstance(node.op, ast.Sub):
                return combine(left, right, -1)
            if isinstance(node.op, ast.Mult):
                if set(left) <= {""}:
                    return scale(right, left.get("", Fraction(0)))
                if set(right) <= {""}:
                    return scale(left, right.get("", Fraction(0)))
            if isinstance(node.op, ast.Div) and set(right) == {""} and right[""]:
                return scale(left, 1 / right[""])
        raise ValueError("unsupported expression")
    try:
        return parse(ast.parse(text, mode="eval").body)
    except (ValueError, SyntaxError, ZeroDivisionError, RecursionError):
        return None


def _scene_issues(scene: dict | None, answer=None) -> list[str]:
    if scene is None:
        return []
    if not isinstance(scene, dict) or scene.get("kind") not in {"number-line", "triangle-count"}:
        return ["互动组件不在允许范围"]
    params = scene.get("params", {})
    if not isinstance(params, dict):
        return ["互动参数必须是对象"]
    if scene["kind"] == "number-line":
        left, right = params.get("left"), params.get("right")
        if _number(left) is None or _number(right) is None:
            return ["数轴固定点参数不合法"]
        if params.get("parameterName") is not None and params.get("parameterName") != "a":
            return ["数轴参数仅支持a"]
        if params.get("parameterName") == "a":
            value = _number(params.get("parameterValue"))
            if value is None or not answers_equal(left, -value) or not answers_equal(right, 3):
                return ["数轴参数a必须有限，且固定点为-a和3"]
        for name in ("targetSum", "targetMinimum"):
            if name in params and (_number(params[name]) is None or _number(params[name]) < 0):
                return ["数轴目标参数必须为有限非负数"]
        low, high = sorted([left, right])
        value = (answer or {}).get("value")
        if (answer or {}).get("kind") == "minimum":
            computed = {"minimum": high - low, "attainedWhen": {"min": low, "max": high, "includeMin": True, "includeMax": True}}
            if not answers_equal(value, computed):
                return ["数轴场景的最小值及完整闭区间与结论不一致"]
        if "targetSum" in params:
            target = params["targetSum"]
            if target < high - low:
                solutions = []
            elif target == high - low:
                solutions = {"min": low, "max": high, "includeMin": True, "includeMax": True}
            else:
                half = (target - (high - low)) / 2
                solutions = [low - half, high + half]
            if not answers_equal(value, solutions):
                return ["数轴场景的距离和与解集不一致"]
        if params.get("parameterName") == "a" and "targetMinimum" in params:
            target = params["targetMinimum"]
            solutions = [-right] if target == 0 else [target - right, -target - right]
            if not answers_equal(value, solutions):
                return ["数轴场景的参数解与结论不一致"]
        allowed = {"left", "right", "targetSum", "targetMinimum", "parameterName", "parameterValue"}
    else:
        low, high = params.get("lower"), params.get("upper")
        if not isinstance(low, int) or not isinstance(high, int) or not 0 <= low < high <= 100:
            return ["三角形数范围不合法"]
        if "previewRows" in params and not 2 <= params["previewRows"] <= 8:
            return ["点阵预览层数必须在2至8"]
        allowed = {"lower", "upper", "previewRows"}
    if set(params) - allowed:
        return ["互动参数包含未实现字段"]
    return []


def check_lesson(question: dict, lesson: dict, gold: dict | None) -> dict:
    issues = []
    input_ok = question.get("state") == "confirmed" and not check_question(question)
    if not input_ok:
        issues.append("题面尚未完整确认")
    expected_ids = [p["id"] for p in question.get("parts", [])]
    covered = lesson.get("coveredPartIds", [])
    actual_ids = [p.get("partId") for p in lesson.get("parts", [])]
    coverage = set(expected_ids) == set(covered) == set(actual_ids) and len(actual_ids) == len(set(actual_ids)) and len(covered) == len(set(covered))
    if not coverage:
        issues.append("小问覆盖不完整或重复：" + ",".join(sorted(set(expected_ids) - set(actual_ids))))
    if lesson.get("questionRevision") != question.get("revision"):
        issues.append("教案对应旧题面版本")
    for part in lesson.get("parts", []):
        label = part.get("partId", "未知小问")
        for field in ("goal", "method", "verification", "summary"):
            if not isinstance(part.get(field), str) or not part[field].strip():
                issues.append(f"{label}缺少{field}")
        for field in ("known", "prerequisites"):
            if not isinstance(part.get(field), list) or not part[field] or any(not isinstance(x, str) or not x.strip() for x in part[field]):
                issues.append(f"{label}缺少{field}")
        steps = part.get("steps", [])
        if not steps or len({s.get("id") for s in steps}) != len(steps):
            issues.append(f"{label}没有完整且唯一的步骤")
        for step in steps:
            if any(not isinstance(step.get(f), str) or not step[f].strip() for f in ("id", "title", "explanation", "reason")):
                issues.append(f"{label}步骤缺少讲解或理由")
        mistakes = part.get("misconceptions", [])
        if not mistakes or any(not m.get("mistake") or not m.get("correction") for m in mistakes):
            issues.append(f"{label}没有易错及修正")
        answer = part.get("answer", {})
        if not answer.get("kind") or answer.get("value") is None or not answer.get("display"):
            issues.append(f"{label}没有完整结论")
        issues.extend(f"{label}：{x}" for x in _scene_issues(part.get("scene"), answer))
        if gold is not None and question.get("number") in {19, 26} and part.get("scene") is None:
            issues.append(f"{label}：本样卷核心互动目标要求提供与本小问对应的已实现互动场景")
        if gold is not None and part.get("scene") is not None:
            scene = part["scene"]
            number = question.get("number")
            params = scene.get("params", {})
            expected_part = next((p for p in gold.get("parts", []) if p["id"] == label), {})
            semantic = expected_part.get("semanticId", label)
            valid_sample = False
            if number == 19 and scene.get("kind") == "number-line" and isinstance(params, dict):
                if semantic in {"1", "2.1", "2.2"}:
                    left, right = (-1, 2) if semantic == "1" else (-2, 4)
                    valid_sample = answers_equal(params.get("left"), left) and answers_equal(params.get("right"), right) and "parameterName" not in params
                    if semantic == "2.2":
                        valid_sample = valid_sample and answers_equal(params.get("targetSum"), 8)
                    else:
                        valid_sample = valid_sample and "targetSum" not in params and ("targetMinimum" not in params or answers_equal(params["targetMinimum"], right - left))
                elif semantic == "2.3":
                    valid_sample = params.get("parameterName") == "a" and answers_equal(params.get("right"), 3) and answers_equal(params.get("targetMinimum"), 2) and "targetSum" not in params
            elif number == 26 and scene.get("kind") == "triangle-count" and isinstance(params, dict):
                valid_sample = params.get("lower") == 22 and params.get("upper") == 24
            if not valid_sample:
                issues.append(f"{label}：本样卷的受控场景仅支持第19题对应小问数轴与第26题22至24点阵，当前条件不对应")
    answer_ok = False
    if gold is not None:
        issues.extend(gold.get("mappingIssues", []))
        expected_parts = {p["id"]: p for p in gold.get("parts", [])}
        answer_ok = set(expected_parts) == set(actual_ids)
        for part in lesson.get("parts", []):
            expected = expected_parts.get(part.get("partId"), {}).get("expectedAnswer", {})
            actual = part.get("answer", {})
            kind_ok = actual.get("kind") == expected.get("kind") or {actual.get("kind"), expected.get("kind")} <= {"number", "numbers"}
            if expected.get("value") is None or not kind_ok or not answers_equal(actual.get("value"), expected.get("value")):
                issues.append(f"{part.get('partId')}结论未通过独立答案核验")
                answer_ok = False
    else:
        issues.append("当前题暂无独立答案核验清单，保留草稿")
    return {"inputConfirmed": input_ok, "coverage": coverage, "answerVerified": answer_ok,
            "reasoningReviewed": False, "issues": issues}
