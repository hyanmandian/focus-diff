// The filled pill behind a row's chosen option that slides over to the next one picked, as in
// Focus Diff's popup and bar (its timing and curve). It lives inside the row (its parent, which
// must be positioned), so it scrolls with it; options mark themselves with data-pill={key}.

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** `line`: a 2px underline under the chosen tab instead of a filled pill. */
export function SlidingPill({ selected, className, line = false }: { selected: string; className?: string; line?: boolean }) {
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Placed once without moving, so it doesn't fly in from the corner when the row appears.
  const [ready, setReady] = useState(false);
  const placed = useRef(false);
  const self = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    // Its own parent: a ref on the row isn't set yet when a child's layout effect runs.
    const el = self.current?.parentElement;
    if (!el) return;
    const place = () => {
      const option = [...el.querySelectorAll<HTMLElement>("[data-pill]")].find((o) => o.dataset.pill === selected);
      if (!option?.offsetWidth) return;
      setBox({ x: option.offsetLeft, y: option.offsetTop, w: option.offsetWidth, h: option.offsetHeight });
      if (!placed.current) {
        placed.current = true;
        requestAnimationFrame(() => setReady(true));
      }
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    for (const option of el.querySelectorAll("[data-pill]")) observer.observe(option);
    return () => observer.disconnect();
  }, [selected]);

  return (
    <span
      ref={self}
      aria-hidden
      className={cn(
        "pointer-events-none absolute top-0 left-0",
        line ? "rounded-full bg-foreground" : "-z-10 rounded-lg bg-selected",
        ready && "transition-[transform,width,height] duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
        className,
      )}
      style={box ? (line ? { transform: `translate(${box.x}px, ${box.y + box.h - 2}px)`, width: box.w, height: 2 } : { transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }) : { opacity: 0 }}
    />
  );
}
