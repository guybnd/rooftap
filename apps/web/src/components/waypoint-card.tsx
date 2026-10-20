"use client";

import { useState, useRef } from "react";
import { Bath, Bed, Car, MessageSquare, Phone, RotateCcw, Send, X } from "lucide-react";
import { AgentSelector } from "@/components/agent-selector";
import { UserScoreChip } from "@/components/apartment-card";
import { PreliminaryScorePill } from "@/components/preliminary-score";
import { cn } from "@/lib/utils";
import type { ApartmentWithScore } from '@homeup/core';

// Hearth v2 pass: a standalone itinerary card (rounded-3xl, one border level)
// laid out in three bands so nothing is squeezed at 390px: a head (stop
// number, time, address, status select), a body indented under the text
// (agent, details as icon + figure with no dot runs, scores as tinted values
// rather than a filled pill, comment previews), and a full-width action row.
// The stop number is neutral (H2: coral means interactive); optional tints
// the number amber, skipped/rebook swap it for a glyph. Actions are 36px:
// labelled verbs first, then icon-only actions (`iconOnly`) with aria-labels.

export interface WaypointCardAction {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  href?: string;
  variant?: "primary" | "default" | "subtle";
  /** Render as a 36px icon button (label becomes its aria-label). */
  iconOnly?: boolean;
}

export interface CardComment {
  content: string;
  avatar: string | null;
  name: string | null;
}

