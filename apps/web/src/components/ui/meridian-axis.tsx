// FLUX-1570: the Axis Mundi meridian — "one vertical gilt axis per surface."
// Purely decorative (aria-hidden), CSS-gated to `[data-theme="axis-mundi-*"]`
// in globals.css so it is a structural no-op under any non-Axis theme.
// `hero` = the home lede's center line + glowing top node. `dock` =
// the mobile tab bar's center tick. Never mount a third call site without
// re-reading hearth.md's "one meridian per surface" rule — it does not
// belong in dense list rows.
export function MeridianAxis({ variant }: { variant: "hero" | "dock" }) {
  return (
    <div aria-hidden="true" className={`meridian-axis meridian-axis--${variant}`}>
      {variant === "hero" && <span className="meridian-axis__node" />}
    </div>
  );
}
