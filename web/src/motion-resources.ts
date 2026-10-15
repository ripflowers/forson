import type {LessonPart,Question} from './types';

export type MotionView='space'|'flat';
export type MotionTemplate='triangle-grow'|'triangle-compare'|'triangle-sum'|'triangle-expand'|'triangle-cancel'|'triangle-verify'|'triangle-recap'|'distance-model';
export type MotionTarget={questionId:string;questionRevision:number;lessonVersion:number;partId:string;lessonHash:string};
export type MotionPack={
  id:string;
  schemaVersion:1;
  title:string;
  subject:'math';
  author:'Codex';
  target:MotionTarget;
  concepts:{id:string;label:string;explanation:string}[];
  stages:{stageIndex:number;template:MotionTemplate;title:string;conceptIds:string[];focus:string;explanation:string}[];
  createdAt:string;
  packHash:string;
};
export type MotionPackInput=Omit<MotionPack,'id'|'createdAt'|'packHash'>;
export type TeachingContext={
  question:Pick<Question,'id'|'revision'|'number'|'stem'|'options'|'figureDescription'|'parts'>;
  part:LessonPart;
  target:MotionTarget;
  templateConstraints:{stageCount:number;templates:{stageIndex:number;template:MotionTemplate}[]};
  validation:{kind:'local-structure';teacherReviewed:false};
};
export function currentMotionPack(pack:MotionPack|null,questionId:string,revision:number,lessonVersion:number|undefined,partId:string|undefined){
  return pack?.target.questionId===questionId&&pack.target.questionRevision===revision&&pack.target.lessonVersion===lessonVersion&&pack.target.partId===partId?pack:null;
}

// Formula ledgers retain completed work; the current result appears after its visual derivation.
export function revealedMotionStepCount(stageIndex:number,visualFrame:number,fps:number,reducedMotion=false){
  if(stageIndex<2)return 0;
  if(stageIndex>=6)return 4;
  const revealAt=[1.2,2.8,2.8,1.8][stageIndex-2];
  return stageIndex-2+(reducedMotion||visualFrame/fps>=revealAt?1:0);
}
