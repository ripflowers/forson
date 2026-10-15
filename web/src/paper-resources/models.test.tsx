import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {paperCatalog,paperInputs,paperFrame,teacherInputs,paperRecipe,paperSnapshot,weightedDistance,weightedMinimum,recurrenceValue,harryValues,powerDifference,type Inputs} from './models';
import {DiagramView,PaperTeaching} from './PaperVisual';
import {MathText,splitMathText} from '../components/MathText';
import sources from '../../../resources/codex/paper/lesson-sources.json';
import type {LessonPart} from '../types';
import type {MotionPack} from '../motion-resources';
import {lessonFrameState,lessonTimeline} from '../remotion/timeline';
const recipe=(n:number,part='main')=>paperCatalog.find(r=>r.number===n&&r.partId===part)!;
const facts=(n:number,part:string,inputs:Inputs={})=>paperFrame(recipe(n,part),paperInputs(recipe(n,part),inputs)).facts;

it('all reviewed lesson prose renders valid formulas, including every numeric exponent',()=>{
 const errors:string[]=[];
 const inspect=(value:unknown,path:string)=>{
  if(typeof value==='string'){
   if(renderToStaticMarkup(<MathText text={value}/>).includes('katex-error'))errors.push(`${path}: invalid formula ${value}`);
   for(const segment of splitMathText(value))if(segment.kind==='text'&&/[A-Za-z0-9][_^]/.test(segment.text))errors.push(`${path}: plain script ${segment.text}`);
  }else if(Array.isArray(value))value.forEach((item,i)=>inspect(item,`${path}.${i}`));
  else if(value&&typeof value==='object')Object.entries(value).filter(([key])=>!['formulaLatex','scene','id','partId','prerequisiteIds','knowledgePointIds'].includes(key)).forEach(([key,item])=>inspect(item,`${path}.${key}`));
 };
 for(const source of sources)for(const part of source.lesson?.parts??[])inspect(part,`Q${source.question.number}.${part.partId}`);
 expect(errors).toEqual([]);
});

it('fraction cancellation strikes only the common sevens and leaves the numerator intact',()=>{
 const html=renderToStaticMarkup(<DiagramView diagram={{kind:'reciprocal',phase:2}}/>);
 expect([...html.matchAll(/class="cancel-seven">([^<]+)/g)].map(m=>m[1])).toEqual(['7','7']);
 expect(html).toContain('6999');
});

