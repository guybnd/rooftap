// HOUP-88: Setup items starter templates (Australia region), relocated from
// apps/web/src/app/setup/setup-templates.ts so both platforms seed
// identically from one source.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface TemplateItem {
  room: string;
  name: string;
  priority: 'low' | 'medium' | 'high';
  est_price?: number;
}

export const SETUP_TEMPLATES: TemplateItem[] = [
  // Kitchen
  { room: 'Kitchen', name: 'Fridge/Freezer', priority: 'high', est_price: 1200 },
  { room: 'Kitchen', name: 'Stove/Oven', priority: 'high', est_price: 800 },
  { room: 'Kitchen', name: 'Microwave', priority: 'medium', est_price: 200 },
  { room: 'Kitchen', name: 'Dishwasher', priority: 'low', est_price: 600 },
  { room: 'Kitchen', name: 'Cookware set', priority: 'medium', est_price: 300 },
  { room: 'Kitchen', name: 'Cutlery & crockery', priority: 'high', est_price: 150 },

  // Bedroom
  { room: 'Bedroom', name: 'Bed frame', priority: 'high', est_price: 500 },
  { room: 'Bedroom', name: 'Mattress', priority: 'high', est_price: 600 },
  { room: 'Bedroom', name: 'Pillows & bedding', priority: 'high', est_price: 200 },
  { room: 'Bedroom', name: 'Wardrobe/Dresser', priority: 'medium', est_price: 400 },
  { room: 'Bedroom', name: 'Nightstands', priority: 'medium', est_price: 200 },

  // Bathroom
  { room: 'Bathroom', name: 'Shower curtain & rings', priority: 'medium', est_price: 50 },
  { room: 'Bathroom', name: 'Bath mat', priority: 'low', est_price: 30 },
  { room: 'Bathroom', name: 'Towel rack', priority: 'low', est_price: 40 },
  { room: 'Bathroom', name: 'Mirror', priority: 'medium', est_price: 80 },
  { room: 'Bathroom', name: 'Toilet brush & holder', priority: 'medium', est_price: 30 },

  // Living Room
  { room: 'Living Room', name: 'Couch/Lounge', priority: 'high', est_price: 800 },
  { room: 'Living Room', name: 'TV stand', priority: 'medium', est_price: 300 },
  { room: 'Living Room', name: 'Coffee table', priority: 'low', est_price: 200 },
  { room: 'Living Room', name: 'Armchair', priority: 'medium', est_price: 400 },
  { room: 'Living Room', name: 'Curtains', priority: 'medium', est_price: 100 },

  // Laundry
  { room: 'Laundry', name: 'Washing machine', priority: 'high', est_price: 800 },
  { room: 'Laundry', name: 'Dryer', priority: 'medium', est_price: 700 },
  { room: 'Laundry', name: 'Drying rack', priority: 'low', est_price: 40 },

  // General
  { room: 'Other', name: 'Vacuum cleaner', priority: 'medium', est_price: 200 },
  { room: 'Other', name: 'Mop & bucket', priority: 'medium', est_price: 50 },
];

export async function seedTemplateItems(
  groupId: string,
  supabase: SupabaseClient
): Promise<number> {
  try {
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.error('Failed to seed templates: no authenticated user');
      return 0;
    }

    // Check how many template items already exist
    const { count: existingCount } = await supabase
      .from('setup_items')
      .select('*', { count: 'exact', head: true })
      .eq('group_id', groupId)
      .not('template_key', 'is', null);

    if (existingCount && existingCount > 0) {
      // Templates already seeded
      return 0;
    }

    // Insert template items
    const itemsToInsert = SETUP_TEMPLATES.map((item) => ({
      group_id: groupId,
      name: item.name,
      room: item.room,
      priority: item.priority,
      est_price: item.est_price || null,
      status: 'needed' as const,
      template_key: `setup-template-${item.room.toLowerCase().replace(/\s+/g, '-')}-${item.name.toLowerCase().replace(/\s+/g, '-')}`,
      sort_order: 0,
      created_by: user.id,
    }));

    const { data, error } = await supabase
      .from('setup_items')
      .insert(itemsToInsert)
      .select();

    if (error) {
      console.error('Failed to seed templates:', error instanceof Error ? error.message : JSON.stringify(error));
      return 0;
    }

    return data?.length || 0;
  } catch (error) {
    console.error('Error seeding templates:', error instanceof Error ? error.message : JSON.stringify(error));
    return 0;
  }
}
