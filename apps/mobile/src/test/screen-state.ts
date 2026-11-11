// What the screen under test sees: the household, the signed-in person and the
// rows each table serves. renderScreen() fills it before each render.
import { fakeSupabase, type Tables } from './fake-supabase';

export const ME = 'user-me';
export const OTHER = 'user-other';

export const screenState = {
  groupId: 'group-0',
  tables: {} as Tables,
  supabase: fakeSupabase({}),
  loading: false,
};
