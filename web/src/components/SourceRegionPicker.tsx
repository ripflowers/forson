import {useEffect,useRef,useState} from 'react';
import {Crop,CheckCircle2,X,Expand} from 'lucide-react';
import type {Question,Paper} from '../types';
import {normalizedSelection,regionEditResult} from '../source-regions';
import type {Point,RegionBox} from '../source-regions';
type Props={page:Paper['pages'][number];title:string;regions:Question['sourceRegions'];onChange:(regions:Question['sourceRegions'])=>void};
export function SourceRegionPicker({page,title,regions,onChange}:Props){
  const [selecting,setSelecting]=useState(false),[selection,setSelection]=useState<RegionBox|null>(null),[message,setMessage]=useState('');
  const imageRef=useRef<HTMLImageElement>(null),startRef=useRef<Point|null>(null),[loaded,setLoaded]=useState(false);
  useEffect(()=>{setSelecting(false);setSelection(null);startRef.current=null;setMessage('');setLoaded(Boolean(imageRef.current?.complete&&imageRef.current.naturalWidth));},[page.index,page.url]);
  const finish=()=>{if(!selection)return;onChange(regionEditResult(regions,page.index,selection,true));setSelecting(false);setSelection(null);setMessage('本页范围已调整，其他页保持原样。请保存修改后再继续。');};
  const cancel=()=>{setSelecting(false);setSelection(null);startRef.current=null;setMessage('已取消圈选，原来的范围仍保留。');};
  const displayed=regionEditResult(regions,page.index,selection,selecting);
  const move=(point:Point)=>{const image=imageRef.current,start=startRef.current;if(!image||!start)return;setSelection(normalizedSelection(image.getBoundingClientRect(),start,point));};
  return <>
    <div className="region-controls"><button type="button" className="button" disabled={!loaded} aria-pressed={selecting} onClick={()=>{setSelecting(true);setSelection(null);setMessage('从题目左上角拖到右下角，把共同题干、图和所有小问一起圈进去。');}}><Crop/>重新圈选本题</button>{selecting&&<><button type="button" className="button primary" disabled={!selection} onClick={finish}><CheckCircle2/>使用这个范围</button><button type="button" className="button" onClick={cancel}><X/>取消圈选</button><button type="button" className="button text" onClick={()=>{setSelection({x:0,y:0,width:1,height:1});setMessage('已预览本页整页范围。确认后仍保留跨页题的其他页。');}}><Expand/>改用本页整页范围</button></>}</div>
    <a className={`original-image ${selecting?'region-selecting':''}`} href={selecting?undefined:page.url} tabIndex={0} target="_blank" rel="noreferrer" aria-label={selecting?'正在重新圈选本题原图范围；可取消或改用本页整页范围':'打开原图放大查看'} onClick={event=>{if(selecting)event.preventDefault();}} onKeyDown={event=>{if(selecting&&event.key==='Escape'){event.preventDefault();cancel();}}} onPointerDown={event=>{if(!selecting||event.button!==0||!loaded)return;event.preventDefault();startRef.current={x:event.clientX,y:event.clientY};setSelection(null);event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{if(selecting&&startRef.current)move({x:event.clientX,y:event.clientY});}} onPointerUp={event=>{if(!selecting||!startRef.current)return;move({x:event.clientX,y:event.clientY});startRef.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);setMessage('预览本页新范围。确认后会替换本页的旧框，其他页保持原样；如果框太小，请重新拖动。');}} onPointerCancel={()=>{startRef.current=null;setSelection(null);setMessage('圈选未完成，原范围仍保留。请重试或改用本页整页范围。');}}>
      <div className="original-image-surface"><img ref={imageRef} src={page.url} onLoad={()=>setLoaded(true)} onError={()=>{setLoaded(false);setMessage('原图尚未加载成功，暂时不能圈选。请重新打开原图。');}} draggable={false} alt={`${title}第${page.index+1}页原图`}/>{displayed.filter(region=>region.pageIndex===page.index).map((region,index)=><span aria-hidden="true" className={`region-highlight ${selecting&&selection?'region-preview':''}`} key={index} style={{left:`${region.x*100}%`,top:`${region.y*100}%`,width:`${region.width*100}%`,height:`${region.height*100}%`}}/>)}</div>
    </a><p className="small" role="status">{message||'原图范围需要对照校准。点原图可放大；定位不准时可重新圈选本题。'}</p>
  </>;
}
