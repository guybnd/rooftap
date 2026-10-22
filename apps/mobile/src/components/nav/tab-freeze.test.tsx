import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAB_FREEZE_DELAY_MS, TAB_WARM_FREEZE_DELAY_MS, TabFreeze } from './tab-freeze';

// A stand-in for a tab's navigation prop: focus state plus focus/blur events.
function fakeNavigation(focused: boolean) {
  const listeners = { focus: new Set<() => void>(), blur: new Set<() => void>() };
  return {
    focused,
    isFocused() {
      return this.focused;
    },
    addListener(event: 'focus' | 'blur', cb: () => void) {
      listeners[event].add(cb);
      return () => listeners[event].delete(cb);
    },
    emit(event: 'focus' | 'blur') {
      this.focused = event === 'focus';
      listeners[event].forEach((cb) => cb());
    },
  };
}

// A store outside React, like a Legend store, and a screen reading it.
let value = 0;
const subscribers = new Set<() => void>();
function setValue(next: number) {
  value = next;
  subscribers.forEach((cb) => cb());
}
const subscribe = (cb: () => void) => {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
};
let renders: number[] = [];
function Screen() {
  const v = React.useSyncExternalStore(subscribe, () => value);
  renders.push(v);
  return <>{`value ${v}`}</>;
}

let root: ReactTestRenderer;

// A concurrent root, as on device, where React could otherwise render a
// hidden tree's updates at idle priority.
function mount(nav: ReturnType<typeof fakeNavigation>) {
  const options = { unstable_isConcurrent: true } as unknown as Parameters<typeof create>[1];
  act(() => {
    root = create(<TabFreeze navigation={nav}>{<Screen />}</TabFreeze>, options);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  value = 0;
  renders = [];
});
afterEach(() => {
  act(() => root?.unmount());
  vi.useRealTimers();
});

describe('TabFreeze', () => {
  it('keeps a focused tab live', () => {
    const nav = fakeNavigation(true);
    mount(nav);
    act(() => setValue(1));
    expect(renders.at(-1)).toBe(1);
  });

  it('stops rendering a tab once its slide out is over, and catches up on return', () => {
    const nav = fakeNavigation(true);
    mount(nav);
    act(() => nav.emit('blur'));
    // Still live during the slide out.
    act(() => setValue(1));
    expect(renders.at(-1)).toBe(1);

    act(() => {
      vi.advanceTimersByTime(TAB_FREEZE_DELAY_MS);
    });
    const before = renders.length;
    act(() => setValue(2));
    act(() => setValue(3));
    expect(renders.length).toBe(before);

    act(() => nav.emit('focus'));
    expect(renders.at(-1)).toBe(3);
    expect(root.toJSON()).toBe('value 3');
  });

  it('lets a warmed-up tab mount and settle before it freezes', () => {
    const nav = fakeNavigation(false);
    mount(nav);
    expect(renders).toEqual([0]);
    act(() => setValue(1));
    expect(renders.at(-1)).toBe(1);

    act(() => {
      vi.advanceTimersByTime(TAB_WARM_FREEZE_DELAY_MS);
    });
    const before = renders.length;
    act(() => setValue(2));
    expect(renders.length).toBe(before);
  });

  it('a quick return cancels the pending freeze', () => {
    const nav = fakeNavigation(true);
    mount(nav);
    act(() => nav.emit('blur'));
    act(() => nav.emit('focus'));
    act(() => {
      vi.advanceTimersByTime(TAB_FREEZE_DELAY_MS * 2);
    });
    act(() => setValue(5));
    expect(renders.at(-1)).toBe(5);
  });
});
