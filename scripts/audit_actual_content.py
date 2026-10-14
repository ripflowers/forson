#!/usr/bin/env python3
"""GET actual persisted content and prepare an independent leaf-by-leaf audit.

No writes to the application, paid AI calls, generation, gold corrections, or
automatic assertion of pedagogical correctness. Reports are local artifacts.
"""
import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]


def read(base, path):
    with urlopen(base.rstrip("/") + "/api" + path, timeout=30) as response:
        return json.load(response)


def semantic_label(part, expected, single):
    if part["id"] in expected:
        return part["id"]
    if single and expected == {"main"}:
        return "main"
    label = re.sub(r"第\s*\d+\s*题", "", part.get("label", "")).strip()
    matched = re.fullmatch(r"[（(]\s*(\d+)\s*[）)]\s*([①②③④]?)", label)
    if matched:
        sub = "①②③④".find(matched[2]) + 1 if matched[2] else None
        return matched[1] + (f".{sub}" if sub else "")
    return label if re.fullmatch(r"\d+(?:\.\d+)?", label) else None


def teaching_issues(part):
    if not part:
        return ["无实际讲义"]
    issues = []
    for key in ("goal", "method", "verification", "summary"):
        if not isinstance(part.get(key), str) or not part[key].strip():
            issues.append(f"{key}为空")
    for key in ("known", "prerequisites"):
        values = part.get(key)
        if not isinstance(values, list) or not values or any(not isinstance(x, str) or not x.strip() for x in values):
            issues.append(f"{key}缺少有效条目")
    steps = part.get("steps", [])
    if not steps or len({step.get("id") for step in steps}) != len(steps):
        issues.append("步骤为空或标识重复")
    for step in steps:
        for key in ("id", "title", "explanation", "reason"):
            if not isinstance(step.get(key), str) or not step[key].strip():
                issues.append(f"步骤{step.get('id')}缺少{key}")
    answer = part.get("answer", {})
    if not answer.get("kind") or answer.get("value") is None or not answer.get("display"):
        issues.append("结论不完整")
    mistakes = part.get("misconceptions", [])
    if not mistakes or any(not m.get("mistake") or not m.get("correction") for m in mistakes):
        issues.append("易错与纠正缺失")
    return issues


