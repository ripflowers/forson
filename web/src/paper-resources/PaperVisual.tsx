import type {CSSProperties} from 'react';
import type {LessonPart} from '../types';
import {Formula} from '../components/Formula';
import {MathText,splitMathText} from '../components/MathText';
import {paperFrame,teacherInputs,num,type Diagram,type Recipe,type Inputs,type Tone} from './models';
import './paper-motion.css';

const colors:Record<Tone,string>={teal:'#168c83',orange:'#d68735',muted:'#9baeb7',red:'#ca5d5a'};
const color=(tone?:Tone)=>colors[tone??'teal'];
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
function SvgLabel({x,y,text,size=14,fill,width=180}:{x:number;y:number;text:string;size?:number;fill:string;width?:number}){
  if(!splitMathText(text).some(part=>part.kind==='math'))return <text x={x} y={y} textAnchor="middle" fill={fill} stroke="none" fontSize={size}>{text}</text>;
  return <foreignObject x={x-width/2} y={y-32} width={width} height={52}><div className="paper-svg-label" style={{fontSize:size,color:fill}}><MathText text={text}/></div></foreignObject>;
}
export function DiagramView({diagram,progress=1}:{diagram:Diagram;progress?:number}){
  const p=clamp(progress);
  if(diagram.kind==='axis'){
    const d=diagram,x=(n:number)=>46+(n-d.min)/(d.max-d.min)*548;
    const step=d.max-d.min>14?2:1,ticks=Array.from({length:Math.floor((d.max-Math.ceil(d.min))/step)+1},(_,i)=>Math.ceil(d.min)+i*step);
    return <svg className="paper-axis" viewBox="0 0 640 275" role="img" aria-label={`数轴：${d.marks.map(m=>`${m.label}=${num(m.value)}`).join('，')}。${d.spans.map(s=>s.label).join('；')}`}>
      {d.ranges?.map((range,i)=><g key={i} stroke={color(range.tone)}><path d={`M${x(range.from)} 38H${x(range.to)}`} strokeWidth="13" opacity=".12"/><circle cx={x(range.from)} cy="38" r="4" fill="white"/><circle cx={x(range.to)} cy="38" r="4" fill="white"/><SvgLabel x={(x(range.from)+x(range.to))/2} y={22} text={range.label} fill={color(range.tone)}/></g>)}
      <path d="M30 130H612l-7-4m7 4-7 4" fill="none" stroke="#b7c7cd" strokeWidth="1.5"/>
      {ticks.map(n=><g key={n} fill="#7b8c94"><path d={`M${x(n)} 126v8`} stroke="currentColor"/><text x={x(n)} y="154" textAnchor="middle" fontSize="14">{num(n)}</text></g>)}
      {d.min<=0&&d.max>=0&&<path d={`M${x(0)} 46v84`} stroke="#c0cdd1" strokeDasharray="3 5"/>}
      {d.spans.map((s,i)=>{const y=183+(s.lane??i)*29,from=x(s.from),to=x(s.to);return <g key={i} opacity={clamp(p*3-i*.3)} stroke={color(s.tone)}><path d={`M${from} ${y-5}v10m0-5H${from+(to-from)*p}m${(to-from)*(1-p)}-5v10`} fill="none" strokeWidth="2"/><SvgLabel x={(from+to)/2} y={y-9} text={s.label} fill={color(s.tone)}/></g>;})}
      {d.marks.map((m,i)=>{const y=103-(m.lane??0)*22;return <g key={i} opacity={clamp(p*4-i*.12)}><line x1={x(m.value)} x2={x(m.value)} y1={y+7} y2="130" stroke={color(m.tone)} strokeDasharray="2 3"/><circle cx={x(m.value)} cy="130" r="7" fill={color(m.tone)} stroke="white" strokeWidth="2"/><SvgLabel x={x(m.value)} y={y} text={m.label} fill={color(m.tone)} size={16}/></g>;})}
    </svg>;
  }
  if(diagram.kind==='tokens')return <div className="paper-token-rows">{diagram.rows.map((r,i)=><div className="paper-token-row" key={i} style={{opacity:Math.max(.3,clamp(p*3-i*.45)),transform:`translateY(${(1-clamp(p*3-i*.45))*8}px)`}}><span><MathText text={r.label}/></span><div>{r.items.map((t,j)=><b key={j} className={t.cancel?'is-cancelled':''} style={{'--token-color':color(t.tone),'--cancel':p} as CSSProperties}><MathText text={t.text}/></b>)}</div></div>)}</div>;
  if(diagram.kind==='graph'){
    const d=diagram,ys=d.curves.flatMap(c=>c.points.map(p=>p[1])),lo=Math.min(0,...ys),hi=Math.max(1,...ys),x=(n:number)=>45+(n-d.min)/(d.max-d.min)*550,y=(n:number)=>200-(n-lo)/(hi-lo)*170;
    const dataAt=(points:[number,number][])=>{const index=points.findIndex(point=>point[0]>=d.at);if(index<=0)return points[Math.max(0,index)];const [a,b]=[points[index-1],points[index]];return[d.at,a[1]+(b[1]-a[1])*(d.at-a[0])/(b[0]-a[0])];};
    return <div className="paper-graph"><div className="paper-legend">{d.curves.map(c=><span key={c.label}><i style={{background:color(c.tone)}}/><MathText text={c.label}/></span>)}</div><svg viewBox="0 0 640 258" role="img" aria-label={`函数图像，当前横坐标 ${num(d.at)}。${d.curves.map(c=>c.label).join('，')}`}>
      {[0,.25,.5,.75,1].map(f=><g key={f}><path d={`M45 ${200-f*170}H595`} stroke="#e4ecee"/><text x="36" y={204-f*170} textAnchor="end" fontSize="12" fill="#8a9ba3">{num(lo+(hi-lo)*f)}</text></g>)}
      <text x="45" y="16" fill="#6f848e" fontSize="12">{d.yLabel}</text><text x="595" y="249" textAnchor="end" fill="#6f848e" fontSize="12">{d.xLabel}</text><path d={`M45 ${y(0)}H602M45 24V206`} stroke="#bac9ce" fill="none"/>
      {d.floor!==undefined&&<path d={`M45 ${y(d.floor)}H595`} stroke="#d9a56a" strokeDasharray="5 5"/>}
      {d.curves.map((c,i)=><path key={i} d={c.points.map(([a,b],j)=>`${j?'L':'M'}${x(a)},${y(b)}`).join(' ')} stroke={color(c.tone)} fill="none" strokeWidth="3" pathLength="1" strokeDasharray="1" strokeDashoffset={1-p}/>)}
      <path d={`M${x(d.at)} 25V205`} stroke="#a1b4bb" strokeDasharray="4 4"/>
      {d.ends?.map((point,i)=><circle key={`end${i}`} cx={x(point.x)} cy={y(point.y)} r="5" fill={point.open?'white':color(point.tone)} stroke={color(point.tone)} strokeWidth="2"/>)}
      {d.curves.filter(c=>d.at>=c.points[0][0]&&d.at<=c.points.at(-1)![0]).map((c,i)=>{const point=dataAt(c.points);return <circle key={i} cx={x(d.at)} cy={y(point[1])} r="5" fill={color(c.tone)} stroke="white" strokeWidth="2"/>;})}
      {[d.min,(d.min+d.max)/2,d.max].map(t=><text key={t} x={x(t)} y="225" textAnchor="middle" fill="#6f848e" fontSize="13">{num(t)}</text>)}
    </svg><p className="paper-graph-reading"><MathText text={d.meaning}/></p></div>;
  }
  if(diagram.kind==='units')return <div className="paper-units"><span>每格 = <MathText text={diagram.unit}/></span>{[diagram.positive,diagram.negative].map((n,i)=><div key={i}><label>{i?'负单位':'正单位'}</label><div>{Array.from({length:n},(_,j)=><span key={j} className={i?'negative':'positive'} style={{opacity:diagram.cancel&&j<Math.min(diagram.positive,diagram.negative)?1-p*.82:1,transform:`translateY(${diagram.cancel&&j<Math.min(diagram.positive,diagram.negative)?(i?-1:1)*p*8:0}px)`}}>{i?'−':'+'}</span>)}</div></div>)}{diagram.cancel&&<p style={{opacity:p}}>每对正负单位合为 0，只数留下的格子。</p>}</div>;
  if(diagram.kind==='orbit'){
    const positions=[[320,50],[480,150],[320,250],[160,150]];
    return <svg viewBox="0 0 640 310" role="img" aria-label={`四项循环：${diagram.values.join(' → ')}。当前第 ${diagram.active+1} 位`}>
      <path d="M320 50Q480 50 480 150Q480 250 320 250Q160 250 160 150Q160 50 320 50" fill="none" stroke="#d6e6e5" strokeWidth="3" pathLength="1" strokeDasharray="1" strokeDashoffset={1-p}/>
      {positions.map(([x,y],i)=><g key={i}><circle cx={x} cy={y} r="34" fill={i===diagram.active?'#168c83':'#f1f7f6'} stroke={i===diagram.active?'#168c83':'#d4e3e2'} strokeWidth="2"/><SvgLabel x={x} y={y+7} text={diagram.values[i]} fill={i===diagram.active?'white':'#4d7179'} size={24} width={65}/><text x={x} y={y-42} textAnchor="middle" fontSize="14" fill="#7c9399">第 {i+1} 位</text></g>)}
      <text x="320" y="148" textAnchor="middle" fontSize="17" fill="#366469">每 4 项回到同一位置</text><SvgLabel x={320} y={179} text={diagram.rule} fill="#82979b" size={13} width={250}/><text x="440" y="66" fill="#d68735" fontSize="22">↘</text><text x="440" y="244" fill="#d68735" fontSize="22">↙</text><text x="187" y="244" fill="#d68735" fontSize="22">↖</text><text x="187" y="66" fill="#d68735" fontSize="22">↗</text>
    </svg>;
  }
  if(diagram.kind==='window')return <div className="paper-count-grid"><span>每一格是一种不重复的选择</span><div>{Array.from({length:5},(_,i)=><div key={i}><label>a={i+1}</label>{Array.from({length:4},(_,j)=><b className={diagram.left===i+1&&diagram.middle===j+1?'selected':''} key={j} style={{opacity:clamp(p*4-(i+j)*.12)}}>{i+1},{i+j+2},{i+6}</b>)}</div>)}</div></div>;
  if(diagram.kind==='halves')return <div className="paper-halves"><span>始终从 128 这一整体里减去</span><div className="halves-strip">{diagram.removed.map((n,i)=><span key={i} style={{width:`${n/128*100}%`,opacity:.4+.35*p}} aria-label={`已减去 ${n}`}>{n>=8?n:''}</span>)}<b style={{width:`${diagram.remaining/128*100}%`}} aria-label={`余下 ${diagram.remaining}`}/></div><div className="halves-calculation">{diagram.removed.map((n,i)=><span key={i}>−{n}</span>)}<strong>余下 {diagram.remaining}</strong></div></div>;
  if(diagram.kind==='reciprocal'){
    const flipped=diagram.phase>=1,cancel=diagram.phase===2;
    const fraction=(top:string,bottom:string,cancelTop=false,cancelBottom=false)=><span className="paper-fraction"><b className={cancelTop?'cancel-seven':''}>{top}</b><b className={cancelBottom?'cancel-seven':''}>{bottom}</b></span>;
    return <div className="paper-reciprocal"><span>被除数保持原样 · 仅除数取倒数</span><div>{fraction('6999','7',false,cancel)}<strong>{flipped?'×':'÷'}</strong><span className="negative-fraction">−{fraction(flipped?'7':'10',flipped?'10':'7',cancel,false)}</span></div><p>{flipped?'分子分母互换，负号保留。':'先将两个带分数分别转成假分数。'}</p>{cancel&&<div className="reciprocal-result"><span>只约去两个 7，留下</span>−{fraction('6999','10')}</div>}</div>;
  }
  if(diagram.kind==='sequence')return <div className="paper-sequence"><span>上方是项数，下方是数值 · 第 2 项起，两项一组</span><div>{diagram.values.map((value,i)=><div key={i} className={`${Math.floor((i+1)/2)%2?'alternate':''} ${diagram.active===i+1?'active':''}`}><span>第 {i+1} 项</span><b>{num(value)}</b><small>{i===0?'起点':`第 ${Math.floor((i+1)/2)} 组`}</small></div>)}</div></div>;
  return <div className="paper-shift"><span>相同指数对齐后，每一列相减</span><div className="shift-grid" style={{gridTemplateColumns:`42px repeat(${diagram.n+2},minmax(32px,1fr))`}}><label>2S</label><b/><>{Array.from({length:diagram.n+1},(_,i)=><b key={i} className={diagram.cancel&&i<diagram.n?'is-cancelled':''} style={{opacity:diagram.cancel&&i<diagram.n?1-p*.7:1}}>2<sup>{i+1}</sup></b>)}</><label>−S</label>{Array.from({length:diagram.n+1},(_,i)=><b key={i} className={diagram.cancel&&i>0?'is-cancelled':''} style={{opacity:diagram.cancel&&i>0?1-p*.7:1}}>{i===0?'−1':<>−2<sup>{i}</sup></>}</b>)}<b/></div>{diagram.cancel&&<p>只剩：2<sup>{diagram.n+1}</sup> − 1</p>}</div>;
}

