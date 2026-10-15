import catalogData from './catalog.json';
import type {MotionPack} from '../motion-resources';

export type Control={key:string;label:string;min:number;max:number;step:number;value:number;options?:string[]};
export type Recipe={number:number;partId:string;title:string;action:string;labels:string[];controls:Control[];states:Record<string,number>[];task:string;choices:string[];correct:number;feedback:string[];key:string;target:MotionPack['target'];stageCount:number};
export const paperCatalog=catalogData as unknown as Recipe[];
export function paperRecipe(pack?:MotionPack|null){
  if(!pack)return null;
  return paperCatalog.find(recipe=>recipe.target.lessonHash===pack.target.lessonHash&&recipe.target.questionId===pack.target.questionId&&recipe.target.questionRevision===pack.target.questionRevision&&recipe.target.lessonVersion===pack.target.lessonVersion&&recipe.partId===pack.target.partId&&pack.stages.length===recipe.stageCount&&pack.stages.every((stage,index)=>stage.template===recipe.key&&stage.stageIndex===index))??null;
}
export type Inputs=Record<string,number>;
export function paperInputs(recipe:Recipe,state:Record<string,unknown>={}):Inputs{
  return Object.fromEntries(recipe.controls.map(control=>{
    const input=state[control.key],raw=typeof input==='number'&&Number.isFinite(input)?input:control.value;
    return[control.key,Number(Math.max(control.min,Math.min(control.max,control.min+Math.round((raw-control.min)/control.step)*control.step)).toFixed(4))];
  }));
}
export function teacherInputs(recipe:Recipe,stage:number,seconds:number,reduced=false):Inputs{
  const index=Math.max(0,Math.min(recipe.stageCount-1,stage));
  const previous=paperInputs(recipe,Object.assign({},...recipe.states.slice(0,Math.max(1,index))));
  const next=paperInputs(recipe,Object.assign({},...recipe.states.slice(0,index+1)));
  const t=reduced?1:Math.max(0,Math.min(1,(seconds-.4)/2)),smooth=t*t*(3-2*t);
  return Object.fromEntries(recipe.controls.map(c=>[c.key,c.options||c.step===1||(c.key==='a'&&[13,16,19].includes(recipe.number))?next[c.key]:Number((previous[c.key]+(next[c.key]-previous[c.key])*smooth).toFixed(4))]));
}
export const num=(value:number)=>String(Number(value.toFixed(3))).replace('-','−');
export type Tone='teal'|'orange'|'muted'|'red';
export type Mark={value:number;label:string;tone?:Tone;lane?:number};
export type Span={from:number;to:number;label:string;tone?:Tone;lane?:number};
export type Axis={kind:'axis';min:number;max:number;marks:Mark[];spans:Span[];ranges?:Span[]};
export type Tokens={kind:'tokens';rows:{label:string;items:{text:string;tone?:Tone;cancel?:boolean}[]}[]};
export type Graph={kind:'graph';min:number;max:number;curves:{label:string;points:[number,number][];tone:Tone}[];at:number;floor?:number;xLabel:string;yLabel:string;meaning:string;ends?:{x:number;y:number;open:boolean;tone:Tone}[]};
export type Diagram=Axis|Tokens|Graph|{kind:'units';positive:number;negative:number;cancel:boolean;unit:string}
  |{kind:'orbit';values:string[];active:number;rule:string}
  |{kind:'window';left:number;middle:number;count:number}
  |{kind:'halves';remaining:number;removed:number[]}
  |{kind:'shift';n:number;cancel:boolean}|{kind:'reciprocal';phase:number}|{kind:'sequence';values:number[];active:number};
