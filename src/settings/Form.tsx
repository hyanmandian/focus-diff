// The building blocks of a macOS grouped form (System Settings): a scrolling page, sections drawn as
// rounded insets with a heading and footnote, and rows inside them with the label on the left and
// the control on the right, or, for wide controls, below it.

import { cn } from "@/lib/utils";

/** A pane's scrolling column, centred, at System Settings' reading width. */
export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className={cn("mx-auto flex max-w-[580px] flex-col gap-5 px-5 pt-4 pb-6", className)}>{children}</div>
    </div>
  );
}

/** A pane's lead-in: what it's for, in secondary text above its sections. */
export function Intro({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 text-[12px] leading-snug text-muted-foreground">{children}</p>;
}

/** A section: an optional heading (and something on its right, like a link), the inset, a footnote. */
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
        <div className="flex min-h-5 items-center gap-2 px-2.5">
          {title ? <h3 className="text-[13px] font-semibold">{title}</h3> : null}
          {accessory ? <div className="ml-auto flex items-center">{accessory}</div> : null}
        </div>
      ) : null}
      <div
        className={cn(
          "settings-group flex flex-col rounded-[10px] bg-[var(--settings-group)] ring-1 ring-[var(--settings-group-edge)] ring-inset",
          className,
        )}
      >
        {children}
      </div>
      {footer ? <div className="px-2.5 text-[11px] leading-snug text-muted-foreground">{footer}</div> : null}
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
        {description ? <div className="mt-px text-[11px] leading-snug text-muted-foreground">{description}</div> : null}
      </div>
    ) : null;
  if (stacked)
    return (
      <div className={cn("flex flex-col gap-2 px-2.5 py-2.5", className)}>
        {text}
        {children}
      </div>
    );
  return (
    <div className={cn("flex min-h-10 items-center gap-4 px-2.5 py-2", className)}>
      {text}
      {children ? <div className={cn("flex items-center gap-2", text ? "shrink-0" : "min-w-0 flex-1")}>{children}</div> : null}
    </div>
  );
}

/** A list beside a pane's details, drawn as an inset with its add button along the bottom. */
export function SideList({ label, children, footer }: { label: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <aside className="flex min-h-0 flex-col py-4 pl-4">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] bg-[var(--settings-group)] ring-1 ring-[var(--settings-group-edge)] ring-inset">
        <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto p-1.5" aria-label={label}>
          {children}
        </ul>
        <div className="flex items-center border-t border-[var(--settings-separator)] p-1">{footer}</div>
      </div>
    </aside>
  );
}

/** The row look for SideList items; the selected one gets the system's quiet gray fill. */
export const sideItem = (selected: boolean) =>
  cn("flex h-7 items-center gap-2 rounded-md px-2 text-[13px]", selected ? "bg-[var(--settings-selection)]" : "hover:bg-foreground/[0.04]");
