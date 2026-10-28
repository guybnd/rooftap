import { defineModule, REACH_REASONS } from '../../module-manifest';

export const binsModule = defineModule({
  id: 'bins',
  label: 'Bin night',
  description: 'Which bins go out tonight, whose turn it is, and a reminder before bed.',
  iconId: 'trash-2',
  defaultEnabled: false,
  enhances: ['calendar', 'assistant'],
  minSchema: '20261023110000_bins',
  section: {
    label: 'Bin night',
    shortLabel: 'Bins',
    basePath: '/bins',
    acceptsShares: false,
    navItems: [
      { href: '/bins', label: 'Bin night', iconId: 'trash-2', accent: true },
    ],
    hue: 'olive',
  },
  tables: {
    bin_streams: { reach: { tools: ['get_bin_night', 'change_bin_collection', 'get_agenda'] }, sync: ['bins'] },
    bin_changes: { reach: { tools: ['get_bin_night', 'change_bin_collection'] }, sync: ['bins'] },
    bin_plans: { reach: { tools: ['get_bin_night', 'mark_bins_out'] }, sync: ['bins'] },
    bin_night_pushes: { reach: { none: REACH_REASONS.server } },
  },
  tools: [
    { name: 'get_bin_night', kind: 'read' },
    { name: 'mark_bins_out', kind: 'write' },
    { name: 'change_bin_collection', kind: 'write' },
  ],
  slots: ['calendar', 'home-agenda'],
});
