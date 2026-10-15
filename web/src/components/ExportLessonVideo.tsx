import {useEffect,useRef,useState} from 'react';
import {Download,Film,LoaderCircle} from 'lucide-react';
import {ApiError,post,request} from '../api';
import type {Narration} from '../narration';
import type {MotionPack,MotionView} from '../motion-resources';
import type {Question,TeachingPackage,LessonPart} from '../types';
type Video={id:string;state:'queued'|'rendering'|'ready'|'failed';progress:number;questionId:string;questionRevision:number;lessonVersion:number;partId:string;motionPackId?:string|null;motionView?:MotionView;error?:string|null;url?:string|null};
type Props={question:Question;lesson:TeachingPackage;part:LessonPart;narration?:Narration|null;motionPack?:MotionPack|null;motionView?:MotionView;onPause:()=>void;onError:(text:string)=>void};
export function ExportLessonVideo({question,lesson,part,narration,motionPack=null,motionView='space',onPause,onError}:Props){
  const key=`zhijian-video:${question.id}:${question.revision}:${lesson.lessonVersion}:${part.partId}:${narration?.id??'silent'}:${motionPack?.packHash??'original'}:${motionView}`;
  return <VideoExportJob key={key} storageKey={key} question={question} lesson={lesson} part={part} narration={narration} motionPack={motionPack} motionView={motionView} onPause={onPause} onError={onError}/>;
}
function VideoExportJob({storageKey,question,lesson,part,narration,motionPack=null,motionView='space',onPause,onError}:Props&{storageKey:string}){
  const mounted=useRef(true);
  const [video,setVideo]=useState<Video|null>(null),[creating,setCreating]=useState(false),[pace,setPace]=useState(1),[jobId,setJobId]=useState(()=>localStorage.getItem(storageKey)),[connectionError,setConnectionError]=useState('');
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    if(!jobId)return;
    let active=true,timer:ReturnType<typeof setTimeout>|undefined;
    const poll=async()=>{
      try{
        const {video:next}=await request<{video:Video}>(`/videos/${jobId}`);
        if(!active)return;
        if(next.questionId!==question.id||next.questionRevision!==question.revision||next.lessonVersion!==lesson.lessonVersion||next.partId!==part.partId||(next.motionPackId??null)!==(motionPack?.id??null)||(motionPack&&(next.motionView??'space')!==motionView)){
          localStorage.removeItem(storageKey);setJobId(null);setVideo(null);setConnectionError('历史导出与当前小问不一致，请重新导出当前小问。');return;
        }
        setVideo(next);setConnectionError('');
        if(['queued','rendering'].includes(next.state))timer=setTimeout(()=>void poll(),1500);
      }catch(e){
        if(!active)return;
        if(e instanceof ApiError&&e.status===404){localStorage.removeItem(storageKey);setJobId(null);setVideo(null);setConnectionError('上次导出已不在本机，可以重新导出当前小问。');return;}
        setConnectionError('暂时无法获取导出进度，正在自动重试。');
        timer=setTimeout(()=>void poll(),3000);
      }
    };
    void poll();return()=>{active=false;if(timer)clearTimeout(timer);};
  },[jobId,storageKey,question.id,question.revision,lesson.lessonVersion,part.partId,motionPack?.id,motionView]);
  const create=async()=>{
    onPause();setCreating(true);setConnectionError('');
    try{
      const {video:next}=await post<{video:Video}>(`/questions/${question.id}/videos`,{expectedRevision:question.revision,lessonVersion:lesson.lessonVersion,partId:part.partId,pace,...(narration?{narrationId:narration.id}:{}),...(motionPack?{motionPackId:motionPack.id,motionView}:{})});
      localStorage.setItem(storageKey,next.id);
      if(mounted.current){setVideo(next);setJobId(next.id);}
    }catch(e){if(mounted.current)onError((e as Error).message);}
    finally{if(mounted.current)setCreating(false);}
  };
  const busy=creating||Boolean(jobId&&!video)||Boolean(video&&['queued','rendering'].includes(video.state));
  return <section className="panel video-export"><div className="teacher-label"><span className="teacher-avatar"><Film/></span><div><h2>把这节课带走</h2><p className="small">同一套板书，导出后离线回看</p></div></div><label className="playback-speed">视频节奏<select aria-label="视频节奏" disabled={busy} value={pace} onChange={e=>setPace(Number(e.target.value))}><option value={1}>正常讲解</option><option value={2}>紧凑回顾</option></select></label><button className="button" disabled={busy} onClick={()=>void create()}>{busy?<LoaderCircle/>:<Film/>}{busy?video?.state==='queued'?'等待导出':'正在制作视频':video?.state==='failed'?'重新导出本小问':'导出本小问视频'}</button>{video&&busy&&<p className="small" role="status">{video.state==='queued'?'正在等待本机空闲':`已制作 ${Math.round(Math.max(0,Math.min(100,video.progress)))}%`}</p>}{connectionError&&<p className="notice warm" role="status">{connectionError}</p>}{video?.state==='ready'&&<a className="button primary" href={video.url??`/api/videos/${video.id}/file`} download><Download/>下载教学视频</a>}{video?.state==='failed'&&<p className="notice warm" role="status">{video.error||'本次导出未完成，可以重试。'}</p>}<p className="small">第{question.number}题 · {part.label} · {narration?'有声教学视频':'图文动画视频 · 暂不含配音'}{motionPack?` · 教学动效 · ${motionView==='space'?'空间示意':'平面数点'}`:''}</p></section>;
}
