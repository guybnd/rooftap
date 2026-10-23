'use client';

// Home care module: the household's upkeep jobs. Local-first like every group
// store; the database keeps each job's reminder task in step
// (20261023120000_home_care.sql), so the apps only ever write the job.

import { createGroupStore } from '../create-group-store';
import type { CareJob } from '../../modules/home-care/home-care';

export const careJobs$ = createGroupStore<CareJob>({
  collection: 'care_jobs',
  storageName: 'care_jobs',
});
