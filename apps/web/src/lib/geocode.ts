export async function geocodeAddress(
  address: string,
  suburb?: string | null
): Promise<{ lat: number; lng: number } | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;

  const query = suburb ? `${address}, ${suburb}, Australia` : `${address}, Australia`;
  const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(query)}&country=AU&limit=1&access_token=${token}`;

  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  const coords = data.features?.[0]?.geometry?.coordinates;
  if (!coords) return null;

  return { lng: coords[0], lat: coords[1] };
}
