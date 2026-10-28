import { defineModule } from '../../module-manifest';

export const homeCareModule = defineModule({
  id: 'home-care',
  label: 'Home care',
  description: 'Upkeep on a schedule you choose, from smoke alarms to gutters, in Home Setup.',
  iconId: 'wrench',
  // Lives in Home Setup as its Care view, so it needs Setup on.
  defaultEnabled: false,
  requires: ['setup'],
  enhances: ['household', 'calendar'],
  minSchema: '20261023120000_home_care',
  tables: {
    care_jobs: { reach: { tools: ['get_care_jobs', 'add_care_job', 'update_care_job', 'get_agenda'] }, sync: ['home-care'] },
  },
  tools: [
    { name: 'get_care_jobs', kind: 'read' },
    { name: 'update_care_job', kind: 'write' },
    { name: 'add_care_job', kind: 'write' },
  ],
});
