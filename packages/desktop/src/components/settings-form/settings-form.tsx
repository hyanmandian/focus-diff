import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { Switch } from "@/components/switch/switch";
import { cn } from "@/utils/cn/cn";
import type { Queue } from "@/utils/config/config";
import { useT } from "@/utils/i18n/i18n";
import { primary, shortcut } from "@/utils/os/os";
import { PANE_META, type PaneId } from "@/utils/settings-panes/settings-panes";

export const TONE_FILL: Record<Queue["tone"], string> = {
  blue: "bg-(--blue)",
  purple: "bg-(--purple)",
  green: "bg-(--green)",
  amber: "bg-(--orange)",
  red: "bg-(--red)",
  gray: "bg-(--gray)",
};

export const TWO_LINE_ITEM = "h-auto flex-col items-start gap-0 py-1 whitespace-normal";

export const PRESSED_CHIP =
  "aria-pressed:bg-selected aria-pressed:text-selected-foreground aria-pressed:active:brightness-90";

const HERO_PAST = 120;

function Back({ label, onBack, ref }: { label: string; onBack: () => void; ref?: React.Ref<HTMLButtonElement> }) {
  const t = useT();
  return (
    <button
      ref={ref}
      type="button"
      onClick={onBack}
      aria-label={t("settings.backTo", { pane: label })}
      title={t("settings.backToShortcut", { pane: label, shortcut: shortcut("[", ["cmd"]) })}
      className="-ml-1.5 grid size-(--toolbar-item-h) shrink-0 cursor-default place-items-center rounded-(--radius-capsule) text-muted-foreground focus-ring outline-none hover:bg-fill hover:text-foreground active:bg-(--fill-control-pressed)"
    >
      <ChevronLeft className="size-[18px]" strokeWidth={2} aria-hidden />
    </button>
  );
}

export function Pane({
  title,
  back,
  tools,
  hero,
  children,
}: {
  title: React.ReactNode;
  back?: { label: string; onBack: () => void; ref?: React.Ref<HTMLButtonElement> };
  tools?: React.ReactNode;
  hero?: PaneId;
  children: React.ReactNode;
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
          <div data-tauri-drag-region className="h-full min-w-4 flex-1" />
          {tools ? <div className="-mr-1.5 flex shrink-0 items-center gap-0.5">{tools}</div> : null}
        </div>
      </header>
      <div
        className="min-h-0 flex-1 [scrollbar-gutter:stable_both-edges] overflow-y-auto"
        onScroll={(e) => {
          setScrolled(e.currentTarget.scrollTop);
        }}
      >
        <div className="mx-auto flex max-w-[620px] flex-col gap-6 px-5 pt-1 pb-8">
          {meta && Icon ? (
            <div className="flex flex-col items-center gap-1.5 pt-1 pb-3 text-center">
              <span
                className="settings-tile mb-2 grid size-16 place-items-center rounded-[18px] text-white"
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

export function Intro({ children }: { children: React.ReactNode }) {
  return <p className="max-w-[62ch] px-3 text-callout text-muted-foreground">{children}</p>;
}

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

export function LinkRow({
  leading,
  label,
  description,
  muted,
  control,
  onOpen,
  ref,
}: {
  leading?: React.ReactNode;
  label: React.ReactNode;
  description?: React.ReactNode;
  muted?: boolean;
  control?: React.ReactNode;
  onOpen: () => void;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <div className="group/link relative flex min-h-11 items-center gap-3 px-3 py-1.5 transition-colors duration-(--duration-fast) first:rounded-t-[12px] last:rounded-b-[12px] has-[>button:active]:bg-fill has-[>button:hover]:bg-(--fill-quaternary)">
      {leading}
      <button
        ref={ref}
        type="button"
        onClick={onOpen}
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
}

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
      if (openId && primary(e) && e.key === "[") {
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

export function moved<T>(list: T[], index: number, by: number): T[] {
  const next = [...list];
  next.splice(index + by, 0, ...next.splice(index, 1));
  return next;
}
