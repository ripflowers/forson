import {useId} from 'react';
import {paperRecipe} from '../paper-resources/models';
import {PaperTeaching} from '../paper-resources/PaperVisual';
import {interpolate,spring} from 'remotion';
import {distanceState,fmt,parseScene,triangleState} from '../domain';
import type {NumberScene,TriangleScene} from '../domain';
import type {LessonPart} from '../types';
import type {MotionPack} from '../motion-resources';
import {Formula} from './Formula';
import {TriangleMotionLesson,type MotionView} from './TriangleMotionLesson';
import './teaching-visual.css';

type Props={part:LessonPart;stepIndex:number;localFrame?:number;fps?:number;pace?:number;reducedMotion:boolean;motionPack?:MotionPack|null;motionView?:MotionView};
type Timing={localFrame:number;fps:number;pace:number;reducedMotion:boolean};
const clamped={extrapolateLeft:'clamp',extrapolateRight:'clamp'} as const;
const seconds=({localFrame,fps,pace}:Timing)=>Math.max(0,localFrame)*Math.max(.1,pace)/Math.max(1,fps);
const progress=(time:number,start:number,duration:number)=>interpolate(time,[start,start+duration],[0,1],clamped);
const arrival=(timing:Timing,start:number)=>timing.reducedMotion?1:spring({frame:Math.max(0,(seconds(timing)-start)*timing.fps),fps:timing.fps,config:{damping:24,stiffness:180}});

export function TeachingVisual({part,stepIndex,localFrame=0,fps=30,pace=1,reducedMotion,motionPack,motionView='space'}:Props){
  const scene=parseScene(part.scene),timing={localFrame,fps,pace,reducedMotion};
  const recipe=paperRecipe(motionPack);
  if(recipe)return <PaperTeaching recipe={recipe} part={part} stage={stepIndex} frame={localFrame*pace} fps={fps} reducedMotion={reducedMotion}/>;
  if(!scene)return null;
  const template=['triangle-grow','triangle-compare','triangle-sum','triangle-expand','triangle-cancel','triangle-verify','triangle-recap'][stepIndex];
  if(scene.kind==='triangle-count'&&scene.lower===22&&scene.upper===24&&motionPack?.target.partId===part.partId&&motionPack.stages.some(stage=>stage.stageIndex===stepIndex&&stage.template===template))return <TriangleMotionLesson scene={scene} stageIndex={stepIndex} localFrame={localFrame} fps={fps} pace={pace} reducedMotion={reducedMotion} pack={motionPack} view={motionView}/>;
  return scene.kind==='triangle-count'
    ?<TriangleTeaching scene={scene} stage={stepIndex} timing={timing}/>
    :<DistanceTeaching scene={scene} phase={distanceTeachingPhase(part,stepIndex)} timing={timing}/>;
}

export function triangleTeachingFacts(scene:TriangleScene){
  return{example:triangleState(4,6),original:triangleState(scene.lower,scene.upper)};
}
export function distanceTeachingFacts(scene:NumberScene){
  const left=scene.parameterValue===undefined?scene.left:-scene.parameterValue;
  const right=scene.parameterValue===undefined?scene.right:3;
  const {lo,hi,minimum}=distanceState(left,right,(left+right)/2);
  const extra=scene.targetSum===undefined?null:(scene.targetSum-minimum)/2;
  return{left,right,lo,hi,minimum,roots:extra!==null&&extra>0?[lo-extra,hi+extra]:[],parameterAnswers:scene.parameterValue!==undefined&&scene.targetMinimum!==undefined&&scene.targetMinimum>=0?[-3-scene.targetMinimum,-3+scene.targetMinimum]:[]};
}
export function distanceDisplayState(left:number,right:number,x:number){
  const round=(value:number)=>Number(value.toFixed(2)),position={left:round(left),right:round(right),x:round(x)};
  const state=distanceState(position.left,position.right,position.x);
  return{...position,...state,first:round(state.first),second:round(state.second),sum:round(state.sum),minimum:round(state.minimum),excess:round(state.excess)};
}
export const quantizedDistanceFrame=distanceDisplayState;

