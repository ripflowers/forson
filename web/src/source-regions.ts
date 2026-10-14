import type {Question} from './types';
export type RegionBox={x:number;y:number;width:number;height:number};
export type ImageBounds={left:number;top:number;width:number;height:number};
export type Point={x:number;y:number};
export function normalizedSelection(bounds:ImageBounds,start:Point,end:Point):RegionBox|null{
  if(![bounds.left,bounds.top,bounds.width,bounds.height,start.x,start.y,end.x,end.y].every(Number.isFinite)||bounds.width<=0||bounds.height<=0)return null;
  const clamp=(value:number)=>Math.max(0,Math.min(1,value));
  const sx=clamp((start.x-bounds.left)/bounds.width),sy=clamp((start.y-bounds.top)/bounds.height),ex=clamp((end.x-bounds.left)/bounds.width),ey=clamp((end.y-bounds.top)/bounds.height);
  const width=Math.abs(ex-sx),height=Math.abs(ey-sy);
  if(width*bounds.width<8||height*bounds.height<8)return null;
  return{x:Math.min(sx,ex),y:Math.min(sy,ey),width,height};
}
export function regionEditResult(initial:Question['sourceRegions'],pageIndex:number,selection:RegionBox|null,commit:boolean):Question['sourceRegions']{
  if(!commit||!selection)return initial.map(region=>({...region}));
  return [...initial.filter(region=>region.pageIndex!==pageIndex).map(region=>({...region})),{pageIndex,...selection}];
}
