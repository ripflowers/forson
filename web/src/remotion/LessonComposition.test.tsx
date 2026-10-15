import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import type {ReactNode} from 'react';
import type {LessonPart} from '../types';
import type {Narration} from '../narration';
import {LessonComposition} from './LessonComposition';
import {lessonTimeline} from './timeline';

const clock=vi.hoisted(()=>({frame:0}));
vi.mock('remotion',async()=>{
  const actual=await vi.importActual<typeof import('remotion')>('remotion');
  return{...actual,useCurrentFrame:()=>clock.frame,useVideoConfig:()=>({fps:30}),delayRender:()=>0,continueRender:()=>{},
    AbsoluteFill:({children,className}:{children:ReactNode;className:string})=><div className={className}>{children}</div>,
    Sequence:({children}:{children:ReactNode})=><>{children}</>,
    Html5Audio:({src}:{src:string})=><audio src={src}/>,
  };
});

const part:LessonPart={partId:'main',label:'本题',goal:'理解相同部分可以抵消',known:['第一组有四行'],prerequisites:['掌握逐行累加'],method:'找出共同部分',steps:[{id:'s1',title:'保留新增行',explanation:'先将两组共同部分对齐',reason:'减掉相同数量后只留下新增行',formulaLatex:'T_6-T_4=5+6=11'}],answer:{kind:'integer',value:11,display:'答案为十一'},verification:'二十一减十等于十一',misconceptions:[{mistake:'不要把行数当成石子总数',correction:'每一行要按实际石子数量计数'}],summary:'遇到求差先找共同部分',scene:null};
const render=(canvasOnly=true,lesson=part,narration?:Narration)=>renderToStaticMarkup(<LessonComposition part={lesson} canvasOnly={canvasOnly} narration={narration}/>);

describe('聚焦课堂画布',()=>{
  it('无配音的普通题仍逐段讲完整条件、推理原因、检验和误区',()=>{
    const timeline=lessonTimeline(part);
    const html=timeline.stages.flatMap(stage=>Array.from({length:11},(_,index)=>{
      clock.frame=stage.from+Math.floor((stage.durationInFrames-1)*index/10);
      return render();
    })).join('');
    for(const text of [part.goal,...part.known,...part.prerequisites,part.method,part.steps[0].explanation,part.steps[0].reason,part.verification,part.misconceptions[0].mistake,part.misconceptions[0].correction,part.summary])expect(html).toContain(text);
    expect(html).toContain('随板书推进的老师讲解');
    expect(html).not.toContain('lc-header');expect(html).not.toContain('lc-knowledge');expect(html).not.toContain('lc-footer');
  });
  it('有图的课堂去掉额外全量公式表，但视频继续保留标题和公式',()=>{
    const visual={...part,scene:{kind:'triangle-count' as const,params:{lower:4,upper:6}}};
    clock.frame=lessonTimeline(visual).stages[2].from+90;
    const canvas=render(true,visual),video=render(false,visual);
    expect(canvas).toContain('三角形数的动态板书');expect(canvas).not.toContain('lc-visual-proof');expect(canvas).not.toContain('lc-formula-ledger');
    expect(video).toContain('lc-header');expect(video).toContain('lc-knowledge');expect(video).toContain('lc-footer');expect(video).toContain('lc-formula-ledger');
    expect(video).not.toContain('随板书推进的老师讲解');
  });
  it('有配音时使用同一时刻的口述，不同时展示另一段文字讲解',()=>{
    const narration:Narration={id:'voice-main',state:'ready',questionId:'q',questionRevision:1,lessonVersion:1,partId:'main',lessonHash:'hash',voice:'teacher',fps:30,stageDurations:[120,120,120,120],durationInFrames:480,clips:[{id:'clip-first',stageIndex:0,text:'看一看两组有哪些相同的行。',from:0,audioFrames:90,durationInFrames:120,audioUrl:'/audio/first.mp3',visualFrom:0,visualTo:2}]};
    clock.frame=45;
    const html=render(true,part,narration);
    expect(html).toContain('data-clip-id="clip-first"');expect(html).toContain('看一看两组有哪些相同的行。');expect(html).toContain('/audio/first.mp3');
    expect(html).not.toContain('随板书推进的老师讲解');
    clock.frame=100;
    const gap=render(true,part,narration);
    expect(gap).toContain('data-speaking="false"');expect(gap).toContain('观察板书 · 稍作停留');
  });
});
