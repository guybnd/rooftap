import * as React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGroupTableRealtime, useGroupTableRefetch } from './use-group-table-realtime';

type RealtimeHandler = (payload: unknown) => void;

const channelOn = vi.fn();
const channelSubscribe = vi.fn();
// Resolves like the real client's async removeChannel — the hook's cleanup
// chains `.then()` on it (PR #229 perfMark instrumentation). Args stay loose
// so the HOUP-258 case below can install a FakeChannel-typed implementation.
const removeChannel = vi.fn<(...args: any[]) => Promise<string>>(() => Promise.resolve('ok'));
const channel = { on: channelOn, subscribe: channelSubscribe };
const supabase = {
  // Return type widened so the HOUP-258 case below can swap in a channel double
  // that models the real client's topic dedupe.
  channel: vi.fn((_topic: string): unknown => channel),
  removeChannel,
};

let latestHandler: RealtimeHandler | undefined;

vi.mock('./supabase-client', () => ({
  getCurrentSupabaseClient: vi.fn(() => supabase),
}));

function RefetchProbe({
  groupId,
  refetch,
  debounceMs = 350,
}: {
  groupId: string | null;
  refetch: () => void;
  debounceMs?: number;
}) {
  useGroupTableRefetch({ table: 'document_links', groupId, refetch, debounceMs });
  return null;
}

describe('useGroupTableRefetch', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    latestHandler = undefined;
    supabase.channel.mockClear();
    channelOn.mockReset().mockImplementation((_event, _config, handler: RealtimeHandler) => {
      latestHandler = handler;
      return channel;
    });
    channelSubscribe.mockReset().mockReturnValue(channel);
    removeChannel.mockClear();
  });

  afterEach(() => {
    if (renderer) {
      act(() => renderer?.unmount());
      renderer = undefined;
    }
    vi.useRealTimers();
  });

  it('keeps the subscription inert until a group id exists', () => {
    act(() => {
      renderer = create(<RefetchProbe groupId={null} refetch={vi.fn()} />);
    });

    expect(supabase.channel).not.toHaveBeenCalled();
    expect(channelOn).not.toHaveBeenCalled();
  });

  it('subscribes to document_links with a group filter and removes the channel on group changes', () => {
    const refetch = vi.fn();

    act(() => {
      renderer = create(<RefetchProbe groupId="group-a" refetch={refetch} />);
    });

    // HOUP-258: the topic carries a per-subscription suffix, so match the shape.
    expect(supabase.channel).toHaveBeenCalledWith(
      expect.stringMatching(/^rt:document_links:group-a:\d+$/)
    );
    expect(channelOn).toHaveBeenCalledWith(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'document_links', filter: 'group_id=eq.group-a' },
      expect.any(Function)
    );
    expect(channelSubscribe).toHaveBeenCalledTimes(1);

    act(() => {
      renderer?.update(<RefetchProbe groupId="group-b" refetch={refetch} />);
    });

    expect(removeChannel).toHaveBeenCalledWith(channel);
    expect(supabase.channel).toHaveBeenLastCalledWith(
      expect.stringMatching(/^rt:document_links:group-b:\d+$/)
    );
  });

  it('coalesces bursty document_links realtime events into one refetch', () => {
    const refetch = vi.fn();

    act(() => {
      renderer = create(<RefetchProbe groupId="group-a" refetch={refetch} debounceMs={100} />);
    });

    act(() => {
      latestHandler?.({ eventType: 'INSERT' });
      latestHandler?.({ eventType: 'UPDATE' });
      latestHandler?.({ eventType: 'DELETE' });
      vi.advanceTimersByTime(99);
    });
    expect(refetch).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending debounced refetch on unmount', () => {
    const refetch = vi.fn();

    act(() => {
      renderer = create(<RefetchProbe groupId="group-a" refetch={refetch} debounceMs={100} />);
    });
    act(() => {
      latestHandler?.({ eventType: 'UPDATE' });
    });
    act(() => {
      renderer?.unmount();
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(refetch).not.toHaveBeenCalled();
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });
});

// HOUP-258 regression: swapping pages threw
// "cannot add `postgres_changes` callbacks for realtime:rt:grocery_items:<group>
// after `subscribe()`" out of the subscribe effect and into the router error
// boundary ("Something went wrong"), captured on a release APK.
describe('useGroupTableRealtime channel ownership', () => {
  /**
   * Models the three behaviours of @supabase/realtime-js that combine into the
   * bug: `RealtimeClient.channel()` dedupes by topic, `RealtimeChannel.on()`
   * throws once the channel has joined, and `RealtimeClient.removeChannel()`
   * only deregisters after an await.
   */
  class FakeChannel {
    joined = false;
    constructor(readonly topic: string) {}
    on(type: string): FakeChannel {
      if (this.joined && type === 'postgres_changes') {
        throw new Error(`cannot add \`${type}\` callbacks for ${this.topic} after \`subscribe()\`.`);
      }
      return this;
    }
    subscribe(): FakeChannel {
      this.joined = true;
      return this;
    }
  }

  function RealtimeProbe({ groupId }: { groupId: string | null }) {
    useGroupTableRealtime({ table: 'grocery_items', groupId, onChange: () => {} });
    return null;
  }

  it('does not hand a remount the previous, still-subscribed channel', () => {
    const registry = new Map<string, FakeChannel>();
    const topics: string[] = [];

    supabase.channel.mockReset().mockImplementation((topic: string) => {
      topics.push(topic);
      const existing = registry.get(topic);
      if (existing) return existing;
      const created = new FakeChannel(topic);
      registry.set(topic, created);
      return created;
    });
    removeChannel.mockReset().mockImplementation(async (chan: FakeChannel) => {
      // Async, exactly like the real client: the channel stays registered for
      // the rest of this synchronous turn.
      await Promise.resolve();
      registry.delete(chan.topic);
      return 'ok';
    });

    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(<RealtimeProbe groupId="group-a" />);
    });

    // Unmount and remount within one synchronous turn — react-freeze unfreezing a
    // screen on a page swap. The cleanup's `void removeChannel(...)` has started
    // but its microtask has not deregistered the channel yet.
    expect(() =>
      act(() => {
        renderer?.unmount();
        renderer = create(<RealtimeProbe groupId="group-a" />);
      })
    ).not.toThrow();

    expect(topics).toHaveLength(2);
    expect(topics[0]).not.toBe(topics[1]);

    act(() => renderer?.unmount());
  });
});