type DistancePhase='read'|'method'|'meaning'|'compare'|'left-root'|'right-root'|'left-outside'|'right-outside'|'interval'|'endpoints'|'parameter'|'verify'|'summary';
export function distanceTeachingPhase(part:LessonPart,index:number):DistancePhase{
  if(index===0)return'read';if(index===1)return'method';if(index>=part.steps.length+2)return'summary';
  const title=part.steps[index-2]?.title??'';
  const scene=parseScene(part.scene),comparison=title.replace(/\\leq?\b/g,'≤').replace(/\\geq?\b/g,'≥').replace(/[$\s{}]/g,'').replace(/[−–]/g,'-');
  if(scene?.kind==='number-line'){
    const {lo,hi}=distanceTeachingFacts(scene);
    if(comparison.includes(`x<${fmt(lo)}`))return scene.targetSum!==undefined?'left-root':'left-outside';
    if(comparison.includes(`x>${fmt(hi)}`))return scene.targetSum!==undefined?'right-root':'right-outside';
    if(comparison.includes(`${fmt(lo)}≤x≤${fmt(hi)}`)||comparison.includes(`${fmt(lo)}<=x<=${fmt(hi)}`))return'interval';
  }
  if(/检验|验证|代回|核验|核对|全部解|所有解|合并.*解|汇总/.test(title))return'verify';
  if(/左侧|左边|左方/.test(title))return'left-root';
  if(/右侧|右边|右方/.test(title))return'right-root';
  if(/端点|边界|取值范围|取得区间/.test(title))return'endpoints';
  if(/方程|参数解/.test(title))return'parameter';
  if(/分类|分段|分三|比较|判断.*位置|线段.*上|线段外|变大|最小值/.test(title))return'compare';
  return'meaning';
}

function triangleFrame(scene:TriangleScene,stage:number,timing:Timing){
  const {original}=triangleTeachingFacts(scene),originalVisible=stage>=3;
  const rows=stage===0&&!timing.reducedMotion?Math.min(6,Math.floor(seconds(timing)/.48)+1):6;
  const pointCount=triangleState(0,rows).upperCount;
  const captions=[
    `现在有 ${rows} 行、${pointCount} 个点。第 k 行恰好有 k 个点，行数与总点数是两件事。`,
    '先用小例看方法：6 行减去 4 行，共同的前 4 行消去，只留下第 5、6 行。',
    '第 n 个三角形数有 n 行。把各行点数加起来，才得到总点数。',
    `回到原题：前 ${scene.lower} 行完全相同；第 ${scene.upper} 个还多出 ${original.addedRows.length} 行。`,
    `消去相同部分，只数新增的行：${original.addedRows.join(' + ')} = ${original.added}。`,
    `用另一种算法检验：总点数 ${original.upperCount} − ${original.lowerCount} = ${original.added}。`,
    '先看结构，再算数量。求差时找共同部分，能少做很多计算。',
  ];
  return{rows:originalVisible?scene.upper:rows,visibleRows:originalVisible?original.addedRows.length:rows,pointCount:originalVisible?original.added:stage===1?pointCount+10:pointCount,primaryPointCount:pointCount,representedPointCount:originalVisible?original.upperCount:pointCount,commonPointCount:originalVisible?original.lowerCount:stage===1?10:0,cue:captions[Math.min(stage,captions.length-1)],teacherAnimation:true,teacherPhase:stage===0?'growth':stage<3?'example':'original',teachingAction:stage===0?'growth':stage===1?'small-example':stage===2?'generalize':stage===3?'original-common':stage===4?'cancel-common':stage===5?'verify':'summary',growth:rows/6,originalComparisonVisible:originalVisible,originalLower:scene.lower,originalUpper:scene.upper,addedRows:originalVisible?original.addedRows:stage===1?[5,6]:[],addedPoints:originalVisible?original.added:stage===1?11:0};
}

