import {useState} from 'react';
import {Bookmark,RotateCcw} from 'lucide-react';
import {MathText} from '../components/MathText';
import {PaperBoard} from './PaperVisual';
import {paperFrame,paperInputs,paperSnapshot,type Recipe} from './models';

export function PaperExploration({recipe,state,onChange,onSave}:{recipe:Recipe;state:Record<string,unknown>;onChange:(value:Record<string,unknown>)=>void;onSave:(text:string,snapshot:Record<string,unknown>)=>Promise<void>}){
  const input=paperInputs(recipe,state),[answer,setAnswer]=useState<number|null>(null),[checked,setChecked]=useState(false),[saving,setSaving]=useState(false),[saved,setSaved]=useState(false);
  const stage=recipe.stageCount-1;
  const change=(key:string,value:number)=>{onChange({...input,[key]:value});setSaved(false);};
  const save=async()=>{setSaving(true);try{const frame=paperFrame(recipe,input,stage);await onSave(`第${recipe.number}题 ${recipe.partId}：${recipe.title}。${frame.values.map(item=>`${item.label}：${item.value}`).join('；')}。${checked?`判断选择“${recipe.choices[answer!]}”，${answer===recipe.correct?'本次判断符合推理':'本次判断尚需修正'}。`:''}这是一次探索观察，不代表独立掌握。`,{...paperSnapshot(recipe,input,stage),...(checked?{predictionAttempt:{answer,correct:answer===recipe.correct}}:{})});setSaved(true);}finally{setSaving(false);}};
  return <section className="paper-exploration" aria-label="本小问的专属探索">
    <div className="exploration-task"><span className="eyebrow">动手发现</span><h3><MathText text={recipe.task}/></h3><p><MathText text={recipe.action}/></p></div>
    <PaperBoard recipe={recipe} input={input} stage={stage} explore/>
    <div className="paper-controls">{recipe.controls.map(c=><div key={c.key}>{c.options?<fieldset><legend><MathText text={c.label}/></legend><div className="paper-picks">{c.options.map((label,i)=><button key={label} aria-pressed={input[c.key]===i} onClick={()=>change(c.key,i)}><MathText text={label}/></button>)}</div></fieldset>:<label><MathText text={c.label}/><output>{input[c.key]}</output><input type="range" min={c.min} max={c.max} step={c.step} value={input[c.key]} aria-label={c.label} onChange={e=>change(c.key,Number(e.target.value))}/></label>}</div>)}</div>
    <button className="button text" onClick={()=>{onChange(paperInputs(recipe));setSaved(false);}}><RotateCcw/>恢复示例条件</button>
    <fieldset className="paper-check"><legend>看完变化，再说说你的判断</legend>{recipe.choices.map((choice,i)=><button className={answer===i?'selected':''} aria-pressed={answer===i} key={choice} onClick={()=>{setAnswer(i);setChecked(false);setSaved(false);}}><span>{String.fromCharCode(65+i)}</span><span className="paper-choice-copy"><MathText text={choice}/></span></button>)}<button className="button primary" disabled={answer===null} onClick={()=>setChecked(true)}>检查我的判断</button></fieldset>
    {checked&&<p role="status" className={`prediction-feedback ${answer===recipe.correct?'correct':'retry'}`}><MathText text={recipe.feedback[answer!]}/></p>}
    <div className="exploration-save"><button className="button" disabled={saving} onClick={()=>void save().catch(()=>{})}><Bookmark/>{saving?'正在保存…':saved?'已保存这次观察':'保存这次观察'}</button><span>记录参数、图像关系和本次判断。</span></div>
  </section>;
}
