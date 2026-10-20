"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImageCarouselProps {
  images: string[];
  alt: string;
  className?: string;
}

export function ImageCarousel({ images, alt, className }: ImageCarouselProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true, dragFree: false });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
  const didDrag = useRef(false);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", onSelect);
    return () => { emblaApi.off("select", onSelect); };
  }, [emblaApi, onSelect]);

  const scrollPrev = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    emblaApi?.scrollPrev();
  }, [emblaApi]);

  const scrollNext = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    emblaApi?.scrollNext();
  }, [emblaApi]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerDownPos.current = { x: e.clientX, y: e.clientY };
    didDrag.current = false;
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (pointerDownPos.current) {
      const dx = Math.abs(e.clientX - pointerDownPos.current.x);
      const dy = Math.abs(e.clientY - pointerDownPos.current.y);
      didDrag.current = dx > 5 || dy > 5;
    }
    pointerDownPos.current = null;
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (didDrag.current || (e.target as HTMLElement).closest("button")) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, []);

  return (
    <div
      className={cn("relative group", className)}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
    >
      <div ref={emblaRef} className="overflow-hidden h-full cursor-grab active:cursor-grabbing">
        <div className="flex h-full">
          {images.map((src, i) => (
            <div key={i} className="flex-[0_0_100%] min-w-0 h-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={`${alt} - photo ${i + 1}`}
                className="w-full h-full object-cover pointer-events-none"
                loading={i === 0 ? "eager" : "lazy"}
                draggable={false}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Nav buttons: always visible on mobile, hover-only on desktop */}
      <button
        onClick={scrollPrev}
        className="absolute left-1.5 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 active:bg-black/70 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
        aria-label="Previous photo"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        onClick={scrollNext}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 active:bg-black/70 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
        aria-label="Next photo"
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      {images.length > 1 && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
          <span className="text-[10px] font-medium text-white bg-black/50 rounded-full px-1.5 py-0.5 tabular-nums">
            {selectedIndex + 1}/{images.length}
          </span>
          <div className="flex gap-1">
            {images.slice(0, 5).map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 w-1.5 rounded-full transition-colors",
                  i === selectedIndex ? "bg-white" : "bg-white/50"
                )}
              />
            ))}
            {images.length > 5 && (
              <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
