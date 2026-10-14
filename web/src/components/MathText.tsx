import {Fragment} from 'react';
import katex from 'katex';
import {Formula} from './Formula';
type Segment={kind:'text';text:string}|{kind:'math';text:string;display:boolean};
const bareCommands=new Set(['frac','sqrt','cdot','times','div','pm','mp','le','leq','ge','geq','ne','neq','left','right','lvert','rvert','vert']);
function supportedBareMath(value:string){
  if(value.length>2048||/\{\s*\}/.test(value)||value.includes('\\\\')||/^[=_*/^]|[=+\-*/^_]$/.test(value))return false;
  const commands=[...value.matchAll(/\\([A-Za-z]+)/g)];
  if(!commands.length||commands.some(command=>!bareCommands.has(command[1])))return false;
  const plain=value.replace(/\\[A-Za-z]+/g,'');
  if(plain.includes('\\')||[...plain.matchAll(/[A-Za-z]+/g)].some(word=>word[0].length>1))return false;
  const brackets:string[]=[];
  for(const character of value){
    if('{(['.includes(character))brackets.push(character);
    else if('})]'.includes(character)&&brackets.pop()!==({'}':'{',')':'(',']':'['} as Record<string,string>)[character])return false;
  }
  if(brackets.length||(value.match(/\|/g)?.length??0)%2!==0)return false;
  try{katex.renderToString(value,{throwOnError:true,trust:false,strict:'ignore',maxExpand:200,maxSize:10});return true;}catch{return false;}
}
function splitBareText(text:string):Segment[]{
  if(text.includes('$')||/<\/?[A-Za-z]/.test(text)||/\b[A-Za-z]:\\/.test(text))return[{kind:'text',text}];
  const segments:Segment[]=[];let cursor=0;
  for(const match of text.matchAll(/[A-Za-z0-9\\{}()[\]|_^+\-*/=.,;: \t]+/g)){
    const leading=match[0].match(/^[ \t]*/)?.[0].length??0;
    const formula=match[0].slice(leading).replace(/[ \t.,;:]+$/,'');
    if(!supportedBareMath(formula))continue;
    const start=match.index!+leading,end=start+formula.length;
    if(start>cursor)segments.push({kind:'text',text:text.slice(cursor,start)});
    segments.push({kind:'math',text:formula,display:false});cursor=end;
  }
  if(cursor<text.length)segments.push({kind:'text',text:text.slice(cursor)});
  return segments.length?segments:[{kind:'text',text}];
}
export function splitMathText(text:string):Segment[]{
  const segments:Segment[]=[];
  const escaped=(position:number)=>{let slashes=0;while(position>0&&text[--position]==='\\')slashes++;return slashes%2===1;};
  let cursor=0,index=0;
  while(index<text.length){
    let open='',close='',display=false;
    if(!escaped(index)){
      if(text.startsWith('$$',index)){open=close='$$';display=true;}
      else if(text[index]==='$'){open=close='$';}
      else if(text.startsWith('\\(',index)){open='\\(';close='\\)';}
      else if(text.startsWith('\\[',index)){open='\\[';close='\\]';display=true;}
    }
    if(!open){index++;continue;}
    let end=text.indexOf(close,index+open.length);
    while(end>=0&&(escaped(end)||(close==='$'&&(text[end-1]==='$'||text[end+1]==='$'||/\d/.test(text[end+1]??'')))))end=text.indexOf(close,end+close.length);
    if(end<0)break;
    const formula=text.slice(index+open.length,end);
    if(!formula.trim()){index=end+close.length;continue;}
    if(index>cursor)segments.push({kind:'text',text:text.slice(cursor,index)});
    segments.push({kind:'math',text:formula,display});
    cursor=end+close.length;index=cursor;
  }
  if(cursor<text.length)segments.push({kind:'text',text:text.slice(cursor)});
  return segments.flatMap(segment=>segment.kind==='text'?splitBareText(segment.text):[segment]);
}
export function MathText({text}:{text?:string|null}){
  return <>{splitMathText(text??'').map((segment,index)=>segment.kind==='text'?<Fragment key={index}>{segment.text}</Fragment>:<Formula key={index} latex={segment.text} display={segment.display}/>)}</>;
}
