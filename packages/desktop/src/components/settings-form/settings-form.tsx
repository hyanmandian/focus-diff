// The building blocks of a macOS grouped form (System Settings, Raycast's settings): a pane with its
// title in the window's title-bar strip, sections drawn as rounded insets with a heading and
// footnote, and rows inside them with the label on the left and the control on the right, or, for
// wide controls, below it.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { Switch } from "@/components/switch/switch";
import { cn } from "@/utils/cn/cn";
import type { Queue } from "@/utils/config/config";
import { useT } from "@/utils/i18n/i18n";
import { PANE_META, type PaneId } from "@/utils/settings-panes/settings-panes";

/** A queue's colour, as a fill: the system colours (the -ic ones are for text). */
export const TONE_FILL: Record<Queue["tone"], string> = {
  blue: "bg-(--blue)",
  purple: "bg-(--purple)",
  green: "bg-(--green)",
  amber: "bg-(--orange)",
  red: "bg-(--red)",
  gray: "bg-(--gray)",
};

/** A menu item with a name and a line about it under, as the add menus have. */
export const TWO_LINE_ITEM = "h-auto flex-col items-start gap-0 py-1 whitespace-normal";

/** A push button that stays in (a preset picked, a queue included): the accent, as Tahoe draws a
 *  chosen segment, gray in a window that isn't in front. */
export const PRESSED_CHIP =
  "aria-pressed:bg-selected aria-pressed:text-selected-foreground aria-pressed:active:brightness-90";

/** How far a pane's big header scrolls before its name takes its place in the strip. */
const HERO_PAST = 120;

/** The way back from a detail to its list, in the strip. */
function Back({ label, onBack, ref }: { label: string; onBack: () => void; ref?: React.Ref<HTMLButtonElement> }) {
  const t = useT();
  return (
    <button
      ref={ref}
      type="button"
      onClick={onBack}
      aria-label={t("settings.backTo", { pane: label })}
      title={t("settings.backToShortcut", { pane: label })}
      className="-ml-1.5 grid size-(--toolbar-item-h) shrink-0 cursor-default place-items-center rounded-(--radius-capsule) text-muted-foreground focus-ring outline-none hover:bg-fill hover:text-foreground active:bg-(--fill-control-pressed)"
    >
      {/* A toolbar item, which (unlike a button in the content) may light up under the pointer. */}
      <ChevronLeft className="size-[18px]" strokeWidth={2} aria-hidden />
    </button>
  );
}

/**
 * A pane: the 52px strip level with the traffic lights (its title, a way back from a detail, the
 * detail's own tools) and a scrolling column under it. The strip is the window's drag area; a
 * hairline shows under it once the content scrolls beneath, as in the system's own windows.
 * `hero`: a top-level pane opens on its tile, large, its name and what it's for, centred (Tahoe's
 * and Raycast's settings); the strip takes the name only once that has scrolled away.
 */
