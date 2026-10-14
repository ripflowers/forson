import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {MathText,splitMathText} from './MathText';
import {Formula} from './Formula';

describe('题面公式的精细分段与安全显示',()=>{
  it('真实第24题讲义的裸下标准确显示完整序号与递推关系',()=>{
    expect(splitMathText('求 a_2027 的值，并从四个选项中选出正确答案')).toEqual([
      {kind:'text',text:'求 '},
      {kind:'math',text:'a_{2027}',display:false},
      {kind:'text',text:' 的值，并从四个选项中选出正确答案'},
    ]);
    expect(splitMathText('从 a_1=0 开始，递推式为 a_n=-|a_{n-1}+(n-1)|。')).toEqual([
      {kind:'text',text:'从 '},
      {kind:'math',text:'a_1=0',display:false},
      {kind:'text',text:' 开始，递推式为 '},
      {kind:'math',text:'a_n=-|a_{n-1}+(n-1)|',display:false},
      {kind:'text',text:'。'},
    ]);
    const html=renderToStaticMarkup(<MathText text="要求的是 a_2027"/>);
    expect(html).toContain('<msub><mi>a</mi><mn>2027</mn></msub>');
    expect(html).not.toContain('katex-error');
  });
  it('保守支持单字母变量的幂，不猜普通词、文件路径与未闭合表达',()=>{
    expect(splitMathText('面积 x^2，负幂 x^{-2}')).toEqual([
      {kind:'text',text:'面积 '},
      {kind:'math',text:'x^2',display:false},
      {kind:'text',text:'，负幂 '},
      {kind:'math',text:'x^{-2}',display:false},
    ]);
    for(const raw of ['snake_case','file_name.txt','docs/a_1.txt','/tmp/a_2027','a_1/a_2','C:\\a_2027','价格$20和$30','a_{n-1','a_','x^-2','x^+2','a_2027+','a_2027)']){
      expect(splitMathText(raw)).toEqual([{kind:'text',text:raw}]);
    }
  });
  it('完整显示第26题的数列、省略号和八个公式片段',()=>{
    const stem='数学文化 三角形数 古希腊的毕达哥拉斯学派认为：$1,3,6,10,15,21,\\cdots$ 这些数量的石子都可以排成三角形(如图)，像这样的数称为三角形数，其中，$1$ 称为第 $1$ 个三角形数，$3$ 称为第 $2$ 个三角形数，$\\cdots$，依此类推，那么，第 $24$ 个三角形数与第 $22$ 个三角形数的差为（ ）';
    expect(splitMathText(stem).filter(segment=>segment.kind==='math')).toHaveLength(8);
    const html=renderToStaticMarkup(<MathText text={stem}/>);
    expect(html).toContain('1,3,6,10,15,21,');
    expect(html).toContain('⋯');
    expect(html).not.toContain('katex-error');
    expect(html).not.toContain('$');
  });
  it('未闭合美元符号不阻断后面的括号公式和独立公式',()=>{
    expect(splitMathText('保留 $x 未闭合，接着 \\(y=2\\) 和 $$z=3$$')).toEqual([
      {kind:'text',text:'保留 $x 未闭合，接着 '},
      {kind:'math',text:'y=2',display:false},
      {kind:'text',text:' 和 '},
      {kind:'math',text:'z=3',display:true},
    ]);
  });
  it('价格不吃掉其后的合法公式，也不跨段落寻找闭合',()=>{
    expect(splitMathText('价格$20和$30，公式 $x=3$')).toEqual([
      {kind:'text',text:'价格$20和$30，公式 '},
      {kind:'math',text:'x=3',display:false},
    ]);
    expect(splitMathText('成本 $20，公式 $x=3$')).toEqual([
      {kind:'text',text:'成本 $20，公式 '},
      {kind:'math',text:'x=3',display:false},
    ]);
    expect(splitMathText('费用 $20\n另一行 $30')).toEqual([{kind:'text',text:'费用 $20\n另一行 $30'}]);
  });
  it('允许独立公式换行、中文文本命令，并区分转义标记',()=>{
    expect(splitMathText('\\$20 与 \\(1\\text{元}=100\\text{分}\\) 和 $$\nx=2\n$$')).toEqual([
      {kind:'text',text:'\\$20 与 '},
      {kind:'math',text:'1\\text{元}=100\\text{分}',display:false},
      {kind:'text',text:' 和 '},
      {kind:'math',text:'\nx=2\n',display:true},
    ]);
    expect(splitMathText('$2ab+3$ 与 $\\text{价格}=\\$20$')).toEqual([
      {kind:'math',text:'2ab+3',display:false},
      {kind:'text',text:' 与 '},
      {kind:'math',text:'\\text{价格}=\\$20',display:false},
    ]);
  });
  it('坏公式明确要求校对，保留原始内容而不静默替换',()=>{
    const html=renderToStaticMarkup(<MathText text={'公式 $\\frac{1$，继续 $x=2$'}/>);
    expect(html).toContain('公式需校对');
    expect(html).toContain('\\frac{1');
    expect(html).toContain('katex-error');
    expect(html).toContain('x=2');
  });
  it('公式外层支持容器内横向滚动，不让长公式撑开页面',()=>{
    const inline=renderToStaticMarkup(<Formula latex={'x_1+x_2+\\cdots+x_{200}=20100'}/>);
    const block=renderToStaticMarkup(<Formula latex={'\\frac{n(n+1)}2'} display/>);
    for(const html of [inline,block]){
      expect(html).toContain('max-width:100%');
      expect(html).toContain('overflow-x:auto');
    }
    expect(inline).toContain('display:inline-block');
    expect(block).toContain('display:block');
  });
  it('拒绝HTML、链接和图片扩展命令并显示可校对源码',()=>{
    for(const latex of ['\\href{javascript:alert(1)}{x}','\\htmlStyle{color:red}{x}','\\includegraphics{x.png}']){
      const html=renderToStaticMarkup(<Formula latex={latex}/>);
      expect(html).toContain('公式需校对');
      expect(html).not.toMatch(/<(?:a|img)\b/);
      expect(html).not.toContain('style="color:red"');
    }
  });
});
