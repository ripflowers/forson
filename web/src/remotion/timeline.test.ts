import {describe,it,expect} from 'vitest';
import type {LessonPart} from '../types';
import type {Narration} from '../narration';
import {stageDuration} from '../lesson-playback';
import {lessonFrameState,lessonTimeline,narrationCards,timedNarrationClips} from './timeline';
import {chunkNarration} from './LessonComposition';

const part:LessonPart={partId:'p',label:'本题',goal:'看懂一行为何有相应数量的点',known:['第n个数有n行'],prerequisites:['求差时消去共同部分'],method:'用新增行直接计数',steps:[{id:'s1',title:'写成逐行的和',explanation:'第k行有k个点，点不重复。',reason:'一行一行相加得到总数。',formulaLatex:'T_n=1+2+\\cdots+n'},{id:'s2',title:'看新增的行',explanation:'新增行单独保留。',reason:'共同部分相同。',formulaLatex:'T_6-T_4=5+6'}],answer:{kind:'integer',value:11,display:'11'},verification:'21−10=11',misconceptions:[{mistake:'把行号当总点数',correction:'行号只对应行数'}],summary:'先找共同部分',scene:{kind:'triangle-count',params:{lower:4,upper:6}}};

const voice:Narration={id:'voice-p',state:'ready',questionId:'question',questionRevision:1,lessonVersion:2,partId:'p',lessonHash:'hash',voice:'teacher',fps:30,stageDurations:[534,642,282,102,342],durationInFrames:1902,clips:[
  {id:'c0',stageIndex:0,text:'从一行慢慢长成六行。',from:0,audioFrames:300,durationInFrames:312,audioUrl:'/audio/c0.mp3',visualFrom:0,visualTo:2.88},
  {id:'c1',stageIndex:0,text:'行数和总点数不同。',from:312,audioFrames:180,durationInFrames:192,audioUrl:'/audio/c1.mp3',visualFrom:2.88,visualTo:4.1},
  {id:'c2',stageIndex:1,text:'先找共同的部分。',from:534,audioFrames:600,durationInFrames:612,audioUrl:'/audio/c2.mp3',visualFrom:0,visualTo:4},
  {id:'c3',stageIndex:2,text:'每行的点数相加。',from:1176,audioFrames:240,durationInFrames:252,audioUrl:'/audio/c3.mp3',visualFrom:0,visualTo:4},
  {id:'c4',stageIndex:3,text:'只留下新增的行。',from:1458,audioFrames:60,durationInFrames:72,audioUrl:'/audio/c4.mp3',visualFrom:0,visualTo:4},
  {id:'c5',stageIndex:4,text:'换一种算法检验。',from:1560,audioFrames:300,durationInFrames:312,audioUrl:'/audio/c5.mp3',visualFrom:0,visualTo:4},
]};