type MotionSegment={at:number;to:number;duration?:number};
function move(initial:number,segments:MotionSegment[],time:number){
  let current=initial;
  for(const segment of segments){
    if(time<segment.at)return current;
    const end=segment.at+(segment.duration??1.4);
    if(time<end)return interpolate(time,[segment.at,end],[current,segment.to],{...clamped,easing:t=>t*t*(3-2*t)});
    current=segment.to;
  }
  return current;
}
function distanceFrame(scene:NumberScene,phase:DistancePhase,timing:Timing){
  const facts=distanceTeachingFacts(scene),parameter=scene.parameterValue!==undefined,target=scene.targetSum,time=seconds(timing);
  const outside=facts.lo-Math.max(1,facts.minimum/3),rightOutside=facts.hi+Math.max(1,facts.minimum/3),mid=(facts.left+facts.right)/2;
  const solveParameter=parameter&&['parameter','verify','summary'].includes(phase)&&facts.parameterAnswers.length>0;
  let left=facts.left,x=['left-outside','left-root'].includes(phase)?outside:['right-outside','right-root'].includes(phase)?rightOutside:mid;
  if(timing.reducedMotion){
    if(solveParameter){left=3-scene.targetMinimum!;x=(left+3)/2;}
    else if(phase==='left-root'&&facts.roots.length)x=facts.roots[0];
    else if(phase==='right-root'&&facts.roots.length)x=facts.roots[1];
    else if(phase==='endpoints'||phase==='interval')x=facts.hi;
    else if(['verify','summary'].includes(phase)&&facts.roots.length)x=facts.roots[1];
  }else if(solveParameter){
    const d=scene.targetMinimum!;
    left=move(facts.left,[{at:0,to:3-d},{at:2.2,to:3+d},{at:4.4,to:3-d}],time);
    x=move(mid,[{at:0,to:3-d/2},{at:2.2,to:3+d/2},{at:4.4,to:3-d/2}],time);
  }else if(target!==undefined&&facts.roots.length===2&&['left-root','right-root','verify','summary'].includes(phase)){
    const segments=[{at:0,to:phase==='left-root'?facts.roots[0]:facts.roots[1]}];
    if(['verify','summary'].includes(phase))segments.push({at:2.1,to:facts.roots[0]},{at:4.2,to:facts.roots[1]});
    x=move(x,segments,time);
  }else if(['read','meaning'].includes(phase)){
    x=move(x,[{at:0,to:facts.lo+.2*facts.minimum},{at:1.9,to:facts.hi-.2*facts.minimum}],time);
  }else if(['endpoints','interval'].includes(phase)){
    x=move(x,[{at:0,to:facts.lo},{at:2.1,to:facts.hi}],time);
  }else if(phase==='left-outside'){
    x=move(x,[{at:0,to:outside},{at:2.1,to:facts.lo-.35},{at:4.2,to:outside}],time);
  }else if(phase==='right-outside'){
    x=move(x,[{at:0,to:rightOutside},{at:2.1,to:facts.hi+.35},{at:4.2,to:rightOutside}],time);
  }else{
    x=move(x,[{at:0,to:facts.lo},{at:1.8,to:facts.hi},{at:3.8,to:outside},{at:5.8,to:facts.lo}],time);
  }
  const cue=parameter
    ?solveParameter?`让两固定点的距离等于 ${fmt(scene.targetMinimum!)}。A 可以在 3 的左侧或右侧，两个方向都要检查。`:`用 a=${fmt(scene.parameterValue!)} 作示例。固定点是 −a 和 3；这是理解条件的示范，还要解出全部参数。`
    :phase==='read'?'绝对值变成距离：青色是 PA，暖色是 PB。P 移动时，观察两段各自怎样变化。'
    :target!==undefined&&target<facts.minimum?`目标 ${fmt(target)} 小于两固定点间的距离 ${fmt(facts.minimum)}，距离和无法达到这个值。`
    :target!==undefined&&target===facts.minimum?`目标等于两固定点间的距离，整个闭区间 [${fmt(facts.lo)}, ${fmt(facts.hi)}] 都满足条件。`
    :target!==undefined&&phase==='left-root'?`检查左侧：P 越过 A，额外路程为 (${fmt(target)} − ${fmt(facts.minimum)}) ÷ 2。`
    :target!==undefined&&phase==='right-root'?`检查右侧：P 越过 B，额外路程相同，右侧的位置也必须检验。`
    :target!==undefined&&['compare','verify','summary'].includes(phase)?`目标 ${fmt(target)} 大于两固定点间的距离 ${fmt(facts.minimum)}，解只能在区间左侧或右侧。`
    :phase==='left-outside'?`当前讨论左侧 x < ${fmt(facts.lo)}：P 在 A、B 的左边，额外路程走了两次。`
    :phase==='right-outside'?`当前讨论右侧 x > ${fmt(facts.hi)}：P 在 A、B 的右边，额外路程走了两次。`
    :phase==='interval'?`当前讨论 ${fmt(facts.lo)} ≤ x ≤ ${fmt(facts.hi)}：两段距离拼成 AB，总长始终是 ${fmt(facts.minimum)}。`
    :phase==='endpoints'?'P 与 A、B 重合时仍然成立。取得最小值的区间包含两个端点。'
    :'P 在 A、B 之间时，一段变长、另一段等量变短；越过端点后，多出来的路程走了两次。';
  const state=distanceDisplayState(left,facts.right,x);
  const observation=state.inMinimumInterval?`区间内：${fmt(state.first)} + ${fmt(state.second)} = ${fmt(state.minimum)}，总长保持不变。`:`区间外：${fmt(state.minimum)} + 2 × ${fmt(state.excess)} = ${fmt(state.sum)}，额外路程算了两次。`;
  return{...state,...(parameter?{a:-state.left}:{}),cue,observation:`${parameter?`当前最小值 ${fmt(state.minimum)}。`:''}${observation}`,teacherAnimation:true,teacherPhase:phase,solveParameter};
}

