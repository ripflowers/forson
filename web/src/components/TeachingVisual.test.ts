import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {TeachingVisual,triangleTeachingFacts,distanceTeachingFacts,distanceTeachingPhase,distanceDisplayState,quantizedDistanceFrame,teachingVisualFrame} from './TeachingVisual';
import {fmt} from '../domain';
import type {LessonPart,SceneSpec} from '../types';
const testPart=(titles:string[],scene:SceneSpec|null=null):LessonPart=>({partId:'main',label:'本题',goal:'动画回归',known:[],prerequisites:[],method:'',steps:titles.map((title,i)=>({id:String(i),title,explanation:'',reason:'',formulaLatex:''})),answer:{kind:'text',value:null,display:''},verification:'',misconceptions:[],summary:'',scene});
const triangle=testPart(['把三角形数写成连续自然数和','展开第24个和第22个三角形数','抵消公共部分并求差','用求和公式检验'],{kind:'triangle-count',params:{lower:22,upper:24}});
const number=(titles:string[],params:Record<string,unknown>)=>testPart(titles,{kind:'number-line',params});
const markup=(part:LessonPart,stepIndex:number,localFrame=0,reducedMotion=false)=>renderToStaticMarkup(createElement(TeachingVisual,{part,stepIndex,localFrame,fps:30,pace:1,reducedMotion}));
const dotCount=(html:string)=>(html.match(/class="tv-dot"/g)??[]).length;