describe('Remotion课堂唯一时间线',()=>{
  it('包含读题、方法、每个真实步骤和检验，不另建视频教案',()=>{
    const timeline=lessonTimeline(part,30,1);
    expect(timeline.stages).toHaveLength(part.steps.length+3);
    expect(timeline.stages.map(stage=>stage.label)).toEqual(['读懂条件与知识点','建立解题方法','写成逐行的和','看新增的行','检验与方法收束']);
    expect(timeline.durationInFrames).toBe(timeline.stages.reduce((sum,stage)=>sum+stage.durationInFrames,0));
    expect(timeline.stages[1].from).toBe(stageDuration(part,0)*30);
  });
  it('章边界不会回退；结束停在最后一帧',()=>{
    const timeline=lessonTimeline(part);
    const boundary=timeline.stages[2].from;
    expect(lessonFrameState(part,boundary-1).stageIndex).toBe(1);
    expect(lessonFrameState(part,boundary).stageIndex).toBe(2);
    expect(lessonFrameState(part,boundary).localFrame).toBe(0);
    const last=lessonFrameState(part,Number.MAX_SAFE_INTEGER);
    expect(last.frame).toBe(timeline.durationInFrames-1);
    expect(last.stageIndex).toBe(4);expect(last.ended).toBe(true);expect(last.totalProgress).toBe(1);
  });
  it('网页与视频从同一帧得到同一数学快照，倍速不改变数学状态',()=>{
    const base=lessonTimeline(part,30,1),fast=lessonTimeline(part,30,2);
    const frame=base.stages[0].from+60;
    const normal=lessonFrameState(part,frame,30,1),accelerated=lessonFrameState(part,frame/2,30,2);
    for(const key of ['rows','visibleRows','pointCount','teacherPhase'])expect(accelerated.snapshot[key]).toEqual(normal.snapshot[key]);
    expect(fast.durationInFrames).toBe(base.durationInFrames/2);
    expect(lessonFrameState(part,frame).snapshot).toEqual(lessonFrameState(part,frame).snapshot);
  });
  it('视频讲解包含全部原始字段，没有只截取回答或最后公式',()=>{
    expect(narrationCards(part,0).map(card=>card.text)).toEqual([part.goal,...part.known,...part.prerequisites]);
    expect(narrationCards(part,1)[0].text).toBe(part.method);
    expect(narrationCards(part,2).map(card=>card.text)).toEqual([part.steps[0].explanation,part.steps[0].reason]);
    expect(narrationCards(part,4).map(card=>card.text)).toEqual([part.answer.display,part.verification,part.misconceptions[0].mistake,part.misconceptions[0].correction,part.summary]);
  });
  it('长讲解分页保留全文且不从公式中间切开',()=>{
    const text=`${'解释每一个点的来源。'.repeat(24)}这里完整写出 $T_n=1+2+\\cdots+n$，${'再说明同一结构可以推广。'.repeat(24)}`;
    const chunks=chunkNarration(text,100);
    expect(chunks.join('')).toBe(text);expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.filter(chunk=>chunk.includes('$'))).toHaveLength(1);
    expect(chunks.find(chunk=>chunk.includes('$'))).toContain('$T_n=1+2+\\cdots+n$');
  });
  it('空教案只等待真实数据，不注入预置题目或答案',()=>{
    expect(lessonTimeline(null)).toEqual({stages:[],durationInFrames:180});
    expect(lessonFrameState(null,0).snapshot).toEqual({frame:0,localFrame:0,fps:30,pace:1,stepIndex:0});
  });
  it('有声课程按实测音长排章，不再按文字估时',()=>{
    const timeline=lessonTimeline(part,30,1,voice);
    expect(timeline.stages.map(stage=>stage.durationInFrames)).toEqual(voice.stageDurations);
    expect(timeline.durationInFrames).toBe(voice.durationInFrames);
    expect(timeline.stages[1].from).toBe(534);
    expect(timeline.durationInFrames).not.toBe(lessonTimeline(part).durationInFrames);
    const fast=lessonTimeline(part,30,2,voice);
    expect(fast.durationInFrames).toBe(951);
    expect(lessonTimeline(part,60,1,voice).durationInFrames).toBe(3804);
  });
  it('同一句口述映射同一个视觉进度，静默期间停住画面且不声称仍在讲话',()=>{
    const halfway=lessonFrameState(part,150,30,1,false,voice);
    expect(halfway.clipId).toBe('c0');expect(halfway.spokenText).toBe(voice.clips[0].text);
    expect(halfway.visualFrame).toBeCloseTo(1.44*30);
    expect(halfway.snapshot.rows).toBe(4);
    const gap=lessonFrameState(part,307,30,1,false,voice);
    expect(gap.visualFrame).toBeCloseTo(2.88*30);expect(gap.speaking).toBe(false);expect(gap.spokenText).toBeNull();
    expect(lessonFrameState(part,311,30,1,false,voice).visualFrame).toBe(gap.visualFrame);
    expect(lessonFrameState(part,312,30,1,false,voice).clipId).toBe('c1');
    const observation=lessonFrameState(part,520,30,1,false,voice);
    expect(observation.visualFrame).toBeCloseTo(4.1*30);expect(observation.speaking).toBe(false);
  });
  it('暂停快照保留真实课帧、音轨和口述，跳章再倒退能恢复同一数学状态',()=>{
    const first=lessonFrameState(part,150,30,1,false,voice);
    expect(first.snapshot).toMatchObject({frame:150,localFrame:150,narrationId:'voice-p',clipId:'c0',spokenText:voice.clips[0].text,speaking:true,rows:4});
    const later=lessonFrameState(part,1500,30,1,false,voice);
    expect(later.stageIndex).toBe(3);expect(later.clipId).toBe('c4');
    expect(lessonFrameState(part,150,30,1,false,voice)).toEqual(first);
    expect(lessonFrameState(part,533,30,1,false,voice).stageIndex).toBe(0);
    expect(lessonFrameState(part,534,30,1,false,voice).stageIndex).toBe(1);
  });
  it('倍速改变音轨开始与播放速率，完整保留每句音频和静默末尾',()=>{
    const fast=timedNarrationClips(voice,30,2);
    expect(fast[1]).toMatchObject({from:156,audioFrames:90,durationInFrames:96});
    fast.forEach(item=>expect(item.from+item.durationInFrames).toBeGreaterThanOrEqual(Math.ceil((item.clip.from+item.clip.audioFrames)/2)));
    const normal=lessonFrameState(part,150,30,1,false,voice),accelerated=lessonFrameState(part,75,30,2,false,voice);
    expect(accelerated.visualFrame).toBe(normal.visualFrame);
    expect(accelerated.spokenText).toBe(normal.spokenText);expect(accelerated.snapshot.rows).toBe(normal.snapshot.rows);
    expect(lessonFrameState(part,951,30,2,false,voice).speaking).toBe(false);
  });
  it('不使用其他小问的音轨或时长',()=>{
    const different={...voice,partId:'other'};
    expect(lessonTimeline(part,30,1,different)).toEqual(lessonTimeline(part));
    expect(lessonFrameState(part,150,30,1,false,different).snapshot).not.toHaveProperty('narrationId');
    expect(lessonFrameState(part,150,30,1,false,different).speaking).toBe(false);
  });
  it('奇数音帧在倍速舍入后，字幕和视觉从真正的音轨开始帧计算',()=>{
    const odd={...voice,stageDurations:[535,643,283,103,343],durationInFrames:1907,clips:voice.clips.map((clip,i)=>i===0?clip:{...clip,from:clip.from+(i===1?1:i)})};
    const clip=timedNarrationClips(odd,30,2)[2];
    const start=lessonFrameState(part,clip.from,30,2,false,odd);
    expect(start.clipId).toBe('c2');expect(start.speaking).toBe(true);
    expect(start.visualFrame).toBe(voice.clips[2].visualFrom*30);
    expect(lessonFrameState(part,clip.from+75,30,2,false,odd).visualFrame).toBe(1*30);
  });
});
