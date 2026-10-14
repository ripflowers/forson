import katex from 'katex';
export function Formula({latex,display=false}:{latex:string;display?:boolean}){
  let html='';
  try{
    if(latex.length>8192||/\\(?:href|url|includegraphics|html[A-Za-z]*)\b/.test(latex))throw new Error('Unsupported formula extension');
    html=katex.renderToString(latex,{throwOnError:true,displayMode:display,trust:false,strict:'ignore',maxExpand:200,maxSize:10});
  }catch{
    return <span className="formula-fallback katex-error" title="请对照原题校对公式，原始内容已保留。"><span>公式需校对：</span><code>{latex}</code></span>;
  }
  return <span className={display?'formula block':'formula'} style={{display:display?'block':'inline-block',maxWidth:'100%',overflowX:'auto',overflowY:'hidden',verticalAlign:'middle'}} dangerouslySetInnerHTML={{__html:html}}/>;
}