/** The Player, exported video and the question snapshot all read this same frame. */
export function teachingVisualFrame(part:LessonPart,stageIndex:number,localFrame:number,fps=30,pace=1,reducedMotion=false):Record<string,unknown>{
  const scene=parseScene(part.scene),timing={localFrame,fps,pace,reducedMotion};
  if(!scene)return{};
  return scene.kind==='triangle-count'?triangleFrame(scene,stageIndex,timing):distanceFrame(scene,distanceTeachingPhase(part,stageIndex),timing);
}

function TriangleTeaching({scene,stage,timing}:{scene:TriangleScene;stage:number;timing:Timing}){
  const {example,original}=triangleTeachingFacts(scene),frame=triangleFrame(scene,stage,timing),time=seconds(timing);
  const cancel=timing.reducedMotion?1:progress(time,stage===1?.8:.3,.8),originalVisible=frame.originalComparisonVisible;
  const commonOpacity=stage===1||stage>=4?1-.8*cancel:1;
  const resultArrival=arrival(timing,stage===1?2:2.1);
  const row=(count:number,added:boolean,key:string,growing=false)=>{
    const enter=arrival(timing,growing?(count-1)*.48:added?1.3+(count-(originalVisible?scene.lower+1:5))*.3:0);
    return <div className={`tv-dot-row ${added?'added':'shared'}`} key={key} data-point-count={count} style={{opacity:growing?count===1?1:Math.max(.35,enter):added?Math.max(.35,enter):stage===1?commonOpacity:1,translate:`0 ${growing?(1-enter)*8:0}px`}}>
      <div className="tv-row-points">{Array.from({length:count},(_,i)=><i className="tv-dot" key={i}/>)}</div><span className="tv-row-label">第 {count} 行<span>{count} 点</span></span>
    </div>;
  };
  const common=(lower=false)=><div className="tv-common-block" style={{opacity:commonOpacity,translate:stage===3?`0 ${(1-arrival(timing,0))*-10}px`:'0 0'}}><span>相同的前 {scene.lower} 行</span><strong>{original.lowerCount} 个点</strong><small>{lower?'这一份正是被减去的点阵':'用省略块表示，点数没有省略'}</small>{stage>=4&&<i className="tv-cancel-mark" aria-hidden="true" style={{scale:`${cancel} 1`}}/>}</div>;
  return <div className={`teaching-visual tv-triangle tv-stage-${stage}`} aria-label="三角形数的动态板书" data-visible-rows={frame.visibleRows} data-visible-points={frame.pointCount}>
    <div className="tv-heading"><span className="tv-topic">图像 → 结构 → 算式</span><span className={`tv-scope ${originalVisible?'original':''}`}>{originalVisible?'原题推演':'认识规律 · 小例'}</span></div>
    <div className="tv-canvas">
      {!originalVisible?<div className={`tv-example-grid ${stage===1?'comparing':''}`}>
        <div className="tv-example-main"><div className="tv-dot-triangle" data-growing-diagram role="img" aria-label={`小例：${frame.rows} 行，共 ${frame.primaryPointCount} 个点`}>{Array.from({length:frame.rows},(_,i)=>row(i+1,stage===1&&i>=4,`large-${i}`,stage===0))}</div><span className="tv-count" data-growing-count>{`${frame.rows} 行 · ${frame.primaryPointCount} 个点`}</span></div>
        {stage===1&&<><span className="tv-minus" aria-hidden="true">−</span><div className="tv-example-small" style={{opacity:commonOpacity,translate:`${(1-arrival(timing,0))*18}px 0`}}><div className="tv-dot-triangle" role="img" aria-label="小例第4个三角形数：4行，共10点">{Array.from({length:4},(_,i)=>row(i+1,false,`small-${i}`))}</div><span className="tv-count">4 行 · {example.lowerCount} 个点</span></div></>}
      </div>:<div className="tv-original-diagram"><div className="tv-original-comparison">
        <div className="tv-original-upper"><div className="tv-object-label"><Formula latex={`T_{${scene.upper}}`}/><span>第 {scene.upper} 个 · {original.upperCount} 点</span></div>{common()}
          <div className="tv-added-rows" role="img" aria-label={`只在第${scene.upper}个三角形数中新增的${original.addedRows.length}行，行号与点数分别为${original.addedRows.join('、')}，共${original.added}点`}>{original.addedRows.map(n=><div className="tv-original-row" key={n} style={{translate:`${(1-arrival(timing,stage===3?.65+(n-scene.lower-1)*.3:1.3))*12}px 0`}}>{row(n,true,`original-${n}`)}</div>)}</div>
        </div><span className="tv-original-minus" aria-label="减去">−</span>
        <div className="tv-original-lower"><div className="tv-object-label"><Formula latex={`T_{${scene.lower}}`}/><span>第 {scene.lower} 个 · {original.lowerCount} 点</span></div>{common(true)}</div>
      </div></div>}
    </div>
    <div className="tv-formula-line" style={{opacity:Math.max(.5,arrival(timing,0))}}>
      {stage===0?<><span>第 {frame.rows} 个 · {frame.rows} 行 · {frame.pointCount} 点</span><Formula latex={`${Array.from({length:frame.rows},(_,i)=>i+1).join('+')}=${frame.pointCount}`}/></>
      :stage===1?<><span>小例的差</span><Formula latex={`T_6-T_4=5+6=${example.added}`}/></>
      :stage===2?<><span>把图译成数学语言</span><Formula latex={String.raw`T_n=1+2+3+\cdots+n`}/></>
      :stage===3?<><span>共同部分 + 新增部分</span><Formula latex={`T_{${scene.upper}}=T_{${scene.lower}}+${original.addedRows.join('+')}`}/></>
      :stage===5?<><span>独立检验</span><Formula latex={`${original.upperCount}-${original.lowerCount}=${original.added}`}/></>
      :<><span>原题的差</span><Formula latex={`T_{${scene.upper}}-T_{${scene.lower}}=${original.addedRows.join('+')}=${original.added}`}/></>}
      {(stage===1||stage>=4)&&<strong className="tv-result" style={{scale:String(.92+.08*resultArrival)}}>{stage===1?example.added:original.added}<small> 个点</small></strong>}
    </div>
    <p className="tv-caption">{frame.cue}</p>
    <div className="tv-legend"><span><i/>共同部分</span><span><i className="added"/>新添的行</span><span>点数是离散数量</span></div>
  </div>;
}

