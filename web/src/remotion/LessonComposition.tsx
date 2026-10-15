import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {AbsoluteFill,Html5Audio,Sequence,continueRender,delayRender,interpolate,staticFile,useCurrentFrame,useVideoConfig} from 'remotion';
import type {LessonPart} from '../types';
import type {Narration} from '../narration';
import {revealedMotionStepCount,type MotionPack,type MotionView} from '../motion-resources';
import {TeachingVisual} from '../components/TeachingVisual';
import {Formula} from '../components/Formula';
import {MathText} from '../components/MathText';
import {parseScene} from '../domain';
import {lessonFrameState,lessonStageLabel,narrationCards,timedNarrationClips} from './timeline';
import 'katex/dist/katex.min.css';
import '@fontsource-variable/noto-sans-sc';
import './lesson-composition.css';

export type LessonCompositionProps={part:LessonPart|null;pace?:number;reducedMotion?:boolean;canvasOnly?:boolean;narration?:Narration|null;muted?:boolean;onAudioError?:(error:Error)=>void;onCanvasHeight?:(height:number)=>void;motionPack?:MotionPack|null;motionView?:MotionView};

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

function FormulaLedger({steps}:{steps:LessonPart['steps']}){
  return <section className="lc-formula-ledger" aria-label="已经形成的关键公式">{steps.slice(-2).map((item,i)=><div key={item.id}><span>{Math.max(0,steps.length-2)+i+1}</span><VideoFormula latex={item.formulaLatex}/></div>)}</section>;
}