def md_value(value):
    return json.dumps(value, ensure_ascii=False, indent=2) if not isinstance(value, str) else value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--paper-id", required=True)
    parser.add_argument("--base", default="http://127.0.0.1:8787")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    destination = args.output or ROOT / "data/runtime/evidence" / f"independent-content-{args.paper_id}-{stamp}.json"
    original = read(args.base, "/papers/" + quote(args.paper_id, safe=""))
    gold = json.loads((ROOT / "data/sample_manifest.json").read_text())
    numbers = [q["number"] for q in original["questions"]]
    questions = {q["number"]: q for q in original["questions"]}
    expected_numbers = {q["number"] for q in gold["questions"]}
    report = {"evidenceKind": "actual-api-read-only-independent-audit", "fetchedAt": datetime.now(timezone.utc).isoformat(),
              "paperId": args.paper_id, "paperState": original["paper"]["state"], "referenceStatus": gold["reviewStatus"],
              "missingQuestions": sorted(expected_numbers - set(numbers)), "unexpectedQuestions": sorted(set(numbers) - expected_numbers),
              "duplicateQuestionNumbers": sorted({n for n in numbers if numbers.count(n) > 1}),
              "manualContentReview": "pending", "notes": ["字段与ready门禁齐全不代表数学或教学正确。", "需要独立逐图核对题设、逐步数学理由及孩子可理解性。"], "parts": []}
    pages = ["# 实际课程逐叶内容审核材料", "", f"试卷：{args.paper_id}", f"读取时间：{report['fetchedAt']}",
             "", "本材料只读真实 API，不生成、修改或补预置教案；数学理由与教学完整性待独立审阅。", ""]
    for reference in gold["questions"]:
        q = questions.get(reference["number"])
        lesson, error = None, None
        if q:
            try:
                lesson = read(args.base, "/questions/" + quote(q["id"], safe="") + "/lesson").get("lesson")
            except HTTPError as exc:
                error = f"课程读取HTTP{exc.code}"
        expected_ids = {p["id"] for p in reference["parts"]}
        mapping, ambiguous = {}, []
        for part in q.get("parts", []) if q else []:
            identity = semantic_label(part, expected_ids, len(q["parts"]) == 1)
            if identity not in expected_ids or identity in mapping:
                ambiguous.append(part["id"])
            else:
                mapping[identity] = part["id"]
        actual_parts = {part["partId"]: part for part in lesson.get("parts", [])} if lesson else {}
        pages += [f"## 第{reference['number']}题", "", "### 实际校对题面", "", md_value({key: q.get(key) for key in ("stem", "options", "figureDescription", "parts", "missingFields")} if q else "题目缺失"), ""]
        for target in reference["parts"]:
            actual_id = mapping.get(target["id"])
            part = actual_parts.get(actual_id)
            issues = teaching_issues(part)
            checks = lesson.get("checks", {}) if lesson else {}
            current = bool(q and lesson and q["state"] == "confirmed" and lesson.get("questionRevision") == q["revision"])
            gate = bool(current and lesson.get("status") == "ready" and all(checks.get(k) is True for k in ("inputConfirmed", "coverage", "answerVerified", "reasoningReviewed")) and not checks.get("issues") and not issues and not ambiguous)
            blocked = bool(reference["needsCompletion"] and q and q["state"] == "needs_completion" and not gate)
            row = {"question": reference["number"], "semanticPartId": target["id"], "actualPartId": actual_id,
                   "questionRevision": q["revision"] if q else None, "lessonVersion": lesson.get("lessonVersion") if lesson else None,
                   "currentLesson": current, "lessonStatus": lesson.get("status") if lesson else None, "readError": error,
                   "ambiguousPartIds": ambiguous, "teachingFieldIssues": issues, "structurallyCompleteAndReady": gate,
                   "blockedExpected": reference["needsCompletion"], "blockedCorrectly": blocked,
                   "actualAnswer": part.get("answer") if part else None, "referenceAnswer": target["expectedAnswer"],
                   "requiredReasoning": target["requiredReasoning"], "actualLessonPart": part,
                   "modelChecks": checks, "manualReview": {"status": "pending", "findings": []}}
            report["parts"].append(row)
            pages += [f"### 叶小问 {target['id']} / API {actual_id or '缺失'}", "", f"当前课程：{row['lessonStatus']}；结构门禁：{gate}；预期阻断：{row['blockedExpected']}。", "", "独立预期结论：", "", md_value(target["expectedAnswer"]), "", "必须讲明的理由：", "", "\n".join(f"- {x}" for x in target["requiredReasoning"]), "", "实际模型讲义：", "", md_value(part or "无讲义"), "", "独立内容结论：待审阅，不从模型自评自动通过。", ""]
    report["expectedQuestions"] = len(expected_numbers)
    report["actualQuestions"] = len(numbers)
    report["actualExtractedLeafParts"] = sum(len(q.get("parts", [])) for q in original["questions"])
    report["expectedLeafParts"] = len(report["parts"])
    report["solvableLeafParts"] = sum(not part["blockedExpected"] for part in report["parts"])
    report["structurallyReadyLeafParts"] = sum(part["structurallyCompleteAndReady"] for part in report["parts"])
    report["blockedLeafPartsCorrectly"] = sum(part["blockedCorrectly"] for part in report["parts"])
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    destination.with_suffix(".md").write_text("\n".join(pages))
    print(json.dumps({key: report[key] for key in ("paperState", "actualQuestions", "actualExtractedLeafParts", "expectedLeafParts", "solvableLeafParts", "structurallyReadyLeafParts", "blockedLeafPartsCorrectly", "manualContentReview")}, ensure_ascii=False))
    print("Reports:", destination, destination.with_suffix(".md"))


if __name__ == "__main__":
    main()
