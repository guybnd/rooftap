// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssistantApiError, type AssistantApi, type AssistantConversation, type AssistantStatus } from './assistant-api';
import { openAssistantPopup } from './assistant-popup';
import { useArchivedConversations, useAssistantPopupState, useAssistantSpace, usePopupThreadLifecycle } from './use-assistant-screens';

const status = (over: Partial<AssistantStatus> = {}): AssistantStatus => ({
  access: 'full' as AssistantStatus['access'],
  ready: true,
  pending: 2,
  spentCents: 0,
  isOwner: true,
  ...over,
});

const conv = (id: string, extra: Partial<AssistantConversation> = {}): AssistantConversation => ({
  id,
  kind: 'chat',
  title: id,
  pinned: false,
  last_active_at: '2026-10-21T09:00:00Z',
  closes_at: null,
  pending: 0,
  ...extra,
});

function fakeApi(over: Partial<Record<keyof AssistantApi, unknown>>): AssistantApi {
  return over as unknown as AssistantApi;
}

describe('useAssistantSpace', () => {
  it('loads the status and chats, and reports the status', async () => {
    const onStatus = vi.fn();
    const api = fakeApi({
      status: vi.fn(async () => status()),
      conversationList: vi.fn(async () => ({ conversations: [conv('c1'), conv('c2')], archived: 3 })),
    });
    const { result } = renderHook(() => useAssistantSpace(api, { onStatus }));
    await act(() => result.current.load());
    expect(result.current.groups.chats).toHaveLength(2);
    expect(result.current.archived).toBe(3);
    expect(result.current.caption).toBe('2 chats');
    expect(result.current.hardBlock).toBe(false);
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ pending: 2 }));
  });

  it('blocks without Plus, and without a model', async () => {
    const list = vi.fn(async () => ({ conversations: [], archived: 0 }));
    const plus = renderHook(() => useAssistantSpace(fakeApi({ status: async () => status({ access: 'none' as AssistantStatus['access'] }), conversationList: list })));
    await act(() => plus.result.current.load());
    expect(plus.result.current.blocked).toBe('assistant_requires_plus');
    expect(list).not.toHaveBeenCalled();

    const model = renderHook(() => useAssistantSpace(fakeApi({ status: async () => status({ ready: false }), conversationList: list })));
    await act(() => model.result.current.load());
    expect(model.result.current.blocked).toBe('assistant_not_configured');
    expect(model.result.current.hardBlock).toBe(true);
  });

  it('keeps an API error code, and shows other errors as text', async () => {
    const coded = renderHook(() =>
      useAssistantSpace(fakeApi({ status: async () => Promise.reject(new AssistantApiError('limit', 429, 'assistant_budget_reached')) })),
    );
    await act(() => coded.result.current.load());
    expect(coded.result.current.blocked).toBe('assistant_budget_reached');

    const plain = renderHook(() => useAssistantSpace(fakeApi({ status: async () => Promise.reject(new Error('offline')) })));
    await act(() => plain.result.current.load());
    expect(plain.result.current.error).toBe('offline');
  });
});

describe('useArchivedConversations', () => {
  it('loads only while enabled', async () => {
    const archivedConversations = vi.fn(async () => [conv('a', { archived: true })]);
    const api = fakeApi({ archivedConversations });
    const { result, rerender } = renderHook(({ on }) => useArchivedConversations(api, on), { initialProps: { on: false } });
    expect(archivedConversations).not.toHaveBeenCalled();
    rerender({ on: true });
    await waitFor(() => expect(result.current.list).toHaveLength(1));
  });
});

describe('useAssistantPopupState', () => {
  it('opens on a request, resumes the conversation on show, and starts fresh asks', () => {
    const { result } = renderHook(() => useAssistantPopupState(true));
    act(() => {
      openAssistantPopup({ conversationId: 'c1' });
    });
    expect(result.current.state).toMatchObject({ open: true, key: 1, target: { id: 'c1' } });
    act(() => result.current.remember(conv('c1')));
    act(() => result.current.minimize());
    act(() => {
      openAssistantPopup({ conversationId: 'c1' });
    });
    expect(result.current.state).toMatchObject({ open: true, key: 1 });
    act(() => {
      openAssistantPopup({ ask: 'Milk?' });
    });
    expect(result.current.state).toMatchObject({ open: true, key: 2, target: { id: 'new', kind: 'quick' }, ask: 'Milk?' });
    act(() => result.current.fresh());
    expect(result.current.state.key).toBe(3);
  });
});

describe('usePopupThreadLifecycle', () => {
  it('sends a handed-over ask once and reloads on reopening', () => {
    const send = vi.fn();
    const reload = vi.fn();
    const onConversation = vi.fn();
    const c = conv('c1');
    const { rerender } = renderHook((props: { open: boolean }) =>
      usePopupThreadLifecycle({ open: props.open, ask: 'Hi', conversation: c, loadError: null, send, reload, onConversation }),
      { initialProps: { open: true } },
    );
    rerender({ open: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(onConversation).toHaveBeenCalledWith(c);
    rerender({ open: false });
    expect(reload).not.toHaveBeenCalled();
    rerender({ open: true });
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
