import { defineModule } from '../../module-manifest';

export const checklistsModule = defineModule({
  id: 'checklists',
  label: 'Checklists',
  description: 'Reusable lists and templates, from packing to cleaning.',
  iconId: 'list-todo',
  defaultEnabled: true,
  enhances: ['household'],
  section: {
    label: 'Checklists',
    shortLabel: 'Lists',
    basePath: '/checklists',
    acceptsShares: false,
    navItems: [
      { href: '/checklists', label: 'All checklists', iconId: 'list-todo', accent: true },
      { href: '/checklists/templates', label: 'Templates', iconId: 'layout-template' },
    ],
    hue: 'lime',
  },
  tables: {
    checklists: { reach: { tools: ['get_checklists', 'create_checklist'] }, sync: ['checklists'] },
    checklist_task_items: { reach: { tools: ['get_checklists', 'add_checklist_item', 'check_checklist_item', 'create_checklist'] }, sync: ['checklists'] },
    checklist_templates: { reach: { tools: ['get_checklist_templates', 'create_checklist'] }, sync: ['checklists'] },
    checklist_template_items: { reach: { tools: ['get_checklist_templates', 'create_checklist'] }, sync: ['checklists'] },
  },
  tools: [
    { name: 'get_checklists', kind: 'read' },
    { name: 'add_checklist_item', kind: 'write' },
    { name: 'check_checklist_item', kind: 'write' },
    { name: 'get_checklist_templates', kind: 'read' },
    { name: 'create_checklist', kind: 'write' },
  ],
  settings: ['checklists'],
});
