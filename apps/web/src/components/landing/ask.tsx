"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import styles from "./landing.module.css";

// The assistant panel: pick a question and play the answer an MCP client
// gives for the demo household. The answers are recorded, and the panel
// says so; the tool names are the server's own (packages/core mcp-tools.ts).

interface Exchange {
  ask: string;
  tools: readonly string[];
  answer: string;
}

const EXCHANGES: readonly Exchange[] = [
  {
    ask: "What is on the shopping list?",
    tools: ["get_grocery_items"],
    answer: "Thirteen things, among them milk, sourdough, ricotta, lasagne sheets and salmon. The ricotta and the sheets are for the lasagne. Mia added strawberries for school lunches.",
  },
  {
    ask: "What is due this week?",
    tools: ["get_tasks", "get_upcoming_calendar_events"],
    answer: "Today: bins out at 7 PM, and the home insurance contract ends. Tomorrow: water the plants. Later: the dentist, book the plumber, renew the dishwasher warranty. On Saturday you host, replace the hallway sensor battery and go to Jazz at the Lighthouse.",
  },
  {
    ask: "Add AA batteries to the list",
    tools: ["create_grocery_item"],
    answer: "Done. AA batteries are on the list under Household.",
  },
  {
    ask: "How much have we spent this month?",
    tools: ["get_budget_summary"],
    answer: "$2,801 of the $4,200 planned this month. Rent is the largest line, at $1,840.",
  },
];

type Line = { from: "you"; text: string } | { from: "assistant"; ex: Exchange } | { from: "typing" };

export function AskPanel() {
  const [lines, setLines] = useState<Line[]>([]);
  const timer = useRef(0);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const ask = (ex: Exchange) => {
    window.clearTimeout(timer.current);
    setLines((ls) => [...ls.filter((l) => l.from !== "typing"), { from: "you", text: ex.ask }, { from: "typing" }]);
    const wait = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1100;
    timer.current = window.setTimeout(() => setLines((ls) => [...ls.filter((l) => l.from !== "typing"), { from: "assistant", ex }]), wait);
  };

  return (
    <div className={styles.ask}>
      <div ref={log} className={styles.askLog} aria-live="polite">
        {lines.length === 0 && <p className={styles.askEmpty}>Pick a question below.</p>}
        {lines.map((l, i) =>
          l.from === "you" ? (
            <div key={i} className={cn(styles.chatLine, styles.chatYou)}>
              <span className={styles.bubble}>{l.text}</span>
            </div>
          ) : l.from === "typing" ? (
            <div key={i} className={cn(styles.chatLine, styles.chatAssistant)}>
              <span className={cn(styles.bubble, styles.typing)} aria-label="The assistant is typing">
                <i />
                <i />
                <i />
              </span>
            </div>
          ) : (
            <div key={i} className={cn(styles.chatLine, styles.chatAssistant)}>
              <span className={styles.chatTools}>
                {l.ex.tools.map((t) => (
                  <code key={t}>homeup · {t}</code>
                ))}
              </span>
              <span className={styles.bubble}>{l.ex.answer}</span>
            </div>
          )
        )}
      </div>
      <div className={styles.askChips} role="group" aria-label="Questions">
        {EXCHANGES.map((ex) => (
          <button key={ex.ask} type="button" className={styles.askChip} onClick={() => ask(ex)}>
            {ex.ask}
          </button>
        ))}
      </div>
      <p className={styles.askNote}>Recorded answers from an assistant connected to the demo household over MCP.</p>
    </div>
  );
}