export function Pane({
  title,
  back,
  tools,
  hero,
  children,
  className,
}: {
  title: React.ReactNode;
  back?: { label: string; onBack: () => void; ref?: React.Ref<HTMLButtonElement> };
  tools?: React.ReactNode;
  hero?: PaneId;
  children: React.ReactNode;
  className?: string;
}) {
  const [scrolled, setScrolled] = useState(0);
  const t = useT();
  const meta = hero ? PANE_META[hero] : null;
  const Icon = meta?.icon;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header
        data-tauri-drag-region
        className={cn(
          "shrink-0 border-b transition-colors duration-(--duration)",
          scrolled > 0 && (!hero || scrolled > HERO_PAST) ? "border-separator" : "border-transparent",
        )}
      >
        {/* Lined up with the column below, so the title sits over the groups' edge. */}
        <div data-tauri-drag-region className="mx-auto flex h-[52px] max-w-[620px] items-center gap-1.5 px-5">
          {back ? <Back {...back} /> : null}
          <h1
            data-tauri-drag-region
            aria-hidden={hero ? true : undefined}
            className={cn(
              "min-w-0 truncate text-title3 font-semibold transition-opacity duration-(--duration)",
              hero && scrolled <= HERO_PAST && "opacity-0",
            )}
          >
            {title}
          </h1>
          {/* The empty stretch between title and tools is the most likely grab point. */}
          <div data-tauri-drag-region className="h-full min-w-4 flex-1" />
          {tools ? <div className="-mr-1.5 flex shrink-0 items-center gap-0.5">{tools}</div> : null}
        </div>
      </header>
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          setScrolled(e.currentTarget.scrollTop);
        }}
      >
        <div className={cn("mx-auto flex max-w-[620px] flex-col gap-6 px-5 pt-1 pb-8", className)}>
          {meta && Icon ? (
            <div className="flex flex-col items-center gap-1.5 pt-1 pb-3 text-center">
              <span
                className="settings-tile settings-tile-large mb-2 grid size-16 place-items-center rounded-[18px] text-white"
                data-tile={meta.tile}
                aria-hidden
              >
                <Icon className="size-8" strokeWidth={2} />
              </span>
              <h1 className="text-title1 leading-tight font-bold">{title}</h1>
              <p className="text-body text-muted-foreground">{t(`settings.subtitle.${hero!}`)}</p>
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}

/** A pane's lead-in: what it's for, in secondary text above its sections. */
export function Intro({ children }: { children: React.ReactNode }) {
  return <p className="max-w-[62ch] px-3 text-callout text-muted-foreground">{children}</p>;
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
          {title ? <h2 className="text-headline font-bold">{title}</h2> : null}
          {accessory ? <div className="ml-auto flex items-center">{accessory}</div> : null}
        </div>
      ) : null}
      <div className={cn("settings-group flex flex-col rounded-[12px] bg-(--settings-group)", className)}>
        {children}
      </div>
      {footer ? <div className="max-w-[70ch] px-3 text-subheadline text-muted-foreground">{footer}</div> : null}
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
            <label htmlFor={htmlFor} className="block text-body">
              {label}
            </label>
          ) : (
            <div className="text-body">{label}</div>
          )
        ) : null}
        {description ? <div className="mt-0.5 text-subheadline text-muted-foreground">{description}</div> : null}
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
    <div className={cn("flex min-h-10 items-center gap-4 px-3 py-2", className)}>
      {text}
      {children ? (
        <div className={cn("flex items-center gap-2", text ? "shrink-0" : "min-w-0 flex-1")}>{children}</div>
      ) : null}
    </div>
  );
}

/** A row with a switch, the mini one System Settings puts in a grouped form's rows. */
export function SwitchRow({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: React.ReactNode;
}) {
  const id = useId();
  return (
    <Row label={label} description={hint} htmlFor={id}>
      <Switch id={id} size="sm" checked={checked} onCheckedChange={onChange} />
    </Row>
  );
}

/**
 * A row that opens a detail (a queue, an action): the whole row is the button, with a chevron at
 * its end, and an optional control (a switch) that stays its own target above it. No highlight under
 * the pointer, as in System Settings; a fill while pressed.
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
    <div className="group/link relative flex min-h-11 items-center gap-3 px-3 py-1.5 transition-colors duration-(--duration-fast) first:rounded-t-[12px] last:rounded-b-[12px] has-[>button:active]:bg-fill has-[>button:hover]:bg-(--fill-quaternary)">
      {leading}
      <button
        ref={ref}
        type="button"
        onClick={onOpen}
        aria-label={ariaLabel}
        className="min-w-0 flex-1 cursor-default text-left outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:outline-3 focus-visible:after:-outline-offset-3 focus-visible:after:outline-(--focus-ring)"
      >
        <span className={cn("block truncate text-body", muted && "text-muted-foreground")}>{label}</span>
        {description ? (
          <span className="mt-0.5 block truncate text-subheadline text-muted-foreground">{description}</span>
        ) : null}
      </button>
      {control ? <div className="relative z-10 flex shrink-0 items-center">{control}</div> : null}
      <ChevronRight className="size-3.5 shrink-0 text-(--label-tertiary)" strokeWidth={2.25} aria-hidden />
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
    const onKey = (e: KeyboardEvent) => {
      if (openId && e.metaKey && e.key === "[") {
        e.preventDefault();
        returnTo.current = openId;
        setOpenId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [openId]);
  const rowRef = (id: string) => (el: HTMLButtonElement | null) => {
    if (el) rows.current.set(id, el);
    else rows.current.delete(id);
  };
  return { openId, open, close, backRef, rowRef };
}

/** Arrow keys within a hand-drawn radio group: move to the next or previous choice and pick it. */
export function radioKeys(e: React.KeyboardEvent<HTMLElement>) {
  const by =
    e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
  if (!by) return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=radio]")];
  const i = radios.findIndex((r) => r === document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  const next = radios[(i + by + radios.length) % radios.length];
  next?.focus();
  next?.click();
}