export function PaperBoard({recipe,input,stage,progress=1,explore=false}:{recipe:Recipe;input:Inputs;stage:number;progress?:number;explore?:boolean}){
  const frame=paperFrame(recipe,input,stage);
  return <div className={`paper-board ${explore?'is-explore':''}`} data-paper-resource={recipe.key} data-stage={stage}>
    <div className="paper-visual-head"><span>{explore?'改变条件，观察关系':'把推理画出来'}</span><b><MathText text={recipe.title}/></b></div>
    <div className={`paper-diagrams ${frame.diagrams.length>1?'has-pair':''}`}>{frame.diagrams.map((diagram,i)=><DiagramView key={i} diagram={diagram} progress={progress}/>)}</div>
    {(stage>=2||explore)&&<div className="paper-metrics">{frame.values.map((item,i)=><div key={i} style={{borderColor:color(item.tone)}}><span><MathText text={item.label}/></span><strong style={{color:color(item.tone)}}><MathText text={item.value}/></strong></div>)}</div>}
    {explore&&<p className="paper-reading"><MathText text={frame.note}/></p>}
  </div>;
}
export function PaperTeaching({recipe,part,stage,frame,fps,reducedMotion}:{recipe:Recipe;part:LessonPart;stage:number;frame:number;fps:number;reducedMotion:boolean}){
  const seconds=frame/fps,progress=reducedMotion||stage===0?1:.35+.65*clamp(seconds/2),input=teacherInputs(recipe,stage,seconds,reducedMotion),step=part.steps[stage-2];
  return <div className="paper-teaching"><PaperBoard recipe={recipe} input={input} stage={stage} progress={progress}/>
    <div className="paper-step-reason"><span>{stage===0?'先看什么':stage===1?'为什么这样做':step?'这一步的依据':'把结论带回原题'}</span><p><MathText text={stage===0?recipe.action:stage===1?part.method:step?.reason??part.summary}/></p></div>
    {step?.formulaLatex&&<div className="paper-formula" style={{opacity:reducedMotion?1:.45+.55*clamp(seconds-1)}}><Formula latex={step.formulaLatex}/></div>}
    {stage===recipe.stageCount-1&&<div className="paper-result"><span>本小问的结论</span><MathText text={part.answer.display}/></div>}
  </div>;
}
