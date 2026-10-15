"""All authored leaf resources must bind, freeze and reject another lesson's model."""
import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError
from zhijian.motion_resources import MotionPackInput, MotionResourceStore, validate_motion_pack
from zhijian.paper_resources import CATALOG, paper_scene_context
from zhijian.store import Invalid, Conflict
from zhijian.videos import VideoRequest, VideoStore

ROOT = Path(__file__).resolve().parents[2]
SOURCES = json.loads((ROOT/'resources/codex/paper/lesson-sources.json').read_text())

def source(recipe):
    raw = next(s for s in SOURCES if s['question']['number'] == recipe['number'])
    return copy.deepcopy(raw['question']), copy.deepcopy(raw['lesson'])

def pack_data(recipe):
    return json.loads((ROOT/f'resources/codex/paper/q{recipe["number"]}-{recipe["partId"].replace(".","-")}.json').read_text())

@pytest.mark.parametrize('recipe', CATALOG, ids=[r['key'] for r in CATALOG])
def test_each_leaf_imports_reads_and_freezes_exact_stage_coverage(tmp_path, recipe):
    q,l=source(recipe); store=MotionResourceStore(tmp_path); store.initialize()
    data=pack_data(recipe); pack=store.create(q,l,MotionPackInput.model_validate(data))
    assert store.current(q,l,l['lessonVersion'],recipe['partId']) == pack
    assert validate_motion_pack(pack,q,l,l['lessonVersion'],recipe['partId']) == pack
    video_store=VideoStore(tmp_path); video_store.initialize()
    video=video_store.create(q,l,VideoRequest(expectedRevision=q['revision'],lessonVersion=l['lessonVersion'],partId=recipe['partId'],motionPackId=pack['id']),motion_pack=pack)
    assert video['motionPackId'] == pack['id']
    context=store.context(q,l,l['lessonVersion'],recipe['partId'])
    assert context['templateConstraints']['stageCount']==len(context['part']['steps'])+3==len(data['stages'])
    assert context['validation']['teacherReviewed'] is False

@pytest.mark.parametrize('defect',['hash','revision','template','missing-stage','part'])
def test_other_content_or_incomplete_resources_cannot_replace_approved_course(tmp_path,defect):
    r=CATALOG[0];q,l=source(r);data=pack_data(r);store=MotionResourceStore(tmp_path);store.initialize()
    if defect=='hash':data['target']['lessonHash']='a'*64
    elif defect=='revision':data['target']['questionRevision']-=1
    elif defect=='template':data['stages'][0]['template']=CATALOG[1]['key']
    elif defect=='missing-stage':data['stages'].pop()
    else:data['target']['partId']='unrelated'
    with pytest.raises((Invalid,Conflict,ValidationError)):store.create(q,l,MotionPackInput.model_validate(data))
    assert not list(store.root.iterdir())

def test_missing_q11_never_gets_a_resource():
    q=next(s for s in SOURCES if s['question']['number']==11)
    assert q['lesson'] is None and q['question']['missingFields']
    assert not any(r['number']==11 for r in CATALOG)

@pytest.mark.parametrize('recipe',CATALOG,ids=[r['key'] for r in CATALOG])
def test_question_context_validates_controls_and_does_not_trust_client_calculations(recipe):
    _,l=source(recipe);p=next(p for p in l['parts'] if p['partId']==recipe['partId'])
    state={c['key']:c['value'] for c in recipe['controls']}
    snapshot={'paperResource':recipe['key'],'paperInputs':state,'paperFacts':{'answer':'fake'}}
    context=paper_scene_context(p,snapshot)
    assert context['resource']==recipe['key'] and 'fake' not in json.dumps(context)
    snapshot['paperInputs']={**state,recipe['controls'][0]['key']:float('nan')}
    with pytest.raises(Invalid):paper_scene_context(p,snapshot)
    snapshot['paperResource']='paper-q11-main-v1'
    with pytest.raises(Invalid):paper_scene_context(p,snapshot)
