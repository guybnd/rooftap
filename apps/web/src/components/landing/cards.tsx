"use client";

import type { ReactNode } from "react";
import { sectionHue } from "@homeup/core";
import { sectionIconFor } from "@/lib/section-icons";
import { cn } from "@/lib/utils";
import styles from "./landing.module.css";

// Drawn phone screens for the things the app's own pages cannot show: the
// Android home screen with the widget, a chat with an assistant or with the
// household's Telegram bot, a lock screen with a push, and the camera over a
// cookbook page. Each fills a
// phone (390 by 844 points) and sizes in cqw, so it scales with the phone.

export function SectionTile({ sectionId, small = false }: { sectionId: string; small?: boolean }) {
  const Icon = sectionIconFor(sectionId);
  return (
    <span className={cn(styles.tile, small && styles.tileSm)} data-hue={sectionHue(sectionId)} aria-hidden="true">
      <Icon className={small ? "size-4" : "size-5"} />
    </span>
  );
}

/** The space a status bar takes. Left blank: the app shots have none, so the drawn screens match them. */
function TopInset() {
  return <div className={styles.topInset} aria-hidden="true" />;
}

/** The Android widget (design A): Home in miniature, with Upcoming by day. */
const WIDGET_GROUPS: ReadonlyArray<[label: string, rows: ReadonlyArray<[section: string, title: string, meta: string]>]> = [
  ["Today", [["costs", "Home insurance contract ends", "Reminder · Bill"], ["household", "Bins out", "7:00 PM · Task"]]],
  ["Tomorrow", [["household", "Water the plants", "Task"]]],
  ["Wednesday", [["calendar", "Dentist", "2:30 PM · Event"]]],
  ["Friday", [["documents", "Renew dishwasher warranty", "Document reminder"]]],
];

export function Widget() {
  return (
    <div className={styles.widget}>
      <div className={styles.widgetHead}>
        <span className={styles.widgetHero}>
          <b>2</b>
          <span>of 2 left today</span>
        </span>
        <span className={styles.widgetWeather}>
          <b>18°</b>
          <span>Rain at 7pm</span>
        </span>
      </div>
      <div className={styles.widgetMeter} aria-hidden="true">
        <span />
        <span />
      </div>
      <div className={styles.widgetTitle}>
        <span>Upcoming</span>
        <code>11</code>
        <span className={styles.widgetPlus} aria-hidden="true">
          +
        </span>
      </div>
      {WIDGET_GROUPS.map(([label, rows]) => (
        <div key={label}>
          <p className={styles.widgetDay}>{label}</p>
          <div className={styles.widgetGroup}>
            {rows.map(([section, title, meta]) => (
              <div key={title} className={styles.widgetRow}>
                <SectionTile sectionId={section} small />
                <span style={{ minWidth: 0 }}>
                  <span className={styles.widgetRowTitle}>{title}</span>
                  <span className={styles.widgetRowMeta}>{meta}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className={styles.widgetChips}>
        <span className={styles.widgetChip}>
          <SectionTile sectionId="groceries" small />9 to buy
        </span>
        <span className={styles.widgetChip}>
          <SectionTile sectionId="costs" small />
          $2,801 of $4,200
        </span>
      </div>
    </div>
  );
}

/** The Android home screen with the Rooftap widget on it. */
export function HomeScreen() {
  return (
    <div className={styles.launcher}>
      <TopInset />
      <Widget />
      <div className={styles.dock} aria-hidden="true">
        {["Phone", "Messages", "Rooftap", "Camera"].map((name) => (
          <span key={name} className={cn(styles.dockApp, name === "Rooftap" && styles.dockRooftap)}>
            {name === "Rooftap" ? <SectionTile sectionId="home" /> : <i />}
            <span>{name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export interface ChatLine {
  from: "you" | "assistant";
  text: string;
  /** The MCP tools the assistant called before this line. */
  tools?: readonly string[];
  /** Buttons under the line, as Telegram puts them under a bot's reply. */
  buttons?: readonly string[];
}

/** A chat app with an AI assistant that has Rooftap connected over MCP, or Telegram with the household's bot. */
export function ChatScreen({
  lines,
  typing = false,
  name = "Assistant",
  status = "Rooftap and Home Assistant connected",
}: {
  lines: readonly ChatLine[];
  typing?: boolean;
  name?: string;
  status?: string;
}) {
  return (
    <div className={styles.chatApp}>
      <TopInset />
      <div className={styles.chatBar}>
        <span className={styles.chatAvatar} aria-hidden="true" />
        <span>
          <b>{name}</b>
          <small>{status}</small>
        </span>
      </div>
      <div className={styles.chat} role="log">
        {lines.map((line, i) => (
          <div key={i} className={cn(styles.chatLine, line.from === "you" ? styles.chatYou : styles.chatAssistant)}>
            {line.tools && (
              <span className={styles.chatTools}>
                {line.tools.map((t) => (
                  <code key={t}>{t}</code>
                ))}
              </span>
            )}
            <span className={styles.bubble}>{line.text}</span>
            {line.buttons && (
              <span className={styles.chatButtons}>
                {line.buttons.map((b) => (
                  <span key={b}>{b}</span>
                ))}
              </span>
            )}
          </div>
        ))}
        {typing && (
          <div className={cn(styles.chatLine, styles.chatAssistant)}>
            <span className={cn(styles.bubble, styles.typing)} aria-label="The assistant is typing">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
      </div>
      <div className={styles.chatInput} aria-hidden="true">
        <span>Message</span>
        <i />
      </div>
    </div>
  );
}

/** A lock screen with a push from Rooftap. */
export function LockScreen({ time, title, body }: { time: string; title: string; body: string }) {
  return (
    <div className={styles.lock}>
      <TopInset />
      <div className={styles.lockClock} aria-hidden="true">
        <span>{time}</span>
        <small>Saturday 24 October</small>
      </div>
      <div className={styles.push}>
        <span className={styles.pushIcon} aria-hidden="true">
          <SectionTile sectionId="home" small />
        </span>
        <span className={styles.pushHead}>
          <span>Rooftap</span>
          <span>now</span>
        </span>
        <span className={styles.pushTitle}>{title}</span>
        <span className={styles.pushBody}>{body}</span>
      </div>
    </div>
  );
}

/** The camera, pointed at a page of a cookbook, with the scan button. */
export function CameraScreen({ title, lines }: { title: string; lines: readonly string[] }) {
  return (
    <div className={styles.camera}>
      <TopInset />
      <div className={styles.paper} aria-hidden="true">
        <span className={styles.paperTitle}>{title}</span>
        {lines.map((l) => (
          <span key={l} className={styles.paperLine}>
            {l}
          </span>
        ))}
      </div>
      <span className={styles.viewfinder} aria-hidden="true" />
      <div className={styles.cameraBar} aria-hidden="true">
        <span className={styles.shutter} />
      </div>
    </div>
  );
}

export function CardStack({ children }: { children: ReactNode }) {
  return <div className={styles.cardStack}>{children}</div>;
}
