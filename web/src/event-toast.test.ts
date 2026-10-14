import {describe,it,expect} from 'vitest';
import {eventToast} from './domain';
describe('保存追问不冒充读完主线',()=>{
  it('help-used系统事件只确认追问及现场已保存',()=>{
    expect(eventToast('help-used','system')).toBe('已保存这次追问与提问现场。');
    expect(eventToast('help-used','system')).not.toContain('读过');
  });
  it('只有小问主线阅读事件使用读过提示，原话与观察保持各自来源',()=>{
    expect(eventToast('lesson-part-viewed','system')).toBe('已记录读过本小问主线；这不代表已经掌握。');
    expect(eventToast('note','learner')).toBe('已保存你的原话。');
    expect(eventToast('observation','system-observation')).toBe('已保存系统观察摘要。');
    expect(eventToast('answer-exposed','system')).not.toContain('读过');
  });
});
