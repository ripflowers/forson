import {useId} from 'react';
import {triangleState,type TriangleScene} from '../domain';
import type {MotionPack,MotionView} from '../motion-resources';
import {Formula} from './Formula';
import './triangle-motion-lesson.css';

export type {MotionView} from '../motion-resources';
type Props={scene:TriangleScene;stageIndex:number;localFrame:number;fps:number;pace:number;reducedMotion:boolean;pack:MotionPack;view?:MotionView};
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
const ramp=(time:number,from:number,duration:number)=>clamp((time-from)/duration);
const ease=(value:number)=>value*value*(3-2*value);

/** Canonical voice seconds, never a second clock or an accumulated animation state. */
export function triangleMotionFrame(scene:TriangleScene,stageIndex:number,localFrame:number,fps=30,pace=1,reducedMotion=false){
  const time=reducedMotion?2.88:Math.max(0,localFrame)*pace/fps;
  const rows=stageIndex===0?Math.min(6,Math.floor(time/.48)+1):6;
  const original=triangleState(scene.lower,scene.upper),example=triangleState(4,6);
  const comparison=stageIndex===1?example:original;
  const cancel=stageIndex===1?ramp(time,.8,.8):stageIndex>=4?ramp(time,.3,.8):0;
  const move=stageIndex===1?ramp(time,1.6,1.2):stageIndex===4?ramp(time,1.1,1.7):stageIndex>4?1:0;
  const commonCopies=stageIndex===1||stageIndex>=3?2:0;
  return{time,stageIndex,rows,rowCounts:Array.from({length:rows},(_,i)=>i+1),
    pointCount:stageIndex===0?triangleState(0,rows).upperCount:stageIndex===1?31:stageIndex===2?21:original.added,
    upperCount:comparison.upperCount,lowerCount:comparison.lowerCount,
    commonCount:commonCopies?comparison.lowerCount:0,commonCopies,
    addedRows:stageIndex===1?[5,6]:stageIndex>=3?original.addedRows:[],
    addedCount:stageIndex===1?11:stageIndex>=3?original.added:0,
    cancel:ease(cancel),move:ease(move),sumVisible:stageIndex===1?time>=1.6:stageIndex>=4&&(stageIndex>4||time>=1.1),
    highlightedRow:stageIndex===0?rows:stageIndex===2?Math.min(6,Math.floor(clamp(time/.6)*5)+1):stageIndex===3?(time<1.3?0:time<1.6?scene.lower+1:scene.upper):0,
    verifyStep:stageIndex===5?(time<.6?0:time<1.2?1:time<1.8?2:3):0,
    routeProgress:stageIndex===6?clamp(time/2.8):0,
  };
}
type Frame=ReturnType<typeof triangleMotionFrame>;

