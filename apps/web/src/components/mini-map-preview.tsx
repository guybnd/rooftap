"use client";

interface MiniMapPreviewProps {
  lat: number;
  lng: number;
}

export function MiniMapPreview({ lat, lng }: MiniMapPreviewProps) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;

  const mapUrl = `https://api.mapbox.com/styles/v1/mapbox/streets-v11/static/pin-s+ef4444(${lng},${lat})/${lng},${lat},14/600x300@2x?access_token=${token}`;

  return (
    <div
      className="relative aspect-[2/1] w-full overflow-hidden rounded-md bg-muted"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={mapUrl}
        alt="Apartment location map"
        loading="lazy"
        className="w-full h-full object-cover"
      />
    </div>
  );
}
