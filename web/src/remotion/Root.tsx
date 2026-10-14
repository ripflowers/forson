import {Composition} from 'remotion';
import {LessonComposition} from './LessonComposition';
import {LESSON_FPS,LESSON_HEIGHT,LESSON_WIDTH,lessonTimeline} from './timeline';

export function RemotionRoot(){
  return <Composition id="Lesson" component={LessonComposition} width={LESSON_WIDTH} height={LESSON_HEIGHT} fps={LESSON_FPS} durationInFrames={180} defaultProps={{part:null,pace:1,reducedMotion:false,canvasOnly:false}} calculateMetadata={({props})=>({durationInFrames:lessonTimeline(props.part,LESSON_FPS,props.pace??1).durationInFrames})}/>;
}
