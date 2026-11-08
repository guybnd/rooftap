import { defineModule, REACH_REASONS } from '../../module-manifest';

export const householdModule = defineModule({
  id: 'household',
  label: 'Tasks & Reminders',
  description: 'Shared to-dos, chores and reminders with due dates.',
  askStarters: ["Split this week's chores fairly between us", "Remind me to call the plumber on Tuesday"],
  firstSteps: [{ label: 'Plan a move or a party from a template', meta: 'Checklists', href: '/checklists/templates', module: 'checklists' }],
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
  slots: ['search'],
  helper: {
    label: 'Week helper',
    subtitle: 'To-dos, reminders and the calendar',
    focus:
      "You plan this household's week: the to-dos and reminders, who does what, and how it fits around the calendar. " +
      'Work like this. Read get_tasks for the to-dos and get_agenda or the calendar for what is on each day. ' +
      'When your answer lists to-dos, show them as rows with show_items (module household, the brief gives the overdue, today and this week ids), ' +
      'one group per day or per person, and add one or two lines on what matters most: what is late, what clashes, who has too much. ' +
      'The person already sees the brief, so never send them back to it: bring something new, such as a fair split of the overdue ones, ' +
      'a day that is too full, or a to-do worth moving. ' +
      'Change a to-do only when the person asks: add, move, reassign or tick it, one tool call each, and confirm in one short line; the rows show under your reply. ' +
      'Give a due date to every to-do you add when the person gives one. Private to-dos of others are hidden from you.',
    reads: ['calendar', 'bins', 'occasions'],
    summary: {
      label: 'Catch me up',
      ask: 'Catch me up on the week: what is overdue, what is on today, what is coming up and who has what, any clashes with the calendar, and the one thing to do first.',
    },
    starters: ['Plan my day', 'Split the overdue ones fairly', 'What can wait until next week?'],
  },
});
