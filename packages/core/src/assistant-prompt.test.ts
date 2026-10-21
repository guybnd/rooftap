import { describe, expect, it } from 'vitest';
import { ASSISTANT_PERSONA, REMEMBER_INSTRUCTION, buildAssistantSystemPrompt, extractMemoryMarkers, summaryRequest } from './assistant-prompt';

const base = {
  now: 'Tuesday 21 October 2026, 09:41',
  timeZone: 'Australia/Sydney',
  person: 'Guy',
  members: ['Guy', 'Noa'],
  modules: [
    { label: 'Tasks & Reminders', trust: 'ask' as const },
    { label: 'Costs & Budget', trust: 'read' as const },
  ],
  memories: [],
  kind: 'chat' as const,
  channel: 'app' as const,
};

describe('buildAssistantSystemPrompt', () => {
  it('opens with the persona and always teaches the remember marker', () => {
    const prompt = buildAssistantSystemPrompt(base);
    expect(prompt.startsWith(ASSISTANT_PERSONA)).toBe(true);
    expect(prompt).toContain(REMEMBER_INSTRUCTION);
  });

  it('names the person, the members and each module with its trust level', () => {
    const prompt = buildAssistantSystemPrompt(base);
    expect(prompt).toContain('talking with Guy');
    expect(prompt).toContain('Guy, Noa');
    expect(prompt).toContain('- Tasks & Reminders: changes are proposed');
    expect(prompt).toContain('- Costs & Budget: look up only');
  });

  it('adds memories and the thread summary only when there are any', () => {
    expect(buildAssistantSystemPrompt(base)).not.toContain('Remembered about');
    const prompt = buildAssistantSystemPrompt({ ...base, memories: ['Noa is vegetarian'], summary: 'Planned dinners.' });
    expect(prompt).toContain('- Noa is vegetarian');
    expect(prompt).toContain('## Earlier in this conversation\nPlanned dinners.');
  });

  it('says so when no modules are reachable', () => {
    expect(buildAssistantSystemPrompt({ ...base, modules: [] })).toContain('No parts of the app are available');
  });

  it('adapts to the channel and conversation kind', () => {
    const prompt = buildAssistantSystemPrompt({ ...base, kind: 'household', channel: 'telegram' });
    expect(prompt).toContain("household's shared chat");
    expect(prompt).toContain('Telegram');
  });
});

describe('extractMemoryMarkers', () => {
  it('pulls markers out and tidies the text', () => {
    expect(extractMemoryMarkers('Added it.\n\n<remember> Noa is vegetarian </remember>\n\n\nAnything else?')).toEqual({
      cleanedText: 'Added it.\n\nAnything else?',
      memories: ['Noa is vegetarian'],
    });
  });

  it('drops empty markers and leaves unclosed ones alone', () => {
    expect(extractMemoryMarkers('Hi <remember> </remember>there <remember>open')).toEqual({
      cleanedText: 'Hi there <remember>open',
      memories: [],
    });
  });
});

describe('summaryRequest', () => {
  it('lays out the summary so far and the messages to fold, one line each', () => {
    expect(summaryRequest(null, [{ speaker: 'Noa', text: 'Dinner\n  Sunday?' }, { speaker: 'Rooftap', text: 'Sunday works.' }])).toBe(
      'Summary so far:\n(none yet)\n\nNewer messages:\nNoa: Dinner Sunday?\nRooftap: Sunday works.'
    );
  });
});
