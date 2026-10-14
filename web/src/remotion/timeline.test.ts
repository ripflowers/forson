import {describe,it,expect} from 'vitest';
import type {LessonPart} from '../types';
import {stageDuration} from '../lesson-playback';
import {lessonFrameState,lessonTimeline,narrationCards} from './timeline';
import {chunkNarration} from './LessonComposition';

const part:LessonPart={partId:'p',label:'本题',goal:'看懂一行为何有相应数量的点',known:['第n个数有n行'],prerequisites:['求差时消去共同部分'],method:'用新增行直接计数',steps:[{id:'s1',title:'写成逐行的和',explanation:'第k行有k个点，点不重复。',reason:'一行一行相加得到总数。',formulaLatex:'T_n=1+2+\\cdots+n'},{id:'s2',title:'看新增的行',explanation:'新增行单独保留。',reason:'共同部分相同。',formulaLatex:'T_6-T_4=5+6'}],answer:{kind:'integer',value:11,display:'11'},verification:'21−10=11',misconceptions:[{mistake:'把行号当总点数',correction:'行号只对应行数'}],summary:'先找共同部分',scene:{kind:'triangle-count',params:{lower:4,upper:6}}};

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
});
