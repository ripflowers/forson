export type NarrationClip={
  id:string;stageIndex:number;text:string;from:number;durationInFrames:number;
  audioFrames:number;audioUrl:string;audioPath?:string;visualFrom:number;visualTo:number;
};

/** All source timings are measured audio frames at fps, before playback speed. */
export type Narration={
  id:string;state:'ready';questionId:string;questionRevision:number;lessonVersion:number;
  partId:string;lessonHash:string;voice:string;fps:30;clips:NarrationClip[];
  stageDurations:number[];durationInFrames:number;askId?:string;
};
