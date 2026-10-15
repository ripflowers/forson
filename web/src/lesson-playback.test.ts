import {describe,it,expect} from 'vitest';
import {canPlayLesson,stageDuration,nextStage,stageText,teachingSnapshot,canResumeAfterAnswer} from './lesson-playback';
import type {LessonPart} from './types';
const part={goal:'理解新增的两行',known:['第n个三角形有n行'],prerequisites:['每行点数'],method:'共同部分相减',steps:[{id:'s1',title:'写成和',explanation:'每行k个点',reason:'点不重复',formulaLatex:'T_n=1+2+\\cdots+n'}],answer:{display:'47'},verification:'300−253=47',misconceptions:[{mistake:'序号等于点数',correction:'序号是行数'}],summary:'只数新增部分'} as LessonPart;
describe('真实课堂连续播放的边界',()=>{
  it('追问/探索/离开/隐藏/保存冲突都阻止推进',()=>{
    expect(canPlayLesson(true,false,'teacher',true,'saved')).toBe(true);
    expect(canPlayLesson(true,true,'teacher',true,'saved')).toBe(false);
    expect(canPlayLesson(true,false,'explore',true,'saved')).toBe(false);
    expect(canPlayLesson(false,false,'teacher',true,'saved')).toBe(false);
    expect(canPlayLesson(true,false,'teacher',false,'saved')).toBe(false);
    expect(canPlayLesson(true,false,'teacher',true,'conflict')).toBe(false);
  });
  it('保留原教案步序，最后停在收束而不越过小问',()=>{
    expect(nextStage(1,4)).toBe(2);expect(nextStage(3,4)).toBeNull();
    expect(stageText(part,2)).toContain('每行k个点');
    expect(stageText(part,3)).toContain('300−253=47');
  });
  it('长讲解获得更长的阅读时间；图示至少留足建立直觉的时间',()=>{
    expect(stageDuration(part,0)).toBeGreaterThanOrEqual(16);
    const long={...part,method:'完整推理'.repeat(80)};
    expect(stageDuration(long,1)).toBeGreaterThan(stageDuration(part,1));
  });
  it('追问绑定当前动画画面，不能退回默认3行或默认中点',()=>{
    const shot=teachingSnapshot({rows:6,cue:'共同部分消去',originalComparisonVisible:true},4,{});
    expect(shot.rows).toBe(6);expect(shot.stepIndex).toBe(4);expect(shot.cue).toBe('共同部分消去');
    const number=teachingSnapshot({x:-3,a:-5,left:5,right:3},2,{});
    expect(number.x).toBe(-3);expect(number.a).toBe(-5);
  });
});


describe('补讲完成后续讲的权限',()=>{
  const intent={identity:'q26:r4:v3:main',wasPlaying:true,frame:3811};
  it('仅在原来正在播放且同一课堂可见时续讲',()=>{
    expect(canResumeAfterAnswer(intent,intent.identity,true,true,true,'teacher','saved')).toBe(true);
    expect(canResumeAfterAnswer({...intent,wasPlaying:false},intent.identity,true,true,true,'teacher','saved')).toBe(false);
    expect(canResumeAfterAnswer(null,intent.identity,true,true,true,'teacher','saved')).toBe(false);
  });
  it('换课、离开、隐藏、未核验、探索或保存冲突都不能自动发声',()=>{
    expect(canResumeAfterAnswer(intent,'q26:r4:v4:main',true,true,true,'teacher','saved')).toBe(false);
    expect(canResumeAfterAnswer(intent,intent.identity,true,false,true,'teacher','saved')).toBe(false);
    expect(canResumeAfterAnswer(intent,intent.identity,true,true,false,'teacher','saved')).toBe(false);
    expect(canResumeAfterAnswer(intent,intent.identity,false,true,true,'teacher','saved')).toBe(false);
    expect(canResumeAfterAnswer(intent,intent.identity,true,true,true,'explore','saved')).toBe(false);
    expect(canResumeAfterAnswer(intent,intent.identity,true,true,true,'teacher','conflict')).toBe(false);
  });
});
