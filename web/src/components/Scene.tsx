import {useId,useEffect,useRef,useState} from 'react';
import {ArrowRight,Bookmark} from 'lucide-react';
import {distanceState,triangleState,fmt,parseScene} from '../domain';
import type {SceneSpec} from '../types';
import {Formula} from './Formula';
type Props={spec:SceneSpec;state:Record<string,unknown>;onChange:(state:Record<string,unknown>)=>void;onSave:(text:string,snapshot:Record<string,unknown>)=>void;readOnly?:boolean};
export function Scene({spec,state,onChange,onSave,readOnly=false}:Props){
  const id=useId(),parsed=parseScene(spec),boardRef=useRef<HTMLDivElement>(null),[boardWidth,setBoardWidth]=useState(300);
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
    return <div className="scene"><div className="scene-top"><span>{readOnly?'老师示范 · P在两固定点的中间':'移动一个点，看式子如何变化'}</span><span className="chip">数轴距离</span></div><Formula latex={formula} display/>
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
      <div className="notice">{value.inMinimumInterval?<>P在闭区间内：一段增加，另一段等量减少，总长为AB={fmt(value.minimum)}。端点也成立。</>:<>P超出区间 {fmt(value.excess)}：去端点又折回来，多走了两倍的距离。总长为 {fmt(value.minimum)}+2×{fmt(value.excess)}={fmt(value.sum)}。</>}</div>
      {parsed.targetSum!==undefined&&<p className="scene-reason">原题目标距离和为{parsed.targetSum}。{value.sum===parsed.targetSum?'当前位置满足目标；还要检查区间的另一侧是否也有解。':'改变x观察目标在哪些位置出现；数值观察不能替代老师的完整推导。'}</p>}
      {parsed.targetMinimum!==undefined&&<p className="scene-reason">原题要求最小值为{parsed.targetMinimum}，{parsed.parameterValue!==undefined?'这里最小值等于固定点距离 |a+3|。探索参数改变时，老师原题结论保持不变。':`这里最小值等于两固定点距离 |${fmt(right)}−(${fmt(left)})|=${fmt(value.minimum)}。固定点不变时，移动P不会改变这个最小值。`}</p>}
      {readOnly?<p className="small">固定示范条件：A={fmt(left)}、B={fmt(right)}、P={fmt(x)}。这是认识距离的示意，完整推理请沿老师主线继续。</p>:<button className="button" onClick={()=>onSave(text,{...state,x,a:parameter,left,right,...value})}><Bookmark/>保存观察摘要</button>}
    </div>;
  }
  const n=typeof state.rows==='number'?Math.max(2,Math.min(8,Math.round(state.rows))):parsed.previewRows;
  const preview=triangleState(Math.max(0,n-2),n),original=triangleState(parsed.lower,parsed.upper);
  const text=`小点阵 ${n} 层共 ${preview.upperCount} 个点，新增最后两行共 ${preview.added} 点。原题从 ${parsed.lower} 层到 ${parsed.upper} 层，新增 ${original.addedRows.join('+')}=${original.added} 个点。`;
  return <div className="scene"><div className="scene-top"><span>{readOnly?'老师示范 · 消去共同部分，只数新添的行':'消去共同部分，只数新添的行'}</span><span className="chip">三角形数</span></div>
    <div className="dot-board" role="img" aria-label={`${n}层点阵，共${preview.upperCount}点，最后两行用强调色展示`}>
      {Array.from({length:n},(_,i)=><div className="dot-row" key={i}>{Array.from({length:i+1},(_,j)=><span key={j} className={i>=n-2?'dot added':'dot'}/>)}<span className="dot-label">{i+1}</span></div>)}
    </div>{!readOnly&&<label htmlFor={id} className="slider-label">小点阵层数 <output>{n}</output><input id={id} type="range" min="2" max="8" step="1" value={n} onChange={e=>onChange({...state,rows:Number(e.target.value)})}/></label>}
    <div className="scene-values"><span>小点阵全部<strong>{preview.upperCount}点</strong></span><span>新增两行<strong>{n-1}+{n}={preview.added}</strong></span></div>
    <div className="original-rows"><span className="small">回到原题 · 前{parsed.lower}行共{original.lowerCount}点略去，没有画出</span>{original.addedRows.map(row=><div key={row}><span>第{row}行</span><strong>{row}个点</strong></div>)}<p><ArrowRight/>新增 {original.addedRows.join('+')} = <b>{original.added}</b> 点</p></div>
    <p className="scene-reason">原题与小点阵共用同一个计数函数。点数是离散数量，不是三角形面积。</p>{!readOnly&&<button className="button" onClick={()=>onSave(text,{...state,rows:n,originalLower:parsed.lower,originalUpper:parsed.upper,...original})}><Bookmark/>保存观察摘要</button>}
  </div>;
}
