import {useEffect,useState,useRef,useCallback,type SyntheticEvent} from 'react';
import {flushSync} from 'react-dom';
import {ArrowLeft,ArrowRight,BookOpen,Bookmark,MessagesSquare,Pause,Play,MoveHorizontal,Send,CheckCircle2,RotateCcw,Volume2,VolumeX,Headphones,LoaderCircle,Layers3} from 'lucide-react';
import type {Narration} from '../narration';
import {currentMotionPack,revealedMotionStepCount,type MotionPack,type MotionView} from '../motion-resources';
import {request,post} from '../api';
import type {Question,TeachingPackage,LearningEvent,AskResponse,Job,LessonPart} from '../types';
import {validLesson,parseScene,sceneSnapshot,isCurrentReply,eventToast} from '../domain';
import {useSession} from '../useSession';
import {Formula} from './Formula';
import {MathText} from './MathText';
import {Scene} from './Scene';
import {RemotionLessonPlayer,type RemotionLessonPlayerHandle} from './RemotionLessonPlayer';
import {ExportLessonVideo} from './ExportLessonVideo';
import {TeachingResources} from './TeachingResources';
import {LESSON_FPS,lessonFrameState,type LessonTime} from '../remotion/timeline';
import {canPlayLesson,canResumeAfterAnswer,type QuestionInterruption,stageDuration,teachingSnapshot} from '../lesson-playback';
import './guided-classroom.css';
type Props={question:Question;active:boolean;onJob:(job:Job)=>void;onRecords:()=>void;onError:(error:string)=>void};
export function Classroom({question,active,onJob,onRecords,onError}:Props){
  const [lesson,setLesson]=useState<TeachingPackage|null>(null),[loading,setLoading]=useState(true),[askText,setAskText]=useState(''),[reply,setReply]=useState<AskResponse|null>(null),[asking,setAsking]=useState(false),[paused,setPaused]=useState(true),[eventBusy,setEventBusy]=useState(false),[toast,setToast]=useState('');
  const [completed,setCompleted]=useState<string[]>([]),[history,setHistory]=useState<AskResponse[]>([]),eventKey=useRef(new Set<string>());
  useEffect(()=>{let active=true;setLoading(true);request<{lesson:TeachingPackage|null}>(`/questions/${question.id}/lesson`).then(data=>{if(active)setLesson(data.lesson);}).catch(e=>onError(e.message)).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[question.id,question.revision,question.lessonState]);
  const [speed,setSpeed]=useState(1),[visible,setVisible]=useState(document.visibilityState!=='hidden'),[reducedMotion,setReducedMotion]=useState(false);
  const teacherFrame=useRef<Record<string,unknown>>({}),proofRef=useRef<HTMLDivElement>(null),playerRef=useRef<RemotionLessonPlayerHandle>(null);
  const [lessonTime,setLessonTime]=useState<LessonTime|null>(null);
  const [narration,setNarration]=useState<Narration|null>(null),[preparingVoice,setPreparingVoice]=useState(false),[muted,setMuted]=useState(false),[voiceError,setVoiceError]=useState(''),[answerVoice,setAnswerVoice]=useState<Narration|null>(null),[answerSpeaking,setAnswerSpeaking]=useState(false),[answerVoiceLoading,setAnswerVoiceLoading]=useState(false);
  const replyAudio=useRef<HTMLAudioElement>(null),interruption=useRef<QuestionInterruption|null>(null),speechSerial=useRef(0),answerSerial=useRef<number|null>(null);
  const ready=validLesson(lesson,question.revision,question.parts.map(p=>p.id));
  const controller=useSession(question,ready?lesson:null);
  const savedSession=controller.session;
  const session=savedSession?.questionId===question.id&&savedSession.questionRevision===question.revision&&savedSession.lessonVersion===lesson?.lessonVersion?savedSession:null;
  const part=lesson?.parts.find(p=>p.partId===session?.partId)??lesson?.parts[0];
  const playbackIndex=session?.stepIndex??0;
  const voiceIdentity=`${question.id}:${question.revision}:${lesson?.lessonVersion}:${part?.partId}`;
  const environment=useRef({identity:voiceIdentity,active,visible,mode:session?.mode??'teacher',saveState:controller.state});
  environment.current={identity:voiceIdentity,active,visible,mode:session?.mode??'teacher',saveState:controller.state};
  const currentNarration=narration?.questionId===question.id&&narration.questionRevision===question.revision&&narration.lessonVersion===lesson?.lessonVersion&&narration.partId===part?.partId?narration:null;
  const stopSpeech=useCallback(()=>{speechSerial.current++;answerSerial.current=null;interruption.current=null;replyAudio.current?.pause();setAnswerSpeaking(false);setAsking(false);setAnswerVoiceLoading(false);},[]);
  const stopAll=()=>{stopSpeech();setPaused(true);playerRef.current?.pause();};
  useEffect(()=>{stopSpeech();setNarration(null);setAnswerVoice(null);setVoiceError('');if(!ready||!lesson||!part||question.number!==26)return;let current=true;setPaused(true);request<{narration:Narration|null}>(`/questions/${question.id}/narration?lessonVersion=${lesson.lessonVersion}&partId=${encodeURIComponent(part.partId)}`).then(data=>{if(current)setNarration(data.narration);}).catch(e=>{if(current)setVoiceError(e.message);});return()=>{current=false;};},[voiceIdentity,ready,stopSpeech]);
  useEffect(()=>()=>{speechSerial.current++;replyAudio.current?.pause();},[]);
  const [motionPack,setMotionPack]=useState<MotionPack|null>(null),[motionView,setMotionView]=useState<MotionView>('space');
  const currentPack=currentMotionPack(motionPack,question.id,question.revision,lesson?.lessonVersion,part?.partId);
  useEffect(()=>{setMotionPack(null);if(!ready||!lesson||!part||!parseScene(part.scene))return;let current=true;request<{motionPack:MotionPack|null}>(`/questions/${question.id}/motion-resource?lessonVersion=${lesson.lessonVersion}&partId=${encodeURIComponent(part.partId)}`).then(data=>{if(current)setMotionPack(data.motionPack);}).catch(e=>{if(current)onError(e.message);});return()=>{current=false;};},[voiceIdentity,ready]);
  const teacherIdentity=`${question.id}:${lesson?.lessonVersion}:${part?.partId}:${playbackIndex}`;
  const onTime=useCallback((time:LessonTime)=>{
    teacherFrame.current={...time.snapshot,teacherIdentity:`${question.id}:${lesson?.lessonVersion}:${part?.partId}:${time.stageIndex}`};
    setLessonTime(time);
    if(session?.mode==='teacher'&&session.stepIndex!==time.stageIndex)controller.update({stepIndex:time.stageIndex});
    if(time.ended)setPaused(true);
  },[question.id,lesson?.lessonVersion,part?.partId,session?.mode,session?.stepIndex,controller.update]);
  const liveTeacherFrame=()=>teacherFrame.current.teacherIdentity===teacherIdentity?teacherFrame.current:{};
  const playing=Boolean(ready&&session&&!asking&&!answerSpeaking&&canPlayLesson(active,paused,session.mode,visible,controller.state));
  useEffect(()=>{const changed=()=>{setVisible(document.visibilityState!=='hidden');if(document.visibilityState==='hidden'){setPaused(true);stopSpeech();playerRef.current?.pause();}};document.addEventListener('visibilitychange',changed);return()=>document.removeEventListener('visibilitychange',changed);},[]);
  useEffect(()=>{const media=window.matchMedia('(prefers-reduced-motion: reduce)'),changed=()=>setReducedMotion(media.matches);changed();media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed);},[]);
  useEffect(()=>{if(!active||controller.state==='conflict'){setPaused(true);stopSpeech();playerRef.current?.pause();}},[active,controller.state]);
  useEffect(()=>{const element=proofRef.current;if(element)element.scrollTo({top:element.scrollHeight,behavior:reducedMotion?'instant':'smooth'});},[playbackIndex,reducedMotion]);
  useEffect(()=>{if(!session||!part)return;const drafts=(session.sceneState.askDrafts??{}) as Record<string,string>;setAskText(drafts[part.partId]??'');},[session?.partId]);
  useEffect(()=>{let active=true;request<{items:AskResponse[]}>(`/questions/${question.id}/asks`).then(({items})=>{if(!active)return;setHistory([...items].reverse());setReply(previous=>previous??[...items].reverse().find(item=>item.questionRevision===question.revision&&item.lessonVersion===lesson?.lessonVersion)??null);}).catch(e=>onError(e.message));return()=>{active=false;};},[question.id,question.revision,lesson?.lessonVersion]);
  useEffect(()=>{if(!active||!ready||!session||!part)return;const fresh=!session.sceneState.guidedClassroom,index=fresh?0:session.stepIndex;const visited=(session.sceneState.visitedSlides??{}) as Record<string,number[]>;const positions=visited[part.partId]??[];if(fresh||!positions.includes(index))controller.update({... (fresh?{stepIndex:0,mode:'teacher' as const,returnTarget:null}:{}),sceneState:{...session.sceneState,guidedClassroom:true,visitedSlides:{...visited,[part.partId]:positions.includes(index)?positions:[...positions,index]}}});if(fresh&&question.number!==26)setPaused(false);},[active,ready,session?.partId,session?.stepIndex,session?.sceneState.guidedClassroom]);
  useEffect(()=>{request<{items:LearningEvent[]}>(`/records?paperId=${encodeURIComponent(question.paperId)}`).then(({items})=>setCompleted([...new Set(items.filter(e=>e.questionId===question.id&&e.questionRevision===question.revision&&e.lessonVersion===lesson?.lessonVersion&&e.kind==='lesson-part-viewed').map(e=>e.partId))])).catch(()=>{});},[lesson?.lessonVersion,question.id]);
  const event=async(kind:string,authorKind:LearningEvent['authorKind'],text:string,payload:Record<string,unknown>={})=>{
    if(!session||!lesson||!part)return;
    setEventBusy(true);setToast('');
    try{await post('/events',{questionId:question.id,questionRevision:question.revision,lessonVersion:lesson.lessonVersion,partId:part.partId,kind,authorKind,text,payload});setToast(eventToast(kind,authorKind));onRecords();}
    catch(e){onError((e as Error).message);throw e;}finally{setEventBusy(false);}
  };
  const pauseForQuestion=()=>{
    if(!interruption.current||interruption.current.identity!==voiceIdentity){
      const frame=playerRef.current?.getFrame()??0;
      interruption.current={identity:voiceIdentity,wasPlaying:playing,frame};
    }
    const intent=interruption.current;
    stopSpeech();interruption.current=intent;
    flushSync(()=>setPaused(true));
    const snapshot=playerRef.current?.pauseAndSnapshot();
    if(interruption.current&&typeof snapshot?.frame==='number')interruption.current.frame=snapshot.frame;
  };
  const finishAnswer=()=>{
    setAnswerSpeaking(false);
    const state=environment.current,intent=interruption.current;
    interruption.current=null;
    if(canResumeAfterAnswer(intent,state.identity,true,state.active,state.visible,state.mode,state.saveState)){
      playerRef.current?.seekFrame(intent!.frame);playerRef.current?.play();setPaused(false);
    }
  };
  const speakAnswer=async(voice:Narration,serial:number)=>{
    const audio=replyAudio.current;if(!audio||serial!==speechSerial.current)return;
    answerSerial.current=serial;setAnswerVoice(voice);audio.src=voice.clips[0].audioUrl;audio.muted=muted;audio.currentTime=0;
    try{await audio.play();if(serial===speechSerial.current)setAnswerSpeaking(true);else audio.pause();}
    catch{if(serial===speechSerial.current){setVoiceError('补讲声音暂未播放，主课保持暂停。请点击“听老师补讲”，或自行继续主线。');setAnswerSpeaking(false);}}
  };
  const prepareAnswerSpeech=async(answer:AskResponse,serial:number,key:string)=>{
    if(!lesson||!part)return;
    setAnswerVoiceLoading(true);
    const {narration:voice}=await post<{narration:Narration}>(`/questions/${question.id}/asks/${answer.id}/narration`,{expectedRevision:question.revision,lessonVersion:lesson.lessonVersion,partId:part.partId});
    if(key===environment.current.identity&&serial===speechSerial.current&&environment.current.active&&environment.current.visible)await speakAnswer(voice,serial);
  };
  const relistenReply=async()=>{
    if(!reply)return;pauseForQuestion();const serial=++speechSerial.current,key=voiceIdentity;setAsking(true);setAnswerVoiceLoading(true);setVoiceError('');
    try{if(answerVoice?.askId===reply.id)await speakAnswer(answerVoice,serial);else await prepareAnswerSpeech(reply,serial,key);}
    catch(e){if(serial===speechSerial.current){setVoiceError((e as Error).message);interruption.current=null;}}
    finally{if(serial===speechSerial.current){setAsking(false);setAnswerVoiceLoading(false);}}
  };
  const ask=async(text:string)=>{
    if(!session||!lesson||!part||!text.trim()||asking)return;
    pauseForQuestion();const serial=++speechSerial.current,key=voiceIdentity;
    setAsking(true);setAskText(text);setAnswerVoice(null);setVoiceError('');
    const selectedScene=(session.mode==='explore'?(session.sceneState[part.partId]??{}):playerRef.current?.pauseAndSnapshot()??liveTeacherFrame()) as Record<string,unknown>;
    const stepIndex=session.mode==='teacher'&&typeof selectedScene.stepIndex==='number'?selectedScene.stepIndex:session.stepIndex;
    const snapshot={...teachingSnapshot(session.mode==='explore'?sceneSnapshot(part.scene,selectedScene):selectedScene,stepIndex,{...session.sceneState}),reflection:session.reflection};
    const mode=session.mode,stepId=stepIndex>=2?part.steps[stepIndex-2]?.id??null:null;
    try{
      const answer=await post<AskResponse>(`/questions/${question.id}/ask`,{questionRevision:question.revision,lessonVersion:lesson.lessonVersion,partId:part.partId,stepId,mode,snapshot,text});
      if(key!==environment.current.identity||serial!==speechSerial.current)return;
      setReply(answer);setHistory(items=>[answer,...items.filter(item=>item.id!==answer.id)]);
      await event('help-used','system',text,{askId:answer.id,status:answer.status,snapshot});
      if(key!==environment.current.identity||serial!==speechSerial.current||!environment.current.active||!environment.current.visible)return;
      if(answer.status==='checked'&&currentNarration){
        await prepareAnswerSpeech(answer,serial,key);
      }else if(answer.status==='checked'&&!currentNarration){finishAnswer();}
    }catch(e){if(key===environment.current.identity&&serial===speechSerial.current){setVoiceError((e as Error).message);interruption.current=null;}}
    finally{if(serial===speechSerial.current){setAsking(false);setAnswerVoiceLoading(false);}}
  };
  const prepareVoice=async()=>{
    if(!lesson||!part)return;stopAll();setPreparingVoice(true);setVoiceError('');const key=voiceIdentity;
    try{const result=await post<{narration:Narration}>(`/questions/${question.id}/narration`,{expectedRevision:question.revision,lessonVersion:lesson.lessonVersion,partId:part.partId});if(key===environment.current.identity){setNarration(result.narration);controller.update({stepIndex:0,mode:'teacher',returnTarget:null});}}
    catch(e){if(key===environment.current.identity)setVoiceError((e as Error).message);}finally{if(key===environment.current.identity)setPreparingVoice(false);}
  };
  const unlockReply=(event:SyntheticEvent)=>{
    const audio=replyAudio.current,url=currentNarration?.clips[0]?.audioUrl;
    if(audio&&url&&!answerSpeaking){audio.src=url;audio.muted=true;void audio.play().then(()=>{if(audio.src.endsWith(url)&&!audio.paused){audio.pause();audio.currentTime=0;audio.muted=muted;}}).catch(()=>{audio.muted=muted;});}
    playerRef.current?.play(event);
  };
  const changePart=(partId:string)=>{stopAll();setAsking(false);setAnswerVoiceLoading(false);setPreparingVoice(false);setReply(null);controller.update({partId,stepIndex:0,mode:'teacher',returnTarget:null});};
  const changeAskText=(text:string)=>{pauseForQuestion();setAskText(text);if(session&&part){const drafts=(session.sceneState.askDrafts??{}) as Record<string,string>;controller.update({sceneState:{...session.sceneState,askDrafts:{...drafts,[part.partId]:text}}});}};
  const goTeacher=()=>{setPaused(true);const target=session?.returnTarget;if(typeof target?.frame==='number')playerRef.current?.seekFrame(target.frame);controller.update({mode:'teacher',stepIndex:typeof target?.stepIndex==='number'?target.stepIndex:session?.stepIndex??0,returnTarget:null});};
  const generate=async()=>{try{const result=await post<{job:Job}>(`/questions/${question.id}/lesson`,{expectedRevision:question.revision});onJob(result.job);}catch(e){onError((e as Error).message);}};
  if(loading)return <section className="panel loading"><span className="skeleton"/><span className="skeleton"/><p>正在打开当前版本的老师课…</p></section>;
  if(!ready||!lesson)return <section className="panel lesson-empty"><div className="teacher-avatar"><BookOpen/></div><h2>{question.state!=='confirmed'?'先核对完整题面':'老师课正在准备'}</h2><p>{question.missingFields.length?`还缺：${question.missingFields.join('、')}。补全前不会猜测解法。`:question.state!=='confirmed'?'到我的试卷逐项检查题干、图注、选项与所有小问。':'正式课堂需要当前题面每个小问的完整讲解和核验。你可以为这道题准备老师课。'}</p>{lesson?.checks.issues.length?<div className="notice warm">{lesson.checks.issues.join('；')}</div>:null}<button className="button primary" disabled={question.state!=='confirmed'||question.missingFields.length>0} onClick={generate}>准备这道题的老师课</button></section>;
  if(!session||!part)return <section className="panel"><p>{controller.error||'正在恢复课堂现场…'}</p>{controller.state==='error'&&<button className="button" onClick={()=>window.location.reload()}>重新连接课堂</button>}</section>;
  const slides=lessonSlides(part),index=Math.max(0,Math.min(session.stepIndex,slides.length-1)),current=slides[index];
  const visited=((session.sceneState.visitedSlides??{}) as Record<string,number[]>)[part.partId]??[];
  const markPart=async()=>{
    if(!slides.every((_,i)=>visited.includes(i))){setToast('请先沿主线查看每个讲解片段，再记录这一个小问。');return;}
    const recordKey=`${question.revision}:${lesson.lessonVersion}:${part.partId}`;
    if(eventKey.current.has(recordKey)||completed.includes(part.partId)){setToast('这份课程的本小问主线已有记录。');return;}
    eventKey.current.add(recordKey);
    try{await event('lesson-part-viewed','system',`读过第${question.number}题${part.label}的完整主线`,{viewedSlides:visited,stepCount:part.steps.length});setCompleted([...completed,part.partId]);}catch{eventKey.current.delete(recordKey);}
  };
  const modeExplore=session.mode==='explore';
  const replyTimedOut=Boolean(reply?.evidence&&typeof reply.evidence==='object'&&'responseTimeout' in reply.evidence&&reply.evidence.responseTimeout===true);
  const replay=(event?:SyntheticEvent)=>{stopSpeech();playerRef.current?.restart();controller.update({stepIndex:0,mode:'teacher',returnTarget:null});if(event)unlockReply(event);setPaused(false);};
  const jump=(position:number)=>{stopAll();playerRef.current?.seekStage(position);controller.update({stepIndex:position});};
  const time=lessonTime&&teacherFrame.current.teacherIdentity===teacherIdentity?lessonTime:lessonFrameState(part,0,LESSON_FPS,1,reducedMotion,currentNarration);
  const formedSteps=currentPack?.stages.some(stage=>stage.template==='triangle-grow')?revealedMotionStepCount(index,time.visualFrame,LESSON_FPS,reducedMotion):Math.max(0,index-1);
  const motionStage=currentPack?.stages.find(stage=>stage.stageIndex===index);
  const sceneState=(session.sceneState[part.partId]??{}) as Record<string,unknown>;
  const explore=()=>{
    stopSpeech();flushSync(()=>setPaused(true));
    const snapshot=playerRef.current?.pauseAndSnapshot();
    const stepIndex=typeof snapshot?.stepIndex==='number'?snapshot.stepIndex:index;
    controller.update({mode:'explore',stepIndex,returnTarget:{mode:'teacher',partId:part.partId,stepIndex,frame:snapshot?.frame,sceneState:{...session.sceneState},reflection:session.reflection}});
  };
  return <>
    <div className="class-top"><div><span className="eyebrow">老师课堂 · 第{question.number}题</span><h1><MathText text={part.goal}/></h1><p className="sub">跟着同一块板书看思路如何形成。会自动往下讲；随时暂停、回看或问为什么。</p></div><span className="chip">{lesson.reviewLevel==='teacher_reviewed'?'教师已审核':'自动核验课程 · 自用'}</span></div>
    {question.number===26&&<section className="voice-lesson-bar"><div><Headphones/><div><b>{currentNarration?'老师声音已准备':'听老师边讲边演示'}</b><p className="small">{currentNarration?'口语讲解、板书和动画同步。提问后先补讲，再从原处继续。':'先为本题准备普通话老师声音，不需要重新生成课程。'}</p></div></div>{currentNarration?<button className="button primary" disabled={asking||answerSpeaking} onClick={e=>replay(e)}><Play/>从头听老师讲课</button>:<button className="button primary" disabled={preparingVoice||asking} onClick={()=>void prepareVoice()}>{preparingVoice?<LoaderCircle/>:<Volume2/>}{preparingVoice?'正在准备老师声音…':'准备老师声音'}</button>}{voiceError&&<p className="notice warm" role="status">{voiceError}</p>}</section>}
    <audio ref={replyAudio} preload="none" aria-label="老师补讲声音" onEnded={()=>{if(answerSerial.current===speechSerial.current&&replyAudio.current?.ended){answerSerial.current=null;finishAnswer();}}} onError={()=>{if(answerSerial.current===speechSerial.current&&answerVoice){answerSerial.current=null;setAnswerSpeaking(false);setVoiceError('补讲音频加载失败，主课已暂停。可以重听补讲或继续主线。');}}}/>
    <div className="part-tabs" aria-label="选择小问">{lesson.parts.map(p=><button className={p.partId===part.partId?'active':''} aria-pressed={p.partId===part.partId} onClick={()=>changePart(p.partId)} key={p.partId}>{p.label||'本题'}{completed.includes(p.partId)&&<CheckCircle2/>}</button>)}</div>
    <div className="class-layout guided-classroom"><section className="stage guided-stage"><div className="stage-bar"><span><BookOpen/>{modeExplore?'动手探索':'连续讲授 · 同一块板书'}</span><span>{index+1} / {slides.length} · <MathText text={current.label}/></span></div><div className="stage-content">
      <details className="question-source"><summary>题面与原题条件</summary><p><MathText text={question.stem}/></p>{question.figureDescription&&<p className="small">图：<MathText text={question.figureDescription}/></p>}<p><MathText text={question.parts.find(p=>p.id===part.partId)?.prompt}/></p>{question.options.length>0&&<ul>{question.options.map(o=><li key={o.label}>{o.label}. <MathText text={o.text}/></li>)}</ul>}</details>
      {currentPack&&!modeExplore&&<div className="motion-view-bar"><div><Layers3/><span>跟着图像理解 · {currentPack.concepts.length}个知识连接</span></div><div className="motion-view-switch" role="group" aria-label="教学动画视角"><button aria-pressed={motionView==='space'} onClick={()=>setMotionView('space')}>空间示意</button><button aria-pressed={motionView==='flat'} onClick={()=>setMotionView('flat')}>平面数点</button></div></div>}
      <div hidden={modeExplore}><RemotionLessonPlayer ref={playerRef} part={part} stageIndex={index} playing={playing} speed={speed} reducedMotion={reducedMotion} narration={currentNarration} motionPack={currentPack} motionView={motionView} muted={muted} onAudioError={()=>{stopAll();setVoiceError('课堂音频暂时无法播放，请检查连接后再试。');}} onPlaybackError={()=>{stopAll();setVoiceError('课堂播放出现问题，已暂停。请重新打开课堂。');}} onTime={onTime}/></div>
      {modeExplore&&part.scene?<Scene spec={part.scene} state={sceneState} onChange={value=>controller.update({sceneState:{...session.sceneState,[part.partId]:value}})} onSave={(text,snapshot)=>void event('observation','system-observation',text,snapshot).catch(()=>{})}/>:<>
        <nav className="lesson-route" aria-label="讲解思路时间线">{slides.map((slide,i)=><button key={i} aria-current={i===index?'step':undefined} className={i===index?'current':i<index?'revealed':''} onClick={()=>jump(i)}><span>{i+1}</span><MathText text={slide.label}/></button>)}</nav>
        <div className="reasoning-board" aria-label="已经形成的推理"><span className="board-heading">思路留下来，理解连起来</span><div className="reasoning-lines" ref={proofRef}>{index>=1&&<div className="reasoning-line"><span>方法</span><p><MathText text={part.method}/></p></div>}{part.steps.slice(0,formedSteps).map((step,i)=><div key={step.id} className={`reasoning-line ${i+2===index?'current':''}`}><span>{i+1}</span><div><b><MathText text={step.title}/></b>{step.formulaLatex?<Formula latex={step.formulaLatex}/>:<p><MathText text={step.reason}/></p>}</div></div>)}{index===0&&<p className="small">先把条件与知识点看清，再让每一步的理由留在板书上。</p>}</div></div>

      </>}
    </div><div className="teacher-controls guided-controls">
      {!modeExplore&&<div className="lesson-time"><label className="lesson-scrub"><span>课堂进度</span><input type="range" aria-label="课堂进度" min={0} max={time.durationInFrames-1} value={time.frame} onChange={e=>{stopAll();playerRef.current?.seekFrame(Number(e.target.value));}}/><span>{Math.floor(time.frame/LESSON_FPS)} / {Math.ceil(time.durationInFrames/LESSON_FPS)}秒</span></label><span role="status">{playing?'自动讲解中':time.progress>=1?'本小问演示完毕':'已暂停，可从这里继续'} · {Math.max(0,Math.ceil((1-time.progress)*(currentNarration?currentNarration.stageDurations[index]/LESSON_FPS:stageDuration(part,index))/speed))}秒后{index<slides.length-1?'接着推理':'停在收束'}</span></div>}
      <div className="control-row"><button className="button primary" disabled={asking||answerSpeaking||preparingVoice||modeExplore||controller.state==='conflict'} onClick={e=>{if(!paused){stopAll();return;}if(time.ended)replay(e);else{stopSpeech();unlockReply(e);setPaused(false);}}}>{paused?<Play/>:<Pause/>}{paused?currentNarration?'继续听老师讲':'继续自动讲解':'暂停讲解'}</button><button className="icon-button" aria-label="从头重播" onClick={e=>replay(e)}><RotateCcw/></button>{currentNarration&&<button className="icon-button" aria-label={muted?'打开老师声音':'静音老师声音'} onClick={()=>{setMuted(!muted);if(replyAudio.current)replyAudio.current.muted=!muted;}}>{muted?<VolumeX/>:<Volume2/>}</button>}<label className="playback-speed">节奏<select aria-label="讲解速度" value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={0.75}>慢一点</option><option value={1}>正常</option><option value={1.5}>1.5倍</option><option value={2}>2倍</option></select></label><button className="button" disabled={index===0||modeExplore} onClick={()=>jump(index-1)}><ArrowLeft/>回看一步</button>{modeExplore?<button className="button" onClick={goTeacher}><ArrowRight/>回老师主线</button>:index<slides.length-1?<button className="button text" onClick={()=>jump(index+1)}>提前看下一步<ArrowRight/></button>:<button className="button" disabled={eventBusy} onClick={()=>void markPart()}>记录读过本小问<CheckCircle2/></button>}</div><p className="small">{modeExplore?'探索会暂停讲授，返回后从原步骤继续。':paused?currentNarration?'声音、板书和动画已一起暂停。':'图形与讲解已一起暂停；当前为图文演示。':'无需点下一步。写下疑问或笔记时会暂停，最后停在本小问。'}</p></div></section>
      <aside className="teacher-side">{!modeExplore&&<section className="panel teaching-slide guided-caption" key={`${part.partId}:${index}`}><div className="slide-label"><span className="teacher-avatar"><BookOpen/></span>老师此刻在讲 · <MathText text={current.label}/></div><div className="narration-body" onWheel={stopAll}>{motionStage?<><h2>{motionStage.title}</h2><p className="teaching-text">{motionStage.focus}</p>{currentPack?.concepts.filter(concept=>motionStage.conceptIds.includes(concept.id)).map(concept=><div className="reason-panel" key={concept.id}><span>{concept.label}</span><p>{concept.explanation}</p></div>)}</>:current.content}</div></section>}<section className="panel askbox"><div className="teacher-label"><span className="teacher-avatar"><MessagesSquare/></span><div><h2>随时问老师</h2><p className="small">围绕当前小问与现场回答</p></div></div><div className="faq-buttons">{['这一步为什么这样做？','从基础讲一遍','换一种讲法'].map(text=><button disabled={asking} key={text} onClick={()=>void ask(text)}>{text}<ArrowRight/></button>)}</div>
        {asking&&<div className="notice" role="status">{answerVoiceLoading?'老师在准备这次补讲的声音…':'声音和板书已暂停，老师正在结合当前现场检查解释…'}</div>}
        {answerSpeaking&&<div className="notice" role="status">老师正在回答你，主课停在提问时的板书。<button className="button text" onClick={()=>{replyAudio.current?.pause();setAnswerSpeaking(false);}}>暂停补讲</button></div>}
        {currentNarration&&reply?.status==='checked'&&reply.questionId===question.id&&reply.questionRevision===question.revision&&reply.lessonVersion===lesson.lessonVersion&&reply.partId===part.partId&&!answerSpeaking&&!asking&&<button className="button" onClick={()=>void relistenReply()}><Volume2/>听老师补讲</button>}
        {reply&&!asking&&<details className={`teacher-reply ${reply.status==='checked'?'':'review'}`} open={Boolean(reply&&isCurrentReply(reply,session,(session.mode==='explore'?sceneSnapshot(part.scene,sceneState):liveTeacherFrame())))}><summary>老师的补讲 · 点击展开</summary><span className="chip">{reply.questionRevision!==question.revision||reply.lessonVersion!==lesson.lessonVersion?'历史版本答疑':!isCurrentReply(reply,session,(session.mode==='explore'?sceneSnapshot(part.scene,sceneState):liveTeacherFrame()))?'历史现场补讲':reply.status==='checked'?'已核对的补讲':replyTimedOut?'老师暂未回应':'还需复核'}</span><p className="small">答疑对应小问：{lesson.parts.find(p=>p.partId===reply.partId)?.label??'历史小问'}<br/>提问现场：{reply.mode==='explore'?'探索':reply.mode==='exercise'?'尝试':'老师主线'} · 第{typeof reply.snapshot?.stepIndex==='number'?reply.snapshot.stepIndex+1:'—'}段{typeof reply.snapshot?.x==='number'?` · x=${reply.snapshot.x}`:''}{typeof reply.snapshot?.a==='number'?` · a=${reply.snapshot.a}`:''}{typeof reply.snapshot?.rows==='number'?` · ${reply.snapshot.rows}行${reply.snapshot.teacherPhase==='original'?'原题点阵（共同部分省略）':reply.snapshot.teacherPhase==='growth'?'成长点阵':'小例点阵'}`:''}<br/>你的问题：{reply.text}</p>{reply.status==='checked'?<div className="reply-text"><MathText text={reply.answer}/></div>:<p>{replyTimedOut?'老师暂时没有回应，你的疑问和当前板书已保存。主课保持暂停，可以稍后再问，或继续听老师讲。':'这次答复尚未通过核验，暂不作为正式解释。可以继续已核验主线，或核对题面条件后再问。'}</p>}<p className="small">{reply.questionRevision!==question.revision||reply.lessonVersion!==lesson.lessonVersion?'这条答疑属于旧版题面或课程，只作为历史记录，不解释当前版本。':'回答绑定提问时的小问与参数；之后探索不会改变这条历史答复。'}</p></details>}
        {history.length>0&&<details className="ask-history"><summary>过去的追问 · {history.length}条</summary>{history.map(item=><button key={item.id} type="button" onClick={()=>{stopAll();setReply(item);}}>{item.text}<span className="small">{item.status==='checked'?'已核对':'待复核'} · {new Date(item.createdAt).toLocaleDateString('zh-CN')}</span></button>)}</details>}
        <form onSubmit={e=>{e.preventDefault();void ask(askText);}}><label className="field">我的疑问<textarea value={askText} onFocus={pauseForQuestion} onChange={e=>changeAskText(e.target.value)} placeholder="这一步哪里没想明白？" maxLength={2000}/></label><button className="button primary" disabled={asking||!askText.trim()}><Send/>把疑问交给老师</button></form>
        {!modeExplore&&parseScene(part.scene)&&<button className="button explore-button" onClick={explore}><MoveHorizontal/>我来探索一下</button>}
      </section><section className="panel reflection"><div className="teacher-label"><span className="teacher-avatar"><Bookmark/></span><div><h2>留下你的发现</h2><p className="small">你的原话，与你自己的理解</p></div></div><label className="field">我的理解<textarea value={session.reflection} onFocus={stopAll} onChange={e=>{stopAll();controller.update({reflection:e.target.value});}} placeholder="原来……是因为……" maxLength={4000}/></label><button className="button" disabled={!session.reflection.trim()||eventBusy} onClick={()=>void event('note','learner',session.reflection,{sceneState,stepIndex:index}).catch(()=>{})}>保存我的原话</button><p className="small save-state" role="status">{controller.state==='saved'?'课堂现场已保存':controller.state==='saving'?'正在保存现场…':controller.state==='conflict'?'版本有冲突，草稿已保留':'现场待同步，本机草稿已保留'}</p>{controller.error&&<p className="small">{controller.error}</p>}{controller.state==='conflict'?<div className="actions"><button className="button" onClick={()=>void controller.resolve('local')}>继续本机草稿</button><button className="button" onClick={()=>void controller.resolve('server')}>使用已保存现场</button></div>:controller.state==='unsaved'&&<button className="button text" onClick={()=>void controller.save()}>重试保存</button>}{toast&&<p className="notice" role="status">{toast}</p>}<p className="small">已读 {completed.length}/{lesson.parts.length} 个小问主线。学习经历不等于掌握。</p></section><ExportLessonVideo question={question} lesson={lesson} part={part} narration={currentNarration} motionPack={currentPack} motionView={motionView} onPause={stopAll} onError={onError}/>{parseScene(part.scene)&&<TeachingResources key={voiceIdentity} question={question} lesson={lesson} part={part} pack={currentPack} onPause={stopAll} onImported={pack=>{stopAll();setMotionPack(pack);}}/>}</aside>
    </div>
  </>;
}
function lessonSlides(part:LessonPart){
  return[
    {label:'读题与条件',content:<><h2><MathText text={part.goal}/></h2><div className="condition-grid"><section><h3>已经知道什么</h3><ul>{part.known.map((x,i)=><li key={i}><MathText text={x}/></li>)}</ul></section><section><h3>需要用到的基础</h3><ul>{part.prerequisites.map((x,i)=><li key={i}><MathText text={x}/></li>)}</ul></section></div></>},
    {label:'选思路',content:<><h2>为什么选这个方法？</h2><p className="teaching-text"><MathText text={part.method}/></p></>},
    ...part.steps.map(step=>({label:step.title,content:<><h2><MathText text={step.title}/></h2><p className="teaching-text"><MathText text={step.explanation}/></p>{step.formulaLatex&&<div className="board-formula"><Formula latex={step.formulaLatex} display/></div>}<div className="reason-panel"><span>这一步的理由</span><p><MathText text={step.reason}/></p></div></>})),
    {label:'检验与方法收束',content:<><h2>把结论检查一遍</h2><div className="answer-box"><MathText text={part.answer.display}/></div><h3>怎样检验</h3><p className="teaching-text"><MathText text={part.verification}/></p><h3>容易混淆的地方</h3>{part.misconceptions.map((m,i)=><div className="misconception" key={i}><p>易错：<MathText text={m.mistake}/></p><p>应当这样想：<MathText text={m.correction}/></p></div>)}<div className="reason-panel"><span>把方法带走</span><p><MathText text={part.summary}/></p></div></>},
  ];
}