export type PaperFrame={diagrams:Diagram[];values:{label:string;value:string;tone?:Tone}[];note:string;valid:boolean;facts:Record<string,unknown>};
const mark=(value:number,label:string,tone:Tone='teal',lane=0):Mark=>({value,label,tone,lane});
const span=(from:number,to:number,label:string,tone:Tone='teal',lane=0):Span=>({from,to,label,tone,lane});
const axis=(min:number,max:number,marks:Mark[],spans:Span[]=[],ranges:Span[]=[]):Axis=>({kind:'axis',min,max,marks,spans,ranges});
const token=(text:string,tone:Tone='teal',cancel=false)=>({text,tone,cancel});
const row=(label:string,...items:ReturnType<typeof token>[])=>({label,items});
const tokens=(...rows:Tokens['rows']):Tokens=>({kind:'tokens',rows});
const metric=(label:string,value:number|string,tone:Tone='teal')=>({label,value:typeof value==='number'?num(value):value,tone});
const sample=(fn:(x:number)=>number,min:number,max:number,knots:number[]=[]):[number,number][]=>[...new Set([...Array.from({length:121},(_,i)=>min+(max-min)*i/120),...knots.filter(x=>x>=min&&x<=max)])].sort((a,b)=>a-b).map(x=>[x,fn(x)]);
export const reflectedTerm=(k:number)=>k%2===0?k-2:k+1;
export const associatedPoint=(t:number)=>t<=7?t+1:6;
export const weightedDistance=(a:number,x:number)=>Math.abs(x+1)+2*Math.abs(x-a)+Math.abs(x-6);
export function weightedMinimum(a:number){return{value:Math.abs(a+1)+Math.abs(a-6),lo:Math.min(a,Math.max(-1,Math.min(6,a))),hi:Math.max(a,Math.max(-1,Math.min(6,a)))};}
export function recurrenceValue(n:number){let value=0;for(let i=1;i<n;i++)value=-Math.abs(value+i);return value;}
export const harryValues=[3,-2,.5,4/3];
export function powerDifference(n:number){return (2n**BigInt(n+1)-1n)-2n**BigInt(n+1);}

