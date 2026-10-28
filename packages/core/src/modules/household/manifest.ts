import { defineModule, REACH_REASONS } from '../../module-manifest';

export const householdModule = defineModule({
  id: 'household',
  label: 'Tasks & Reminders',
  description: 'Shared to-dos, chores and reminders with due dates.',
  iconId: 'list-checks',
  defaultEnabled: true,
  enhances: ['checklists', 'calendar'],
  section: {
    label: 'Tasks',
    shortLabel: 'Tasks',
    basePath: '/tasks',
    acceptsShares: true,
    navItems: [
      { href: '/tasks', label: 'Tasks & Reminders', iconId: 'list-checks', accent: true, badge: 'overdueTasks' },
    ],
    hue: 'lilac',
  },
  tables: {
    // Bill and document reminders are household tasks that belong to Costs and
    // Documents (task-modules.ts), so the table syncs while any of the three is on.
    household_tasks: { reach: { tools: ['get_tasks', 'create_task', 'update_task', 'complete_task', 'delete_task', 'get_agenda'] }, sync: ['household', 'costs', 'documents'] },
    household_task_comments: { reach: { none: REACH_REASONS.comments } },
  },
  tools: [
    { name: 'get_tasks', kind: 'read' },
    { name: 'create_task', kind: 'write' },
    { name: 'update_task', kind: 'write' },
    { name: 'complete_task', kind: 'write' },
    { name: 'delete_task', kind: 'write' },
    { name: 'get_agenda', kind: 'read' },
  ],
  settings: ['task-defaults'],
});
