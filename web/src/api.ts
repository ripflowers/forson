export class ApiError extends Error {constructor(public status:number,message:string){super(message);}}
export async function request<T>(path:string,init:RequestInit={}):Promise<T>{
  let response:Response;
  try{response=await fetch('/api'+path,{...init,headers:init.body instanceof FormData?init.headers:{'Content-Type':'application/json',...init.headers}});}catch{throw new ApiError(0,'连接中断。已输入的内容仍保留在这里，请确认本机服务后重试。');}
  const data=await response.json().catch(()=>({detail:'服务没有返回可读取的内容，请稍后重试。'}));
  if(!response.ok)throw new ApiError(response.status,typeof data.detail==='string'?data.detail:'暂时无法完成，请稍后重试。');
  return data as T;
}
export const post=<T>(path:string,data:unknown={})=>request<T>(path,{method:'POST',body:JSON.stringify(data)});
