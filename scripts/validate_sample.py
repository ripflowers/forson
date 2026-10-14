#!/usr/bin/env python3
"""Read actual persisted OCR/lessons and report every question and leaf part.

This script never fabricates OCR, applies the reference as a correction, or
creates a lesson. The reference is used only after fetching real API output.
"""
import argparse
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def get(base, route):
    with urllib.request.urlopen(base + route, timeout=20) as r:
        return json.load(r)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--paper-id', required=True)
    p.add_argument('--base', default='http://127.0.0.1:8787')
    p.add_argument('--output', default=str(ROOT / 'data/runtime/evidence/sample-coverage.json'))
    args = p.parse_args()
    reference = json.loads((ROOT / 'data/sample_manifest.json').read_text())
    actual = get(args.base, '/api/papers/' + args.paper_id)
    questions = {q['number']: q for q in actual['questions']}
    expected_numbers = {q['number'] for q in reference['questions']}
    report = {
        'evidenceKind': 'actual-api-persisted-content',
        'paperId': args.paper_id,
        'referenceStatus': reference['reviewStatus'],
        'expectedQuestions': len(expected_numbers),
        'actualQuestions': len(questions),
        'missingQuestions': sorted(expected_numbers - set(questions)),
        'unexpectedQuestions': sorted(set(questions) - expected_numbers),
        'parts': [],
        'notes': ['结构完整不等于教学正确；答案与必要理由需按独立核验及原图审核。', '第11题缺定义必须保持阻塞，不能纳入完整授课分子。'],
    }
    required = ['goal', 'known', 'prerequisites', 'method', 'steps', 'answer', 'verification', 'misconceptions', 'summary']
    for rq in reference['questions']:
        q = questions.get(rq['number'])
        package = get(args.base, '/api/questions/' + q['id'] + '/lesson').get('lesson') if q else None
        by_id = {x['partId']: x for x in package.get('parts', [])} if package else {}
        part_id_map = package.get('checks', {}).get('partIdMap', {}) if package else {}
        current = bool(q and package and package.get('questionRevision') == q['revision'])
        for rp in rq['parts']:
            actual_part_id = part_id_map.get(rp['id'], rp['id'])
            part = by_id.get(actual_part_id)
            missing = [key for key in required if not part or not part.get(key)]
            reasons_complete = bool(part and part.get('steps') and all(x.get('reason') and x.get('explanation') for x in part['steps']))
            row = {
                'question': rq['number'], 'partId': rp['id'],
                'actualPartId': actual_part_id,
                'inputPresent': bool(q and actual_part_id in {x['id'] for x in q['parts']}),
                'questionRevision': q['revision'] if q else None,
                'currentLesson': current,
                'lessonStatus': package.get('status') if package else None,
                'missingTeachingFields': missing,
                'stepReasonsPresent': reasons_complete,
                'answerFromActualModel': part.get('answer') if part else None,
                'expectedAnswer': rp['expectedAnswer'],
                'requiredReasoning': rp['requiredReasoning'],
                'checks': package.get('checks') if package else None,
            }
            row['structurallyCompleteAndReady'] = bool(current and package['status'] == 'ready' and not missing and reasons_complete)
            row['blockedExpected'] = rq['needsCompletion']
            row['blockedCorrectly'] = bool(rq['needsCompletion'] and q and q['state'] == 'needs_completion' and not row['structurallyCompleteAndReady'])
            report['parts'].append(row)
    report['expectedParts'] = len(report['parts'])
    report['completeReadyParts'] = sum(x['structurallyCompleteAndReady'] for x in report['parts'])
    report['blockedPartsCorrectly'] = sum(x['blockedCorrectly'] for x in report['parts'])
    report['structuralGatePassed'] = bool(
        not report['missingQuestions'] and not report['unexpectedQuestions']
        and all(x['inputPresent'] for x in report['parts'])
        and all(x['blockedCorrectly'] if x['blockedExpected'] else x['structurallyCompleteAndReady'] for x in report['parts'])
    )
    dest = Path(args.output)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ['expectedQuestions', 'actualQuestions', 'expectedParts', 'completeReadyParts', 'blockedPartsCorrectly', 'structuralGatePassed']}, ensure_ascii=False))
    print('Detailed evidence:', dest)
    raise SystemExit(0 if report['structuralGatePassed'] else 1)


if __name__ == '__main__':
    main()
