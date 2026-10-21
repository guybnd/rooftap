import { Fragment } from "react";
import { sectionHue } from "@homeup/core";
import { SectionTile } from "./cards";
import styles from "./landing.module.css";
import MARKS from "./screen-marks.json";
import { ringAround, SCREEN_H, SCREEN_W, screenSrc, type MarkRect, type ScreenId } from "./screens";

// How the modules fit together: two chains of real screens, each cropped to
// the row that the module before it wrote, centred on its mark. The rings are measured marks
// (screen-marks.json), the same ones the stories use.

/** The height of every crop, in the frame's points. */
const CROP_H = 230;

interface Link {
  section: string;
  module: string;
  text: string;
  scene: ScreenId;
  mark: string;
}

const CHAINS: ReadonlyArray<{ title: string; links: readonly Link[] }> = [
  {
    title: "From a recipe to the budget",
    links: [
      { section: "recipes", module: "Recipes", text: "The lasagne needs two things the house does not have.", scene: "recipe-lasagne", mark: "addMissing" },
      { section: "groceries", module: "Groceries", text: "Add missing puts them on the list, in their aisles.", scene: "groceries-recipe", mark: "ricotta" },
      { section: "costs", module: "Costs", text: "Done shopping writes the trip to Costs.", scene: "costs-groceries", mark: "trip" },
    ],
  },
  {
    title: "From a checklist to the calendar",
    links: [
      { section: "checklists", module: "Checklists", text: "The party checklist gets a date.", scene: "checklist-hosting", mark: "date" },
      { section: "household", module: "Tasks", text: "It becomes a task on that day, with its progress.", scene: "tasks", mark: "hosting" },
      { section: "calendar", module: "Calendar", text: "And it is on the household calendar.", scene: "calendar", mark: "hosting" },
    ],
  },
];

const marks = MARKS as unknown as Record<string, Record<string, MarkRect>>;
const pct = (n: number, of: number) => `${(n / of) * 100}%`;

function Crop({ link }: { link: Link }) {
  const r = marks[link.scene]?.[link.mark];
  // The crop centres on the mark, inside the frame.
  const ring = r && ringAround(r);
  const top = r ? Math.round(Math.min(Math.max(r[1] + r[3] / 2 - CROP_H / 2, 0), SCREEN_H - CROP_H)) : 0;
  return (
    <div className={styles.crop} style={{ aspectRatio: `${SCREEN_W} / ${CROP_H}` }}>
      {/* A percentage margin is a share of the width, so this moves the frame up by `top` points at any size. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={screenSrc(link.scene)} alt="" loading="lazy" decoding="async" style={{ marginTop: `-${pct(top, SCREEN_W)}` }} />
      {ring && <span className={styles.cropRing} style={{ left: pct(ring[0], SCREEN_W), top: pct(ring[1] - top, CROP_H), width: pct(ring[2], SCREEN_W), height: pct(ring[3], CROP_H) }} aria-hidden="true" />}
    </div>
  );
}

export function Fits() {
  return (
    <div className={styles.chains}>
      {CHAINS.map((chain) => (
        <div key={chain.title} className={styles.chain}>
          <h3 className={styles.chainTitle}>{chain.title}</h3>
          <ol className={styles.chainLinks}>
            {chain.links.map((link, i) => (
              <Fragment key={link.scene}>
                {i > 0 && (
                  <li className={styles.chainArrow} aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="24" height="24">
                      <path d="M5 12h14m-5-5 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </li>
                )}
                <li className={styles.chainLink} data-hue={sectionHue(link.section)}>
                  <Crop link={link} />
                  <div className={styles.chainText}>
                    <span className={styles.chainModule}>
                      <SectionTile sectionId={link.section} small />
                      {link.module}
                    </span>
                    <p>{link.text}</p>
                  </div>
                </li>
              </Fragment>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

