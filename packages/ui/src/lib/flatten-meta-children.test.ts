import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { flattenMetaChildren } from './flatten-meta-children';

const text = (label: string) => React.createElement('Text', null, label);

describe('flattenMetaChildren', () => {
  it('passes plain element children through unchanged', () => {
    const items = flattenMetaChildren([text('Overdue'), text('Med')]);
    expect(items).toHaveLength(2);
  });

  it('flattens a fragment into its individual children (the HOUP-305 stacking bug)', () => {
    // HeroTaskRow's non-done meta branch is one `<>due source priority</>`
    // fragment - toArray alone counted it as ONE child, so every fragment
    // landed in a single column-direction wrapper View and stacked.
    const fragment = React.createElement(React.Fragment, null, text('Overdue'), text('Task'), text('Med'));
    const items = flattenMetaChildren(fragment);
    expect(items).toHaveLength(3);
  });

  it('flattens nested fragments recursively', () => {
    const inner = React.createElement(React.Fragment, null, text('Task'), text('Med'));
    const outer = React.createElement(React.Fragment, null, text('Overdue'), inner);
    expect(flattenMetaChildren(outer)).toHaveLength(3);
  });

  it('drops conditional-render noise (null/false) like toArray does', () => {
    const fragment = React.createElement(React.Fragment, null, text('Overdue'), null, false, text('Med'));
    expect(flattenMetaChildren(fragment)).toHaveLength(2);
  });

  it('keeps mixed fragment and element siblings in order', () => {
    const fragment = React.createElement(React.Fragment, null, text('a'), text('b'));
    const items = flattenMetaChildren([fragment, text('c')]);
    expect(items).toHaveLength(3);
    expect((items[2] as React.ReactElement<{ children?: React.ReactNode }>).props.children).toBe('c');
  });
});
