import {describe,it,expect} from 'vitest';
import {normalizedSelection,regionEditResult} from './source-regions';
describe('原图圈选使用真实图像边界',()=>{
  const bounds={left:101,top:51,width:400,height:200};
  it('排除容器边框偏移，并支持反方向拖动',()=>{
    expect(normalizedSelection(bounds,{x:401,y:201},{x:201,y:101})).toEqual({x:0.25,y:0.25,width:0.5,height:0.5});
  });
  it('拖出原图时约束到0至1，不产生越页范围',()=>{
    expect(normalizedSelection(bounds,{x:0,y:0},{x:800,y:600})).toEqual({x:0,y:0,width:1,height:1});
  });
  it('轻点、极小框与未加载图片不覆盖原定位',()=>{
    expect(normalizedSelection(bounds,{x:201,y:101},{x:204,y:103})).toBeNull();
    expect(normalizedSelection({...bounds,width:0},{x:201,y:101},{x:401,y:201})).toBeNull();
  });
});
describe('圈选确认与取消保留跨页题',()=>{
  const initial=[{pageIndex:0,x:0.1,y:0.2,width:0.3,height:0.4},{pageIndex:1,x:0.2,y:0.1,width:0.5,height:0.2}];
  const selection={x:0.25,y:0.5,width:0.4,height:0.25};
  it('只替换正在查看那一页，其他原图页仍保留',()=>{
    expect(regionEditResult(initial,0,selection,true)).toEqual([initial[1],{pageIndex:0,...selection}]);
    expect(initial[0].x).toBe(0.1);
  });
  it('取消预览恢复原矩形，不修改或删除其他页',()=>{
    expect(regionEditResult(initial,0,selection,false)).toEqual(initial);
    expect(regionEditResult(initial,0,null,true)).toEqual(initial);
  });
});
