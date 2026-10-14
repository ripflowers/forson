import {useEffect,useState,useRef} from 'react';
import {ArrowLeft,ArrowRight,BookOpen,Bookmark,MessagesSquare,Pause,Play,MoveHorizontal,Send,CheckCircle2} from 'lucide-react';
import {request,post} from '../api';
import type {Question,TeachingPackage,LearningEvent,AskResponse,Job,LessonPart} from '../types';
import {validLesson,parseScene,sceneSnapshot,isCurrentReply,eventToast} from '../domain';
import {useSession} from '../useSession';
import {Formula} from './Formula';
import {MathText} from './MathText';
import {Scene} from './Scene';
type Props={question:Question;active:boolean;onJob:(job:Job)=>void;onRecords:()=>void;onError:(error:string)=>void};
export function Classroom({question,active,onJob,onRecords,onError}:Props){
  const [lesson,setLesson]=useState<TeachingPackage|null>(null),[loading,setLoading]=useState(true),[askText,setAskText]=useState(''),[reply,setReply]=useState<AskResponse|null>(null),[asking,setAsking]=useState(false),[paused,setPaused]=useState(false),[eventBusy,setEventBusy]=useState(false),[toast,setToast]=useState('');
  const [completed,setCompleted]=useState<string[]>([]),[history,setHistory]=useState<AskResponse[]>([]),eventKey=useRef(new Set<string>());
  useEffect(()=>{let active=true;setLoading(true);request<{lesson:TeachingPackage|null}>(`/questions/${question.id}/lesson`).then(data=>{if(active)setLesson(data.lesson);}).catch(e=>onError(e.message)).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[question.id,question.revision,question.lessonState]);
  const ready=validLesson(lesson,question.revision,question.parts.map(p=>p.id));
  const controller=useSession(question,ready?lesson:null),session=controller.session;
  const part=lesson?.parts.find(p=>p.partId===session?.partId)??lesson?.parts[0];
  useEffect(()=>{if(!session||!part)return;const drafts=(session.sceneState.askDrafts??{}) as Record<string,string>;setAskText(drafts[part.partId]??'');},[session?.partId]);
  useEffect(()=>{let active=true;request<{items:AskResponse[]}>(`/questions/${question.id}/asks`).then(({items})=>{if(!active)return;setHistory(items);setReply(previous=>previous??items.find(item=>item.questionRevision===question.revision&&item.lessonVersion===lesson?.lessonVersion)??null);}).catch(e=>onError(e.message));return()=>{active=false;};},[question.id,question.revision,lesson?.lessonVersion]);
  useEffect(()=>{if(!active||!ready||!session||!part)return;const visited=(session.sceneState.visitedSlides??{}) as Record<string,number[]>;const positions=visited[part.partId]??[];if(!positions.includes(session.stepIndex))controller.update({sceneState:{...session.sceneState,visitedSlides:{...visited,[part.partId]:[...positions,session.stepIndex]}}});},[active,ready,session?.partId,session?.stepIndex]);
  useEffect(()=>{request<{items:LearningEvent[]}>(`/records?paperId=${encodeURIComponent(question.paperId)}`).then(({items})=>setCompleted([...new Set(items.filter(e=>e.questionId===question.id&&e.questionRevision===question.revision&&e.lessonVersion===lesson?.lessonVersion&&e.kind==='lesson-part-viewed').map(e=>e.partId))])).catch(()=>{});},[lesson?.lessonVersion,question.id]);
  const event=async(kind:string,authorKind:LearningEvent['authorKind'],text:string,payload:Record<string,unknown>={})=>{
    if(!session||!lesson||!part)return;
    setEventBusy(true);setToast('');
    try{await post('/events',{questionId:question.id,questionRevision:question.revision,lessonVersion:lesson.lessonVersion,partId:part.partId,kind,authorKind,text,payload});setToast(eventToast(kind,authorKind));onRecords();}
    catch(e){onError((e as Error).message);throw e;}finally{setEventBusy(false);}
  };
  const ask=async(text:string)=>{
    if(!session||!lesson||!part||!text.trim()||asking)return;
    setPaused(true);setAsking(true);setAskText(text);
    const selectedScene=(session.mode==='explore'?(session.sceneState[part.partId]??{}):{}) as Record<string,unknown>;
    const snapshot={...sceneSnapshot(part.scene,selectedScene),sceneState:{...session.sceneState},stepIndex:session.stepIndex,reflection:session.reflection};
    const mode=session.mode,stepId=session.stepIndex>=2?part.steps[session.stepIndex-2]?.id??null:null;
    try{const answer=await post<AskResponse>(`/questions/${question.id}/ask`,{questionRevision:question.revision,lessonVersion:lesson.lessonVersion,partId:part.partId,stepId,mode,snapshot,text});setReply(answer);setHistory(items=>[answer,...items.filter(item=>item.id!==answer.id)]);await event('help-used','system',text,{askId:answer.id,status:answer.status,snapshot});}
    catch(e){onError((e as Error).message);}finally{setAsking(false);}
  };
  const changePart=(partId:string)=>{setPaused(true);setReply(null);controller.update({partId,stepIndex:0,mode:'teacher',returnTarget:null});};
  const changeAskText=(text:string)=>{setAskText(text);if(session&&part){const drafts=(session.sceneState.askDrafts??{}) as Record<string,string>;controller.update({sceneState:{...session.sceneState,askDrafts:{...drafts,[part.partId]:text}}});}};
  const goTeacher=()=>{const target=session?.returnTarget;controller.update({mode:'teacher',stepIndex:typeof target?.stepIndex==='number'?target.stepIndex:session?.stepIndex??0,returnTarget:null});};
  const generate=async()=>{try{const result=await post<{job:Job}>(`/questions/${question.id}/lesson`,{expectedRevision:question.revision});onJob(result.job);}catch(e){onError((e as Error).message);}};
  if(loading)return <section className="panel loading"><span className="skeleton"/><span className="skeleton"/><p>正在打开当前版本的老师课…</p></section>;
  if(!ready||!lesson)return <section className="panel lesson-empty"><div className="teacher-avatar"><BookOpen/></div><h2>{question.state!=='confirmed'?'先核对完整题面':'老师课正在准备'}</h2><p>{question.missingFields.length?`还缺：${question.missingFields.join('、')}。补全前不会猜测解法。`:question.state!=='confirmed'?'到我的试卷逐项检查题干、图注、选项与所有小问。':'正式课堂需要当前题面每个小问的完整讲解和核验。你可以为这道题准备老师课。'}</p>{lesson?.checks.issues.length?<div className="notice warm">{lesson.checks.issues.join('；')}</div>:null}<button className="button primary" disabled={question.state!=='confirmed'||question.missingFields.length>0} onClick={generate}>准备这道题的老师课</button></section>;
  if(!session||!part)return <section className="panel"><p>{controller.error||'正在恢复课堂现场…'}</p>{controller.state==='error'&&<button className="button" onClick={()=>window.location.reload()}>重新连接课堂</button>}</section>;
  const slides=lessonSlides(part),index=Math.max(0,Math.min(session.stepIndex,slides.length-1)),current=slides[index];
  const visited=((session.sceneState.visitedSlides??{}) as Record<string,number[]>)[part.partId]??[];
  const markPart=async()=>{
    if(!slides.every((_,i)=>visited.includes(i))){setToast('请先沿主线查看每个讲解片段，再记录这一个小问。');return;}
    if(eventKey.current.has(part.partId)||completed.includes(part.partId)){setToast('这份课程的本小问主线已有记录。');return;}
    eventKey.current.add(part.partId);
    try{await event('lesson-part-viewed','system',`读过第${question.number}题${part.label}的完整主线`,{viewedSlides:visited,stepCount:part.steps.length});setCompleted([...completed,part.partId]);}catch{eventKey.current.delete(part.partId);}
  };
  const modeExplore=session.mode==='explore';
  const sceneState=(session.sceneState[part.partId]??{}) as Record<string,unknown>;
  return <>
    <div className="class-top"><div><span className="eyebrow">老师课堂 · 第{question.number}题</span><h1><MathText text={part.goal}/></h1><p className="sub">先看完整思路，再自己探索。可以随时停下来问为什么。</p></div><span className="chip">{lesson.reviewLevel==='teacher_reviewed'?'教师已审核':'自动核验课程 · 自用'}</span></div>
    <div className="part-tabs" aria-label="选择小问">{lesson.parts.map(p=><button className={p.partId===part.partId?'active':''} aria-pressed={p.partId===part.partId} onClick={()=>changePart(p.partId)} key={p.partId}>{p.label||'本题'}{completed.includes(p.partId)&&<CheckCircle2/>}</button>)}</div>
    <div className="class-layout"><section className="stage"><div className="stage-bar"><span><BookOpen/>{modeExplore?'探索画布':'老师的板书'}</span><span>{index+1} / {slides.length} · {current.label}</span></div><div className="stage-content">
      <details className="question-source"><summary>题面与原题条件</summary><p><MathText text={question.stem}/></p>{question.figureDescription&&<p className="small">图：<MathText text={question.figureDescription}/></p>}<p><MathText text={question.parts.find(p=>p.id===part.partId)?.prompt}/></p>{question.options.length>0&&<ul>{question.options.map(o=><li key={o.label}>{o.label}. <MathText text={o.text}/></li>)}</ul>}</details>
      {modeExplore&&part.scene?<Scene spec={part.scene} state={sceneState} onChange={value=>controller.update({sceneState:{...session.sceneState,[part.partId]:value}})} onSave={(text,snapshot)=>void event('observation','system-observation',text,snapshot).catch(()=>{})}/>:<div className="teaching-slide"><div className="slide-label">{current.label}</div>{current.content}{index===0&&part.scene&&parseScene(part.scene)&&<div className="teacher-demo"><Scene spec={part.scene} state={{}} onChange={()=>{}} onSave={()=>{}} readOnly/></div>}</div>}
    </div><div className="teacher-controls"><div className="control-row"><button className="button" onClick={()=>setPaused(!paused)}>{paused?<Play/>:<Pause/>}{paused?'继续本步':'暂停'}</button><button className="button" disabled={index===0||modeExplore} onClick={()=>controller.update({stepIndex:index-1})}><ArrowLeft/>上一段</button>{modeExplore?<button className="button primary" onClick={goTeacher}><ArrowRight/>回老师主线</button>:index<slides.length-1?<button className="button primary" onClick={()=>{setPaused(false);controller.update({stepIndex:index+1});}}>下一段<ArrowRight/></button>:<button className="button primary" disabled={eventBusy} onClick={()=>void markPart()}>记录读过本小问<CheckCircle2/></button>}</div><p className="small">{paused?'已暂停。本课以图文示范；恢复不会自动发声。':'按自己的节奏读主线，无需先作答。'}</p></div></section>
      <aside className="teacher-side"><section className="panel askbox"><div className="teacher-label"><span className="teacher-avatar"><MessagesSquare/></span><div><h2>随时问老师</h2><p className="small">围绕当前小问与现场回答</p></div></div><div className="faq-buttons">{['这一步为什么这样做？','从基础讲一遍','换一种讲法'].map(text=><button disabled={asking} key={text} onClick={()=>void ask(text)}>{text}<ArrowRight/></button>)}</div>
        {asking&&<div className="notice" role="status">老师正在结合你提问时的现场检查解释…</div>}
        {reply&&<div className={`teacher-reply ${reply.status==='checked'?'':'review'}`}><span className="chip">{reply.questionRevision!==question.revision||reply.lessonVersion!==lesson.lessonVersion?'历史版本答疑':!isCurrentReply(reply,session,sceneSnapshot(part.scene,session.mode==='explore'?sceneState:{}))?'历史现场补讲':reply.status==='checked'?'已核对的补讲':'还需复核'}</span><p className="small">答疑对应小问：{lesson.parts.find(p=>p.partId===reply.partId)?.label??'历史小问'}<br/>提问现场：{reply.mode==='explore'?'探索':reply.mode==='exercise'?'尝试':'老师主线'} · 第{typeof reply.snapshot?.stepIndex==='number'?reply.snapshot.stepIndex+1:'—'}段{typeof reply.snapshot?.x==='number'?` · x=${reply.snapshot.x}`:''}{typeof reply.snapshot?.a==='number'?` · a=${reply.snapshot.a}`:''}{typeof reply.snapshot?.rows==='number'?` · ${reply.snapshot.rows}层小点阵`:''}<br/>你的问题：{reply.text}</p>{reply.status==='checked'?<div className="reply-text"><MathText text={reply.answer}/></div>:<p>这次答复尚未通过核验，暂不作为正式解释。可以继续已核验主线，或核对题面条件后再问。</p>}<p className="small">{reply.questionRevision!==question.revision||reply.lessonVersion!==lesson.lessonVersion?'这条答疑属于旧版题面或课程，只作为历史记录，不解释当前版本。':'回答绑定提问时的小问与参数；之后探索不会改变这条历史答复。'}</p></div>}
        {history.length>0&&<details className="ask-history"><summary>过去的追问 · {history.length}条</summary>{history.map(item=><button key={item.id} type="button" onClick={()=>setReply(item)}>{item.text}<span className="small">{item.status==='checked'?'已核对':'待复核'} · {new Date(item.createdAt).toLocaleDateString('zh-CN')}</span></button>)}</details>}
        <form onSubmit={e=>{e.preventDefault();void ask(askText);}}><label className="field">我的疑问<textarea value={askText} onFocus={()=>setPaused(true)} onChange={e=>changeAskText(e.target.value)} placeholder="这一步哪里没想明白？" maxLength={2000}/></label><button className="button primary" disabled={asking||!askText.trim()}><Send/>把疑问交给老师</button></form>
        {!modeExplore&&parseScene(part.scene)&&<button className="button explore-button" onClick={()=>{setPaused(true);controller.update({mode:'explore',returnTarget:{mode:'teacher',partId:part.partId,stepIndex:index,sceneState:{...session.sceneState},reflection:session.reflection}});}}><MoveHorizontal/>我来探索一下</button>}
      </section><section className="panel reflection"><div className="teacher-label"><span className="teacher-avatar"><Bookmark/></span><div><h2>留下你的发现</h2><p className="small">你的原话，与你自己的理解</p></div></div><label className="field">我的理解<textarea value={session.reflection} onFocus={()=>setPaused(true)} onChange={e=>controller.update({reflection:e.target.value})} placeholder="原来……是因为……" maxLength={4000}/></label><button className="button" disabled={!session.reflection.trim()||eventBusy} onClick={()=>void event('note','learner',session.reflection,{sceneState,stepIndex:index}).catch(()=>{})}>保存我的原话</button><p className="small save-state" role="status">{controller.state==='saved'?'课堂现场已保存':controller.state==='saving'?'正在保存现场…':controller.state==='conflict'?'版本有冲突，草稿已保留':'现场待同步，本机草稿已保留'}</p>{controller.error&&<p className="small">{controller.error}</p>}{controller.state==='conflict'?<div className="actions"><button className="button" onClick={()=>void controller.resolve('local')}>继续本机草稿</button><button className="button" onClick={()=>void controller.resolve('server')}>使用已保存现场</button></div>:controller.state==='unsaved'&&<button className="button text" onClick={()=>void controller.save()}>重试保存</button>}{toast&&<p className="notice" role="status">{toast}</p>}<p className="small">已读 {completed.length}/{lesson.parts.length} 个小问主线。学习经历不等于掌握。</p></section></aside>
    </div>
  </>;
}
function lessonSlides(part:LessonPart){
  return[
    {label:'读题与条件',content:<><h2><MathText text={part.goal}/></h2><div className="condition-grid"><section><h3>已经知道什么</h3><ul>{part.known.map((x,i)=><li key={i}><MathText text={x}/></li>)}</ul></section><section><h3>需要用到的基础</h3><ul>{part.prerequisites.map((x,i)=><li key={i}><MathText text={x}/></li>)}</ul></section></div></>},
    {label:'选思路',content:<><h2>为什么选这个方法？</h2><p className="teaching-text"><MathText text={part.method}/></p></>},
    ...part.steps.map((step,i)=>({label:`示范 ${i+1}`,content:<><h2><MathText text={step.title}/></h2><p className="teaching-text"><MathText text={step.explanation}/></p>{step.formulaLatex&&<div className="board-formula"><Formula latex={step.formulaLatex} display/></div>}<div className="reason-panel"><span>这一步的理由</span><p><MathText text={step.reason}/></p></div></>})),
    {label:'检验与方法收束',content:<><h2>把结论检查一遍</h2><div className="answer-box"><MathText text={part.answer.display}/></div><h3>怎样检验</h3><p className="teaching-text"><MathText text={part.verification}/></p><h3>容易混淆的地方</h3>{part.misconceptions.map((m,i)=><div className="misconception" key={i}><p>易错：<MathText text={m.mistake}/></p><p>应当这样想：<MathText text={m.correction}/></p></div>)}<div className="reason-panel"><span>把方法带走</span><p><MathText text={part.summary}/></p></div></>},
  ];
}
