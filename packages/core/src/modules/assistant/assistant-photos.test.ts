import { describe, expect, it } from 'vitest';
import {
  assistantPhotoKeepDays,
  assistantPhotoPath,
  assistantPhotoProblem,
  expiredPhotoDays,
  isAssistantPhotoPathFor,
} from './assistant-photos';
import { describeProposal } from './assistant-api';
import { aiModelTakesPhotos, cleanAiServerSettings, withCustomProviderPhotos } from '../../ai-providers';

const group = '11111111-1111-4111-8111-111111111111';
const user = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';

describe('assistant photo paths', () => {
  it('files a photo under the household, the day and the person', () => {
    const path = assistantPhotoPath(group, user, id, 'image/png', new Date('2026-10-23T09:00:00Z'));
    expect(path).toBe(`${group}/2026-10-23/${user}-${id}.png`);
    expect(isAssistantPhotoPathFor(path, group, user)).toBe(true);
  });

  it("refuses someone else's photo or a made-up path", () => {
    const path = assistantPhotoPath(group, user, id, 'image/jpeg');
    expect(isAssistantPhotoPathFor(path, group, id)).toBe(false);
    expect(isAssistantPhotoPathFor(path.replace(group, id), group, user)).toBe(false);
    expect(isAssistantPhotoPathFor(`${group}/../x.jpg`, group, user)).toBe(false);
    expect(isAssistantPhotoPathFor(42, group, user)).toBe(false);
  });

  it('finds the day folders past the keep time', () => {
    const now = new Date('2026-11-30T12:00:00Z');
    expect(expiredPhotoDays(['2026-10-30', '2026-10-31', '2026-11-29', 'junk'], 30, now)).toEqual(['2026-10-30']);
  });

  it('keeps photos 30 days on every plan for now', () => {
    expect(assistantPhotoKeepDays('free')).toBe(30);
    expect(assistantPhotoKeepDays('plus')).toBe(30);
  });

  it('says why a file cannot be attached', () => {
    expect(assistantPhotoProblem({ type: 'image/jpg', size: 1000 })).toBeNull();
    expect(assistantPhotoProblem({ type: 'application/pdf', size: 1000 })).toMatch(/photo/);
    expect(assistantPhotoProblem({ type: 'image/png', size: 30 * 1024 * 1024 })).toMatch(/too large/);
  });

  it('describes filing a photo in Documents', () => {
    expect(describeProposal('file_photo', 'documents', { title: 'Fridge receipt' })).toBe('File the photo as "Fridge receipt" in Documents');
  });
});

describe('which models look at photos', () => {
  it('trusts verified models and nothing added by hand', () => {
    const settings = cleanAiServerSettings({ extraModels: [{ provider: 'openai', id: 'gpt-x' }] });
    expect(aiModelTakesPhotos(settings, 'gemini', 'gemini-3.1-flash-lite')).toBe(true);
    expect(aiModelTakesPhotos(settings, 'openai', 'gpt-x')).toBe(false);
  });

  it("follows the operator's switch for a custom provider", () => {
    const base = cleanAiServerSettings({ custom: [{ id: 'custom-home', label: 'Home', baseURL: 'http://ollama:11434/v1' }] });
    expect(aiModelTakesPhotos(base, 'custom-home', 'llava')).toBe(false);
    const on = cleanAiServerSettings(withCustomProviderPhotos(base, 'custom-home', true));
    expect(on.custom[0].photos).toBe(true);
    expect(aiModelTakesPhotos(on, 'custom-home', 'llava')).toBe(true);
    expect(withCustomProviderPhotos(on, 'custom-home', false).custom[0].photos).toBeUndefined();
  });
});
