import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {Scene} from './Scene';
const render=(params:Record<string,unknown>)=>renderToStaticMarkup(<Scene spec={{kind:'number-line',params}} state={{}} onChange={()=>{}} onSave={()=>{}} readOnly/>);
describe('第19题小问的原题最小值提示',()=>{
  it('(1)固定点-1与2的距离为3，不引用参数a',()=>{
    const html=render({left:-1,right:2,targetMinimum:3});
    expect(html).not.toContain('a+3');
    expect(html).toContain('两固定点距离');
    expect(html).toContain('|2−(-1)|=3');
  });
  it('(2)①固定点-2与4的距离为6，不引用参数a',()=>{
    const html=render({left:-2,right:4,targetMinimum:6});
    expect(html).not.toContain('a+3');
    expect(html).toContain('|4−(-2)|=6');
  });
  it('(2)③只有参数a场景说明最小值为|a+3|',()=>{
    const html=render({left:1,right:3,parameterName:'a',parameterValue:-1,targetMinimum:2});
    expect(html).toContain('|a+3|');
  });
});
