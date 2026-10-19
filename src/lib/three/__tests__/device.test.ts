import { describe, it, expect, afterEach } from 'bun:test';
import { cappedPixelRatio, isPhoneLike } from '../device';

const g = globalThis as Record<string, unknown>;
const hadWindow = 'window' in g;
const savedWindow = g.window;

function fakeWindow(dpr: number, coarse: boolean, w: number, h: number) {
  g.window = {
    devicePixelRatio: dpr,
    matchMedia: (q: string) => ({ matches: q === '(pointer: coarse)' && coarse }),
    screen: { width: w, height: h },
  };
}

afterEach(() => {
  if (hadWindow) g.window = savedWindow;
  else delete g.window;
});

describe('DPR cap', () => {
  it('caps desktop at 2', () => {
    fakeWindow(3, false, 2560, 1440);
    expect(isPhoneLike()).toBe(false);
    expect(cappedPixelRatio()).toBe(2);
  });
  it('caps phones (coarse pointer, short side ≤ 820) at 1.5', () => {
    fakeWindow(3, true, 390, 844);
    expect(isPhoneLike()).toBe(true);
    expect(cappedPixelRatio()).toBe(1.5);
  });
  it('a coarse tablet is not phone-like', () => {
    fakeWindow(2, true, 1024, 1366);
    expect(isPhoneLike()).toBe(false);
    expect(cappedPixelRatio()).toBe(2);
  });
  it('never raises a low DPR, and treats 0 as 1', () => {
    fakeWindow(1, true, 390, 844);
    expect(cappedPixelRatio()).toBe(1);
    fakeWindow(0, false, 1280, 800);
    expect(cappedPixelRatio()).toBe(1);
  });
  it('is not phone-like without a window', () => {
    delete g.window;
    expect(isPhoneLike()).toBe(false);
  });
});