describe('controlled teaching visuals',()=>{
  it('keeps the six-row example distinct from the original twenty-four-row comparison',()=>{
    const result=triangleTeachingFacts({kind:'triangle-count',lower:22,upper:24,previewRows:3});
    expect(result.example).toEqual({lowerCount:10,upperCount:21,added:11,addedRows:[5,6]});
    expect(result.original).toEqual({lowerCount:253,upperCount:300,added:47,addedRows:[23,24]});
  });
  it('derives both exterior positions from target distance instead of inserting sample answers',()=>{
    expect(distanceTeachingFacts({kind:'number-line',left:-2,right:4,targetSum:8}).roots).toEqual([-3,5]);
    expect(distanceTeachingFacts({kind:'number-line',left:3,right:7,targetSum:10}).roots).toEqual([0,10]);
    expect(distanceTeachingFacts({kind:'number-line',left:-2,right:4,targetSum:5}).roots).toEqual([]);
    expect(distanceTeachingFacts({kind:'number-line',left:-2,right:4,targetSum:6}).roots).toEqual([]);
  });
  it('distinguishes the supplied parameter demonstration from both parameter solutions',()=>{
    const result=distanceTeachingFacts({kind:'number-line',left:1,right:3,parameterValue:-1,targetMinimum:2});
    expect([result.left,result.right,result.minimum]).toEqual([1,3,2]);
    expect(result.parameterAnswers).toEqual([-5,-1]);
  });
  it('binds actions to actual lesson meaning when a regenerated lesson has extra steps',()=>{
    const part=testPart(['转化为距离','判断解的位置','解左侧 x<-2','解右侧 x>4','代回检验']);
    expect([0,1,2,3,4,5,6,7].map(index=>distanceTeachingPhase(part,index))).toEqual(['read','method','meaning','compare','left-root','right-root','verify','summary']);
    expect(distanceTeachingPhase(testPart(['合并所有解']),2)).toBe('verify');
  });
  it('draws two separate original common blocks and exactly twenty-three plus twenty-four added dots',()=>{
    const html=markup(triangle,3,90,true);
    expect((html.match(/class="tv-common-block"/g)??[]).length).toBe(2);
    expect(dotCount(html)).toBe(47);
    expect(html).toContain('data-point-count="23"');expect(html).toContain('data-point-count="24"');
    expect(html).toContain('第 24 个 · 300 点');expect(html).toContain('第 22 个 · 253 点');
    expect(html).not.toContain('katex-error');
    expect(teachingVisualFrame(triangle,3,90)).toMatchObject({teacherPhase:'original',rows:24,visibleRows:2,pointCount:47,representedPointCount:300,commonPointCount:253,addedRows:[23,24]});
  });
  it('keeps each regenerated absolute-value case in its stated geometric region',()=>{
    const part=number(['识别两个固定点','当 $x<-2$ 时代数化简','当 $-2\\le x\\le 4$ 时代数化简','当 $x>4$ 时代数化简','得到最小值及取得区间'],{left:-2,right:4});
    expect([2,3,4,5,6].map(index=>distanceTeachingPhase(part,index))).toEqual(['meaning','left-outside','interval','right-outside','endpoints']);
    for(const f of [0,10,60,105,180]){
      expect(teachingVisualFrame(part,3,f).x).toBeLessThan(-2);
      expect(teachingVisualFrame(part,5,f).x).toBeGreaterThan(4);
      const state=teachingVisualFrame(part,4,f);
      expect(state.inMinimumInterval).toBe(true);expect(state.sum).toBe(6);
    }
  });
  it('uses one quantized position for distances, displayed arithmetic, and the question snapshot',()=>{
    const frame=distanceDisplayState(-1,2,-2.3333333);
    expect(frame.x).toBe(-2.33);
    expect([frame.first,frame.second,frame.sum].map(fmt)).toEqual(['1.33','4.33','5.66']);
    expect(Number(fmt(frame.first))+Number(fmt(frame.second))).toBeCloseTo(Number(fmt(frame.sum)),10);
    const parameterFrame=quantizedDistanceFrame(1.23456,3,2.22222);
    expect([parameterFrame.left,parameterFrame.right,parameterFrame.x]).toEqual([1.23,3,2.22]);
    expect([parameterFrame.first,parameterFrame.second,parameterFrame.sum].map(fmt)).toEqual(['0.99','0.78','1.77']);
  });
  it('begins growth at precisely one visible row and one point, including a correct formula',()=>{
    expect(teachingVisualFrame(triangle,0,0)).toMatchObject({rows:1,visibleRows:1,pointCount:1,teacherPhase:'growth'});
    const html=markup(triangle,0);
    expect(dotCount(html)).toBe(1);expect(html).toContain('1 行 · 1 个点');
    expect(html).not.toContain('≠');expect(html).not.toContain('katex-error');
  });
  it('matches every growing frame snapshot to the actual dot count and row labels',()=>{
    for(const f of [0,14,15,29,44,58,73,180]){
      const snapshot=teachingVisualFrame(triangle,0,f),html=markup(triangle,0,f);
      expect(dotCount(html)).toBe(snapshot.pointCount);
      expect(html).toContain(`data-visible-rows="${snapshot.visibleRows}"`);
      expect(html).toContain(`${snapshot.rows} 行 · ${snapshot.pointCount} 个点`);
    }
  });
  it('keeps the small-example counts honest while showing the extra five- and six-point rows',()=>{
    const snapshot=teachingVisualFrame(triangle,1,90),html=markup(triangle,1,90);
    expect(snapshot).toMatchObject({teacherPhase:'example',rows:6,pointCount:31,primaryPointCount:21,commonPointCount:10,addedPoints:11,addedRows:[5,6]});
    expect(dotCount(html)).toBe(31);expect(html).toContain('6 行 · 21 个点');expect(html).toContain('4 行 · 10 个点');
  });
  it('has exact seek and reverse-seek determinism without accumulated effects',()=>{
    const part=number(['转化为距离','分类比较距离和','确定最小值与端点'],{left:-1,right:2});
    const initial=teachingVisualFrame(part,3,67),initialHtml=markup(part,3,67);
    for(const f of [180,0,120,44,3,179,80]){teachingVisualFrame(part,3,f);markup(part,3,f);}
    expect(teachingVisualFrame(part,3,67)).toEqual(initial);
    expect(markup(part,3,67)).toBe(initialHtml);
    const growing=teachingVisualFrame(triangle,0,15);teachingVisualFrame(triangle,0,180);
    expect(teachingVisualFrame(triangle,0,15)).toEqual(growing);
  });
  it('matches snapshot distances to the rendered arithmetic and all numeric coordinates at intermediate frames',()=>{
    const part=number(['分类比较距离和'],{left:-1,right:2});
    for(const f of [0,13,46,83,127,166,216]){
      const state=teachingVisualFrame(part,2,f),html=markup(part,2,f);
      for(const [key,attribute] of [['x','data-x'],['left','data-left'],['right','data-right'],['sum','data-distance-sum']])expect(html).toContain(`${attribute}="${state[key]}"`);
      for(const [key,attribute] of [['first','data-first-value'],['second','data-second-value'],['sum','data-sum-value']])expect(html).toContain(`${attribute}="true">${fmt(state[key] as number)}</strong>`);
      expect((state.first as number)+(state.second as number)).toBeCloseTo(state.sum as number,10);
    }
  });
  it('reaches both closed endpoints without displaying a false exterior position',()=>{
    const part=number(['确认端点可取'],{left:-2,right:4});
    expect(teachingVisualFrame(part,2,42)).toMatchObject({x:-2,first:0,second:6,sum:6,inMinimumInterval:true});
    expect(teachingVisualFrame(part,2,105)).toMatchObject({x:4,first:6,second:0,sum:6,inMinimumInterval:true});
  });
  it('collapses a zero distance arc when P coincides with a closed endpoint',()=>{
    const part=number(['确认端点可取'],{left:-2,right:4});
    const html=markup(part,2,42);
    const firstPath=html.match(/data-distance-first="true"[^>]*d="([^"]+)"/);
    expect(firstPath).not.toBeNull();
    const coordinates=firstPath![1].match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    expect(coordinates[0]).toBe(coordinates[2]);expect(coordinates[2]).toBe(coordinates[4]);
    expect([coordinates[1],coordinates[3],coordinates[5]]).toEqual([160,160,160]);
  });
  it('reaches and verifies both exterior equation solutions on their own lesson stages',()=>{
    const part=number(['根据几何意义先判断解的位置','解左侧 x<-2','解右侧 x>4'],{left:-2,right:4,targetSum:8});
    expect(teachingVisualFrame(part,3,42)).toMatchObject({teacherPhase:'left-root',x:-3,first:1,second:7,sum:8});
    expect(teachingVisualFrame(part,4,42)).toMatchObject({teacherPhase:'right-root',x:5,first:7,second:1,sum:8});
    expect(teachingVisualFrame(part,5,105)).toMatchObject({x:-3,sum:8});
    expect(teachingVisualFrame(part,5,168)).toMatchObject({x:5,sum:8});
  });
  it('uses the frame-driven fixed point for both parameter branches and the current minimum',()=>{
    const part=number(['转化为两定点距离','由最小值等于2列方程','检验两个参数解'],{left:1,right:3,parameterName:'a',parameterValue:-1,targetMinimum:2});
    expect(teachingVisualFrame(part,3,42)).toMatchObject({a:-1,left:1,right:3,x:2,minimum:2,sum:2});
    expect(teachingVisualFrame(part,3,108)).toMatchObject({a:-5,left:5,right:3,x:4,minimum:2,sum:2});
    expect(teachingVisualFrame(part,3,174)).toMatchObject({a:-1,left:1,right:3,x:2,minimum:2,sum:2});
    for(const f of [10,55,83,135]){
      const frame=teachingVisualFrame(part,3,f);
      expect(frame.a).toBe(-(frame.left as number));
      expect(frame.minimum).toBe(Number(Math.abs((frame.left as number)-3).toFixed(2)));
      expect(frame.sum).toBe(frame.minimum);
    }
  });
  it('keeps the same mathematical moment at different fps and pace',()=>{
    expect(teachingVisualFrame(triangle,0,30,30,1)).toEqual(teachingVisualFrame(triangle,0,60,60,1));
    expect(teachingVisualFrame(triangle,0,30,30,1)).toEqual(teachingVisualFrame(triangle,0,15,30,2));
    const part=number(['分类比较距离和'],{left:-1,right:2});
    expect(teachingVisualFrame(part,2,30,30,1)).toEqual(teachingVisualFrame(part,2,15,30,2));
  });
  it('provides stable reduced-motion states and returns no controlled scene for ordinary text lessons',()=>{
    expect(teachingVisualFrame(triangle,0,0,30,1,true)).toEqual(teachingVisualFrame(triangle,0,300,30,1,true));
    expect(dotCount(markup(triangle,0,0,true))).toBe(21);
    const part=testPart(['普通公式']);
    expect(teachingVisualFrame(part,2,100)).toEqual({});expect(markup(part,2,100)).toBe('');
  });
});
