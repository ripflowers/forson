import copy
import json
import re

from .config import ROOT


REVIEW_FIELDS = {"goal", "known", "prerequisites", "method", "answer", "verification", "misconceptions", "summary", "scene"}


def remap_gold_parts(question, gold):
    expected = {p["id"] for p in gold.get("parts", [])}
    mapping = {}
    issues = []
    circles = {"①": "1", "②": "2", "③": "3", "④": "4"}
    for part in question.get("parts", []):
        semantic = part["id"] if part["id"] in expected else None
        if semantic is None and expected == {"main"} and len(question.get("parts", [])) == 1:
            semantic = "main"
        if semantic is None:
            label = re.sub(r"第\s*\d+\s*题", "", part.get("label", "")).strip()
            match = re.search(r"[（(]\s*(\d+)\s*[）)]\s*([①②③④]?)", label)
            if match:
                semantic = match.group(1) + ("." + circles[match.group(2)] if match.group(2) else "")
            elif re.fullmatch(r"\d+(?:\.\d+)?", label):
                semantic = label
        if semantic not in expected or semantic in mapping:
            issues.append(f"小问{part['id']}标签无法唯一对应原图叶小问，请标明(1)/(2)①等")
        else:
            mapping[semantic] = part["id"]
    if set(mapping) != expected:
        issues.append("原图叶小问尚未完整对应：" + ",".join(sorted(expected - set(mapping))))
    mapped = copy.deepcopy(gold)
    for part in mapped.get("parts", []):
        semantic = part["id"]
        part["semanticId"] = semantic
        part["id"] = mapping.get(semantic, "unmapped:" + semantic)
    mapped.update(partIdMap=mapping, mappingIssues=issues)
    return mapped


def sample_gold(paper, question):
    """Read the independently prepared benchmark only in the verification stage."""
    hashes_path = ROOT / "server" / "sample-source-hashes.json"
    if not hashes_path.exists() or paper.get("sourceHashes") != json.loads(hashes_path.read_text()):
        return None
    manifest = ROOT / "data" / "sample_manifest.json"
    if not manifest.exists():
        return None
    gold = next((q for q in json.loads(manifest.read_text())["questions"] if q["number"] == question["number"]), None)
    return remap_gold_parts(question, gold) if gold else None


def sample_conditions_compatible(question):
    if question.get("number") != 15:
        return True
    text = question.get("stem", "") + " ".join(p.get("prompt", "") for p in question.get("parts", []))
    clean = re.sub(r"\s+", "", text).replace("−", "-").replace("﹣", "-").replace("\\left", "").replace("\\right", "").replace("\\cdot", "*")
    # The third minus is the known fragile source condition; never repair it from the expected answer.
    negative_term = re.search(r"(?:-3\*?\\(?:frac|dfrac|tfrac)\{\|a\+b\|\}\{c\}|-\\(?:frac|dfrac|tfrac)\{3\*?\|a\+b\|\}\{c\}|-3\*?\|a\+b\|/c)", clean)
    return ("abc<0" in clean or "a*b*c<0" in clean) and "a+b+c=0" in clean and bool(negative_term)


def review_passes(review, gold, lesson=None):
    issues = []
    if review.get("inputEquivalent") is not True:
        issues.append("校对题面与独立原图清单的条件不一致或尚未确认")
    if review.get("inputIssues"):
        issues.append("题面审核仍有未解决问题：" + str(review["inputIssues"]))
    issues.extend(gold.get("mappingIssues", []))
    expected = {p["id"]: p for p in gold.get("parts", [])}
    actual = review.get("parts", [])
    lesson_parts = {p.get("partId"): p for p in (lesson or {}).get("parts", [])}
    if {p.get("partId") for p in actual} != set(expected) or len(actual) != len(expected):
        issues.append("理由复核未覆盖全部小问")
    for part in actual:
        target = expected.get(part.get("partId"))
        if target is None:
            issues.append("理由复核引用未知小问")
            continue
        if part.get("reasoningCorrect") is not True or part.get("issue"):
            issues.append(f"{part['partId']}理由仍有问题：{part.get('issue') or '未核对'}")
        current = lesson_parts.get(part["partId"], {})
        field_checks = part.get("fieldChecks")
        if not isinstance(field_checks, list):
            field_checks = []
        field_ids = [item.get("field") for item in field_checks if isinstance(item, dict)]
        if set(field_ids) != REVIEW_FIELDS or len(field_checks) != len(REVIEW_FIELDS) or len(field_ids) != len(field_checks):
            issues.append(f"{part['partId']}字段审核未唯一覆盖全部九个教学字段")
        for item in field_checks:
            if not isinstance(item, dict) or item.get("correct") is not True or item.get("issue") != "":
                field = item.get("field", "未知") if isinstance(item, dict) else "未知"
                issues.append(f"{part['partId']}字段{field}未通过完整数学审核")
        step_checks = part.get("stepChecks")
        if not isinstance(step_checks, list):
            step_checks = []
        expected_steps = [step["id"] for step in current.get("steps", [])]
        reviewed_steps = [item.get("stepId") for item in step_checks if isinstance(item, dict)]
        if set(reviewed_steps) != set(expected_steps) or len(step_checks) != len(expected_steps) or len(reviewed_steps) != len(step_checks) or len(reviewed_steps) != len(set(reviewed_steps)):
            issues.append(f"{part['partId']}逐步审核未唯一覆盖当前全部实际步骤")
        for item in step_checks:
            if not isinstance(item, dict):
                issues.append(f"{part['partId']}逐步审核格式不完整")
                continue
            for field in ("explanation", "reason", "formulaLatex"):
                result = item.get(field)
                if not isinstance(result, dict) or result.get("correct") is not True or result.get("issue") != "":
                    # Keep the reviewer details in the private raw review, not in repair feedback.
                    issues.append(f"{part['partId']}步骤{item.get('stepId')}.{field}未通过逐步数学审核")
        checks = part.get("checks", [])
        count = len(target.get("requiredReasoning", []))
        if {c.get("index") for c in checks} != set(range(count)) or len(checks) != count:
            issues.append(f"{part['partId']}关键理由条目缺失或重复")
        for check in checks:
            if check.get("supported") is not True or not str(check.get("evidence", "")).strip() or check.get("issue"):
                issues.append(f"{part['partId']}关键理由{check.get('index')}未被教案支持：{check.get('issue') or '没有逐项依据'}")
            current = lesson_parts.get(part["partId"], {})
            source = check.get("source", {})
            if not isinstance(source, dict):
                issues.append(f"{part['partId']}关键理由{check.get('index')}引用来源不是有效定位对象")
                continue
            quoted = check.get("quote", "")
            text = None
            if source.get("kind") == "step" and source.get("field") in {"explanation", "reason", "formulaLatex"}:
                step = next((s for s in current.get("steps", []) if s.get("id") == source.get("stepId")), {})
                text = step.get(source["field"])
            elif source.get("kind") == "field" and source.get("field") in {"method", "verification", "summary", "known", "prerequisites", "answer.display"}:
                field = source["field"]
                if field == "answer.display":
                    text = current.get("answer", {}).get("display")
                elif field in {"known", "prerequisites"}:
                    values = current.get(field, [])
                    index = source.get("itemIndex")
                    text = values[index] if isinstance(index, int) and 0 <= index < len(values) else None
                else:
                    text = current.get(field)
            if not isinstance(quoted, str) or not quoted.strip() or not isinstance(text, str) or quoted not in text:
                issues.append(f"{part['partId']}关键理由{check.get('index')}引用未逐字出现在当前小问教案中")
    return not issues, issues
