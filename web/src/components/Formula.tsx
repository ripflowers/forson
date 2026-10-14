import katex from 'katex';
export function Formula({latex,display=false}:{latex:string;display?:boolean}){
  let html='';
  try{html=katex.renderToString(latex,{throwOnError:false,displayMode:display,trust:false,strict:'warn',maxExpand:200,maxSize:10});}catch{return <code className="formula-fallback">{latex}</code>;}
  return <span className={display?'formula block':'formula'} dangerouslySetInnerHTML={{__html:html}}/>;
}