// Expectations are derived from the original equations, independent of the SVG renderer.
const answers:[number,string,Inputs,Record<string,unknown>][]=[
 [1,'main',{a:-1.5,b:.5},{sum:-1,difference:-2}], [2,'main',{origin:2},{valid:true}],
 [3,'main',{b:2},{a:-1,sum:1,positive:3}], [4,'main',{c:-3},{d:1,DC:4,DB:4}],
 [5,'main',{k:4},{previous:2,next:6,center:4}], [6,'main',{branch:1},{a:-3,b:-5,answers:[-5,1]}],
 [7,'main',{x:-.5},{cube:-.125,square:.25,valid:true}], [8,'1',{b:4},{p:1}],
 [8,'2.1',{t:3},{b:4}], [8,'2.2',{t:7},{a:6,b:0,p:8,branch:'nonnegative'}],
 [9,'main',{a:1},{a:1,b:-1,c:0,sum:0}], [10,'main',{case:1},{signQuotientDifference:2}],
 [12,'main',{origin:3},{sum:3,possible:true}], [13,'main',{a:-1},{lhs:1,rhs:1,solution:true}],
 [14,'main',{branch:1},{a:-2,b:6,c:1,target:10}], [15,'main',{negative:1},{terms:[1,-2,-3],x:-4,product:-24}],
 [16,'main',{a:-1.5,x:-1.25},{minimum:8,value:8,interval:[-1.5,-1]}],
 [17,'1',{b:.5,c:2.5},{difference:2}], [17,'2',{a:-1.5,b:.5,c:2.5},{ac:-4,bc:3,b1:-.5}],
 [17,'3',{a:-1.5,b:.5,c:2.5},{lhs:1.5,rhs:1.5}], [18,'1',{pair:2},{distance:5,maximum:5}],
 [18,'2',{x:-1},{span:3,distinct:true,solution:true}], [18,'3',{left:3,middle:2},{left:3,middle:5,right:8,count:20}],
 [18,'4',{m:6,n:3},{n:3,selected:[1,2,6],maximum:5}], [19,'1',{x:2},{sum:3,minimum:3,extra:0}],
 [19,'2.1',{x:-3},{sum:8,minimum:6,extra:1}], [19,'2.2',{x:5},{sum:8,minimum:6}],
 [19,'2.3',{a:-5,x:4},{left:5,right:3,sum:2,minimum:2}], [20,'main',{path:3},{result:'18/7'}],
 [21,'main',{}, {positive:5,negative:6,result:-1}], [22,'main',{}, {integer:-2,fraction:'-17/28',result:'-73/28'}],
 [23,'1',{}, {result:0}], [23,'2',{}, {result:'-6999/10'}], [24,'main',{n:7},{value:-3,group:3}],
 [25,'main',{n:8},{active:3,value:4/3}], [27,'1',{k:6},{remaining:2}], [27,'2',{n:4},{sum:'31',difference:'-1'}],
];
describe('each reviewed leaf has its own bound teaching and experiment',()=>{
 it('covers exactly 37 new leaves plus existing Q26; refuses incomplete Q11',()=>{
  const leaves=sources.flatMap(s=>s.lesson?.parts.map(p=>`${s.question.number}.${p.partId}`)??[]);
  expect(new Set(paperCatalog.map(r=>`${r.number}.${r.partId}`))).toEqual(new Set(leaves.filter(k=>k!=='26.main')));
  expect(answers).toHaveLength(37);expect(leaves).toHaveLength(38);
  expect(sources.find(s=>s.question.number===11)?.lesson).toBeNull();
 });
 it.each(answers)('Q%s %s matches original mathematical result',(n,part,inputs,expected)=>{expect(facts(n,part,inputs)).toMatchObject(expected);});
 it.each(paperCatalog.map(r=>[r.key,r] as const))('%s renders every stage without generic fallback or lost formulas',(_,r)=>{
  const p=sources.find(s=>s.question.number===r.number)!.lesson!.parts.find(p=>p.partId===r.partId)! as unknown as LessonPart;
  expect(r.stageCount).toBe(p.steps.length+3);expect(r.labels).toHaveLength(r.stageCount);expect(r.states).toHaveLength(r.stageCount);
  expect(r.choices.length).toBe(r.feedback.length);expect(r.correct).toBeLessThan(r.choices.length);
  for(let stage=0;stage<r.stageCount;stage++)for(const seconds of [0,1,4]){
   const inputs=teacherInputs(r,stage,seconds),frame=paperFrame(r,inputs,stage);
   expect(frame.diagrams.length).toBeGreaterThan(0);expect(JSON.stringify(frame)).not.toMatch(/NaN|Infinity|undefined/);
   const html=renderToStaticMarkup(<PaperTeaching recipe={r} part={p} stage={stage} frame={seconds*30} fps={30} reducedMotion={false}/>);
   expect(html).toContain(`data-paper-resource="${r.key}"`);expect(html).not.toContain('katex-error');
   if(stage>=2&&stage<r.stageCount-1&&p.steps[stage-2].formulaLatex)expect(html).toContain('paper-formula');
  }
 });
 it('rebinds resource to exact version and content; does not attach a different small question',()=>{
  const r=recipe(8,'2.2'),pack={target:r.target,stages:r.labels.map((title,i)=>({stageIndex:i,template:r.key,title}))} as MotionPack;
  expect(paperRecipe(pack)?.key).toBe(r.key);expect(paperRecipe({...pack,target:{...pack.target,partId:'1'}})).toBeNull();
  expect(paperRecipe({...pack,target:{...pack.target,lessonHash:'0'.repeat(64)}})).toBeNull();
 });
 it('freezes identical snapshot at a paused frame; branch transition is discontinuous',()=>{
  const r=recipe(8,'2.2');expect(paperSnapshot(r,teacherInputs(r,4,1),4)).toEqual(paperSnapshot(r,teacherInputs(r,4,1),4));
  expect(facts(8,'2.2',{t:6.9}).p).toBe(7.9);expect(facts(8,'2.2',{t:7}).p).toBe(8);expect(facts(8,'2.2',{t:7.1}).p).toBe(6);
 });
});
describe('adversarial boundaries and complete solution branches',()=>{
 it('Q2 only C passes both sign conditions',()=>{expect([0,1,2,3].filter(origin=>facts(2,'main',{origin}).valid)).toEqual([2]);});
 it('Q7 strict boundaries fail; interior succeeds',()=>{for(const x of [-2,-1,0,.5,1,2])expect(facts(7,'main',{x}).valid).toBe(false);for(const x of [-.9,-.5,-.1])expect(facts(7,'main',{x}).valid).toBe(true);});
 it('Q8 no nonnegative time reaches zero',()=>{for(let t=0;t<=10;t+=.1)expect(facts(8,'2.2',{t}).p).toBeGreaterThan(0);});
 it('Q12 both outer origins can work; neither inner origin reaches three',()=>{for(const origin of [1,2])for(const u of [.1,.5,.9])for(const v of [.1,.5,.9])expect(facts(12,'main',{origin,u,v}).sum).toBeLessThan(3);for(const origin of [0,3])expect(facts(12,'main',{origin}).sum).toBe(3);});
 it('Q13 checks both roots and rules out a negative RHS',()=>{for(const a of [-1,3])expect(facts(13,'main',{a}).solution).toBe(true);expect(facts(13,'main',{a:0}).rhs).toBe(-2);expect(facts(13,'main',{a:0}).solution).toBe(false);});
 it('Q14 both branches satisfy both original equations and target ac+2bc',()=>{for(const branch of [0,1]){const f=facts(14,'main',{branch}),a=f.a as number,b=f.b as number,c=f.c as number;expect((a+2)**2-Math.abs(b-3)).toBe(-3);expect(Math.abs(b-3)+(c-1)**2).toBe(3);expect(f.target).toBe(a*c+2*b*c);}});
 it('Q15 all three sign allocations give exact extrema',()=>{expect([0,1,2].map(negative=>facts(15,'main',{negative}).x)).toEqual([-2,-4,6]);});
 it('Q16 preserves the full minimum plateau, including endpoints',()=>{for(const a of [-3,-1.5,-1,2,6,6.5,8]){const m=weightedMinimum(a);for(let x=-4;x<=9;x+=.25)expect(weightedDistance(a,x)).toBeGreaterThanOrEqual(m.value);for(const x of [m.lo,(m.lo+m.hi)/2,m.hi])expect(weightedDistance(a,x)).toBe(m.value);}expect(weightedMinimum(-1.5).value).toBe(8);expect(weightedMinimum(6.5).value).toBe(8);});
 it('Q17 cancellation remains correct across all allowed intervals',()=>{for(const a of [-1.9,-1.1])for(const b of [.1,.9])for(const c of [2.1,2.9]){const f=facts(17,'3',{a,b,c});expect(f.lhs).toBeCloseTo(f.rhs as number);}});
 it('Q18 enumerates 20 unique triples and both valid integer roots',()=>{const triples=[];for(let a=1;a<=10;a++)for(let b=a+1;b<=10;b++)for(let c=b+1;c<=10;c++)if(c-a===5)triples.push([a,b,c]);expect(triples).toHaveLength(20);expect(Array.from({length:10},(_,i)=>i-3).filter(x=>facts(18,'2',{x}).solution)).toEqual([-1,4]);for(const x of [1,2])expect(facts(18,'2',{x}).distinct).toBe(false);});
 it('Q19 includes all interval points, two exterior roots and both parameter values',()=>{for(const x of [-1,0,2])expect(facts(19,'1',{x}).sum).toBe(3);for(const x of [-3,5])expect(facts(19,'2.2',{x}).sum).toBe(8);for(const a of [-1,-5])expect(facts(19,'2.3',{a}).minimum).toBe(2);});
 it('Q22 exact common denominator is negative 219/84 = negative 73/28',()=>{expect(-6080*28+8103*21-12149*14+14162*12).toBe(-219);expect(-56+63-70+12).toBe(-51);});
 it('Q24 uses recurrence to verify parity formula through the requested 2027th term',()=>{for(const n of [1,2,3,6,7,2026,2027])expect(recurrenceValue(n)).toBe(-Math.floor(n/2)||0);});
 it('Q25 closes the actual four-cycle and indexes 2026 correctly',()=>{for(let i=0;i<4;i++)expect(2/(2-harryValues[i])).toBeCloseTo(harryValues[(i+1)%4]);expect(harryValues[(2026-1)%4]).toBe(-2);});
 it('Q27 uses exact integers at exponent 2029, without overflow',()=>{expect(powerDifference(2029)).toBe(-1n);expect(128-64-32-16-8-4-2).toBe(2);});
});

