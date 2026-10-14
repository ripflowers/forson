import {useEffect,useState} from 'react';
import {AbsoluteFill,continueRender,delayRender,interpolate,useCurrentFrame,useVideoConfig} from 'remotion';
import type {LessonPart} from '../types';
import {TeachingVisual} from '../components/TeachingVisual';
import {Formula} from '../components/Formula';
import {MathText} from '../components/MathText';
import {parseScene} from '../domain';
import {lessonFrameState,lessonStageLabel,narrationCards} from './timeline';
import 'katex/dist/katex.min.css';
import '@fontsource-variable/noto-sans-sc';
import './lesson-composition.css';

export type LessonCompositionProps={part:LessonPart|null;pace?:number;reducedMotion?:boolean;canvasOnly?:boolean};

// Split only outside formula delimiters, preserving every character of the source.
export function chunkNarration(text:string,limit=170){
  const chunks:string[]=[];let start=0,close='';
  for(let i=0;i<text.length;i++){
    const escaped=i>0&&text[i-1]==='\\';
    if(close){if(text.startsWith(close,i)&&!escaped){i+=close.length-1;close='';}continue;}
    if(!escaped&&text.startsWith('$$',i)){close='$$';i++;continue;}
    if(!escaped&&text[i]==='$'){close='$';continue;}
    if(text.startsWith('\\(',i)){close='\\)';i++;continue;}
    if(text.startsWith('\\[',i)){close='\\]';i++;continue;}
    const length=i-start+1;
    if(length>=limit&&(length>=limit+40||/[。；！？\n]/.test(text[i]))){chunks.push(text.slice(start,i+1));start=i+1;}
  }
  if(start<text.length)chunks.push(text.slice(start));
  return chunks.length?chunks:[''];
}

function useLessonFonts(part:LessonPart|null){
  const [handle]=useState(()=>delayRender('等待课堂本地字体'));
  useEffect(()=>{
    const text=part?JSON.stringify(part):'知间 老师课堂 等待教案';
    Promise.all([
      document.fonts.load('400 20px "Noto Sans SC Variable"',text),
      document.fonts.load('600 20px "Noto Sans SC Variable"',text),
      document.fonts.ready,
    ]).then(()=>continueRender(handle)).catch(()=>continueRender(handle));
    return()=>continueRender(handle);
  },[handle,part]);
}

function GenericBoard({part,index}:{part:LessonPart;index:number}){
  const step=part.steps[index-2],shown=part.steps.slice(0,Math.max(0,index-1));
  return <div className="lc-generic-board">
    {index===0?<><div className="lc-board-focus"><span>先读懂任务</span><p><MathText text={part.goal}/></p></div><div className="lc-conditions">{part.known.map((condition,i)=><div key={i}><b>条件 {i+1}</b><p><MathText text={condition}/></p></div>)}</div></>
    :<><div className="lc-board-focus"><span>{index===1?'选方法':'当前推理'}</span><p><MathText text={index===1?part.method:step?.title??part.summary}/></p></div><div className={`lc-proof ${shown.length>5?'dense':''}`} aria-label="累积推理板书">{shown.map((item,i)=><div className={`lc-proof-row ${item===step?'active':''}`} key={item.id}><span>{i+1}</span><div><b><MathText text={item.title}/></b>{item.formulaLatex?<Formula latex={item.formulaLatex}/>:<MathText text={item.reason}/>}</div></div>)}</div>{index===part.steps.length+2&&<div className="lc-conclusion"><span>结论与检验</span><strong><MathText text={part.answer.display}/></strong></div>}</>}
  </div>;
}

function VideoFormula({latex}:{latex:string}){
  return <div className="lc-video-formula">{latex.split(/,\s*\\quad\s*/).map((line,index)=><Formula key={index} latex={line}/>)}</div>;
}

export function LessonComposition({part,pace=1,reducedMotion=false,canvasOnly=false}:LessonCompositionProps){
  const frame=useCurrentFrame(),{fps}=useVideoConfig();
  useLessonFonts(part);
  if(!part)return <AbsoluteFill className="lesson-composition lc-empty"><span>知间 · 老师课堂</span><h1>等待经过校对的真实教案</h1><p>选择已生成的小问后，条件、板书与讲解会沿同一条时间线展开。</p></AbsoluteFill>;
  const time=lessonFrameState(part,frame,fps,pace,reducedMotion),index=time.stageIndex;
  const pages=narrationCards(part,index).flatMap(card=>chunkNarration(card.text,canvasOnly?170:80).map(text=>({...card,text})));
  const weights=pages.map(card=>Math.max(35,card.text.length)),totalWeight=weights.reduce((sum,weight)=>sum+weight,0);
  let pageIndex=0,accumulated=weights[0];
  while(pageIndex<pages.length-1&&time.progress*totalWeight>=accumulated){pageIndex++;accumulated+=weights[pageIndex];}
  const page=pages[pageIndex];
  const hasVisual=Boolean(parseScene(part.scene)),shownFormulas=part.steps.slice(0,Math.max(0,index-1)).filter(item=>item.formulaLatex);
  return <AbsoluteFill className={`lesson-composition ${canvasOnly?'lc-canvas-only':'lc-video'}`}>
    <header className="lc-header"><div><span className="lc-brand">知间 · 老师课堂</span><h1><MathText text={lessonStageLabel(part,index)}/></h1></div><span className="lc-stage-number">{index+1} / {part.steps.length+3}</span></header>
    <div className="lc-knowledge" aria-label="本课会用到的知识点">{part.prerequisites.slice(0,3).map((concept,i)=><span key={i}><MathText text={concept}/></span>)}</div>
    <main className="lc-main">
      <section className="lc-board" style={{opacity:reducedMotion?1:interpolate(time.localFrame,[0,Math.max(1,fps*.25/pace)],[.88,1],{extrapolateRight:'clamp',extrapolateLeft:'clamp'})}}>
        {hasVisual?<TeachingVisual part={part} stepIndex={index} localFrame={time.localFrame} fps={fps} pace={pace} reducedMotion={reducedMotion}/>:<GenericBoard part={part} index={index}/>}
        {canvasOnly&&hasVisual&&shownFormulas.length>0&&<div className="lc-visual-proof" aria-label="已经形成的关键公式">{shownFormulas.map(item=><Formula key={item.id} latex={item.formulaLatex}/>)}</div>}
      </section>
      {!canvasOnly&&<aside className="lc-narrator" aria-label="此刻的老师讲解"><span className="lc-narrator-label">{page.label}</span><div className="lc-narration-text"><MathText text={page.text}/></div><span className="lc-page-number">{pages.length>1?`讲解 ${pageIndex+1} / ${pages.length}`:'条件 → 方法 → 推理 → 检验'}</span><div className="lc-narration-progress"><span style={{width:`${time.progress*100}%`}}/></div></aside>}
    </main>
    {!canvasOnly&&hasVisual&&shownFormulas.length>0&&<section className="lc-formula-ledger" aria-label="已经形成的关键公式">{shownFormulas.slice(-2).map((item,i)=><div key={item.id}><span>{Math.max(0,shownFormulas.length-2)+i+1}</span><VideoFormula latex={item.formulaLatex}/></div>)}</section>}
    <footer className="lc-footer"><span>每一步有理由，每个结论可检验</span><span>{Math.floor(frame/fps)} 秒 / {Math.ceil(time.durationInFrames/fps)} 秒</span></footer>
  </AbsoluteFill>;
}
