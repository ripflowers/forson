import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {MathText,splitMathText} from './MathText';
describe('显式数学标记的安全显示',()=>{
  it('混合正文和分数，只把显式数学段交给KaTeX',()=>{
    const value='把 $\\frac{1}{2}$ 读成二分之一。';
    expect(splitMathText(value)).toEqual([{kind:'text',text:'把 '},{kind:'math',text:'\\frac{1}{2}',display:false},{kind:'text',text:' 读成二分之一。'}]);
    expect(renderToStaticMarkup(<MathText text={value}/>)).toContain('class="mfrac"');
  });
  it('支持显式独立公式和反斜杠括号，不猜任意斜杠',()=>{
    expect(splitMathText('$$x+1$$')).toEqual([{kind:'math',text:'x+1',display:true}]);
    expect(splitMathText('\\(x+1\\) 和 \\[x=2\\]')).toEqual([{kind:'math',text:'x+1',display:false},{kind:'text',text:' 和 '},{kind:'math',text:'x=2',display:true}]);
    expect(splitMathText('路径 a/b，符号 \\unknown{1}{2}')).toEqual([{kind:'text',text:'路径 a/b，符号 \\unknown{1}{2}'}]);
  });
  it('不闭合标记保留原文，常见美元价格不当公式',()=>{
    expect(splitMathText('这里 $x+1 没有闭合')).toEqual([{kind:'text',text:'这里 $x+1 没有闭合'}]);
    expect(splitMathText('价格$20和$30')).toEqual([{kind:'text',text:'价格$20和$30'}]);
    expect(splitMathText('价格\\$20')).toEqual([{kind:'text',text:'价格\\$20'}]);
  });
  it('XSS样式纯文本通过React转义，不作为AI HTML执行',()=>{
    const html=renderToStaticMarkup(<MathText text={'<img src=x onerror="alert(1)"><script>alert(2)</script> $x$'}/>);
    expect(html).not.toContain('<img');expect(html).not.toContain('<script');expect(html).toContain('&lt;img');
  });
  it('非法LaTeX显示安全错误文本而不让整个课堂崩溃',()=>{
    expect(()=>renderToStaticMarkup(<MathText text={'公式 $\\frac{1$'}/>)).not.toThrow();
    expect(renderToStaticMarkup(<MathText text={'公式 $\\frac{1$'}/>)).toContain('katex-error');
  });
});
