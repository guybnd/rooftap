import { describe, expect, it } from 'vitest';
import { isIosUserAgent, webDevice } from './web-install';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

describe('webDevice', () => {
  it('tells an iPhone tab from an iPhone Home Screen app', () => {
    expect(webDevice({ userAgent: IPHONE, maxTouchPoints: 5, standalone: false })).toBe('ios-browser');
    expect(webDevice({ userAgent: IPHONE, maxTouchPoints: 5, standalone: true })).toBe('ios-installed');
  });

  it('finds an iPad that reports a Mac user agent by its touch screen', () => {
    expect(isIosUserAgent(IPAD, 5)).toBe(true);
    expect(isIosUserAgent(IPAD, 0)).toBe(false);
    expect(webDevice({ userAgent: IPAD, maxTouchPoints: 0, standalone: false })).toBe('desktop');
  });

  it('sorts Android and computers', () => {
    expect(webDevice({ userAgent: ANDROID, maxTouchPoints: 5, standalone: false })).toBe('android-browser');
    expect(webDevice({ userAgent: ANDROID, maxTouchPoints: 5, standalone: true })).toBe('installed');
    expect(webDevice({ userAgent: WINDOWS, maxTouchPoints: 0, standalone: false })).toBe('desktop');
  });
});
