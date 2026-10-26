// The building blocks of a macOS grouped form (System Settings, Raycast's settings): a pane with its
// title in the window's title-bar strip, sections drawn as rounded insets with a heading and
// footnote, and rows inside them with the label on the left and the control on the right, or, for
// wide controls, below it.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A pane: the 52px strip level with the traffic lights (its title, a way back from a detail, the
 * detail's own tools) and a scrolling column under it. The strip is the window's drag area; a
 * hairline shows under it once the content scrolls beneath, as in the system's own windows.
 */
export function Pane({
  title,
  back,
  tools,
  children,
  className,
}: {
  title: React.ReactNode;
  back?: { label: string; onBack: () => void; ref?: React.Ref<HTMLButtonElement> };
  tools?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [scrolled, setScrolled] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header
        data-tauri-drag-region
        className={cn("shrink-0 border-b motion-safe:transition-colors", scrolled ? "border-[var(--settings-separator)]" : "border-transparent")}
      >
        {/* Lined up with the column below, so the title sits over the groups' edge. */}
        <div data-tauri-drag-region className="mx-auto flex h-[52px] max-w-[620px] items-center gap-1.5 px-5">
          {back ? (
            <button
              ref={back.ref}
              type="button"
              onClick={back.onBack}
              aria-label={`Back to ${back.label}`}
              title={`Back to ${back.label} (⌘[)`}
              className="-ml-2 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="size-[18px]" strokeWidth={2} aria-hidden />
            </button>
          ) : null}
          <h1 data-tauri-drag-region className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em]">
            {title}
          </h1>
          {/* The empty stretch between title and tools is the most likely grab point. */}
          <div data-tauri-drag-region className="h-full min-w-4 flex-1" />
          {tools ? <div className="-mr-1.5 flex shrink-0 items-center gap-0.5">{tools}</div> : null}
        </div>
      </header>
      <div className="settings-scroll min-h-0 flex-1 overflow-y-auto" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}>
        <div className={cn("mx-auto flex max-w-[620px] flex-col gap-6 px-5 pt-1 pb-8", className)}>{children}</div>
      </div>
    </div>
  );
}

/** A pane's lead-in: what it's for, in secondary text above its sections. */
export function Intro({ children }: { children: React.ReactNode }) {
  return <p className="max-w-[62ch] px-3 text-[12px] leading-[1.45] text-muted-foreground">{children}</p>;
}

/** A section: an optional heading (and something on its right, like an add button), the inset, a footnote. */
export function Group({
  title,
  accessory,
  footer,
  children,
  className,
}: {
  title?: React.ReactNode;
  accessory?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      {title || accessory ? (
        <div className="flex min-h-6 items-end gap-2 px-3">
          {title ? <h2 className="text-[13px] font-semibold">{title}</h2> : null}
          {accessory ? <div className="ml-auto flex items-center">{accessory}</div> : null}
        </div>
      ) : null}
      <div className={cn("settings-group flex flex-col rounded-[10px] bg-[var(--settings-group)] ring-1 ring-[var(--settings-group-edge)] ring-inset", className)}>
        {children}
      </div>
      {footer ? <div className="max-w-[70ch] px-3 text-[11px] leading-snug text-muted-foreground">{footer}</div> : null}
    </section>
  );
}

/**
 * A row: label and description on the left, the control on the right. `stacked` puts the control
 * under the label at full width, for lists, text fields and anything wide.
 */
export function Row({
  label,
  description,
  htmlFor,
  stacked,
  children,
  className,
}: {
  label?: React.ReactNode;
  description?: React.ReactNode;
  htmlFor?: string;
  stacked?: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  const text =
    label || description ? (
      <div className={cn("min-w-0", !stacked && "flex-1")}>
        {label ? (
          htmlFor ? (
            <label htmlFor={htmlFor} className="block text-[13px] leading-[18px]">
              {label}
            </label>
          ) : (
            <div className="text-[13px] leading-[18px]">{label}</div>
          )
        ) : null}
        {description ? <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{description}</div> : null}
      </div>
    ) : null;
  if (stacked)
    return (
      <div className={cn("flex flex-col gap-2 px-3 py-3", className)}>
        {text}
        {children}
      </div>
    );
  return (
    <div className={cn("flex min-h-11 items-center gap-4 px-3 py-2", className)}>
      {text}
      {children ? <div className={cn("flex items-center gap-2", text ? "shrink-0" : "min-w-0 flex-1")}>{children}</div> : null}
    </div>
  );
}

/**
 * A row that opens a detail (a queue, an action): the whole row is the button, with a chevron at
 * its end, and an optional control (a switch) that stays its own target above it.
 */
export const LinkRow = forwardRef<
  HTMLButtonElement,
  {
    leading?: React.ReactNode;
    label: React.ReactNode;
    description?: React.ReactNode;
    muted?: boolean;
    control?: React.ReactNode;
    onOpen: () => void;
    "aria-label"?: string;
  }
>(function LinkRow({ leading, label, description, muted, control, onOpen, "aria-label": ariaLabel }, ref) {
  return (
    <div className="group/link relative flex min-h-11 items-center gap-3 px-3 py-1.5 first:rounded-t-[10px] last:rounded-b-[10px] hover:bg-foreground/[0.03]">
      {leading}
      <button
        ref={ref}
        type="button"
        onClick={onOpen}
        aria-label={ariaLabel}
        className="min-w-0 flex-1 text-left outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
      >
        <span className={cn("block truncate text-[13px] leading-[18px]", muted && "text-muted-foreground")}>{label}</span>
        {description ? <span className="mt-0.5 block truncate text-[11px] leading-snug text-muted-foreground">{description}</span> : null}
      </button>
      {control ? <div className="relative z-10 flex shrink-0 items-center">{control}</div> : null}
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" strokeWidth={2.25} aria-hidden />
    </div>
  );
});

/**
 * A list that opens one item at a time in place (System Settings' drill-in), rather than a third
 * column: which item is open, focus moved to the way back on the way in and to the item's row on
 * the way out, and ⌘[ to go back.
 */
export function useDetail() {
  const [openId, setOpenId] = useState<string | null>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const returnTo = useRef<string | null>(null);
  const open = (id: string) => {
    returnTo.current = null;
    setOpenId(id);
  };
  const close = () => {
    returnTo.current = openId;
    setOpenId(null);
  };
  useLayoutEffect(() => {
    if (openId) backRef.current?.focus({ preventScroll: true });
    else if (returnTo.current) rows.current.get(returnTo.current)?.focus({ preventScroll: true });
  }, [openId]);
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "[") {
        e.preventDefault();
        returnTo.current = openId;
        setOpenId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);
  const rowRef = (id: string) => (el: HTMLButtonElement | null) => {
    if (el) rows.current.set(id, el);
    else rows.current.delete(id);
  };
  return { openId, open, close, backRef, rowRef };
}

/** Arrow keys within a hand-drawn radio group: move to the next or previous choice and pick it. */
export function radioKeys(e: React.KeyboardEvent<HTMLElement>) {
  const by = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
  if (!by) return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=radio]")];
  const i = radios.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  const next = radios[(i + by + radios.length) % radios.length];
  next?.focus();
  next?.click();
}
