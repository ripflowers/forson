import type {SceneSpec,TeachingPackage,LearningEvent,Session,AskResponse} from './types';
export function distanceState(left:number,right:number,x:number){
  const lo=Math.min(left,right),hi=Math.max(left,right),minimum=hi-lo;
  const first=Math.abs(x-left),second=Math.abs(x-right),excess=Math.max(lo-x,x-hi,0);
  return{first,second,sum:first+second,minimum,excess,lo,hi,inMinimumInterval:x>=lo&&x<=hi};
}
export function triangleState(lower:number,upper:number){
  const lowerCount=lower*(lower+1)/2,upperCount=upper*(upper+1)/2;
  return{lowerCount,upperCount,added:upperCount-lowerCount,addedRows:Array.from({length:upper-lower},(_,i)=>lower+i+1)};
}
export type NumberScene={kind:'number-line';left:number;right:number;targetSum?:number;targetMinimum?:number;parameterValue?:number};
export type TriangleScene={kind:'triangle-count';lower:number;upper:number;previewRows:number};
export function parseScene(spec:SceneSpec|null):NumberScene|TriangleScene|null{
  if(!spec)return null;
  const p=spec.params,finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1000;
  if(spec.kind==='number-line'&&finite(p.left)&&finite(p.right)){
    if(p.left===p.right&&p.parameterName!=='a')return null;
    return{kind:'number-line',left:p.left,right:p.right,...(finite(p.targetSum)?{targetSum:p.targetSum}:{}),...(finite(p.targetMinimum)?{targetMinimum:p.targetMinimum}:{}),...(p.parameterName==='a'&&finite(p.parameterValue)?{parameterValue:p.parameterValue}:{})};
  }
  if(spec.kind==='triangle-count'&&finite(p.lower)&&finite(p.upper)&&Number.isInteger(p.lower)&&Number.isInteger(p.upper)&&p.lower>=0&&p.upper>p.lower&&p.upper<=100&&p.upper-p.lower<=10){
    return{kind:'triangle-count',lower:p.lower,upper:p.upper,previewRows:finite(p.previewRows)?Math.max(2,Math.min(8,Math.round(p.previewRows))):6};
  }
  return null;
}
export function evidenceLabel(event:Pick<LearningEvent,'authorKind'|'kind'>){
  if(event.authorKind==='learner')return '我的原话';
  if(event.authorKind==='system-observation')return '系统观察';
  return({'lesson-part-viewed':'读过本小问主线','question-finished':'读过全题主线','help-used':'使用过补讲','answer-exposed':'看过答案'} as Record<string,string>)[event.kind]??'学习经历';
}
export function eventToast(kind:string,authorKind:LearningEvent['authorKind']){
  if(kind==='help-used')return'已保存这次追问与提问现场。';
  if(kind==='lesson-part-viewed')return'已记录读过本小问主线；这不代表已经掌握。';
  if(authorKind==='learner')return'已保存你的原话。';
  if(kind==='observation')return'已保存系统观察摘要。';
  return'已保存本次学习经历。';
}
export function validLesson(lesson:TeachingPackage|null,revision:number,partIds:string[]){
  if(!lesson||lesson.status!=='ready'||lesson.questionRevision!==revision)return false;
  if(!['inputConfirmed','coverage','answerVerified','reasoningReviewed'].every(key=>lesson.checks[key as keyof typeof lesson.checks]===true))return false;
  return partIds.length>0&&partIds.every(id=>lesson.coveredPartIds.includes(id)&&lesson.parts.some(p=>p.partId===id&&p.goal.trim()&&p.known.length&&p.prerequisites.length&&p.method.trim()&&p.steps.length&&p.steps.every(s=>s.title.trim()&&s.explanation.trim()&&s.reason.trim())&&p.answer.display.trim()&&p.verification.trim()&&p.misconceptions.length&&p.summary.trim()));
}
export const fmt=(value:number)=>Number.isInteger(value)?String(value):String(Number(value.toFixed(2)));
export function sceneSnapshot(spec:SceneSpec|null,state:Record<string,unknown>){
  const parsed=parseScene(spec);if(!parsed)return {...state};
  if(parsed.kind==='triangle-count')return{...state,rows:typeof state.rows==='number'?Math.max(2,Math.min(8,Math.round(state.rows))):parsed.previewRows};
  const a=typeof state.a==='number'&&Number.isFinite(state.a)?state.a:parsed.parameterValue;
  const left=a===undefined?parsed.left:-a,right=a===undefined?parsed.right:3;
  const lo=Math.min(left,right),hi=Math.max(left,right),width=Math.max(4,hi-lo),min=Math.floor(lo-width/2),max=Math.ceil(hi+width/2);
  const x=typeof state.x==='number'&&state.x>=min&&state.x<=max?state.x:(left+right)/2;
  return{...state,x,...(a===undefined?{}:{a}),left,right};
}
export function restoreSession(remote:Session|null,draft:{session:Session;dirty:boolean}|null,fresh:Session){
  const sameVersion=(s:Session)=>s.questionId===fresh.questionId&&s.questionRevision===fresh.questionRevision&&s.lessonVersion===fresh.lessonVersion;
  const valid=remote&&sameVersion(remote),base=valid?remote:fresh;
  if(draft?.dirty&&sameVersion(draft.session))return{session:draft.session,dirty:true,conflict:draft.session.sessionRevision!==base.sessionRevision,stale:Boolean(remote&&!valid)};
  return{session:base,dirty:false,conflict:false,stale:Boolean(remote&&!valid)};
}
export function isCurrentReply(reply:AskResponse,session:Session,currentScene:Record<string,unknown>){
  return reply.questionId===session.questionId&&reply.questionRevision===session.questionRevision&&reply.lessonVersion===session.lessonVersion&&reply.partId===session.partId&&reply.mode===session.mode&&reply.snapshot?.stepIndex===session.stepIndex&&['x','a','rows','left','right','paperResource'].every(key=>reply.snapshot?.[key]===currentScene[key])&&JSON.stringify(Object.entries((reply.snapshot?.paperInputs??{}) as Record<string,unknown>).sort())===JSON.stringify(Object.entries((currentScene.paperInputs??{}) as Record<string,unknown>).sort());
}
export function normalizePartLabel(label:string):string|null{
  const value=label.replace(/\s/g,'').replace(/（/g,'(').replace(/）/g,')');
  if(['本题','main','无小问'].includes(value))return'main';
  const match=value.match(/^\((\d+)\)(?:([①②③④⑤⑥⑦⑧⑨⑩])|\((\d+)\))?$/);
  if(match){const sub=match[2]?'①②③④⑤⑥⑦⑧⑨⑩'.indexOf(match[2])+1:match[3]?Number(match[3]):null;return sub?`${Number(match[1])}.${sub}`:String(Number(match[1]));}
  if(/^\d+(?:\.\d+)?$/.test(value))return value.split('.').map(Number).join('.');
  return null;
}
