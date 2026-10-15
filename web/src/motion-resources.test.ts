import {describe,it,expect} from 'vitest';
import {currentMotionPack,revealedMotionStepCount,type MotionPack} from './motion-resources';
const pack={target:{questionId:'q26',questionRevision:4,lessonVersion:3,partId:'main'}} as MotionPack;
describe('课堂资源只绑定当前题面与小问',()=>{
  it('当前版本可以使用已导入包',()=>expect(currentMotionPack(pack,'q26',4,3,'main')).toBe(pack));
  it.each([
    ['other',4,3,'main'],['q26',5,3,'main'],['q26',4,4,'main'],['q26',4,3,'part2'],['q26',4,undefined,'main'],['q26',4,3,undefined],
  ] as const)('变更任何身份不沿用旧资源 %s/%s/%s/%s',(id,revision,version,part)=>expect(currentMotionPack(pack,id,revision,version,part)).toBeNull());
  it('没有导入资源时保持原课堂',()=>expect(currentMotionPack(null,'q26',4,3,'main')).toBeNull());
});

describe('公式只在动画推导完成后留下',()=>{
  it.each([[2,1.2],[3,2.8],[4,2.8],[5,1.8]])('阶段%s在%s秒前后保持前序公式',(stage,seconds)=>{
    expect(revealedMotionStepCount(stage,seconds*30-1,30)).toBe(stage-2);
    expect(revealedMotionStepCount(stage,seconds*30,30)).toBe(stage-1);
  });
  it('减少动画与收束直接保留完整关系',()=>{
    expect(revealedMotionStepCount(5,0,30,true)).toBe(4);
    expect(revealedMotionStepCount(6,0,30)).toBe(4);
  });
});
