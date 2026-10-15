import {useRef,useState} from 'react';
import {Download,Upload,Layers3,CheckCircle2} from 'lucide-react';
import {post,request} from '../api';
import type {MotionPack,TeachingContext} from '../motion-resources';
import type {LessonPart,Question,TeachingPackage} from '../types';
import './teaching-resources.css';

type Props={question:Question;lesson:TeachingPackage;part:LessonPart;pack:MotionPack|null;onPause:()=>void;onImported:(pack:MotionPack)=>void};
export function TeachingResources({question,lesson,part,pack,onPause,onImported}:Props){
  const input=useRef<HTMLInputElement>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const identity=useRef('');identity.current=`${question.id}:${question.revision}:${lesson.lessonVersion}:${part.partId}`;
  const exportContext=async()=>{
    onPause();setBusy(true);setError('');setMessage('');const current=identity.current;
    try{
      const context=await request<TeachingContext>(`/questions/${question.id}/teaching-context?lessonVersion=${lesson.lessonVersion}&partId=${encodeURIComponent(part.partId)}`);
      if(identity.current!==current)return;
      const url=URL.createObjectURL(new Blob([JSON.stringify(context,null,2)],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download=`第${question.number}题-${part.partId}-备课资料.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setMessage('已导出题面、核验教案和动画模板约束，可交给 Codex 制作资源包。');
    }catch(e){if(identity.current===current)setError((e as Error).message);}finally{if(identity.current===current)setBusy(false);}
  };
  const importPack=async(file:File)=>{
    onPause();setBusy(true);setError('');setMessage('');const current=identity.current;
    try{
      if(file.size>128*1024)throw new Error('资源包需小于128KB，只包含教学文字和模板配置。');
      let data:unknown;try{data=JSON.parse(await file.text());}catch{throw new Error('无法读取这个JSON资源包，请检查文件格式。');}
      if(identity.current!==current)return;
      const result=await post<{motionPack:MotionPack}>(`/questions/${question.id}/motion-resources`,data);
      if(identity.current!==current)return;
      onImported(result.motionPack);setMessage('已绑定当前教案。课程和声音保持原版本，动画资源已更新。');
    }catch(e){if(identity.current===current)setError((e as Error).message);}finally{if(identity.current===current)setBusy(false);if(input.current)input.current.value='';}
  };
  return <details className="panel teaching-resources"><summary><Layers3/><span>老师备课台<span className="small">Codex 制作资源 · 本机导入</span></span></summary><div className="resource-workflow"><span>题目与教案</span><b>→</b><span>Codex 备课</span><b>→</b><span>本机校验</span><b>→</b><span>课堂动画</span></div><p className="small">先导出这一个小问的备课资料，再由 Codex 按模板制作资源包并导入。不需要重新调用解题模型。</p>{pack&&<div className="resource-current"><CheckCircle2/><div><b>{pack.title}</b><p className="small">{pack.stages.length}个教学阶段 · {pack.concepts.length}个知识点 · Codex 制作</p></div></div>}<div className="actions"><button className="button" disabled={busy} onClick={()=>void exportContext()}><Download/>导出备课资料</button><button className="button" disabled={busy} onClick={()=>{onPause();input.current?.click();}}><Upload/>导入教学资源</button><input ref={input} type="file" accept=".json,application/json" aria-label="教学资源包文件" hidden onChange={e=>{const file=e.target.files?.[0];if(file)void importPack(file);}}/></div>{busy&&<p className="small" role="status">正在检查当前教案与资源…</p>}{message&&<p className="notice" role="status">{message}</p>}{error&&<p className="notice warm" role="alert">{error}</p>}<p className="small">资源仅通过本机结构与版本校验，未标记为教师审核。数值由已核验教案决定，资源包不能改题、改答案或运行脚本。</p></details>;
}
