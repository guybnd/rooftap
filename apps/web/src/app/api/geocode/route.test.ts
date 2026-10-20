import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// HOUP-149: this route exists to let native (Bearer-only, no cookie jar for
// this origin) geocode without shipping the Mapbox token — mirrors
// push/device-token/route.test.ts's shape for a Bearer-capable getSessionUser
// route, plus the geocodeAddress found/not-found branches.
const getSessionUserMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({ getSessionUser: getSessionUserMock }));

const geocodeAddressMock = vi.fn();
vi.mock("@/lib/geocode", () => ({ geocodeAddress: (...args: unknown[]) => geocodeAddressMock(...args) }));

function req(params: Record<string, string>): NextRequest {
  const url = new URL("https://example.com/api/geocode");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/geocode", () => {
  it("401s with no session user (no cookie, no Bearer)", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const { GET } = await import("./route");

    const res = await GET(req({ address: "1 Test St" }));
    expect(res.status).toBe(401);
  });

  it("400s when address is missing", async () => {
    getSessionUserMock.mockResolvedValue({ id: "user-1" });
    const { GET } = await import("./route");

    const res = await GET(req({}));
    expect(res.status).toBe(400);
  });

  it("resolves lat/lng for a Bearer-authenticated caller", async () => {
    getSessionUserMock.mockResolvedValue({ id: "user-1" });
    geocodeAddressMock.mockResolvedValue({ lat: -37.8, lng: 144.9 });
    const { GET } = await import("./route");

    const res = await GET(req({ address: "1 Test St", suburb: "Richmond" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ lat: -37.8, lng: 144.9 });
    expect(geocodeAddressMock).toHaveBeenCalledWith("1 Test St", "Richmond");
  });

  it("404s when the geocoder finds nothing", async () => {
    getSessionUserMock.mockResolvedValue({ id: "user-1" });
    geocodeAddressMock.mockResolvedValue(null);
    const { GET } = await import("./route");

    const res = await GET(req({ address: "nowhere" }));
    expect(res.status).toBe(404);
  });
});
