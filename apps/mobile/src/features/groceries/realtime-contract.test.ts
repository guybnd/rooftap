import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(new URL('../../app/(tabs)/groceries/index.tsx', import.meta.url), 'utf8');

function expectSource(pattern: RegExp, label: string) {
  expect(source, label).toMatch(pattern);
}

describe('GroceriesSectionScreen realtime contract', () => {
  it('subscribes to grocery_items only as a remote echo marker', () => {
    expectSource(
      /import\s+\{\s*useGroupTableRealtime\s*\}\s+from\s+['"]@\/lib\/use-group-table-realtime['"]/,
      'mobile groceries must use the shared group-scoped realtime hook'
    );
    expectSource(
      /useGroupTableRealtime\(\s*\{[\s\S]*table:\s*['"]grocery_items['"][\s\S]*onChange:\s*\(\)\s*=>\s*\{?\s*remoteUpdateRef\.current\s*=\s*Date\.now\(\)/s,
      'grocery_items events should stamp the remote-echo window for item-derived session calculations'
    );
    expect(source, 'grocery_items should stay Legend-owned; the screen must not refetch item rows manually').not.toMatch(
      /table:\s*['"]grocery_items['"][\s\S]{0,240}refetch/
    );
  });

  it('guards derived session-cost writes against remote echoes and duplicate signatures', () => {
    expectSource(
      /const\s+remoteUpdateRef\s*=\s*React\.useRef\(0\)/,
      'remoteUpdateRef holds the timestamp of the last realtime-driven item/session change (HOUP-285: a decaying window, not a consume-once flag)'
    );
    expectSource(
      /const\s+REMOTE_ECHO_WINDOW_MS\s*=\s*1500\b/,
      'the remote-echo suppression window is a named, bounded constant'
    );
    expectSource(
      /const\s+sessionSyncRef\s*=\s*React\.useRef<\s*string\s*>\(['"]{2}\)/,
      'sessionSyncRef deduplicates identical session-cost writes'
    );
    expectSource(
      /if\s*\(\s*Date\.now\(\)\s*-\s*remoteUpdateRef\.current\s*<\s*REMOTE_ECHO_WINDOW_MS\s*\)\s*return[\s\S]*const\s+sig\s*=/s,
      'the session-cost effect must skip syncSession inside the remote-echo window, before computing the dedupe signature'
    );
    expectSource(
      /const\s+sig\s*=[\s\S]*session\.id[\s\S]*summed[\s\S]*if\s*\(\s*sessionSyncRef\.current\s*===\s*sig\s*\)\s*return[\s\S]*sessionSyncRef\.current\s*=\s*sig[\s\S]*syncSession/s,
      'the session-cost effect must suppress duplicate syncSession calls for the same session/sum signature'
    );
  });

  it('reconciles realtime grocery_sessions only for the mounted group and current day', () => {
    expectSource(
      /useGroupTableRealtime\(\s*\{[\s\S]*table:\s*['"]grocery_sessions['"][\s\S]*groupId:\s*group\?\.id/s,
      'grocery_sessions must be subscribed while the groceries screen has an active group'
    );
    expectSource(
      /payload\.eventType\s*===\s*['"]DELETE['"][\s\S]*old\.id\s*===\s*session\?\.id[\s\S]*setSession\(null\)/s,
      'DELETE for the visible session clears the panel'
    );
    expectSource(
      /payload\.eventType\s*!==\s*['"]DELETE['"][\s\S]*next\.session_date\s*!==\s*todayStr\(\)[\s\S]*return/s,
      'INSERT/UPDATE for non-current-day sessions must be ignored'
    );
    expectSource(
      /payload\.eventType\s*!==\s*['"]DELETE['"][\s\S]*setSession\(next\s+as\s+GrocerySession\)/s,
      'INSERT/UPDATE for today updates the visible session panel'
    );
    expectSource(
      /setSession\(next\s+as\s+GrocerySession\)[\s\S]*remoteUpdateRef\.current\s*=\s*Date\.now\(\)/s,
      'applying a current-day remote session update stamps the remote-echo window for the next derived calculation'
    );
  });
});
