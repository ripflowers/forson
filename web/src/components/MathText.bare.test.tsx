import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {MathText,splitMathText} from './MathText';
describe('真实讲义裸LaTeX的保守显示',()=>{
  it('第15题known的完整ASCII分数式安全显示为公式',()=>{
    const raw='x=\\frac{|b+c|}{a}+\\frac{2|a+c|}{b}-\\frac{3|a+b|}{c}';
    expect(splitMathText(raw)).toEqual([{kind:'math',text:raw,display:false}]);
    expect(renderToStaticMarkup(<MathText text={raw}/>)).toContain('class="mfrac"');
  });
  it('只拆中文叙述中的明确分数片段，叙述原样保留',()=>{
    const raw='设 s_a=\\frac{|a|}{a}，于是只取1或-1。';
    expect(splitMathText(raw)).toEqual([{kind:'text',text:'设 '},{kind:'math',text:'s_a=\\frac{|a|}{a}',display:false},{kind:'text',text:'，于是只取1或-1。'}]);
  });
  it('不猜裸a+b、普通英语、价格、HTML或转义文本',()=>{
    for(const raw of ['普通文字 a+b，并不猜它是公式。','Use \\frac{1}{2} as an example.','价格$20和$30','<img title="\\frac{1}{2}" src=x>','展示字面值 \\\\frac{1}{2}','C:\\frac{1}{2}'])expect(splitMathText(raw)).toEqual([{kind:'text',text:raw}]);
  });
  it('不完整、括号不平衡或未支持命令保持原文，显式标记仍优先',()=>{
    for(const raw of ['s_a=\\frac{|a|}{a','x=\\frac{1}','x=\\frac{}{a}','x=\\frac{1}{2}+','x=\\frac{1}{2})','\\href{https://example.com}{x}','未闭合 $\\frac{1}{2}'])expect(splitMathText(raw)).toEqual([{kind:'text',text:raw}]);
    expect(splitMathText('$a+b$')).toEqual([{kind:'math',text:'a+b',display:false}]);
  });
});
