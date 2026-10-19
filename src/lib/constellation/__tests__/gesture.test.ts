import { describe, it, expect } from 'bun:test';
import { classifyGesture, GESTURE_SLOP_PX } from '../gesture';

describe('classifyGesture', () => {
  it('below the slop it is still pending', () => {
    expect(GESTURE_SLOP_PX).toBe(6);
    expect(classifyGesture(1, 3, 2, true)).toBe('pending');
    expect(classifyGesture(1, 3, 2, false)).toBe('pending');
  });

  it('phone, one finger horizontal → yaw', () => {
    expect(classifyGesture(1, 20, 5, true)).toBe('yaw');
    expect(classifyGesture(1, -20, 8, true)).toBe('yaw');
  });

  it('phone, one finger vertical → page scroll, no yaw', () => {
    expect(classifyGesture(1, 4, 20, true)).toBe('scroll');
    expect(classifyGesture(1, 10, -30, true)).toBe('scroll');
    // a diagonal tie goes to scroll: the page must stay scrollable
    expect(classifyGesture(1, 15, 15, true)).toBe('scroll');
  });

  it('two fingers → pinch / tilt, on phone and desktop, no slop', () => {
    expect(classifyGesture(2, 0, 0, true)).toBe('pinch');
    expect(classifyGesture(2, 30, 0, false)).toBe('pinch');
    expect(classifyGesture(3, 0, 1, true)).toBe('pinch');
  });

  it('desktop, one pointer → free orbit (yaw + pitch)', () => {
    expect(classifyGesture(1, 4, 20, false)).toBe('orbit');
    expect(classifyGesture(1, 20, 0, false)).toBe('orbit');
  });

  it('no pointers → pending', () => {
    expect(classifyGesture(0, 50, 50, true)).toBe('pending');
  });
});
