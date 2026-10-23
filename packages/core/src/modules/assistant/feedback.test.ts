import { describe, expect, it } from 'vitest';
import { describeProposal } from './assistant-api';
import { SEND_FEEDBACK_TOOL } from './feedback';

describe('send_feedback proposal', () => {
  it('shows the whole message the person is about to send', () => {
    expect(describeProposal(SEND_FEEDBACK_TOOL, 'assistant', { message: 'Let me copy chat text' })).toBe(
      'Send this to the Rooftap team: "Let me copy chat text"'
    );
  });
});
