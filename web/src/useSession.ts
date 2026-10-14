import {useEffect,useRef,useState} from 'react';
import {ApiError,request} from './api';
import type {Question,TeachingPackage,Session} from './types';
import {restoreSession} from './domain';
export function useSession(question:Question,lesson:TeachingPackage|null){
  const [session,setSession]=useState<Session|null>(null),[state,setState]=useState('loading'),[error,setError]=useState('');
  const latest=useRef<Session|null>(null),busy=useRef(false),mounted=useRef(true),dirty=useRef(false);
  const storageKey=`zhijian-draft:${question.id}:${question.revision}:${lesson?.lessonVersion??0}`;
  const writeLocal=(value:Session,unsaved:boolean)=>{try{localStorage.setItem(storageKey,JSON.stringify({session:value,dirty:unsaved}));}catch{/* Server persistence remains the authoritative saved state. */}};
  const save=async()=>{
    if(busy.current||!dirty.current||!latest.current||state==='conflict')return;
    busy.current=true;
    while(dirty.current&&latest.current){
      const submitted:Session=latest.current;dirty.current=false;
      if(mounted.current)setState('saving');
      try{
        const {sessionRevision,updatedAt,...fields}=submitted;
        const response=await request<{session:Session}>(`/sessions/${question.id}`,{method:'PUT',body:JSON.stringify({...fields,expectedSessionRevision:sessionRevision})});
        if(latest.current===submitted){latest.current=response.session;writeLocal(response.session,false);if(mounted.current)setSession(response.session);}
        else if(latest.current){latest.current={...latest.current,sessionRevision:response.session.sessionRevision};if(mounted.current)setSession(latest.current);writeLocal(latest.current,true);}
        if(mounted.current){setState(dirty.current?'saving':'saved');setError('');}
      }catch(e){
        dirty.current=true;
        if(mounted.current){setState(e instanceof ApiError&&e.status===409?'conflict':'unsaved');setError((e as Error).message);}
        break;
      }
    }
    busy.current=false;
  };
  const saveRef=useRef(save);saveRef.current=save;
  useEffect(()=>{
    mounted.current=true;let active=true;
    if(!lesson)return;
    request<{session:Session|null}>(`/sessions/${question.id}`).then(({session:remote})=>{
      if(!active)return;
      const fresh:Session={questionId:question.id,questionRevision:question.revision,lessonVersion:lesson.lessonVersion,sessionRevision:remote?.sessionRevision??0,partId:lesson.parts[0].partId,stepIndex:0,mode:'teacher',sceneState:{},reflection:'',returnTarget:null,updatedAt:''};
      let draft:{session:Session;dirty:boolean}|null=null;try{draft=JSON.parse(localStorage.getItem(storageKey)??'null');}catch{/* Invalid local draft cannot replace server data. */}
      const restored=restoreSession(remote,draft,fresh);
      if(restored.dirty){
        latest.current=restored.session;dirty.current=true;setSession(restored.session);
        if(restored.conflict){setState('conflict');setError('另一个页面保存了不同的课堂现场。本机草稿已保留，请选择继续的位置。');}
        else setState('unsaved');
      }else{latest.current=restored.session;setSession(restored.session);setState(remote&&!restored.stale?'saved':'unsaved');}
      if(restored.stale)setError('旧课堂属于上一个内容版本。本次从新版开始，旧记录仍保留。');
    }).catch(e=>{if(active){setState('error');setError(e.message);}});
    return()=>{active=false;mounted.current=false;void saveRef.current();};
  },[question.id,question.revision,lesson?.lessonVersion]);
  useEffect(()=>{if(session&&dirty.current&&state!=='conflict'){const timer=setTimeout(()=>void saveRef.current(),450);return()=>clearTimeout(timer);}},[session,state]);
  const update=(patch:Partial<Session>)=>{
    if(!latest.current)return;
    const next={...latest.current,...patch};latest.current=next;dirty.current=true;writeLocal(next,true);setSession(next);if(state!=='conflict')setState('unsaved');
  };
  const resolve=async(choice:'local'|'server')=>{
    try{
      const {session:remote}=await request<{session:Session|null}>(`/sessions/${question.id}`);
      if(choice==='server'&&remote){latest.current=remote;dirty.current=false;setSession(remote);writeLocal(remote,false);setState('saved');setError('');}
      else if(latest.current){const next={...latest.current,sessionRevision:remote?.sessionRevision??0};latest.current=next;setSession(next);dirty.current=true;setState('unsaved');setError('');}
    }catch(e){setError((e as Error).message);}
  };
  return{session,state,error,update,save:()=>saveRef.current(),resolve};
}