export function WaypointCard({
  index,
  time,
  endTime,
  apartment,
  agent,
  isSkipped,
  isOptional,
  isRebook,
  onStatusChange,
  onNavigate,
  onAgentChange,
  actions,
  trailingAction,
  note,
  comments,
  onAddComment,
}: {
  index: number | null;
  time: string;
  endTime: string | null;
  apartment: ApartmentWithScore;
  agent: { name: string; phone: string | null; color: string } | null;
  isSkipped?: boolean;
  isOptional?: boolean;
  isRebook?: boolean;
  onStatusChange?: (newStatus: "scheduled" | "optional" | "skipped" | "rebook") => void;
  onNavigate: () => void;
  onAgentChange?: (agentId: string | null) => void;
  actions?: WaypointCardAction[];
  trailingAction?: WaypointCardAction;
  note?: string | null;
  comments?: CardComment[];
  onAddComment?: (content: string) => Promise<void>;
}) {
  const [editingAgent, setEditingAgent] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const struck = isSkipped || isRebook;
  const actionBase = "inline-flex h-9 items-center justify-center rounded-lg transition-colors";
  const labelled = actions?.filter((a) => !a.iconOnly) ?? [];
  const iconActions = actions?.filter((a) => a.iconOnly) ?? [];

  const renderAction = (action: WaypointCardAction, idx: number) => {
    const cls = action.iconOnly
      ? cn(actionBase, "w-9 text-muted-foreground hover:bg-muted hover:text-foreground")
      : cn(
          actionBase,
          "gap-1.5 px-3 text-xs font-medium",
          action.variant === "subtle"
            ? "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            : "bg-muted/60 text-foreground hover:bg-muted"
        );
    const content = action.iconOnly ? action.icon : (<>{action.icon}{action.label}</>);
    if (action.href) {
      return (
        <a key={idx} href={action.href} target="_blank" rel="noopener noreferrer" className={cls} aria-label={action.iconOnly ? action.label : undefined} title={action.iconOnly ? action.label : undefined}>
          {content}
        </a>
      );
    }
    return (
      <button key={idx} type="button" onClick={action.onClick} className={cls} aria-label={action.iconOnly ? action.label : undefined} title={action.iconOnly ? action.label : undefined}>
        {content}
      </button>
    );
  };

  const hasDetails = apartment.rent_per_week != null || apartment.bedrooms != null || apartment.bathrooms != null || apartment.parking;
  const hasScores = (apartment.preliminaryScores?.length ?? 0) > 0;

  return (
    <div
      className={cn(
        "rounded-3xl border border-border/60 bg-card px-4 py-3.5 shadow-[var(--card-shadow)] transition-colors hover:border-primary/30",
        struck ? "opacity-50" : isOptional ? "opacity-80" : undefined
      )}
    >
      {/* Head: stop, time + address, status */}
      <div className="flex items-start gap-3">
        <button type="button" onClick={onNavigate} className="shrink-0" aria-label={`Open ${apartment.address}`}>
          <span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums",
              isOptional ? "text-warning" : struck || index == null ? "text-muted-foreground" : "text-foreground"
            )}
          >
            {isRebook ? (
              <RotateCcw className="h-3.5 w-3.5" />
            ) : isSkipped ? (
              <X className="h-3.5 w-3.5" />
            ) : index != null ? (
              index + 1
            ) : (
              "–"
            )}
          </span>
        </button>

        <button type="button" onClick={onNavigate} className="min-w-0 flex-1 text-left transition-opacity hover:opacity-80">
          <span className={cn("flex items-baseline gap-1.5 text-sm font-semibold tabular-nums", struck && "line-through decoration-muted-foreground/40")}>
            {time}
            {endTime && <span className="text-xs font-normal text-muted-foreground">– {endTime}</span>}
          </span>
          <span className="mt-0.5 block truncate text-sm text-muted-foreground">
            {apartment.address}
            {apartment.suburb && <span className="hidden sm:inline">, {apartment.suburb}</span>}
          </span>
        </button>

        {onStatusChange && (
          <select
            value={isRebook ? "rebook" : isSkipped ? "skipped" : isOptional ? "optional" : "scheduled"}
            onChange={(e) => { e.stopPropagation(); onStatusChange(e.target.value as "scheduled" | "optional" | "skipped" | "rebook"); }}
            onClick={(e) => e.stopPropagation()}
            aria-label="Viewing status"
            className={cn(
              "h-9 shrink-0 cursor-pointer rounded-lg border border-border/60 bg-card px-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-ring",
              struck ? "text-muted-foreground" : isOptional ? "text-warning" : "text-foreground"
            )}
          >
            <option value="scheduled">Active</option>
            <option value="optional">Optional</option>
            <option value="skipped">Skipped</option>
            <option value="rebook">Rebook</option>
          </select>
        )}
      </div>

      {/* Body, indented under the text column */}
      <div className="mt-2 space-y-2 pl-10">
        {/* Agent */}
        {(onAgentChange || agent) && (
          <div className="flex flex-wrap items-center gap-2">
            {onAgentChange && !editingAgent ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setEditingAgent(true); }}
                className="flex min-h-8 items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {agent ? (
                  <>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: agent.color }} />
                    <span>{agent.name}</span>
                  </>
                ) : (
                  <span>Assign an agent</span>
                )}
              </button>
            ) : onAgentChange && editingAgent ? (
              <div className="w-56" onClick={(e) => e.stopPropagation()}>
                <AgentSelector
                  value={apartment.agent_id}
                  onChange={(id) => {
                    onAgentChange(id);
                    setEditingAgent(false);
                  }}
                />
              </div>
            ) : agent ? (
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: agent.color }} />
                <span>{agent.name}</span>
              </span>
            ) : null}
            {agent?.phone && (
              <a
                href={`tel:${agent.phone}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 text-xs font-medium tabular-nums text-foreground transition-colors hover:bg-muted"
              >
                <Phone className="h-3 w-3 text-muted-foreground" />
                {agent.phone}
              </a>
            )}
          </div>
        )}

        {/* Details: value first, unit muted (H6), icons instead of a dot run */}
        {hasDetails && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {apartment.rent_per_week != null && (
              <span className="text-sm font-semibold tabular-nums text-foreground">
                ${apartment.rent_per_week}
                <span className="text-xs font-normal text-muted-foreground">/wk</span>
              </span>
            )}
            {apartment.bedrooms != null && (
              <span className="inline-flex items-center gap-1 tabular-nums" aria-label={`${apartment.bedrooms} bedrooms`}>
                <Bed className="h-3.5 w-3.5" />
                {apartment.bedrooms}
              </span>
            )}
            {apartment.bathrooms != null && (
              <span className="inline-flex items-center gap-1 tabular-nums" aria-label={`${apartment.bathrooms} bathrooms`}>
                <Bath className="h-3.5 w-3.5" />
                {apartment.bathrooms}
              </span>
            )}
            {apartment.parking && (
              <span className="inline-flex items-center gap-1" aria-label="Parking">
                <Car className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
        )}

        {/* Scores: tinted values, never a filled block (H2) */}
        {hasScores && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <PreliminaryScorePill
              averageScore={apartment.preliminaryScores!.reduce((sum, s) => sum + s.score, 0) / apartment.preliminaryScores!.length}
              count={apartment.preliminaryScores!.length}
            />
            {apartment.preliminaryScores!.map((s) => (
              <UserScoreChip key={s.id} score={s} />
            ))}
          </div>
        )}

        {/* Comments */}
        {comments && comments.length > 0 && (
          <div className="space-y-1.5">
            {comments.map((c, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                {c.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.avatar} alt="" className="mt-0.5 h-5 w-5 shrink-0 rounded-full" />
                ) : (
                  <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted">
                    <span className="text-[10px] font-medium text-muted-foreground">
                      {c.name ? c.name[0].toUpperCase() : "?"}
                    </span>
                  </div>
                )}
                <span className="line-clamp-1 pt-0.5 text-muted-foreground">{c.content}</span>
              </div>
            ))}
          </div>
        )}

        {/* Fallback: single note if no comments */}
        {(!comments || comments.length === 0) && note && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <MessageSquare className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="line-clamp-2">{note}</span>
          </div>
        )}

        {/* Inline comment input */}
        {onAddComment && commentOpen && (
          <form
            className="flex items-center gap-1.5"
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) {
                setCommentOpen(false);
                setCommentText("");
              }
            }}
            onSubmit={async (e) => {
              e.preventDefault();
              const text = commentText.trim();
              if (!text || submitting) return;
              setSubmitting(true);
              await onAddComment(text);
              setCommentText("");
              setSubmitting(false);
              setCommentOpen(false);
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Add a comment"
              disabled={submitting}
              autoFocus
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring/30"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setCommentOpen(false);
                  setCommentText("");
                }
              }}
            />
            <button
              type="submit"
              disabled={submitting || !commentText.trim()}
              aria-label="Post comment"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
        )}
      </div>

      {/* Actions: full width, labelled verbs then icon buttons */}
      {(actions?.length || trailingAction || onAddComment) && (
        <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-border/60 pt-2.5">
          {labelled.map(renderAction)}
          <div className="ml-auto flex items-center gap-0.5">
            {onAddComment && !commentOpen && (
              <button
                type="button"
                onClick={() => { setCommentOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
                className={cn(actionBase, "w-9 text-muted-foreground hover:bg-muted hover:text-foreground")}
                aria-label="Add a comment"
                title="Add a comment"
              >
                <MessageSquare className="h-4 w-4" />
              </button>
            )}
            {iconActions.map(renderAction)}
            {trailingAction && renderAction({ ...trailingAction, iconOnly: true }, -1)}
          </div>
        </div>
      )}
    </div>
  );
}
