// next/image for the screen demo: a plain img.
import type { ImgHTMLAttributes } from "react";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string | { src: string }; fill?: boolean; priority?: boolean; unoptimized?: boolean };

export default function Image({ src, fill, priority: _priority, unoptimized: _unoptimized, alt = "", style, ...rest }: Props) {
  const url = typeof src === "string" ? src : src.src;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} style={fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", ...style } : style} {...rest} />;
}