function Stone({x,y,r=7,added=false,active=false,view,id,opacity=1}:{x:number;y:number;r?:number;added?:boolean;active?:boolean;view:MotionView;id:string;opacity?:number}){
  return <g className={`tm-stone ${added?'added':'shared'} ${active?'active':''}`} opacity={opacity}>
    {view==='space'&&<ellipse cx={x+1} cy={y+r*.82} rx={r*1.05} ry={r*.4} fill="var(--ink)" opacity=".12"/>}
    {active&&<circle cx={x} cy={y} r={r+3} fill="none" stroke={added?'var(--orange)':'var(--accent)'} strokeWidth="1" opacity=".45"/>}
    <circle cx={x} cy={y} r={r} fill={view==='space'?`url(#${id}-${added?'gold':'teal'})`:added?'var(--orange)':'var(--accent)'} stroke={added?'var(--orange)':'var(--accent)'} strokeWidth=".6"/>
    {view==='space'&&<circle cx={x-r*.3} cy={y-r*.3} r={r*.23} fill="#fff" opacity=".7"/>}
  </g>;
}
function StoneDefinitions({id}:{id:string}){
  return <defs><radialGradient id={`${id}-teal`} cx="30%" cy="24%" r="78%"><stop offset="0" stopColor="#e6ffff"/><stop offset=".35" stopColor="#58b4b5"/><stop offset="1" stopColor="#006c76"/></radialGradient><radialGradient id={`${id}-gold`} cx="30%" cy="24%" r="78%"><stop offset="0" stopColor="#fff1c7"/><stop offset=".35" stopColor="#e9b85d"/><stop offset="1" stopColor="#a96213"/></radialGradient></defs>;
}
function SmallTriangle({rows,frame,view,id,subtract=false}:{rows:number;frame:Frame;view:MotionView;id:string;subtract?:boolean}){
  const comparing=frame.stageIndex===1;
  const active=frame.highlightedRow;
  const last=rows-1,center=145+last*4,half=last*12.5;
  return <svg viewBox="0 0 320 220" role="img" aria-label={`${rows}行、${triangleState(0,rows).upperCount}个石子${comparing?'；前4行在两边一一对应':''}`}>
    <StoneDefinitions id={id}/>
    {view==='space'&&<path d={`M145 23 L${center+half+12} ${47+last*23.5} L${center-half-12} ${47+last*26.5} Z`} fill="var(--soft)" stroke="var(--line)"/>}
    {Array.from({length:rows},(_,index)=>{
      const row=index+1,added=comparing&&!subtract&&row>4;
      const entry=frame.stageIndex===0&&row===active?1-ease(ramp(frame.time,(row-1)*.48,.32)):0;
      const offset=added?frame.move*16:0;
      return <g key={row} data-motion-row={row} data-row-point-count={row}>
        {Array.from({length:row},(_,column)=>{
          const x=145+(column-index/2)*25+(view==='space'?index*4:0),y=35+index*25-(view==='space'?(column-index/2)*3:0)+offset-entry*7;
          return <Stone key={column} x={x} y={y} added={added} active={row===active||added&&frame.move>0} view={view} id={id} opacity={comparing&&row<=4?1-frame.cancel*.45:1}/>;
        })}
        <text x="274" y={40+index*25+offset} className={`tm-row-number ${added?'added':''}`}>{row} 点</text>
        {comparing&&row<=4&&frame.cancel>0&&<path d={`M${130-index*12.5} ${34+index*25} h${(35+index*25)*frame.cancel}`} className="tm-cancel-stroke"/>}
      </g>;
    })}
  </svg>;
}
function CommonBlock({count,rows,frame,view}:{count:number;rows:number;frame:Frame;view:MotionView}){
  const x=24,y=27,w=268,h=86,d=view==='space'?10:0;
  return <g className="tm-common-block" data-common-count={count} data-represented-rows={rows}>
    {view==='space'&&<><path d={`M${x} ${y} l${d} ${-d} h${w} l${-d} ${d} Z`} fill="var(--soft)" stroke="var(--accent)" opacity=".65"/><path d={`M${x+w} ${y} l${d} ${-d} v${h} l${-d} ${d} Z`} fill="var(--accent)" opacity=".28"/></>}
    <rect x={x} y={y} width={w} height={h} rx="9" fill="var(--soft)" fillOpacity={1-frame.cancel*.5} stroke="var(--accent)" strokeWidth="1" strokeDasharray={frame.cancel>0?'5 3':undefined}/>
    {Array.from({length:rows-1},(_,i)=><path key={i} d={`M${x+6} ${y+(i+1)*h/rows} h${w-12}`} stroke="var(--accent)" strokeWidth=".5" opacity=".16"/>)}
    <rect x="77" y="43" width="162" height="50" rx="8" fill="var(--paper)" opacity=".96"/>
    <text x="158" y="64" className="tm-block-label">共同的前 {rows} 行</text>
    <text x="158" y="88" className="tm-common-value">{count}<tspan className="tm-point-unit"> 个点</tspan></text>
    {frame.cancel>0&&<path d={`M38 105 L${38+236*frame.cancel} ${105-68*frame.cancel}`} className="tm-cancel-stroke"/>}
  </g>;
}
function OriginalTriangle({scene,frame,view,id,subtract=false}:{scene:TriangleScene;frame:Frame;view:MotionView;id:string;subtract?:boolean}){
  const rows=frame.addedRows;
  return <svg viewBox="0 0 320 250" role="img" aria-label={subtract?`第${scene.lower}个三角形数，共同的${scene.lower}行是${frame.commonCount}个点`:`第${scene.upper}个三角形数，包含共同的${frame.commonCount}个点，以及第${rows.join('、')}行的石子，逐行点数仍需相加`}>
    <StoneDefinitions id={id}/><CommonBlock count={frame.commonCount} rows={scene.lower} frame={frame} view={view}/>
    {!subtract&&rows.map((row,index)=>{
      const moved=frame.move*(index===0?15:25),y=153+index*39+moved;
      const active=frame.stageIndex!==3||frame.highlightedRow===row;
      return <g key={row} data-motion-row={row} data-row-point-count={row}>
        {Array.from({length:row},(_,column)=><Stone key={column} x={28+column*11.3} y={y-(view==='space'?(column-(row-1)/2)*.22:0)} r={4} added active={active&&frame.move>0} view={view} id={id} opacity={frame.stageIndex===3&&!active ? 0.72 : 1}/>)}
        <text x="160" y={y+22} className={`tm-original-row-label ${active?'active':''}`}>第 {row} 行 · {row} 个点</text>
      </g>;
    })}
    {subtract&&<text x="158" y="138" className="tm-reference-note">省略的是画法，点数没有省略</text>}
  </svg>;
}

