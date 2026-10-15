import type {LessonPart,Session} from './types';
export const canPlayLesson=(active:boolean,paused:boolean,mode:Session['mode'],visible:boolean,saveState:string)=>active&&!paused&&mode==='teacher'&&visible&&saveState!=='conflict';
export const nextStage=(index:number,count:number)=>index<count-1?index+1:null;
export function stageText(part:LessonPart,index:number){
  if(index===0)return[part.goal,...part.known,...part.prerequisites].join(' ');
  if(index===1)return part.method;
  const step=part.steps[index-2];
  if(step)return[step.title,step.explanation,step.reason].join(' ');
  return[part.answer.display,part.verification,...part.misconceptions.flatMap(m=>[m.mistake,m.correction]),part.summary].join(' ');
}
export function stageDuration(part:LessonPart,index:number){return Math.max(index===0?16:18,Math.min(70,Math.ceil(stageText(part,index).length/5)+5));}
export function teachingSnapshot(frame:Record<string,unknown>,stepIndex:number,sceneState:Record<string,unknown>):Record<string,unknown>{return {...frame,stepIndex,sceneState};}

export type QuestionInterruption={identity:string;wasPlaying:boolean;frame:number};
export function canResumeAfterAnswer(intent:QuestionInterruption|null,identity:string,checked:boolean,active:boolean,visible:boolean,mode:Session['mode'],saveState:string){
  return Boolean(intent?.wasPlaying&&intent.identity===identity&&checked&&canPlayLesson(active,false,mode,visible,saveState));
}
