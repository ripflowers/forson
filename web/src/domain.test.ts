import {describe,it,expect} from 'vitest';
import {distanceState,triangleState,evidenceLabel,validLesson,parseScene,restoreSession,sceneSnapshot,isCurrentReply,normalizePartLabel} from './domain';
import type {TeachingPackage,Session,AskResponse} from './types';
describe('可信探索计算',()=>{
  it('绝对值距离最小在整个闭区间，不只在中点',()=>{
    for(const x of [-1,-0.5,0,1,2]) expect(distanceState(-1,2,x).sum).toBe(3);
    expect(distanceState(-1,2,-1).inMinimumInterval).toBe(true);
    expect(distanceState(-1,2,2).inMinimumInterval).toBe(true);
  });
  it('离开区间的距离和按两倍超出量增加',()=>{
    expect(distanceState(-2,4,-3).sum).toBe(8);
    expect(distanceState(-2,4,5).sum).toBe(8);
    expect(distanceState(-2,4,5).excess).toBe(1);
    expect(distanceState(-2,4,5).sum).toBe(6+2*1);
  });
  it('参数固定点为负a；a为-1或-5时最小距离都是2',()=>{
    expect(distanceState(-(-1),3,2).minimum).toBe(2);
    expect(distanceState(-(-5),3,4).minimum).toBe(2);
  });
  it('八层共36点，24与22层差为23+24=47',()=>{
    expect(triangleState(6,8).upperCount).toBe(36);
    expect(triangleState(22,24)).toEqual({lowerCount:253,upperCount:300,added:47,addedRows:[23,24]});
  });
  it('拒绝不能安全绘制的模型场景参数',()=>{
    expect(parseScene({kind:'number-line',params:{left:1,right:1}})).toBeNull();
    expect(parseScene({kind:'triangle-count',params:{lower:22,upper:240000}})).toBeNull();
    expect(parseScene({kind:'script',params:{code:'alert(1)'}} as never)).toBeNull();
  });
  it('追問快照记录屏幕实际默认点位及当前参数',()=>{
    expect(sceneSnapshot({kind:'number-line',params:{left:-1,right:2}},{})).toEqual({x:0.5,left:-1,right:2});
    expect(sceneSnapshot({kind:'number-line',params:{left:1,right:3,parameterName:'a',parameterValue:-1}},{a:-3})).toEqual({a:-3,x:3,left:3,right:3});
  });
});
describe('追问晚回与原卷小问身份',()=>{
  const session:Session={questionId:'q19',questionRevision:1,lessonVersion:1,sessionRevision:1,partId:'2.2',stepIndex:2,mode:'explore',sceneState:{},reflection:'',returnTarget:null,updatedAt:''};
  const reply:AskResponse={id:'ask1',questionId:'q19',questionRevision:1,lessonVersion:1,partId:'2.2',mode:'explore',snapshot:{stepIndex:2,x:-3,left:-2,right:4},text:'为什么8？',answer:'示例',status:'checked',evidence:{},createdAt:''};
  it('旧小问、旧参数或旧模式的晚回不能标为当前现场补讲',()=>{
    const current={x:-3,left:-2,right:4};
    expect(isCurrentReply(reply,session,current)).toBe(true);
    expect(isCurrentReply({...reply,partId:'2.1'},session,current)).toBe(false);
    expect(isCurrentReply(reply,session,{...current,x:5})).toBe(false);
    expect(isCurrentReply(reply,{...session,mode:'teacher'},current)).toBe(false);
  });
  it('用户填写的卷内标记规范化为语义小问，而非随机身份',()=>{
    expect(normalizePartLabel('（2）②')).toBe('2.2');
    expect(normalizePartLabel('(2)③')).toBe('2.3');
    expect(normalizePartLabel('(1)')).toBe('1');
    expect(normalizePartLabel('本题')).toBe('main');
    expect(normalizePartLabel('')).toBeNull();
  });
});
describe('恢复课堂时保留真实版本和未同步原话',()=>{
  const fresh:Session={questionId:'q1',questionRevision:2,lessonVersion:3,sessionRevision:0,partId:'p1',stepIndex:0,mode:'teacher',sceneState:{},reflection:'',returnTarget:null,updatedAt:''};
  it('刷新恢复同版服务器位置，不自动改变模式',()=>{
    const remote={...fresh,sessionRevision:4,stepIndex:2,mode:'explore' as const,sceneState:{x:5},reflection:'我还不明白区间外为什么两倍'};
    expect(restoreSession(remote,null,fresh).session).toEqual(remote);
  });
  it('旧题面现场不装进新版课堂',()=>{
    const remote={...fresh,questionRevision:1,stepIndex:5};
    expect(restoreSession(remote,null,fresh).session.stepIndex).toBe(0);
    expect(restoreSession(remote,null,fresh).stale).toBe(true);
  });
  it('跨页写冲突不静默覆盖本机原话和参数',()=>{
    const remote={...fresh,sessionRevision:5,reflection:'另一个页面'};
    const local={...fresh,sessionRevision:4,reflection:'我的未同步原话',mode:'explore' as const,sceneState:{x:-3}};
    const restored=restoreSession(remote,{session:local,dirty:true},fresh);
    expect(restored.conflict).toBe(true);
    expect(restored.session.reflection).toBe('我的未同步原话');
    expect(restored.session.sceneState).toEqual({x:-3});
  });
});
describe('课程与学习证据边界',()=>{
  it('孩子原话、系统观察、读过小问都不等于掌握',()=>{
    expect(evidenceLabel({authorKind:'learner',kind:'note'})).toBe('我的原话');
    expect(evidenceLabel({authorKind:'system-observation',kind:'observation'})).toBe('系统观察');
    expect(evidenceLabel({authorKind:'system',kind:'lesson-part-viewed'})).toBe('读过本小问主线');
    expect(evidenceLabel({authorKind:'system',kind:'question-finished'})).not.toContain('掌握');
  });
  it('旧版、漏小问、仅答案或核验失败的教案不能正式上课',()=>{
    const part={partId:'p1',label:'(1)',goal:'求最小值',known:['固定两点'],prerequisites:['距离'],method:'数轴',steps:[{id:'s1',title:'化距离',explanation:'读取表达式',reason:'绝对值是距离',formulaLatex:'|x+1|'}],answer:{kind:'number',value:3,display:'3'},verification:'核对端点',misconceptions:[{mistake:'只有中点',correction:'整个区间'}],summary:'比较距离',scene:null};
    const lesson:TeachingPackage={id:'l1',questionId:'q1',lessonVersion:1,reviewLevel:'auto_checked',model:'test',createdAt:'',concepts:['距离'],status:'ready',questionRevision:1,coveredPartIds:['p1'],parts:[part],checks:{inputConfirmed:true,coverage:true,answerVerified:true,reasoningReviewed:true,issues:[]}};
    expect(validLesson(lesson,1,['p1'])).toBe(true);
    expect(validLesson(lesson,2,['p1'])).toBe(false);
    expect(validLesson(lesson,1,['p1','p2'])).toBe(false);
    expect(validLesson({...lesson,parts:[{...part,steps:[]}]},1,['p1'])).toBe(false);
    expect(validLesson({...lesson,checks:{...lesson.checks,answerVerified:false}},1,['p1'])).toBe(false);
  });
});
