import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import type {MotionPack,MotionTemplate,MotionView} from '../motion-resources';
import type {TriangleScene} from '../domain';
import type {LessonPart} from '../types';
import {TriangleMotionLesson,triangleMotionFrame} from './TriangleMotionLesson';
import {TeachingVisual,teachingVisualFrame} from './TeachingVisual';

const scene:TriangleScene={kind:'triangle-count',lower:22,upper:24,previewRows:6};
const templates:MotionTemplate[]=['triangle-grow','triangle-compare','triangle-sum','triangle-expand','triangle-cancel','triangle-verify','triangle-recap'];
const pack:MotionPack={id:'motion-q26',schemaVersion:1,title:'观察与抵消',subject:'math',author:'Codex',target:{questionId:'q26',questionRevision:4,lessonVersion:3,partId:'main',lessonHash:'f'.repeat(64)},concepts:[{id:'row',label:'序号与行数',explanation:'第几个对应有几行。'},{id:'sum',label:'逐行相加',explanation:'总点数来自各行相加。'},{id:'cancel',label:'共同部分抵消',explanation:'两份相同数量在减法中贡献零。'}],stages:templates.map((template,stageIndex)=>({stageIndex,template,title:`阶段${stageIndex}`,conceptIds:[stageIndex<2?'row':stageIndex<4?'sum':'cancel'],focus:'先观察图，再说出理由',explanation:'保留共同部分，辨认每一行的点数。'})),createdAt:'2026-10-15T00:00:00Z',packHash:'a'.repeat(64)};
const part:LessonPart={partId:'main',label:'本题',goal:'求三角形数的差',known:['第n个有n行'],prerequisites:['连续自然数和'],method:'先找共同部分',steps:['逐行和','展开原题','抵消','公式检验'].map((title,i)=>({id:String(i),title,explanation:'',reason:'',formulaLatex:''})),answer:{kind:'integer',value:47,display:'47'},verification:'',misconceptions:[],summary:'',scene:{kind:'triangle-count',params:{lower:22,upper:24}}};
const markup=(stageIndex:number,frame=0,view:MotionView='space',reducedMotion=false)=>renderToStaticMarkup(createElement(TriangleMotionLesson,{scene,stageIndex,localFrame:frame,fps:30,pace:1,reducedMotion,pack,view}));
const stones=(html:string)=>(html.match(/class="tm-stone /g)??[]).length;

describe('Q26知识与解题动作',()=>{
  it('逐行增长时石子数量、累计数和已核验快照相同',()=>{
    for(const frame of [0,14,15,29,44,58,73,86,120]){
      const state=triangleMotionFrame(scene,0,frame),source=teachingVisualFrame(part,0,frame);
      expect(stones(markup(0,frame))).toBe(state.pointCount);
      expect(state.pointCount).toBe(source.pointCount);expect(state.rows).toBe(source.rows);
      expect(state.rowCounts.reduce((sum,row)=>sum+row,0)).toBe(state.pointCount);
    }
    expect(markup(0,0)).not.toContain('>47<');
  });
  it('小例保留两份10点并逐行对应，新增5和6合计11，不套成原题',()=>{
    const state=triangleMotionFrame(scene,1,84),html=markup(1,84);
    expect(state).toMatchObject({commonCount:10,commonCopies:2,upperCount:21,lowerCount:10,addedRows:[5,6],addedCount:11,cancel:1,move:1});
    expect(state.upperCount-state.lowerCount).toBe(state.addedCount);
    expect(stones(html)).toBe(31);expect(html).toContain('T_6-T_4=5+6=11');
    expect(html).toContain('还不是原题答案');expect(html).not.toContain('data-common-count="253"');
  });
  it('原题各帧都保留两份253共同块及23+24枚新增石子，不靠隐藏块解释抵消',()=>{
    for(const stage of [3,4,5,6])for(const frame of [0,10,33,48,84]){
      const state=triangleMotionFrame(scene,stage,frame);
      expect(state.commonCopies).toBe(2);expect(state.commonCount).toBe(253);
      expect(state.addedRows).toEqual([23,24]);expect(state.pointCount).toBe(47);
      expect(state.upperCount).toBe(state.commonCount+state.addedCount);
      expect(state.lowerCount).toBe(state.commonCount);
    }
    for(const stage of [3,4,5,6]){
      const html=markup(stage,48);
      expect((html.match(/data-common-count="253"/g)??[]).length).toBe(2);
      expect(stones(html)).toBe(47);
      expect(html).toContain('data-row-point-count="23"');expect(html).toContain('data-row-point-count="24"');
      expect(html).not.toContain('katex-error');
    }
  });
  it('47从stage4求和时才强调，验证章入口重新从计算过程开始',()=>{
    expect(markup(3,84)).not.toContain('>47<');
    expect(markup(4,0)).not.toContain('>47<');
    expect(markup(4,34)).toContain('>47<');
    const verificationStart=markup(5,0);
    expect(verificationStart).not.toContain('>47<');
    expect(verificationStart).toContain(String.raw`T_n=\frac{n(n+1)}{2}`);
    expect(markup(5,54)).toContain('300-253=47');
    expect([0,18,36,54].map(frame=>triangleMotionFrame(scene,5,frame).verifyStep)).toEqual([0,1,2,3]);
  });
  it('两次总数计算各自成立，最终差式独立呈现，不形成错误连等',()=>{
    const totals=markup(5,36),difference=markup(5,54);
    expect(totals).toContain(String.raw`T_{24}=\frac{24\times25}{2}=300`);
    expect(totals).toContain(String.raw`T_{22}=\frac{22\times23}{2}=253`);
    expect(totals).not.toContain('<i>−</i>');
    expect(difference).toContain('300-253=47');
    expect(difference).not.toContain('24\\times25');
  });
  it('抵消与新增行分离都与已配音的canonical窗口一致',()=>{
    expect(triangleMotionFrame(scene,1,23).cancel).toBe(0);
    expect(triangleMotionFrame(scene,1,48).cancel).toBe(1);
    expect(triangleMotionFrame(scene,3,38).highlightedRow).toBe(0);
    expect(triangleMotionFrame(scene,3,39).highlightedRow).toBe(23);
    expect(triangleMotionFrame(scene,3,48).highlightedRow).toBe(24);
    expect(triangleMotionFrame(scene,4,9)).toMatchObject({cancel:0,move:0,sumVisible:false});
    expect(triangleMotionFrame(scene,4,33)).toMatchObject({cancel:1,move:0,sumVisible:true});
    expect(triangleMotionFrame(scene,4,84).move).toBe(1);
  });
  it('空间与平面视角保持同样数量、共同块及数学式',()=>{
    for(const stage of [0,1,4]){
      const spatial=markup(stage,84,'space'),flat=markup(stage,84,'flat');
      expect(stones(spatial)).toBe(stones(flat));
      expect((spatial.match(/data-common-count="253"/g)??[]).length).toBe((flat.match(/data-common-count="253"/g)??[]).length);
      const formulas=(value:string)=>(value.match(/<annotation encoding="application\/x-tex">.*?<\/annotation>/g)??[]);
      expect(formulas(spatial)).toEqual(formulas(flat));
    }
  });
  it('任意seek和倒退都确定，stage2配音静止窗口不凭空继续演进',()=>{
    const initial=triangleMotionFrame(scene,4,47),html=markup(4,47);
    for(const frame of [84,0,20,35,55,18])triangleMotionFrame(scene,4,frame);
    expect(triangleMotionFrame(scene,4,47)).toEqual(initial);expect(markup(4,47)).toBe(html);
    const held=markup(2,36);expect(held).toContain('data-sum-term="6"');
    expect((held.match(/data-sum-term=/g)??[]).length).toBe(6);
    expect(held).toContain(String.raw`T_n=1+2+3+\cdots+n`);
    expect(triangleMotionFrame(scene,0,30,30,1)).toEqual(triangleMotionFrame(scene,0,60,60,1));
    expect(triangleMotionFrame(scene,4,42,30,1)).toEqual(triangleMotionFrame(scene,4,21,30,2));
  });
  it('减少动态时直接呈现完整静态解释，并使用资源包教学提示',()=>{
    for(const stage of [0,1,2,3,4,5,6]){
      expect(triangleMotionFrame(scene,stage,0,30,1,true)).toEqual(triangleMotionFrame(scene,stage,300,30,1,true));
    }
    const complete=markup(4,0,'space',true);
    expect(complete).toBe(markup(4,300,'space',true));
    expect(complete).toContain(pack.stages[4].focus);expect(complete).toContain(pack.stages[4].explanation);
    expect(stones(markup(0,0,'space',true))).toBe(21);
  });
  it('仅有已适配资源的小问使用新演示，无资源仍保留旧版画面',()=>{
    const render=(motionPack?:MotionPack)=>renderToStaticMarkup(createElement(TeachingVisual,{part,stepIndex:3,localFrame:45,fps:30,pace:1,reducedMotion:false,motionPack}));
    expect(render(pack)).toContain('triangle-motion-lesson');
    expect(render()).toContain('tv-common-block');expect(render()).not.toContain('triangle-motion-lesson');
    expect(render({...pack,target:{...pack.target,partId:'other'}})).not.toContain('triangle-motion-lesson');
  });
});