export function TriangleMotionLesson({scene,stageIndex,localFrame,fps,pace,reducedMotion,pack,view='space'}:Props){
  const id=`tm-${useId().replace(/:/g,'')}`,frame=triangleMotionFrame(scene,stageIndex,localFrame,fps,pace,reducedMotion);
  const stage=pack.stages.find(item=>item.stageIndex===stageIndex),original=stageIndex>=3;
  const activeConcepts=stage?.conceptIds.map(conceptId=>pack.concepts.find(concept=>concept.id===conceptId)).filter(Boolean)??[];
  return <section className={`teaching-visual triangle-motion-lesson tm-stage-${stageIndex} tm-view-${view}`} aria-label="三角形数的知识与解题动作演示" data-motion-pack={pack.id} data-motion-view={view} data-visible-rows={original?frame.addedRows.length:frame.rows} data-visible-points={frame.pointCount}>
    <div className="tm-focus"><span>{original?'原题推演':stageIndex===1?'小例找方法':'观察规律'}</span><b>{stage?.focus??stage?.title}</b><small>{view==='space'?'空间示意':'平面示意'}</small></div>
    {stageIndex===0||stageIndex===2?<div className="tm-grow-grid"><figure className="tm-figure"><figcaption><span>{stageIndex===0?`第 ${frame.rows} 个三角形数`:'用 6 行示意每一行的规律'}</span><strong>{stageIndex===0?frame.pointCount:21}<small> 个点</small></strong></figcaption><SmallTriangle rows={frame.rows} frame={frame} view={view} id={`${id}-grow`}/></figure><div className="tm-growth-ledger"><span>{stageIndex===0?'每加一行，就把这一行的点数加上':'图像对应数学语言'}</span><ol aria-label="各行点数与累计总数">{frame.rowCounts.map(row=><li key={row} className={row===frame.highlightedRow?'active':''}><span>第 {row} 行</span><b>+ {row}</b><em>{triangleState(0,row).upperCount}<small> 点</small></em></li>)}</ol></div></div>
    :stageIndex===1?<div className="tm-panels"><figure className="tm-figure"><figcaption><span>第 6 个 · 被减数</span><strong>21<small> 点</small></strong></figcaption><SmallTriangle rows={6} frame={frame} view={view} id={`${id}-six`}/><p>共同的前 4 行：10 点</p></figure><figure className="tm-figure"><figcaption><span>第 4 个 · 减数</span><strong>10<small> 点</small></strong></figcaption><SmallTriangle rows={4} frame={frame} view={view} id={`${id}-four`} subtract/><p>同样的前 4 行：10 点</p></figure></div>
    :<div className="tm-panels"><figure className="tm-figure"><figcaption><span>第 {scene.upper} 个 · 被减数</span><strong>{scene.upper}<small> 行</small></strong></figcaption><OriginalTriangle scene={scene} frame={frame} view={view} id={`${id}-upper`}/><div className="tm-critical-labels"><b>共同的前 {scene.lower} 行 = {frame.commonCount} 个点</b>{frame.addedRows.map(row=><span key={row}>新增第 {row} 行：{row} 个点</span>)}</div></figure><figure className="tm-figure"><figcaption><span>第 {scene.lower} 个 · 减数</span><strong>{scene.lower}<small> 行</small></strong></figcaption><OriginalTriangle scene={scene} frame={frame} view={view} id={`${id}-lower`} subtract/><div className="tm-critical-labels"><b>同样的前 {scene.lower} 行 = {frame.commonCount} 个点</b><span>这一份没有新增的两行</span></div></figure></div>}
    <div className="tm-calculation" aria-label="点阵形成的算式">
      {stageIndex===0?<><span>行数是序号 · 点数要累加</span><div className="tm-growing-sum">{frame.rowCounts.map((row,i)=><span key={row} className={row===frame.highlightedRow?'active':''}>{i>0&&<i>+</i>}{row}</span>)}<i>=</i><strong>{frame.pointCount}</strong></div></>
      :stageIndex===1?<><span>{frame.sumVisible?'共同部分抵消后，只剩两行':'先比较相同的前 4 行'}</span><Formula latex={frame.sumVisible?'T_6-T_4=5+6=11':'T_6=T_4+5+6'}/><small>小例的 11 只说明方法，还不是原题答案。</small></>
      :stageIndex===2?<><span>第几个 → 有几行 → 各行点数相加</span><div className="tm-term-correspondence" aria-label="示意图每一行对应的加数">{frame.rowCounts.map(row=><div key={row} data-sum-term={row} className={row===frame.highlightedRow?'active':''}><span>第 {row} 行</span><svg viewBox="0 0 10 18" aria-hidden="true"><path d="M5 1 v13 M1 10 l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.3"/></svg><b>{row>1?'+ ':''}{row}</b></div>)}</div><Formula latex={String.raw`T_n=1+2+3+\cdots+n`}/><small>图中以 6 行示意，总点数 1+2+3+4+5+6=21；规律可以继续到第 n 行。</small></>
      :stageIndex===3?<><span>两份共同部分 + 新添的行</span><Formula latex={`T_{${scene.upper}}=T_{${scene.lower}}+${frame.addedRows.join('+')}`}/><small>{scene.upper} − {scene.lower} = {scene.upper-scene.lower} 表示多了 {scene.upper-scene.lower} 行，每行的点数还要相加。</small></>
      :stageIndex===4?<><span>{frame.sumVisible?'让新增的两行，走到加法里':'两份共同部分在减法中贡献零'}</span>{frame.sumVisible?<div className="tm-added-sum" style={{translate:`0 ${-8*(1-frame.move)}px`}}>{frame.addedRows.map((row,i)=><span key={row}>{i>0&&<i>+</i>}<b data-added-term={row}>{row}</b></span>)}<i>=</i><strong>{frame.addedCount}<small> 个点</small></strong></div>:<Formula latex={`${frame.commonCount}-${frame.commonCount}=0`}/>}<small>新增 {scene.upper-scene.lower} 行，{frame.sumVisible?`合计 ${frame.addedCount} 个点，不能把 ${scene.upper-scene.lower} 当作点数差。`:'点数差仍需把这两行的点数相加。'}</small></>
      :stageIndex===5?<><span>独立检验 · 用另一条计算路线</span>{frame.verifyStep===0?<Formula latex={String.raw`T_n=\frac{n(n+1)}{2}`}/>:frame.verifyStep===3?<><Formula latex={`${frame.upperCount}-${frame.lowerCount}=${frame.addedCount}`}/><small>两个总数相减，与新增行的点数相同。</small></>:<div className="tm-verify-flow"><div className={frame.verifyStep===1?'active':''}><Formula latex={String.raw`T_{${scene.upper}}=\frac{${scene.upper}\times${scene.upper+1}}{2}=${frame.upperCount}`}/><small>第 {scene.upper} 个的全部点数</small></div>{frame.verifyStep>=2&&<div className="active"><Formula latex={String.raw`T_{${scene.lower}}=\frac{${scene.lower}\times${scene.lower+1}}{2}=${frame.lowerCount}`}/><small>第 {scene.lower} 个的全部点数</small></div>}</div>}</>
      :<><span>从图像出发，把思考路线带走</span><Formula latex={`T_{${scene.upper}}-T_{${scene.lower}}=${frame.addedRows.join('+')}=${frame.addedCount}`}/><ol className="tm-concept-route">{pack.concepts.map((concept,i)=><li key={concept.id} className={i<=Math.floor(frame.routeProgress*(pack.concepts.length-1))?'active':''}><span>{i+1}</span>{concept.label}</li>)}</ol></>}
    </div>
    <p className="tm-stage-explanation">{stage?.explanation}</p>
    {stageIndex!==6&&activeConcepts.length>0&&<div className="tm-concept-tags" aria-label="当前知识点">{activeConcepts.map(concept=><span key={concept!.id}>{concept!.label}</span>)}</div>}
  </section>;
}