export function LessonComposition({part,pace=1,reducedMotion=false,canvasOnly=false,narration=null,muted=false,onAudioError,onCanvasHeight,motionPack=null,motionView='space'}:LessonCompositionProps){
  const frame=useCurrentFrame(),{fps}=useVideoConfig();
  const canvas=useRef<HTMLDivElement>(null);
  useLessonFonts(part);
  // The interactive page follows its content height. Exported video stays at its fixed size.
  useLayoutEffect(()=>{
    const element=canvas.current;if(!canvasOnly||!onCanvasHeight||!element)return;
    let measuredHeight=0;
    const measure=()=>{
      if(element.getBoundingClientRect().width===0)return;
      const style=getComputedStyle(element);
      let height=parseFloat(style.paddingTop)+parseFloat(style.paddingBottom);
      for(const child of element.children){
        if(!(child instanceof HTMLElement))continue;
        const childStyle=getComputedStyle(child);
        if(childStyle.position==='absolute'||childStyle.display==='none')continue;
        height+=child.offsetHeight+(parseFloat(childStyle.marginTop)||0)+(parseFloat(childStyle.marginBottom)||0);
      }
      const next=Math.ceil(height);
      if(next!==measuredHeight){measuredHeight=next;onCanvasHeight(next);}
    };
    const observer=new ResizeObserver(measure);
    observer.observe(element);
    for(const child of element.children){const style=getComputedStyle(child);if(style.position!=='absolute'&&style.display!=='none')observer.observe(child);}
    measure();return()=>observer.disconnect();
  },[canvasOnly,onCanvasHeight,part]);
  if(!part)return <AbsoluteFill className="lesson-composition lc-empty"><span>知间 · 老师课堂</span><h1>等待经过校对的真实教案</h1><p>选择已生成的小问后，条件、板书与讲解会沿同一条时间线展开。</p></AbsoluteFill>;
  const voice=narration?.partId===part.partId?narration:null;
  const time=lessonFrameState(part,frame,fps,pace,reducedMotion,voice),index=time.stageIndex;
  const pages=narrationCards(part,index).flatMap(card=>chunkNarration(card.text,canvasOnly?170:voice?55:80).map(text=>({...card,text})));
  const weights=pages.map(card=>Math.max(35,card.text.length)),totalWeight=weights.reduce((sum,weight)=>sum+weight,0);
  let pageIndex=0,accumulated=weights[0];
  while(pageIndex<pages.length-1&&time.progress*totalWeight>=accumulated){pageIndex++;accumulated+=weights[pageIndex];}
  const page=pages[pageIndex];
  const hasVisual=Boolean(parseScene(part.scene)),shownFormulas=part.steps.slice(0,motionPack?.stages.some(stage=>stage.template==='triangle-grow')?revealedMotionStepCount(index,time.visualFrame,fps,reducedMotion):Math.max(0,index-1)).filter(item=>item.formulaLatex);
  return <AbsoluteFill ref={canvas} className={`lesson-composition ${canvasOnly?'lc-canvas-only':'lc-video'} ${voice?'lc-voiced':''}`}>
    {voice&&timedNarrationClips(voice,fps,pace).map(({clip,from,durationInFrames})=><Sequence key={clip.id} name={`老师口述 · ${clip.id}`} from={from} durationInFrames={durationInFrames} premountFor={fps} style={{pointerEvents:'none'}}><Html5Audio src={clip.audioPath?staticFile(clip.audioPath):clip.audioUrl} data-narration-clip={clip.id} playbackRate={pace} preservePitch muted={muted} pauseWhenBuffering acceptableTimeShiftInSeconds={.12} onError={onAudioError}/></Sequence>)}
    {!canvasOnly&&<><header className="lc-header"><div><span className="lc-brand">知间 · 老师课堂</span><h1><MathText text={lessonStageLabel(part,index)}/></h1></div><span className="lc-stage-number">{index+1} / {part.steps.length+3}</span></header>
    <div className="lc-knowledge" aria-label="本课会用到的知识点">{part.prerequisites.slice(0,3).map((concept,i)=><span key={i}><MathText text={concept}/></span>)}</div></>}
    <main className="lc-main">
      <section className="lc-board" style={{opacity:reducedMotion?1:interpolate(time.localFrame,[0,Math.max(1,fps*.25/pace)],[.88,1],{extrapolateRight:'clamp',extrapolateLeft:'clamp'})}}>
        {hasVisual?<TeachingVisual part={part} stepIndex={index} localFrame={time.visualFrame} fps={fps} pace={voice?1:pace} reducedMotion={reducedMotion} motionPack={motionPack} motionView={motionView}/>:<GenericBoard part={part} index={index}/>}
      </section>
      {!canvasOnly&&<aside className="lc-narrator" aria-label="此刻的老师讲解"><span className="lc-narrator-label">{page.label}</span><div className="lc-narration-text"><MathText text={page.text}/></div>{voice&&hasVisual&&shownFormulas.length>0&&<FormulaLedger steps={shownFormulas}/>}<span className="lc-page-number">{pages.length>1?`讲解 ${pageIndex+1} / ${pages.length}`:'条件 → 方法 → 推理 → 检验'}</span><div className="lc-narration-progress"><span style={{width:`${time.progress*100}%`}}/></div></aside>}
    </main>
    {!canvasOnly&&!voice&&hasVisual&&shownFormulas.length>0&&<FormulaLedger steps={shownFormulas}/>}
    {voice&&<div className={`lc-spoken-caption ${time.speaking?'speaking':'observing'}`} aria-label="同步口述字幕" data-narration-id={voice.id} data-clip-id={time.clipId??''} data-speaking={time.speaking}><span>{time.speaking?(muted?'老师口述 · 已静音':'老师口述 · 与板书同步'):'观察板书 · 稍作停留'}</span><p>{time.spokenText??'可以把这一步的图像和算式对照起来。'}</p></div>}
    {canvasOnly&&!voice&&<div className="lc-spoken-caption lc-reading-caption" aria-label="随板书推进的老师讲解"><span>{page.label}</span><p><MathText text={page.text}/></p></div>}
    {!canvasOnly&&<footer className="lc-footer"><span>每一步有理由，每个结论可检验</span><span>{Math.floor(frame/fps)} 秒 / {Math.ceil(time.durationInFrames/fps)} 秒</span></footer>}
  </AbsoluteFill>;
}
