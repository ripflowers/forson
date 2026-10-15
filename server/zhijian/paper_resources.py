"""Reviewed sample-paper visual models. Values are data, never executable expressions."""
import json
import math
from pathlib import Path

from .store import Invalid

CATALOG = json.loads((Path(__file__).resolve().parents[2] / 'web/src/paper-resources/catalog.json').read_text())
PAPER_TEMPLATES = frozenset(item['key'] for item in CATALOG)


def matching_recipe(target):
    return next((item for item in CATALOG if item['target'] == target), None)


def paper_scene_context(part, snapshot):
    """Rebind submitted controls to the actual lesson; discard client-computed conclusions."""
    from .motion_resources import canonical_hash
    from .videos import approved_part

    key = snapshot.get('paperResource')
    if key is None:
        return None
    recipe = next((item for item in CATALOG if item['key'] == key and item['partId'] == part['partId']
                   and item['target']['lessonHash'] == canonical_hash(approved_part(part))), None)
    if recipe is None:
        raise Invalid('探索资源与当前小问内容不一致，请重新打开课堂')
    state = snapshot.get('paperInputs')
    if not isinstance(state, dict) or set(state) != {c['key'] for c in recipe['controls']}:
        raise Invalid('探索现场缺少本小问的完整参数')
    controls = []
    for control in recipe['controls']:
        value = state[control['key']]
        if type(value) not in (int, float) or not math.isfinite(value) or not control['min'] <= value <= control['max']:
            raise Invalid('探索参数超出本小问允许的范围')
        if control['step'] == 1 and int(value) != value:
            raise Invalid('当前探索参数必须为整数')
        controls.append({'name': control['key'], 'meaning': control['label'], 'value': value,
                         **({'selectedOption': control['options'][int(value)]} if 'options' in control else {})})
    return {'kind': 'reviewed-paper-experiment', 'resource': key, 'title': recipe['title'],
            'action': recipe['action'], 'task': recipe['task'], 'validatedControls': controls,
            'interpretation': '这是观察用的具体示例，不能替代原题一般性证明。请依据已核验教案和这些参数重新计算，不采信客户端的派生结论。'}
