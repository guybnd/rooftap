// The widget is painted from buildWidgetTree's walk of the JSX, which calls
// each component as a plain function. A fragment (no function type) or a
// component returning null throws there, and requestWidgetUpdate swallows the
// error, so the widget silently stays blank. Build the real tree here.
import { describe, expect, it, vi } from 'vitest';
import type { WidgetSummary, WidgetTaskSnapshotItem } from '@homeup/core';

vi.mock('react-native', () => ({
  Image: { resolveAssetSource: () => ({ uri: '' }) },
  Platform: { OS: 'android' },
  NativeModules: {},
  TurboModuleRegistry: { get: () => null, getEnforcing: () => ({}) },
  AppRegistry: { registerHeadlessTask: () => {} },
}));

// The library's TypeScript source (its published lib/ is not transformed here),
// with TasksWidget's own import of the package pointed at the same source.
vi.mock('react-native-android-widget', async () => ({
  ...(await import('../../../../node_modules/react-native-android-widget/src/widgets/FlexWidget')),
  ...(await import('../../../../node_modules/react-native-android-widget/src/widgets/TextWidget')),
  ...(await import('../../../../node_modules/react-native-android-widget/src/widgets/ListWidget')),
  ...(await import('../../../../node_modules/react-native-android-widget/src/widgets/SvgWidget')),
}));

import { buildWidgetTree } from '../../../../node_modules/react-native-android-widget/src/api/build-widget-tree';
import { tasksWidgetRepresentation, widgetFeedFit } from './TasksWidget';

const today = new Date().toISOString().slice(0, 10);
const row = (over: Partial<WidgetTaskSnapshotItem>): WidgetTaskSnapshotItem =>
  ({
    id: 'task-1',
    title: 'Take out the bins',
    due_date: today,
    due_time: null,
    done: false,
    sourceUpdatedAt: null,
    type: 'task',
    section: 'household',
    sourceLabel: 'Task',
    toggleable: true,
    openPath: null,
    ...over,
  }) as WidgetTaskSnapshotItem;

const summary: WidgetSummary = {
  openTodoCount: 2,
  toBuyCount: 3,
  doneTodayCount: 0,
  budget: { spentCents: 1000, budgetCents: 2000, tone: 'success', currencySymbol: '$' },
  bills: [],
  weather: { tempC: 18, condition: 'Cloudy', iconKey: 'cloudy', updatedAt: '2026-10-19T00:00:00Z', stale: false },
  tasksOn: true,
  groceriesOn: true,
  costsOn: true,
  documentsOn: true,
  upcomingDays: 90,
} as WidgetSummary;

const cases: [string, Parameters<typeof tasksWidgetRepresentation>[0]][] = [
  ['a full feed', { items: [row({}), row({ id: 'event-1', type: 'event', section: 'calendar', due_time: '19:00', toggleable: false, openPath: '/calendar' })], groceries: [], summary }],
  ['an empty feed with no weather or budget', { items: [], groceries: [], summary: { ...summary, weather: null, budget: null } }],
  ['everything done', { items: [row({ done: true })], groceries: [], summary }],
  ['a short widget', { items: [row({}), row({ id: 'task-2' }), row({ id: 'task-3' })], groceries: [], summary, height: 220 }],
  ['an Undo line after a tick from the widget', { items: [row({ done: true })], groceries: [], summary: { ...summary, lastTick: { id: 'task-1', title: 'Take out the bins', done: true, at: new Date().toISOString() } } }],
  ['tasks and groceries off', { items: [], groceries: [], summary: { ...summary, tasksOn: false, groceriesOn: false, costsOn: false, weather: null } }],
];

describe('TasksWidget tree', () => {
  it.each(cases)('builds light and dark trees for %s', (_, props) => {
    const { light, dark } = tasksWidgetRepresentation(props) as { light: React.JSX.Element; dark: React.JSX.Element };
    expect(() => buildWidgetTree(light)).not.toThrow();
    expect(() => buildWidgetTree(dark)).not.toThrow();
  });
});

describe('a task row', () => {
  it('opens the task, and only its tick circle finishes it', () => {
    const json = JSON.stringify(
      buildWidgetTree((tasksWidgetRepresentation({ items: [row({})], groceries: [], summary }) as { light: React.JSX.Element }).light),
    );
    expect(json).toContain('mobile://tasks?focus=task-1');
    expect(json.match(/"clickAction":"TOGGLE_TASK"/g)).toHaveLength(1);
    expect(json).toContain('Finish Take out the bins');
  });
});

describe('the Undo line', () => {
  const ticked = (at: string) => ({ ...summary, lastTick: { id: 'task-1', title: 'Take out the bins', done: true, at } });
  const tree = (s: WidgetSummary) =>
    JSON.stringify(buildWidgetTree((tasksWidgetRepresentation({ items: [row({ done: true })], groceries: [], summary: s }) as { light: React.JSX.Element }).light));
  it('names the task a widget tick just finished, with a tap that reverses it', () => {
    const json = tree(ticked(new Date().toISOString()));
    expect(json).toContain('Finished Take out the bins');
    expect(json).toContain('"clickAction":"TOGGLE_TASK"');
  });
  it('is gone once the undo window has passed', () => {
    expect(tree(ticked('2000-01-01T00:00:00.000Z'))).not.toContain('Finished Take out the bins');
  });
});

describe('widgetFeedFit', () => {
  const items = Array.from({ length: 6 }, (_, i) => row({ id: `task-${i}` }));
  it('fits every row when there is room', () => {
    expect(widgetFeedFit(items, today, 1000)).toBe(6);
  });
  it('leaves room for the "more" line when rows are cut', () => {
    // 18 (first day header) + 3 rows of 50 + the 24dp "more" line = 192.
    expect(widgetFeedFit(items, today, 192)).toBe(3);
    expect(widgetFeedFit(items, today, 191)).toBe(2);
  });
  it('shows nothing when not even one row fits', () => {
    expect(widgetFeedFit(items, today, 40)).toBe(0);
  });
});