describe('same frame is shared by playback, interruption and export',()=>{
 it('preserves every absolute-value corner exactly instead of approximating the minimum',()=>{
  const r=recipe(16),state=paperFrame(r,paperInputs(r,{a:-1.5,x:-1.25}));
  const graph=state.diagrams.find(d=>d.kind==='graph')!;
  if(graph.kind!=='graph')throw new Error('Missing distance graph');
  expect(graph.curves[0].points).toContainEqual([-1.5,8]);expect(graph.curves[0].points).toContainEqual([-1,8]);
  expect(Math.min(...graph.curves[0].points.map(p=>p[1]))).toBe(8);
 });
 it('does not animate a parameter through a different case while teaching a fixed branch',()=>{
  const r=recipe(16);expect(teacherInputs(r,4,0).a).toBe(-1.5);expect(teacherInputs(r,6,0).a).toBe(6.5);
 });
});

it('passes the exact authored numeric frame into the interruption snapshot',()=>{
 const r=recipe(4),part=sources.find(s=>s.question.number===4)!.lesson!.parts[0] as unknown as LessonPart;
 const pack={target:r.target,stages:r.labels.map((title,i)=>({stageIndex:i,template:r.key,title}))} as MotionPack;
 const timeline=lessonTimeline(part),at=timeline.stages[4].from+30;
 const time=lessonFrameState(part,at,30,1,false,null,pack);
 expect(time.snapshot.paperResource).toBe(r.key);
 expect(time.snapshot.paperInputs).toEqual(teacherInputs(r,4,1));
 expect(time.snapshot.paperFacts).toEqual(paperFrame(r,teacherInputs(r,4,1),4).facts);
 expect(lessonFrameState(part,at,30,1,false,null,pack)).toEqual(time);
});