// The cases encode different mathematical mechanisms. No generated code or expression eval.
export function paperFrame(recipe:Recipe,input:Inputs,stage=recipe.stageCount-1):PaperFrame{
  const v=input,k=`${recipe.number}.${recipe.partId}`,late=stage>=4;
  let diagrams:Diagram[]=[],values:PaperFrame['values']=[],note=recipe.action,valid=true,facts:Record<string,unknown>={};
  switch(k){
    case'1.main':{
      const {a,b}=v;diagrams=[axis(-2.3,1.3,[mark(a,'a'),mark(b,'b','orange')],[span(a,0,`|a|=${num(-a)}`),span(0,b,`|b|=${num(b)}`,'orange',1)],[span(-2,-1,'−2<a<−1'),span(0,1,'0<b<1','orange')])];
      values=[metric('a+b',a+b),metric('a−b',a-b),metric('|a| 与 |b|',`${num(-a)} > ${num(b)}`)];note='点的位置受开区间限制。图中的数值是示例；|a|>1>|b| 才是适用于所有位置的理由。';facts={a,b,sum:a+b,difference:a-b};break;}
    case'2.main':{
      const origin=[-1,.7,2.3,4][v.origin],a=-origin,b=3-origin;
      diagrams=[axis(-5.5,5.5,[mark(-1-origin,'A','muted',1),mark(a,'a'),mark(.7-origin,'B','muted',1),mark(2.3-origin,'C','muted',1),mark(b,'b','orange'),mark(4-origin,'D','muted',1)],[span(a,0,`|a|=${num(Math.abs(a))}`),span(b,0,`|b|=${num(Math.abs(b))}`,'orange',1)])];
      valid=a*b<0&&a+b<0;values=[metric('ab 的符号',a*b<0?'负':'正',a*b<0?'teal':'red'),metric('a+b 的符号',a+b<0?'负':'正',a+b<0?'teal':'red'),metric('同时满足',valid?'是':'否',valid?'teal':'red')];note='长度为符合原图相对远近的示意值，不能当作题目给定坐标。筛选依据是方向与距离的大小关系。';facts={a,b,origin:recipe.controls[0].options![v.origin],valid};break;}
    case'3.main':{
      const b=v.b,a=1-b;diagrams=[axis(-2,3,[mark(a,'a'),mark(.5,'中点 1/2','muted',1),mark(b,'b','orange')],[span(a,.5,'两侧等长'),span(.5,b,'两侧等长','orange',1)])];
      values=[metric('a+b',1),metric('a',a),metric('b+1',b+1)];note='a、b 关于 1/2 对称。a 可能正、零或负；较大的 b 永远大于 1/2。';facts={a,b,sum:1,positive:b+1};break;}
    case'4.main':{
      const c=v.c,d=(5+c)/2;diagrams=[axis(-5.8,5.8,[mark(-5,'A','muted'),mark(c,'C'),mark(d,'D','orange',1),mark(5,'B')],[span(c,d,`DC=${num(d-c)}`),span(d,5,`DB=${num(5-d)}`,'orange',1)])];values=[metric('D 的位置',d),metric('DC',d-c),metric('DB',5-d)];note='B 固定为 5，C 在 (−5,0) 中变化。D 是中点，所以 0<d<2.5，必在 O 与 B 之间。';facts={c,d,DC:d-c,DB:5-d};break;}
    case'5.main':{
      const i=v.k,a=reflectedTerm(i),b=reflectedTerm(i+1);diagrams=[axis(-3,11,[mark(a,`A_${i}`),mark(i,`中心 ${i}`,'muted',1),mark(b,`A_${i+1}`,'orange')],[span(a,i,'折叠前'),span(i,b,'折叠后','orange',1)]),tokens(row('偶数项',...[0,2,4,6].map(n=>token(`A_${n}=${reflectedTerm(n)}`))),row('奇数项',...[1,3,5,7].map(n=>token(`A_${n}=${reflectedTerm(n)}`,'orange'))))];values=[metric('本次反射',`${a}+${b}=2×${i}`),metric('两点到中心',Math.abs(a-i))];note='表格帮助发现规律；课堂中的两步递推证明，才允许把规律用于第 2027 项。';facts={k:i,previous:a,next:b,center:i};break;}
    case'6.main':{
      const a=v.branch===0?3:-3,b=a-2;diagrams=[axis(-6,4,[mark(a,'A'),mark(b,'B','orange')],[span(a,b,'向左 2','orange')]),tokens(row('分支一',token('A=3'),token('→ 左移 2','muted'),token('B=1','orange')),row('分支二',token('A=−3'),token('→ 左移 2','muted'),token('B=−5','orange')))];values=[metric('到原点距离',Math.abs(a)),metric('本分支 B',b)];note='左移意味着坐标减 2，和 A 在原点哪一侧无关。两个分支都满足原题，须一起保留。';facts={a,b,answers:[-5,1]};break;}
    case'7.main':{
      const x=v.x,square=x*x,cube=x*x*x;valid=x<cube&&cube<square;
      diagrams=[axis(-9,9,[mark(x,'x','teal'),mark(cube,'x³','orange',1),mark(square,'x²','muted',2)],[],[span(-1,0,'解区间 (−1,0)')])];values=[metric('x < x³',`${num(x)} < ${num(cube)}：${x<cube?'成立':'不成立'}`,x<cube?'teal':'red'),metric('x³ < x²',`${num(cube)} < ${num(square)}：${cube<square?'成立':'不成立'}`,cube<square?'teal':'red')];note='必须两条都成立。端点 −1 和 0 会出现相等；不能因为图上点挨得近就把严格不等号忽略。';facts={x,square,cube,valid};break;}
    case'8.1':{
      const b=v.b,a=-1,p=b>=0?a+2:a-Math.abs(b);diagrams=[axis(-7,3,[mark(a,'A'),mark(p,'P','orange',1)],[span(a,p,b>=0?'向右 2':`向左 |b|=${num(-b)}`,'orange')]),tokens(row('当前分支',token(b>=0?'b≥0':'b<0'),token('→','muted'),token(b>=0?'P=A+2':'P=A−|b|','orange')))];values=[metric('b',b),metric('P',p)];note=b===4?'原题 b=4，P=−1+2=1。':'这是改变 b 后的对照实验；原题仍为 b=4。b=0 归入非负分支。';facts={a,b,p,original:b===4};break;}
    case'8.2.1':{
      const t=v.t,b=7-t;diagrams=[axis(-4,8,[mark(7,'起点','muted'),mark(b,'B','orange',1)],[span(7,b,`向左 ${num(t)} 个单位`,'orange')])];values=[metric('时间 t',t),metric('路程 1×t',t),metric('位置 7−t',b)];note='坐标是位置，移动的路程是长度，不能混为一谈。原题时刻为 t=3。';facts={t,b};break;}
    case'8.2.2':{
      const t=v.t,a=t-1,b=7-t,p=associatedPoint(t);diagrams=[axis(-4,11,[mark(a,'A'),mark(b,'B','muted',1),mark(p,'P','orange',2)],[span(a,p,t<=7?'右移 2':`左移 ${num(Math.abs(b))}`,'orange')]),{kind:'graph',min:0,max:10,xLabel:'时间 t',yLabel:'P 的坐标',meaning:'t=7 的实心点属于前一段；后段在 t=7 处为空心点。两段不能相连。',ends:[{x:7,y:8,open:false,tone:'teal'},{x:7,y:6,open:true,tone:'orange'}],curves:[{label:'0≤t≤7：P=t+1',tone:'teal',points:sample(x=>x+1,0,7)},{label:'t>7：P=6',tone:'orange',points:sample(()=>6,7.01,10)}],at:t}];values=[metric('t',t),metric('B=7−t',b),metric('P',p),metric('所属分支',t<=7?'b≥0':'b<0')];note='图的横轴是时间 t。恰好 t=7 时 P=8；刚过 7 秒 P=6，两段不相连。两段内 P 都为正，所以不会与原点重合。';facts={t,a,b,p,branch:t<=7?'nonnegative':'negative'};break;}
    case'9.main':{
      const a=v.a,b=-1,c=1-a;diagrams=[axis(-2.2,2.2,[mark(b,'b'),mark(c,'c','orange',1),mark(a,'a','teal',2)],[span(b,0,`−b=1`),span(0,Math.abs(c),`|c|=${num(Math.abs(c))}`,'orange',1)]),tokens(row('保持和为零',token(num(a)),token('−1','muted'),token(num(c),'orange'),token('=0')))];values=[metric('a>0','成立'),metric('b<0','成立'),metric('c',c,c===0?'orange':'teal')];note='固定 b=−1 是观察用的小例。a=1 时 c=0 仍合法，说明结论必须保留 c≤0 中的等号。';facts={a,b,c,sum:a+b+c};break;}
    case'10.main':{
      const a=-1,b=-3,c=2;diagrams=v.case===0?[axis(-4,4,[mark(b,'b'),mark(-c,'−c','orange',1),mark(-a,'−a','teal')])]:v.case===1?[tokens(row('同号乘积',token('a<0'),token('b<0'),token('ab>0','orange'),token('ab/|ab|=1')),row('异号乘积',token('a<0'),token('c>0'),token('ac<0','orange'),token('ac/|ac|=−1')),row('两项相减',token('1'),token('− (−1)','orange'),token('=2')))]:[axis(-5,1,[mark(a,'a'),mark(b,'b','orange',1),mark(a+b,'a+b','muted')],[span(0,a,'先向左 1'),span(a,a+b,'再向左 3','orange',1)])];values=[metric('①', '不成立','red'),metric('②','不成立','red'),metric('③','成立')];note='示例取 a=−1、b=−3、c=2，满足全部顺序与距离条件；一般性理由在本步板书中。';facts={a,b,c,case:v.case,signQuotientDifference:2};break;}
    case'12.main':{
      const o=v.origin,a=v.u-o,b=2+v.v-o,sum=Math.abs(a)+Math.abs(b);diagrams=[axis(-3.5,3.5,[...['M','N','P','R'].map((label,i)=>mark(i-o,label,'muted',1)),mark(a,'a'),mark(b,'b','orange')],[span(a,0,`|a|=${num(Math.abs(a))}`),span(b,0,`|b|=${num(Math.abs(b))}`,'orange',1)])];values=[metric('原点',recipe.controls[0].options![o]),metric('当前距离和',sum),metric('该原点的全部可能范围',o===0||o===3?'(2,4)，可取 3':'(1,3)，不能取 3',o===0||o===3?'teal':'red')];note='示例点不满足等式，不代表整个原点方案不可能。排除 N、P 要看完整的开区间上界；M、R 可用和为 3 的例子证明存在。';facts={origin:o,a,b,sum,possible:o===0||o===3};break;}
    case'13.main':{
      const a=v.a,lhs=Math.abs(2*a+1),rhs=3*Math.abs(a)-2;diagrams=[{kind:'graph',min:-3,max:4,xLabel:'参数 a',yLabel:'表达式的值',meaning:'在同一条竖线上，两点高度相同表示等式成立。交点的位置就是候选解。',curves:[{label:'|2a+1|',tone:'teal',points:sample(x=>Math.abs(2*x+1),-3,4,[-.5])},{label:'3|a|−2',tone:'orange',points:sample(x=>3*Math.abs(x)-2,-3,4,[0])}],at:a,floor:0}];values=[metric('a',a),metric('左边',lhs),metric('右边',rhs,rhs<0?'red':'orange'),metric('是否相等',Math.abs(lhs-rhs)<1e-8?'是':'否')];note='折线交点帮助看见两个根。右边小于 0 时必无解；每个允许的区间都是一次方程，因此分类能找到全部解。';facts={a,lhs,rhs,solution:Math.abs(lhs-rhs)<1e-8};break;}
    case'14.main':{
      const b=v.branch===0?0:6;diagrams=[tokens(row('第一式的下界',token('(a+2)²≥0'),token('→','muted'),token('|b−3|≥3')),row('第二式的上界',token('(c−1)²≥0'),token('→','muted'),token('|b−3|≤3','orange')),row('两个界相遇',token('|b−3|=3'),token('a=−2'),token('c=1'))),axis(-1,7,[mark(3,'中心 3','muted'),mark(b,'b','orange',1)],[span(b,3,'距离为 3','orange')])];values=[metric('a',-2),metric('b',b),metric('c',1),metric('ac+2bc',-2+2*b)];note='原题要求 ac+2bc；两种 b 都要代入，分别得到 −2 与 10。两个平方为零才同时满足原等式。';facts={a:-2,b,c:1,target:-2+2*b};break;}
    case'15.main':{
      const signs=[1,1,1];signs[v.negative]=-1;const terms=[signs[0],2*signs[1],-3*signs[2]],x=terms.reduce((a,b)=>a+b,0);diagrams=[tokens(row('非零数的符号',...['a','b','c'].map((s,i)=>token(`${s}${signs[i]>0?'>':'<'}0`,i===v.negative?'orange':'teal'))),row('保留系数 1、2、−3',...terms.map(t=>token(num(t),t<0?'orange':'teal')),token(`=${x}`))),tokens(row('三个分支的结果',token('a<0 → −2'),token('b<0 → −4','orange'),token('c<0 → 6')))];values=[metric('当前 x',x),metric('最小值',-4),metric('最大值',6)];note='只有一个负数；分母均非零，所以 |a|/a 等于 ±1。系数 −3 本身的负号不能丢。';facts={negative:v.negative,terms,x,product:-24};break;}
    case'16.main':{
      const {a,x}=v,m=weightedMinimum(a),f=weightedDistance(a,x);diagrams=[axis(-4,9,[mark(-1,'−1','muted'),mark(a,'a（双份）','orange',1),mark(6,'6','muted'),mark(x,'P','teal',2)],[span(x,-1,'1 份距离'),span(x,a,'2 份距离','orange',1),span(x,6,'1 份距离','teal',2)]),{kind:'graph',min:-4,max:9,xLabel:'点的位置 x',yLabel:'距离总和',meaning:'最低处的高度就是最小值；最低处覆盖的一段横坐标，就是全部取得位置。',curves:[{label:'四份距离之和',tone:'teal',points:sample(p=>weightedDistance(a,p),-4,9,[-1,a,6])}],at:x,floor:m.value}];values=[metric('当前 f(x)',f),metric('当前 a 的最小值',m.value),metric('取得最小值的 x',m.lo===m.hi?num(m.lo):`[${num(m.lo)}, ${num(m.hi)}]`)];note='图中水平虚线表示当前参数下的最小值。最低处可能是一段平台；原题问使最低值等于 8 的 a，不是只解 f(x)=8。';facts={a,x,value:f,minimum:m.value,interval:[m.lo,m.hi]};break;}
    case'17.1':{
      const {b,c}=v;diagrams=[axis(-3.5,3.5,[mark(b,'b'),mark(b-1,'b−1','teal',1),mark(c,'c','orange'),mark(-c,'−c','orange',1)],[span(b,b-1,'左移 1'),span(c,-c,'关于 0 对称','orange',1)],[span(-1,0,'(−1,0)'),span(-3,-2,'(−3,−2)','orange')])];values=[metric('b−1',b-1),metric('−c',-c),metric('大小关系','b−1 > −c')];note='区间全部分开，即使点在区间内变化，大小关系也不变。';facts={b,c,difference:b-1+c};break;}
    case'17.2':{
      const {a,b,c}=v;diagrams=[axis(-5.5,4.5,[mark(a-c,'a−c'),mark(b+c,'b+c','orange',1),mark(b-1,'b−1','teal',2)])];values=[metric('a−c',`${num(a-c)} < 0`),metric('b+c',`${num(b+c)} > 0`),metric('b−1',`${num(b-1)} < 0`)];note='给内部整体定号，不能只看到字母前有负号就认定整个式子为负。';facts={a,b,c,ac:a-c,bc:b+c,b1:b-1};break;}
    case'17.3':{
      const {a,b,c}=v,lhs=Math.abs(a-c)-Math.abs(b+c)+Math.abs(b-1),rhs=1-a-2*b;diagrams=[tokens(row('去绝对值',token('c−a'),token('−(b+c)','orange'),token('+(1−b)')),row('去括号',token('+c','muted',late),token('−a'),token('−b','orange'),token('−c','muted',late),token('+1'),token('−b','orange')),row('合并之后',token('1−a−2b')))];values=[metric('原式数值',lhs),metric('化简式数值',rhs),metric('当前 c',c)];note='两个 c 项抵消。括号外的减号必须同时分配给 b 和 c；两个 −b 合并为 −2b。';facts={a,b,c,lhs,rhs};break;}
    case'18.1':{
      const pairs=[[-2,1],[1,3],[-2,3]],[a,b]=pairs[v.pair];diagrams=[axis(-3,4,[-2,1,3].map(x=>mark(x,String(x))),[span(a,b,`距离 ${b-a}`,'orange')])];values=[metric('选中点对距离',b-a),metric('全部点对中的最大值',5)];note='距离系数取最大值，不是求和，也不是数点的个数。';facts={pair:[a,b],distance:b-a,maximum:5};break;}
    case'18.2':{
      const x=v.x,lo=Math.min(1,2,x),hi=Math.max(1,2,x);valid=x!==1&&x!==2;diagrams=[axis(-4,7,[mark(1,'1'),mark(2,'2'),mark(x,'x','orange',1)],[span(lo,hi,`跨度 ${hi-lo}`,'orange')])];values=[metric('整数 x',x),metric('跨度',hi-lo),metric('元素互不相同',valid?'是':'否，重复了',valid?'teal':'red')];note=!valid?'当前位置仅用于看清排除条件；重复元素不属于题目允许的数组。':'还需让跨度恰好等于 3；左右两侧都要检查。';facts={x,span:hi-lo,distinct:valid,solution:valid&&hi-lo===3};break;}
    case'18.3':{
      const l=v.left,m=l+v.middle;diagrams=[axis(0,11,[mark(l,'最小'),mark(m,'中间','orange',1),mark(l+5,'最大')],[span(l,l+5,'固定跨度 5')]),{kind:'window',left:l,middle:v.middle,count:20}];values=[metric('当前一组',`{${l}, ${m}, ${l+5}}`),metric('这一行有',4),metric('全部行合计','5×4=20')];note='每格唯一确定一个最小数和一个中间数。第三个数已由跨度确定，因此不会重复计数。';facts={left:l,middle:m,right:l+5,count:20};break;}
    case'18.4':{
      const m=v.m,n=Math.min(v.n,m),selected=[1,...Array.from({length:n-2},(_,i)=>i+2),m];diagrams=[axis(0,11,Array.from({length:m},(_,i)=>mark(i+1,String(i+1),selected.includes(i+1)?'teal':'muted',i%2)),[span(1,m,`${m} 个点，${m-1} 个间隔`,'orange')])];values=[metric('实际选择个数',n),metric('当前选择',selected.join('、')),metric('最大跨度',m-1)];note='只要包含两个端点，内部再补任何 n−2 个数都不会改变跨度；选数个数须满足 2≤n≤m。';facts={m,n,selected,maximum:m-1};break;}
    case'19.1':case'19.2.1':case'19.2.2':case'19.2.3':{
      const parameter=k==='19.2.3',left=parameter?-v.a:k==='19.1'?-1:-2,right=parameter?3:k==='19.1'?2:4,x=v.x;
      const lo=Math.min(left,right),hi=Math.max(left,right),first=Math.abs(x-left),second=Math.abs(x-right),minimum=hi-lo,extra=Math.max(lo-x,0,x-hi);
      diagrams=[axis(-6,8,[mark(left,parameter?'−a':'A'),mark(right,'B','orange',1),mark(x,'P','teal',2)],[span(x,left,`PA=${num(first)}`),span(x,right,`PB=${num(second)}`,'orange',1)],[span(lo,hi,'最小值取得区间')])];
      values=[metric('PA+PB',first+second),metric('最小值 AB',minimum),metric('额外折返',`2×${num(extra)}=${num(2*extra)}`)];
      note=parameter?'参数 a 决定固定点 −a 的位置；移动 P 可以找最小值，移动 a 才会改变这个最小值。':k==='19.2.2'?'目标总长为 8。中间只能为 6；左右外侧各多走 1，都会达到 8。':'P 在闭区间内时，两段距离恰好拼成 AB；在外侧多出的路程会走两次。';facts={x,a:parameter?v.a:undefined,left,right,first,second,sum:first+second,minimum,extra};break;}
    case'20.main':{
      const paths=[['13 + 5/7','39/16 + 15/112','通分到 112'],['14 − 2/7','21/8 − 3/56','通分到 56'],['10 + 26/7','15/8 + 39/56','通分到 56'],['16 − 16/7','3 − 3/7','两项都直接约去 16']],p=paths[v.path];diagrams=[tokens(row('拆成相等的数',token(p[0]),token('× 3/16','orange')),row('分配后',token(p[1])),row('需要的动作',token(p[2],'orange')))];values=[metric('所选路径',String.fromCharCode(65+v.path)),metric('所有路径的结果','18/7')];note='四条路径都正确；“简便”要看能否用因数关系减少通分与运算，而不是排斥等价拆分。';facts={path:v.path,result:'18/7'};break;}
    case'21.main':{
      diagrams=[tokens(row('每项都乘 12',token('1/6 × 12'),token('1/4 × 12'),token('−1/2 × 12','orange'))),{kind:'units',positive:5,negative:6,cancel:v.phase===2,unit:'1'}];values=[metric('正单位','2+3=5'),metric('负单位',6,'orange'),metric('合计',-1)];note='每一格表示 1 个单位。正负各取一格成对抵消，最后剩下一个负单位。';facts={phase:v.phase,positive:5,negative:6,result:-1};break;}
    case'22.main':{
      diagrams=[tokens(row('整数轨道',token('−2026','orange',v.phase>=1),token('+2025','teal',v.phase>=1),token('−2024','orange',v.phase>=1),token('+2023','teal',v.phase>=1)),row(v.phase>=2?'分数轨道 · 分母 84':'分数轨道',...(v.phase>=2?['−56/84','+63/84','−70/84','+12/84']:['−2/3','+3/4','−5/6','+1/7']).map((x,i)=>token(x,i%2===0?'orange':'teal'))),...(v.phase>=1?[row('整数配对后',token('−1'),token('−1'),token('=−2'))]:[]))];values=v.phase>=2?[metric('整数部分',-2),metric('分数部分','−17/28'),metric('合并','−73/28')]:[metric('先保留符号','负号属于两部分')];note='带分数的负号作用于整个数，拆开后整数和分数都为负。抵消后余下的 −1、−1 仍要保留。';facts={phase:v.phase,integer:-2,fraction:'-17/28',result:'-73/28'};break;}
    case'23.1':{
      diagrams=[tokens(row('共同因数',token('25','orange'),token('× (3/4 − 1/2 − 1/4)'))),{kind:'units',positive:3,negative:3,cancel:v.phase>=2,unit:'1/4'}];values=[metric('正份数',3),metric('负份数','2+1=3','orange'),metric('括号内',0)];note='每个小块代表 1/4；提取 25 之后，正三块与负三块完全抵消，外面的 25 乘 0 仍是 0。';facts={phase:v.phase,positive:3,negative:3,result:0};break;}
    case'23.2':{
      diagrams=[{kind:'reciprocal',phase:v.phase}];values=[metric('结果符号','负'),...(v.phase===2?[metric('结果','−699.9')]:[])];note='不能把整个被除数也翻转。只有除数取倒数；约分后剩下的分子是 6999，分母是 10。';facts={phase:v.phase,result:'-6999/10'};break;}
    case'24.main':{
      const n=v.n,value=recurrenceValue(n);diagrams=[{kind:'sequence',values:Array.from({length:10},(_,i)=>recurrenceValue(i+1)),active:n},tokens(row('本次递推',token(n===1?'a₁=0':`−|${recurrenceValue(n-1)}+${n-1}|`),token(`=${num(value)}`,'orange')))];values=[metric('项数 n',n),metric('所在组 ⌊n/2⌋',Math.floor(n/2)),metric('项的值',value)];note='从第 2 项开始，每个偶数项与后一奇数项配对。观察表不能代替证明，课堂还会说明下一组为什么继续成立。';facts={n,value,group:Math.floor(n/2)};break;}
    case'25.main':{
      const n=v.n,active=(n-1)%4;diagrams=[{kind:'orbit',values:['3','−2','1/2','4/3'],active,rule:String.raw`$\text{下一项}=\frac{2}{2-\text{当前项}}$`}];values=[metric('项数',n),metric('除以 4 的余数',n%4),metric('环上的第几位',active+1),metric('当前值',['3','−2','1/2','4/3'][active])];note='第 5 项回到第 1 项，且下一项只由当前项决定，才得到周期 4。余数 0 对应环的第 4 位。';facts={n,active,value:harryValues[active]};break;}
    case'27.1':{
      const k=v.k,remaining=2**(7-k),removed=Array.from({length:k},(_,i)=>2**(6-i));diagrams=[{kind:'halves',remaining,removed}];values=[metric('已减去的项数',k),metric('剩余',remaining),metric('守恒核对',`${removed.reduce((a,b)=>a+b,0)}+${remaining}=128`)];note='橙色块是已经减去的部分，绿色块是余下的部分。只按原式减到 2，最后还留着 2。';facts={k,remaining,removed};break;}
    case'27.2':{
      const n=v.n;diagrams=[{kind:'shift',n,cancel:stage>=4}];values=[metric('示例最高指数',n),metric('示例 S',2**(n+1)-1),metric('S 减去下一次幂',-1)];note='小指数示例用于看清每一列的抵消。原题最高指数为 2029，同样只剩 2²⁰³⁰−1，最终再减 2²⁰³⁰ 得 −1。';facts={n,sum:String(2n**BigInt(n+1)-1n),difference:powerDifference(n).toString(),originalExponent:2029};break;}
    default:throw new Error(`Missing authored model: ${k}`);
  }
  return{diagrams,values,note,valid,facts};
}
export function paperSnapshot(recipe:Recipe,input:Inputs,stage:number){const state=paperFrame(recipe,input,stage);return{paperResource:recipe.key,paperInputs:input,paperFacts:state.facts,paperStage:stage,cue:recipe.labels[stage],observationNotProof:true};}
