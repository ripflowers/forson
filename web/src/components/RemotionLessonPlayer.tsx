import {forwardRef,useCallback,useEffect,useImperativeHandle,useMemo,useRef,useState,type SyntheticEvent} from 'react';
import {Player,type PlayerRef,type CallbackListener} from '@remotion/player';
import type {LessonPart} from '../types';
import type {Narration} from '../narration';
import type {MotionPack,MotionView} from '../motion-resources';
import {LessonComposition} from '../remotion/LessonComposition';
import {LESSON_FPS,lessonFrameState,lessonTimeline,type LessonTime} from '../remotion/timeline';
import './remotion-lesson-player.css';

export type RemotionLessonPlayerHandle={seekStage:(index:number)=>void;seekFrame:(frame:number)=>void;restart:()=>void;play:(event?:SyntheticEvent)=>void;pause:()=>void;pauseAndSnapshot:()=>Record<string,unknown>;getFrame:()=>number};
export type RemotionLessonPlayerProps={part:LessonPart|null;stageIndex:number;playing:boolean;speed:number;reducedMotion:boolean;onTime:(time:LessonTime)=>void;narration?:Narration|null;muted?:boolean;onAudioError?:(error:Error)=>void;onPlaybackError?:(error:Error)=>void;motionPack?:MotionPack|null;motionView?:MotionView};

export const RemotionLessonPlayer=forwardRef<RemotionLessonPlayerHandle,RemotionLessonPlayerProps>(function RemotionLessonPlayer({part,stageIndex,playing,speed,reducedMotion,onTime,narration=null,muted=false,onAudioError,onPlaybackError,motionPack=null,motionView='space'},ref){
  const player=useRef<PlayerRef>(null),surface=useRef<HTMLDivElement>(null),callback=useRef(onTime);
  const audioFailure=useRef(onAudioError),playbackFailure=useRef(onPlaybackError);
  callback.current=onTime;
  audioFailure.current=onAudioError;playbackFailure.current=onPlaybackError;
  const audioError=useCallback((error:Error)=>audioFailure.current?.(error),[]);
  const [width,setWidth]=useState(800),[contentHeight,setContentHeight]=useState(0);
  const timeline=useMemo(()=>lessonTimeline(part,LESSON_FPS,1,narration),[part,narration]);
  const playerKey=useMemo(()=>`${JSON.stringify(part)}:${narration?.id??''}`,[part,narration?.id]);
  const inputProps=useMemo(()=>({part,pace:1,reducedMotion,canvasOnly:true,narration,muted,onAudioError:audioError,onCanvasHeight:setContentHeight,motionPack,motionView}),[part,reducedMotion,narration,muted,audioError,motionPack,motionView]);
  const height=Math.max(380,contentHeight);
  const report=useCallback((frame:number)=>{
    const time=lessonFrameState(part,frame,LESSON_FPS,1,reducedMotion,narration,motionPack);
    callback.current(time);return time;
  },[part,reducedMotion,narration,motionPack]);
  const seekFrame=useCallback((frame:number)=>{
    const bounded=Math.max(0,Math.min(timeline.durationInFrames-1,Math.round(frame)));
    player.current?.seekTo(bounded);report(bounded);
  },[timeline.durationInFrames,report]);
  const seekStage=useCallback((index:number)=>{
    const stage=timeline.stages[Math.min(timeline.stages.length-1,Math.max(0,Math.floor(index)))];
    seekFrame(stage?.from??0);
  },[timeline,seekFrame]);

  useImperativeHandle(ref,()=>({
    seekStage,seekFrame,
    restart:()=>seekFrame(0),
    play:event=>player.current?.play(event),
    pause:()=>player.current?.pause(),
    pauseAndSnapshot:()=>{player.current?.pause();return report(player.current?.getCurrentFrame()??0).snapshot;},
    getFrame:()=>player.current?.getCurrentFrame()??0,
  }),[seekStage,seekFrame,report]);

  useEffect(()=>{
    if(!surface.current)return;
    const observer=new ResizeObserver(entries=>{const measured=entries[0].contentRect.width;if(measured<=0)return;const next=Math.max(240,Math.round(measured));setWidth(current=>current===next?current:next);});
    observer.observe(surface.current);return()=>observer.disconnect();
  },[]);

  useEffect(()=>{
    const current=player.current;if(!current)return;
    const update:CallbackListener<'frameupdate'>=event=>{report(event.detail.frame);};
    const ended:CallbackListener<'ended'>=()=>{report(timeline.durationInFrames-1);};
    const error:CallbackListener<'error'>=event=>playbackFailure.current?.(event.detail.error);
    current.addEventListener('frameupdate',update);current.addEventListener('ended',ended);current.addEventListener('error',error);
    report(current.getCurrentFrame());
    return()=>{current.removeEventListener('frameupdate',update);current.removeEventListener('ended',ended);current.removeEventListener('error',error);};
  },[part,report,timeline.durationInFrames,playerKey]);

  // A frame update also updates the parent's chapter. Only an external chapter change seeks.
  useEffect(()=>{
    const frame=player.current?.getCurrentFrame()??0;
    if(lessonFrameState(part,frame,LESSON_FPS,1,reducedMotion,narration).stageIndex!==stageIndex)seekStage(stageIndex);
  },[stageIndex,part,reducedMotion,narration,seekStage]);

  useEffect(()=>{if(playing&&part)player.current?.play();else player.current?.pause();},[playing,part,playerKey]);

  return <div ref={surface} className="remotion-lesson-surface" aria-label="连续演进的解题板书">
    <Player key={playerKey} ref={player} component={LessonComposition} inputProps={inputProps} durationInFrames={timeline.durationInFrames} fps={LESSON_FPS} compositionWidth={width} compositionHeight={height} initialFrame={timeline.stages[stageIndex]?.from??0} playbackRate={speed} controls={false} autoPlay={false} loop={false} moveToBeginningWhenEnded={false} clickToPlay={false} doubleClickToFullscreen={false} spaceKeyToPlayOrPause={false} style={{width:'100%'}} errorFallback={()=> <div className="remotion-lesson-error">课堂画面暂时无法播放，请刷新页面后重试。</div>}/>
  </div>;
});