function DistanceTeaching({scene,phase,timing}:{scene:NumberScene;phase:DistancePhase;timing:Timing}){
  const id=useId(),facts=distanceTeachingFacts(scene),frame=distanceFrame(scene,phase,timing),parameter=scene.parameterValue!==undefined,target=scene.targetSum;
  const span=Math.max(4,facts.minimum,(target??0)/2),min=Math.min(facts.lo,...facts.roots,3-(scene.targetMinimum??0))-span*.6,max=Math.max(facts.hi,...facts.roots,3+(scene.targetMinimum??0))+span*.6;
  const px=(n:number)=>58+(n-min)/(max-min)*404;
  const firstX=px(frame.left),secondX=px(frame.right),movingX=px(frame.x);
  const visibleRoots=phase==='left-root'?facts.roots.slice(0,1):phase==='right-root'?facts.roots.slice(1):['verify','summary'].includes(phase)?facts.roots:[];
  const pathReveal=timing.reducedMotion?1:Math.max(.15,progress(seconds(timing),0,.7));
  return <div className="teaching-visual tv-distance" aria-label="绝对值的数轴距离动态板书" data-x={frame.x} data-left={frame.left} data-right={frame.right} data-distance-sum={frame.sum}>
    <div className="tv-heading"><span className="tv-topic">代数式 → 数轴距离</span><span className="tv-scope original">原题条件</span></div>
    <div className="tv-fixed-conditions">{parameter?<><span data-parameter-value>{`当前示例 a=${fmt(-frame.left)}`}</span><span>{scene.targetMinimum===undefined?'几何关系':'原题要求'}</span><Formula latex={String.raw`\min(|x+a|+|x-3|)=${scene.targetMinimum??'|a+3|'}`}/></>:<><span>固定点：{fmt(facts.left)} 与 {fmt(facts.right)}</span>{target!==undefined&&<span>目标距离和：{fmt(target)}</span>}</>}</div>
    <svg className="tv-number-board" viewBox="0 0 520 226" role="img" aria-labelledby={id}>
      <title id={id}>两条弧线表示 P 到两个固定点的距离，闭区间上总距离不变</title>
      <line x1="24" x2="496" y1="160" y2="160" className="tv-axis"/>
      <path d="M486 154 L496 160 L486 166" className="tv-axis"/>
      <line data-minimum-line x1={px(frame.lo)} x2={px(frame.hi)} y1="160" y2="160" className="tv-minimum-line"/>
      <path data-distance-first className="tv-distance-first" d={`M${firstX} 160 Q${(firstX+movingX)/2} ${160-Math.min(122,Math.abs(firstX-movingX)*.65)} ${movingX} 160`} pathLength="1" strokeDasharray="1" strokeDashoffset={1-pathReveal}/>
      <path data-distance-second className="tv-distance-second" d={`M${secondX} 160 Q${(secondX+movingX)/2} ${160-Math.min(72,Math.abs(secondX-movingX)*.35)} ${movingX} 160`} pathLength="1" strokeDasharray="1" strokeDashoffset={1-pathReveal}/>
      <g data-fixed-a transform={`translate(${firstX} 160)`}><circle r="6" className="tv-endpoint"/><text data-label-a y="44" textAnchor="middle">{`A=${fmt(frame.left)}`}</text></g>
      <g transform={`translate(${secondX} 160)`}><circle r="6" className="tv-endpoint"/><text y="44" textAnchor="middle">B={fmt(frame.right)}</text></g>
      <g data-moving-p transform={`translate(${movingX} 160)`}><circle r="15" className="tv-p-halo"/><circle r="7" className="tv-p-point"/><text data-point-x y="-24" textAnchor="middle">{`x=${fmt(frame.x)}`}</text></g>
      {visibleRoots.map(x=><g key={x} transform={`translate(${px(x)} 160)`}><circle r="5" className="tv-solution-point"/><text y="-52" textAnchor="middle">{x<facts.lo?'左侧':'右侧'} x={fmt(x)}</text></g>)}
    </svg>
    <div className="tv-distance-values"><span>青色 PA<strong data-first-value>{fmt(frame.first)}</strong></span><b>+</b><span>暖色 PB<strong data-second-value>{fmt(frame.second)}</strong></span><b>=</b><span>总距离<strong data-sum-value>{fmt(frame.sum)}</strong></span></div>
    <p className="tv-observation" data-observation>{frame.observation}</p>
    {frame.solveParameter&&<div className="tv-formula-line"><Formula latex={String.raw`|a+3|=${scene.targetMinimum}\quad\Rightarrow\quad a=${facts.parameterAnswers.map(fmt).join(String.raw`\;\text{或}\;`)}`}/></div>}
    <p className="tv-caption">{frame.cue}</p>
    <div className="tv-legend"><span><i/>可取的闭区间</span><span><i className="added"/>移动的点 P</span></div>
  </div>;
}
