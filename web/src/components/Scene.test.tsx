import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {Scene,trianglePredictionFeedback} from './Scene';
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
describe('有任务的三角形数探索',()=>{
  const spec={kind:'triangle-count' as const,params:{lower:22,upper:24,previewRows:6}};
  it('先展示小点阵的操作任务，原题推演默认折叠',()=>{
    const html=renderToStaticMarkup(<Scene spec={spec} state={{}} onChange={()=>{}} onSave={()=>{}}/>);
    expect(html).toContain('从 4 行长到 6 行，多了多少颗？');
    expect(html).toContain('我的预测');
    expect(html).toContain('<details class="exploration-original">');
    expect(html).not.toContain('5+6=11');
    expect(html.match(/class="dot added"/g)?.length).toBe(12); // 11 new stones and the legend marker.
  });
  it('改变行数后，任务和点阵保持一致；两行的边界也有效',()=>{
    const html=renderToStaticMarkup(<Scene spec={spec} state={{rows:2}} onChange={()=>{}} onSave={()=>{}}/>);
    expect(html).toContain('从 0 行长到 2 行，多了多少颗？');
    expect(html).toContain('2层点阵，共3点');
    expect(html.match(/class="dot added"/g)?.length).toBe(4);
  });
  it('正确预测解释是哪两行，而不是只给对错',()=>{
    const feedback=trianglePredictionFeedback(6,'11');
    expect(feedback.kind).toBe('correct');
    expect(feedback.message).toContain('第 5 行添 5 颗');
    expect(feedback.message).toContain('第 6 行添 6 颗');
    expect(feedback.message).toContain('5 + 6 = 11');
  });
  it('把总数当新增数时，反馈指向共同部分和新增两行',()=>{
    const feedback=trianglePredictionFeedback(6,'21');
    expect(feedback.kind).toBe('retry');
    expect(feedback.message).toContain('灰色部分');
    expect(feedback.message).toContain('只数橙色的两行');
    expect(feedback.message).not.toContain('= 11');
  });
  it('每个可操作行数的新增数量都匹配逐行计数',()=>{
    for(let n=2;n<=8;n++)expect(trianglePredictionFeedback(n,String((n-1)+n)).kind).toBe('correct');
  });
  it('不将空值、分数或部分数字识别成有效预测',()=>{
    for(const input of ['', ' ', '1.1','11颗','1e1','-11'])expect(trianglePredictionFeedback(6,input).kind).toBe('invalid');
  });
  it('只读示范保留结果，但不会显示练习输入',()=>{
    const html=renderToStaticMarkup(<Scene spec={spec} state={{}} onChange={()=>{}} onSave={()=>{}} readOnly/>);
    expect(html).not.toContain('我的预测');
    expect(html).toContain('5+6=11');
    expect(html).toContain('<details class="exploration-original" open="">');
  });
});
describe('有任务的数轴探索',()=>{
  it('交互模式给出区间内外比较任务与端点入口',()=>{
    const html=renderToStaticMarkup(<Scene spec={{kind:'number-line',params:{left:-1,right:2}}} state={{x:-1}} onChange={()=>{}} onSave={()=>{}}/>);
    expect(html).toContain('把 P 移到两点之间，再移到外面');
    expect(html).toContain('移到 A');
    expect(html).toContain('移到 B');
    expect(html).toContain('端点也成立');
  });
  it('区间外反馈说明来回多出的两倍距离',()=>{
    const html=renderToStaticMarkup(<Scene spec={{kind:'number-line',params:{left:-1,right:2}}} state={{x:3}} onChange={()=>{}} onSave={()=>{}}/>);
    expect(html).toContain('去端点又折回来');
    expect(html).toContain('3+2×1=5');
  });
});
