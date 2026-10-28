import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { cva, type VariantProps } from "class-variance-authority";
import { createContext, useContext, useState, type CSSProperties } from "react";

import { SlidingPill } from "@/components/sliding-pill/sliding-pill";
import { cn } from "@/utils/cn/cn";

// A toggle button: borderless, a fill under the pointer, while it's on or pressed. In a group with
// variant="outline" it's a segment of a segmented control (toggle-group.tsx).
const toggleVariants = cva(
  "group/toggle inline-flex cursor-default items-center justify-center gap-1 rounded-(--radius-control) text-body font-normal whitespace-nowrap focus-ring transition-colors duration-(--duration-fast) outline-none select-none hover:bg-fill active:bg-(--fill-control-pressed) disabled:pointer-events-none disabled:text-(--label-tertiary) aria-pressed:bg-fill data-[state=on]:bg-fill [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        /** A segment: the chosen one in the accent with white text, as Tahoe draws them in content. */
        outline:
          "flex-1 rounded-(--radius-control-sm) px-3 hover:not-aria-pressed:bg-(--fill-control-hover) active:not-aria-pressed:bg-(--fill-control-pressed) aria-pressed:bg-selected aria-pressed:text-selected-foreground",
      },
      size: {
        default: "h-(--control-h) min-w-(--control-h) px-2.5",
        sm: "h-(--control-h) min-w-(--control-h) px-2",
        lg: "h-(--control-h-lg) min-w-(--control-h-lg) px-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const ToggleGroupContext = createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number;
    orientation?: "horizontal" | "vertical";
    /** The chosen segment's fill is the group's sliding pill, not its own. */
    sliding?: boolean;
  }
>({
  size: "default",
  variant: "default",
  spacing: 2,
  orientation: "horizontal",
  sliding: false,
});

// A row of toggles; with variant="outline", a segmented control: one track, equal segments (each as
// wide as the widest label, so none spills out of its segment), the chosen one in the accent, on a
// pill that slides over to the next one picked, as everywhere else a choice is made in the app.
function ToggleGroup({
  className,
  variant,
  size,
  spacing = 2,
  orientation = "horizontal",
  children,
  value,
  defaultValue,
  onValueChange,
  ...props
}: ToggleGroupPrimitive.Props &
  VariantProps<typeof toggleVariants> & {
    spacing?: number;
    orientation?: "horizontal" | "vertical";
  }) {
  const gap: CSSProperties & Record<"--gap", number> = { "--gap": spacing };
  // What's chosen, followed here too when the group keeps it itself (defaultValue).
  const [own, setOwn] = useState(defaultValue);
  const current = value ?? own;
  // One segment chosen: it slides. None, or several (a row of toggles), each fills its own.
  const chosen = variant === "outline" && current?.length === 1 ? String(current[0]) : null;
  return (
    <ToggleGroupPrimitive
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next, details) => {
        setOwn(next);
        onValueChange?.(next, details);
      }}
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      style={gap}
      className={cn(
        "group/toggle-group relative isolate flex w-fit flex-row items-center gap-[--spacing(var(--gap))] rounded-(--radius-control) data-[variant=outline]:grid data-[variant=outline]:auto-cols-fr data-[variant=outline]:grid-flow-col data-[variant=outline]:gap-0 data-[variant=outline]:bg-fill data-vertical:flex-col data-vertical:items-stretch",
        className,
      )}
      {...props}
    >
      {/* The React Compiler keeps this object the same between renders. */}
      {/* oxlint-disable-next-line react/jsx-no-constructed-context-values */}
      {chosen === null ? null : <SlidingPill selected={chosen} className="rounded-(--radius-control-sm) bg-selected" />}
      <ToggleGroupContext.Provider value={{ variant, size, spacing, orientation, sliding: chosen !== null }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  );
}

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  const context = useContext(ToggleGroupContext);

  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      data-pill={context.sliding ? String(props.value) : undefined}
      data-variant={context.variant ?? variant}
      data-size={context.size ?? size}
      data-spacing={context.spacing}
      className={cn(
        "shrink-0 focus-visible:z-10",
        toggleVariants({
          variant: context.variant ?? variant,
          size: context.size ?? size,
        }),
        context.sliding && "aria-pressed:bg-transparent",
        className,
      )}
      {...props}
    >
      {children}
    </TogglePrimitive>
  );
}

export { ToggleGroup, ToggleGroupItem };
