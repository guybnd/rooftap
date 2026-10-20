import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { shouldWrapTitleChildren } from './list-item-title';

describe('shouldWrapTitleChildren', () => {
  it('wraps a plain string', () => {
    expect(shouldWrapTitleChildren('Apple')).toBe(true);
  });

  it('wraps a number', () => {
    expect(shouldWrapTitleChildren(42)).toBe(true);
  });

  it('wraps array children from JSX interpolation (the HOUP-169 blank-row bug)', () => {
    // `{emoji} {name}` in JSX compiles to an array of raw strings, not a
    // single element - this used to fall through to the "already an
    // element" branch and render loose text nodes RN silently drops.
    const children = ['\u{1F34E}', ' ', 'Apple'];
    expect(shouldWrapTitleChildren(children)).toBe(true);
  });

  it('wraps undefined/null', () => {
    expect(shouldWrapTitleChildren(undefined)).toBe(true);
    expect(shouldWrapTitleChildren(null)).toBe(true);
  });

  it('passes through a single React element untouched', () => {
    const element = React.createElement('Text', null, 'Apple');
    expect(shouldWrapTitleChildren(element)).toBe(false);
  });

  it('passes through an array containing a React element (caller-composed layout)', () => {
    // e.g. <Text>Can make now</Text> + <Pill>...</Pill> as ListItemTitle
    // children - JSX gives an array, but it already contains a real element
    // (a View-based Pill/icon), so wrapping it in <Text> would nest a View
    // inside Text and collapse the intended flex-row layout.
    const children = [
      React.createElement('Text', null, 'Can make now'),
      React.createElement('Pill', null, 'Badge'),
    ];
    expect(shouldWrapTitleChildren(children)).toBe(false);
  });
});
