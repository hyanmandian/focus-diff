import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { type VariantProps } from "class-variance-authority";
import { createContext, useContext, useState, type CSSProperties } from "react";

import { SlidingPill } from "@/components/sliding-pill/sliding-pill";
import { toggleVariants } from "@/components/toggle/toggle";
import { cn } from "@/utils/cn/cn";

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
