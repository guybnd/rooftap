// The maps for the screen demo: Mapbox needs a token the demo doesn't ship,
// so the places are drawn on a plain street sketch instead, home and pins
// placed by their coordinates.
import type { Apartment, Appointment, ApartmentWithScore } from "@homeup/core";
import { HOUSEHOLD } from "../fixtures";

interface Pin {
  id: string;
  lat: number;
  lng: number;
  label: string;
  detail: string;
  badge: string;
}

const W = 360;
const H = 460;

function Sketch({ pins, route, caption }: { pins: Pin[]; route: boolean; caption: string }) {
  const home = { lat: HOUSEHOLD.group.home_lat ?? -37.7664, lng: HOUSEHOLD.group.home_lng ?? 144.9602 };
  const all = [home, ...pins];
  const lats = all.map((p) => p.lat);
  const lngs = all.map((p) => p.lng);
  const pad = 0.012;
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats) - pad, Math.max(...lats) + pad, Math.min(...lngs) - pad, Math.max(...lngs) + pad];
  const x = (lng: number) => 30 + ((lng - minLng) / (maxLng - minLng)) * (W - 60);
  const y = (lat: number) => 40 + ((maxLat - lat) / (maxLat - minLat)) * (H - 90);
  const points = [home, ...pins].map((p) => `${x(p.lng)},${y(p.lat)}`).join(" ");
  return (
    <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid var(--border)", background: "var(--card)" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ display: "block", width: "100%", height: "auto" }} role="img" aria-label={caption}>
        <rect width={W} height={H} fill="var(--muted)" />
        {/* A loose street grid and one long diagonal road. */}
        {Array.from({ length: 9 }, (_, i) => (
          <line key={`v${i}`} x1={20 + i * 42} y1={0} x2={10 + i * 42} y2={H} stroke="var(--background)" strokeWidth={i % 3 === 0 ? 7 : 3} />
        ))}
        {Array.from({ length: 11 }, (_, i) => (
          <line key={`h${i}`} x1={0} y1={18 + i * 44} x2={W} y2={26 + i * 44} stroke="var(--background)" strokeWidth={i % 4 === 0 ? 7 : 3} />
        ))}
        <path d={`M -10 ${H * 0.82} Q ${W * 0.4} ${H * 0.55} ${W + 10} ${H * 0.12}`} fill="none" stroke="var(--background)" strokeWidth={10} />
        <rect x={W * 0.62} y={H * 0.62} width={70} height={52} rx={10} fill="color-mix(in oklch, var(--success) 22%, transparent)" />
        {route && <polyline points={points} fill="none" stroke="var(--primary)" strokeWidth={3} strokeDasharray="7 6" strokeLinecap="round" />}
        <g transform={`translate(${x(home.lng)} ${y(home.lat)})`}>
          <circle r={13} fill="var(--foreground)" />
          <path d="M -6 1 L 0 -5 L 6 1 M -4 0 L -4 5 L 4 5 L 4 0" fill="none" stroke="var(--background)" strokeWidth={1.8} strokeLinejoin="round" />
        </g>
        {pins.map((p) => (
          <g key={p.id} transform={`translate(${x(p.lng)} ${y(p.lat)})`}>
            <circle r={14} fill="var(--primary)" stroke="var(--background)" strokeWidth={3} />
            <text textAnchor="middle" dy={4.5} fontSize={12} fontWeight={700} fill="var(--primary-foreground)">
              {p.badge}
            </text>
            <g transform="translate(0 20)">
              <rect x={-62} y={0} width={124} height={34} rx={8} fill="var(--card)" stroke="var(--border)" />
              <text textAnchor="middle" y={14} fontSize={11} fontWeight={600} fill="var(--foreground)">
                {p.label}
              </text>
              <text textAnchor="middle" y={27} fontSize={10} fill="var(--muted-foreground)">
                {p.detail}
              </text>
            </g>
          </g>
        ))}
      </svg>
      <p style={{ margin: 0, padding: "10px 14px", fontSize: 12, color: "var(--muted-foreground)" }}>{caption}</p>
    </div>
  );
}

const street = (a: Apartment) => a.address.split(",")[0];

export function MapViewLazy({ apartments }: { apartments: ApartmentWithScore[] }) {
  const pins = apartments
    .filter((a) => a.lat != null && a.lng != null)
    .map((a) => ({ id: a.id, lat: a.lat!, lng: a.lng!, label: street(a), detail: `$${a.rent_per_week ?? "?"}/wk · ${a.suburb ?? ""}`, badge: String(a.preliminary_score ?? "·") }));
  return <Sketch pins={pins} route={false} caption="Each place by its score, with home as the black pin. Your own server shows a live map." />;
}

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function ItineraryMapLazy({ initialDate }: { initialDate?: string }) {
  const apartments = HOUSEHOLD.stores.apartments as Record<string, Apartment>;
  const visits = Object.values(HOUSEHOLD.stores.appointments as Record<string, Appointment>);
  const days = [...new Set(visits.map((v) => localDay(v.scheduled_at)))].sort();
  const today = localDay(new Date().toISOString());
  const day = initialDate ?? (days.includes(today) ? today : days.find((d) => d > today) ?? today);
  const stops = visits.filter((v) => localDay(v.scheduled_at) === day).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const pins = stops.flatMap((v, i) => {
    const a = apartments[v.apartment_id];
    if (!a?.lat || !a?.lng) return [];
    const time = new Date(v.scheduled_at).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
    return [{ id: v.id, lat: a.lat, lng: a.lng, label: street(a), detail: time, badge: String(i + 1) }];
  });
  const when = new Date(`${day}T12:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short" });
  return (
    <Sketch
      pins={pins}
      route
      caption={pins.length ? `${when}: ${pins.length} viewing${pins.length === 1 ? "" : "s"} in order from home. Your own server shows a live map.` : `${when}: no viewings booked.`}
    />
  );
}
