import {stageDuration} from '../lesson-playback';
import type {LessonPart} from '../types';
import {teachingVisualFrame} from '../components/TeachingVisual';

export const LESSON_FPS=30;
export const LESSON_WIDTH=1280;
export const LESSON_HEIGHT=720;
export type LessonStage={index:number;from:number;durationInFrames:number;label:string};
export type LessonTimeline={stages:LessonStage[];durationInFrames:number};
export type LessonTime={frame:number;stageIndex:number;localFrame:number;progress:number;totalProgress:number;durationInFrames:number;snapshot:Record<string,unknown>;ended:boolean};

export function lessonStageLabel(part:LessonPart,index:number){
  if(index===0)return'读懂条件与知识点';
  if(index===1)return'建立解题方法';
  return part.steps[index-2]?.title??'检验与方法收束';
}

export function lessonTimeline(part:LessonPart|null,fps=LESSON_FPS,pace=1):LessonTimeline{
  if(!part)return{stages:[],durationInFrames:Math.round(fps*6)};
  let from=0;
  const stages=Array.from({length:part.steps.length+3},(_,index)=>{
    const durationInFrames=Math.max(1,Math.round(stageDuration(part,index)*fps/pace));
    const stage={index,from,durationInFrames,label:lessonStageLabel(part,index)};
    from+=durationInFrames;return stage;
  });
  return{stages,durationInFrames:from};
}

export function lessonFrameState(part:LessonPart|null,frame:number,fps=LESSON_FPS,pace=1,reducedMotion=false):LessonTime{
  const timeline=lessonTimeline(part,fps,pace);
  const boundedFrame=Math.min(timeline.durationInFrames-1,Math.max(0,Math.floor(frame)));
  const stage=timeline.stages.find(item=>boundedFrame<item.from+item.durationInFrames);
  const stageIndex=stage?.index??0,localFrame=boundedFrame-(stage?.from??0);
  const snapshot=part?teachingVisualFrame(part,stageIndex,localFrame,fps,pace,reducedMotion):{};
  return{
    frame:boundedFrame,stageIndex,localFrame,
    progress:stage?localFrame/Math.max(1,stage.durationInFrames-1):0,
    totalProgress:boundedFrame/Math.max(1,timeline.durationInFrames-1),
    durationInFrames:timeline.durationInFrames,
    snapshot:{...snapshot,frame:boundedFrame,localFrame,fps,pace,stepIndex:stageIndex},
    ended:boundedFrame===timeline.durationInFrames-1,
  };
}

export type NarrationCard={label:string;text:string};
export function narrationCards(part:LessonPart,index:number):NarrationCard[]{
  if(index===0)return[
    {label:'这节课要弄懂',text:part.goal},
    ...part.known.map(text=>({label:'原题给出的条件',text})),
    ...part.prerequisites.map(text=>({label:'会用到的知识点',text})),
  ];
  if(index===1)return[{label:'为什么选这个方法',text:part.method}];
  const step=part.steps[index-2];
  if(step)return[{label:'老师讲解',text:step.explanation},{label:'这一步为什么成立',text:step.reason}];
  return[
    {label:'结论',text:part.answer.display},
    {label:'独立检验',text:part.verification},
    ...part.misconceptions.flatMap(item=>[{label:'容易混淆',text:item.mistake},{label:'正确的理解',text:item.correction}]),
    {label:'把方法带走',text:part.summary},
  ];
}
