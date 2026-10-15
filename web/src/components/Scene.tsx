import {useId,useEffect,useRef,useState} from 'react';
import {ArrowRight,Bookmark} from 'lucide-react';
import {distanceState,triangleState,fmt,parseScene} from '../domain';
import type {SceneSpec} from '../types';
import {Formula} from './Formula';
import './scene-exploration.css';
type Props={spec:SceneSpec;state:Record<string,unknown>;onChange:(state:Record<string,unknown>)=>void;onSave:(text:string,snapshot:Record<string,unknown>)=>void;readOnly?:boolean};
export function trianglePredictionFeedback(rows:number,input:string){
  const value=input.trim(),expected=2*rows-1;
  if(!/^\d+$/.test(value))return{kind:'invalid' as const,message:'填一个整数，表示新添石子的颗数。'};
  const answer=Number(value),correct=answer===expected;
  return{kind:correct?'correct' as const:'retry' as const,answer,message:correct?`对了！第 ${rows-1} 行添 ${rows-1} 颗，第 ${rows} 行添 ${rows} 颗，所以多了 ${rows-1} + ${rows} = ${expected} 颗。`:`先看灰色部分：它没有增加。只数橙色的两行，第 ${rows-1} 行有 ${rows-1} 颗，第 ${rows} 行有 ${rows} 颗。把这两个数相加，再试一次。`};
}
export function Scene({spec,state,onChange,onSave,readOnly=false}:Props){
  const id=useId(),parsed=parseScene(spec),boardRef=useRef<HTMLDivElement>(null),[boardWidth,setBoardWidth]=useState(300);
  const [prediction,setPrediction]=useState(''),[checked,setChecked]=useState(false),[showHint,setShowHint]=useState(false);
  const sceneKey=JSON.stringify(spec);
  useEffect(()=>{setPrediction('');setChecked(false);setShowHint(false);},[sceneKey,state.rows]);
  useEffect(()=>{const element=boardRef.current;if(!element)return;const observer=new ResizeObserver(([entry])=>setBoardWidth(Math.max(180,entry.contentRect.width)));observer.observe(element);return()=>observer.disconnect();},[spec.kind]);
  if(!parsed)return <div className="notice warm">本小问的探索条件尚未支持。可以继续读老师主线，不会执行模型提供的代码。</div>;
  if(parsed.kind==='number-line'){
    const parameter=typeof state.a==='number'?state.a:parsed.parameterValue;
    const left=parameter===undefined?parsed.left:-parameter,right=parameter===undefined?parsed.right:3;
    const lo=Math.min(left,right),hi=Math.max(left,right),width=Math.max(4,hi-lo),min=Math.floor(lo-width/2),max=Math.ceil(hi+width/2);
    const x=typeof state.x==='number'&&state.x>=min&&state.x<=max?state.x:(left+right)/2;
    const value=distanceState(left,right,x),position=(n:number)=>24+(n-min)/(max-min)*(boardWidth-48);
    const formula=`|x-(${fmt(left)})|+|x-(${fmt(right)})|`;
    const text=`探索条件：固定点 ${fmt(left)}、${fmt(right)}${parameter===undefined?'':`，a=${fmt(parameter)}`}；x=${fmt(x)}。两段距离为 ${fmt(value.first)} 和 ${fmt(value.second)}，距离和 ${fmt(value.sum)}。最小值为 ${fmt(value.minimum)}，整个闭区间 [${fmt(lo)}, ${fmt(hi)}] 取得。`;
    return <div className={`scene scene-exploration${readOnly?' is-readonly':''}`}><div className="scene-top"><span>{readOnly?'老师示范 · P在两固定点的中间':'动手发现'}</span><span className="chip">数轴距离</span></div>
      {!readOnly&&<div className="exploration-task"><h3>把 P 移到两点之间，再移到外面</h3><p>观察 PA、PB 的长度。什么时候距离和不变？端点也算吗？</p></div>}<Formula latex={formula} display/>
      <div ref={boardRef}><svg viewBox={`0 0 ${boardWidth} 180`} className="number-axis" role="img" aria-label={text}>
        <line x1="8" x2={boardWidth-8} y1="115" y2="115" className="axis"/>
        <line x1={position(lo)} x2={position(hi)} y1="115" y2="115" className="minimum-segment"/>
        <path d={`M${position(left)} 100 V50 H${position(x)} V100`} className="distance first"/>
        <path d={`M${position(right)} 100 V75 H${position(x)} V100`} className="distance second"/>
        {Array.from({length:5},(_,i)=>min+i*Math.max(1,Math.ceil((max-min)/4))).filter(n=>n<=max).map(n=><g key={n}><line x1={position(n)} x2={position(n)} y1="110" y2="120" className="axis"/><text x={position(n)} y="146" textAnchor="middle">{n}</text></g>)}
        <circle cx={position(left)} cy="115" r="5" className="fixed-point"/><circle cx={position(right)} cy="115" r="5" className="fixed-point"/>
        <circle cx={position(x)} cy="115" r="15" className="point-halo"/><circle cx={position(x)} cy="115" r="7" className="moving-point"/>
        {left===right?<text x={position(left)} y="28" textAnchor="middle">A=B={fmt(left)}</text>:<><text x={position(left)} y="28" textAnchor="middle">A={fmt(left)}</text><text x={position(right)} y={Math.abs(position(left)-position(right))<70?'48':'28'} textAnchor="middle">B={fmt(right)}</text></>}<text x={position(x)} y="173" textAnchor="middle">P={fmt(x)}</text>
      </svg></div>
      <div className="scene-values"><span>PA<strong>{fmt(value.first)}</strong></span><span>PB<strong>{fmt(value.second)}</strong></span><span>距离和<strong>{fmt(value.sum)}</strong></span></div>
      {!readOnly&&<>{parameter!==undefined&&<label className="slider-label" htmlFor={id+'a'}>改变参数 a <output>{fmt(parameter)}</output><input id={id+'a'} type="range" min="-8" max="2" step="0.25" value={parameter} onChange={e=>onChange({...state,a:Number(e.target.value),x:undefined})}/></label>}
      <label className="slider-label" htmlFor={id}>点 P 的位置 x <output>{fmt(x)}</output><input id={id} type="range" min={min} max={max} step="0.25" value={x} onChange={e=>onChange({...state,x:Number(e.target.value)})}/></label></>}
      {!readOnly&&<div className="exploration-positions" role="group" aria-label="比较点 P 在不同位置的距离和">{[{label:'移到 A',x:left},{label:'放在中间',x:(left+right)/2},{label:'移到 B',x:right},{label:'移到区间外',x:Math.min(max,hi+1)}].map(item=><button key={item.label} type="button" onClick={()=>onChange({...state,x:item.x})}>{item.label}</button>)}</div>}
      <div className="notice">{value.inMinimumInterval?<>P在闭区间内：一段增加，另一段等量减少，总长为AB={fmt(value.minimum)}。端点也成立。</>:<>P超出区间 {fmt(value.excess)}：去端点又折回来，多走了两倍的距离。总长为 {fmt(value.minimum)}+2×{fmt(value.excess)}={fmt(value.sum)}。</>}</div>
      {parsed.targetSum!==undefined&&<p className="scene-reason">原题目标距离和为{parsed.targetSum}。{value.sum===parsed.targetSum?'当前位置满足目标；还要检查区间的另一侧是否也有解。':'改变x观察目标在哪些位置出现；数值观察不能替代老师的完整推导。'}</p>}
      {parsed.targetMinimum!==undefined&&<p className="scene-reason">原题要求最小值为{parsed.targetMinimum}，{parsed.parameterValue!==undefined?'这里最小值等于固定点距离 |a+3|。探索参数改变时，老师原题结论保持不变。':`这里最小值等于两固定点距离 |${fmt(right)}−(${fmt(left)})|=${fmt(value.minimum)}。固定点不变时，移动P不会改变这个最小值。`}</p>}
      {readOnly?<p className="small">固定示范条件：A={fmt(left)}、B={fmt(right)}、P={fmt(x)}。这是认识距离的示意，完整推理请沿老师主线继续。</p>:<button className="button" onClick={()=>onSave(text,{...state,x,a:parameter,left,right,...value})}><Bookmark/>保存观察摘要</button>}
    </div>;
  }
  const n=typeof state.rows==='number'?Math.max(2,Math.min(8,Math.round(state.rows))):parsed.previewRows;
  const preview=triangleState(Math.max(0,n-2),n),original=triangleState(parsed.lower,parsed.upper);
  const feedback=checked?trianglePredictionFeedback(n,prediction):null;
  const text=`小点阵 ${n} 层共 ${preview.upperCount} 个点，新增最后两行共 ${preview.added} 点。${feedback&&'answer' in feedback?`本次预测 ${feedback.answer} 颗，${feedback.kind==='correct'?'与点阵一致':'还需比较新增两行'}。`:''}这是一次探索观察。`;
  return <div className={`scene scene-exploration${readOnly?' is-readonly':''}`}><div className="scene-top"><span>{readOnly?'老师示范 · 消去共同部分，只数新添的行':'动手发现'}</span><span className="chip">三角形数</span></div>
    {!readOnly&&<div className="exploration-task"><h3>从 {n-2} 行长到 {n} 行，多了多少颗？</h3><p>灰色部分没有改变。先猜一猜，再数橙色的新石子。</p></div>}
    <div className="dot-board" role="img" aria-label={`${n}层点阵，共${preview.upperCount}点，最后两行用强调色展示`}>
      {Array.from({length:n},(_,i)=><div className="dot-row" key={i}>{Array.from({length:i+1},(_,j)=><span key={j} className={i>=n-2?'dot added':'dot'}/>)}<span className="dot-label">{i+1} 颗</span></div>)}
    </div>
    <div className="exploration-legend"><span><i className="dot"/>原有石子</span><span><i className="dot added"/>新添的两行</span></div>
    {!readOnly&&<label htmlFor={id} className="slider-label">换一个行数试试 <output>{n} 行</output><input id={id} type="range" min="2" max="8" step="1" value={n} onChange={e=>onChange({...state,rows:Number(e.target.value)})}/></label>}
    {readOnly?<div className="scene-values"><span>小点阵全部<strong>{preview.upperCount}点</strong></span><span>新增两行<strong>{n-1}+{n}={preview.added}</strong></span></div>:<form className="exploration-prediction" onSubmit={event=>{event.preventDefault();setChecked(true);}}>
      <label htmlFor={id+'prediction'}>我的预测 <span>选做 · 可以先观察图形</span></label>
      <div className="prediction-input"><input id={id+'prediction'} inputMode="numeric" autoComplete="off" placeholder="填颗数" value={prediction} onChange={event=>{setPrediction(event.target.value);setChecked(false);}} aria-describedby={feedback?id+'feedback':undefined}/><span>颗</span><button className="button primary" type="submit">检查一下</button></div>
      <div className="prediction-help"><button type="button" className="button text" onClick={()=>setShowHint(value=>!value)} aria-expanded={showHint}>{showHint?'收起提示':'给我一个提示'}</button>{feedback&&<button type="button" className="button text" onClick={()=>{setPrediction('');setChecked(false);}}>重新预测</button>}</div>
      {showHint&&<p className="exploration-hint">第几行，就有几颗石子。增加两行时，只需把最后两行的颗数相加。</p>}
      {feedback&&<p id={id+'feedback'} className={`prediction-feedback ${feedback.kind}`} role="status">{feedback.message}</p>}
    </form>}
    <details className="exploration-original" open={readOnly}><summary>把发现用回原题</summary><div className="original-rows"><span className="small">前 {parsed.lower} 行共 {original.lowerCount} 颗相同石子，可以消去。</span>{original.addedRows.map(row=><div key={row}><span>第 {row} 行</span><strong>{row} 颗</strong></div>)}<p><ArrowRight/>新增 {original.addedRows.join(' + ')} = <b>{original.added}</b> 颗</p></div><p className="scene-reason">数的是石子的颗数。共同部分消去后，只剩新添的行。</p></details>
    {!readOnly&&<div className="exploration-save"><button className="button" onClick={()=>onSave(text,{...state,rows:n,originalLower:parsed.lower,originalUpper:parsed.upper,...original,preview:{rows:n,...preview},...(feedback&&'answer' in feedback?{predictionAttempt:{rows:n,answer:feedback.answer,correct:feedback.kind==='correct'}}:{})})}><Bookmark/>保存这次观察</button><span>记下探索过程，方便下次回看。</span></div>}
  </div>;
}
