'use client';

// Recipes v2 R7: ask the Assistant from cook mode (mockup 4C). A sheet with
// one quick ask that knows the recipe and the step on screen, so "can I use
// butter instead", "double it" or "put cream on the list" need no context.
// The server reads the recipe itself from the cook context each send
// carries; a timer it starts rings on this device. Native twin:
// apps/mobile/src/features/cook/cook-ask.tsx.
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Sparkles } from 'lucide-react';
import { cookDeviceId, useAssistantThread, useModules } from '@homeup/core';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { useDataCache } from '@/lib/data-cache';
import { assistantApi } from '@/lib/assistant-client';
import { ThreadFooter, ThreadMessages } from '@/app/assistant/thread-body';
import { cn } from '@/lib/utils';

const askToast = { error: (m: string) => toast.error(m), message: (m: string) => toast(m) };

/** Example asks for an empty sheet; tapping one sends it. */
const SUGGESTIONS = ['What can I use instead?', 'Make it for 2', 'Add what I am missing to the list'];

/** The header button and its sheet. Renders nothing while the Assistant module is off. */
export function CookAsk({ recipeId, step, className }: { recipeId: string; step: number; className?: string }) {
  const on = useModules().isEnabled('assistant');
  const [open, setOpen] = useState(false);
  if (!on) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask about this recipe"
        className={cn(
          'inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground',
          className,
        )}
      >
        <Sparkles className="h-5 w-5" />
      </button>
      <CookAskSheet open={open} onOpenChange={setOpen} recipeId={recipeId} step={step} />
    </>
  );
}

function CookAskSheet({
  open,
  onOpenChange,
  recipeId,
  step,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipeId: string;
  step: number;
}) {
  const { isOnline } = useDataCache();
  const openRef = useRef(open);
  const stepRef = useRef(step);
  useEffect(() => {
    openRef.current = open;
    stepRef.current = step;
  }, [open, step]);
  // One quick ask for the whole cook: closing the sheet keeps it.
  const thread = useAssistantThread(
    { id: 'new', kind: 'quick' },
    {
      api: assistantApi,
      presence: () => (document.visibilityState !== 'visible' ? 'background' : openRef.current ? 'here' : 'away'),
      toast: askToast,
      cook: () => ({ recipeId, step: stepRef.current, deviceId: cookDeviceId() }),
    },
  );
  const empty = thread.messages.length === 0 && !thread.sending;

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      className="z-[60] flex max-h-[80dvh] w-full flex-col gap-0 rounded-t-[28px] border border-border/60 bg-popover pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[var(--card-shadow)] md:mx-auto md:max-w-xl"
      overlayClassName="z-[59]"
    >
      {(contentRef) => (
        <>
          <p className="px-5 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Ask about this recipe</p>
          <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
            {empty ? (
              <div className="flex flex-wrap gap-2 py-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={!isOnline}
                    onClick={() => void thread.send(s)}
                    className="min-h-11 rounded-full bg-muted px-4 text-sm text-foreground hover:bg-accent disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              <ThreadMessages thread={thread} />
            )}
          </div>
          <ThreadFooter thread={thread} offline={!isOnline} autoFocus className="px-3 pt-2" />
        </>
      )}
    </BottomSheet>
  );
}
