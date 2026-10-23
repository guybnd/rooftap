import { describe, expect, it } from 'vitest';
import { describeProposal, toolStatus } from './assistant-api';

describe('proposal lines for the newer modules', () => {
  it('says what each change does', () => {
    expect(describeProposal('mark_bins_out', 'bins', {})).toBe('Mark the bins as out');
    expect(describeProposal('change_bin_collection', 'bins', { date: '2026-12-25', moved_to: null })).toBe('Mark a bin collection as cancelled');
    expect(describeProposal('update_care_job', 'home-care', { job_id: 'j', action: 'done' })).toBe('Mark a Home care job done');
    expect(describeProposal('add_care_job', 'home-care', { suggestion_id: 'x' })).toBe('Add a job to Home care');
    expect(describeProposal('watch_item', 'shopper', { title: 'Dyson V15' })).toBe('Watch the price of "Dyson V15" in Shopper');
    expect(describeProposal('create_checklist', 'checklists', { title: 'Beach' })).toBe('Start the checklist "Beach"');
    expect(describeProposal('save_recipe', 'recipes', { title: 'Risotto' })).toBe('Save the recipe "Risotto"');
    expect(describeProposal('create_setup_item', 'setup', { name: 'Curtain rail' })).toBe('Add "Curtain rail" to Home Setup');
    expect(describeProposal('update_setup_item', 'setup', { item_id: 'x', status: 'installed' })).toBe('Mark a Home Setup item as got');
    expect(describeProposal('add_reward_perk', 'rewards', { title: '10% off' })).toBe('Save the perk "10% off" in Rewards');
  });

  it('names the newer modules while looking things up', () => {
    expect(toolStatus([{ tool: 'get_bin_night', module: 'bins', lookup: true, args: {} }, { tool: 'get_rewards', module: 'rewards', lookup: true, args: {} }])).toBe(
      'Checking Bin night and Rewards',
    );
  });
});
