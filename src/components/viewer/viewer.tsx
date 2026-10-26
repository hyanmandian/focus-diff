// A picture from a description or comment, shown large: zoom with the trackpad, the wheel or the
// buttons, drag to move around, Esc or a click outside to close. Opened with openViewer from
// anywhere on the page; <Viewer /> is mounted once per page.

import { Minus, Plus, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/button/button";
import { useT } from "@/utils/i18n/i18n";

type Picture = { src: string; alt: string };

let current: Picture | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  listeners.forEach((l) => l());
};

export function openViewer(picture: Picture) {
  current = picture;
  emit();
}

function close() {
  current = null;
  emit();
}

const MIN = 0.5;
const MAX = 8;

export function Viewer() {
  const t = useT();
  const picture = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);

  const zoom = useCallback((by: number) => {
    setScale((s) => Math.min(MAX, Math.max(MIN, s * by)));
  }, []);
  const reset = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  useEffect(() => {
    if (!picture) return;
    opener.current = document.activeElement;
    reset();
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "+" || e.key === "=") zoom(1.25);
      else if (e.key === "-") zoom(0.8);
      else if (e.key === "0") reset();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Back where the person was.
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [picture, zoom]);

  if (!picture) return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={picture.alt || t("shared.pictureLabel")}
      className="fixed inset-0 z-50 flex animate-in flex-col bg-black/85 backdrop-blur-sm duration-150 fade-in-0 motion-reduce:animate-none"
      onClick={(e) => e.target === e.currentTarget && close()}
      onWheel={(e) => {
        // A pinch on a trackpad comes as a wheel with Ctrl.
        e.preventDefault();
        zoom(e.deltaY < 0 ? 1.1 : 0.9);
      }}
    >
      <div className="flex shrink-0 items-center justify-end gap-1 p-3 text-white">
        {picture.alt ? <p className="mr-auto truncate pl-2 text-body text-white/80">{picture.alt}</p> : null}
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-white hover:bg-white/15 hover:text-white"
          aria-label={t("shared.zoomOut")}
          onClick={() => {
            zoom(0.8);
          }}
        >
          <Minus />
        </Button>
        <span className="w-12 text-center text-callout text-white/80 tabular-nums" aria-live="polite">
          {Math.round(scale * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-white hover:bg-white/15 hover:text-white"
          aria-label={t("shared.zoomIn")}
          onClick={() => {
            zoom(1.25);
          }}
        >
          <Plus />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-white hover:bg-white/15 hover:text-white"
          aria-label={t("shared.actualSize")}
          onClick={reset}
        >
          <RotateCcw />
        </Button>
        <Button
          ref={closeButton}
          variant="ghost"
          size="icon-sm"
          className="text-white hover:bg-white/15 hover:text-white"
          aria-label={t("shared.close")}
          onClick={close}
        >
          <X />
        </Button>
      </div>
      <div
        className="flex min-h-0 flex-1 cursor-grab items-center justify-center overflow-hidden active:cursor-grabbing"
        onClick={(e) => e.target === e.currentTarget && close()}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setOffset({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y });
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <img
          src={picture.src}
          alt={picture.alt}
          draggable={false}
          className="max-h-full max-w-full transition-transform duration-100 ease-out select-none motion-reduce:transition-none"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          onDoubleClick={() => {
            scale === 1 ? zoom(2) : reset();
          }}
        />
      </div>
    </div>,
    document.body,
  );
}
