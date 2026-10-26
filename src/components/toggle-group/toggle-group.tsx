import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { type VariantProps } from "class-variance-authority";
import { createContext, useContext, type CSSProperties } from "react";

import { toggleVariants } from "@/components/toggle/toggle";
import { cn } from "@/utils/cn/cn";

const ToggleGroupContext = createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number;
    orientation?: "horizontal" | "vertical";
  }
>({
  size: "default",
  variant: "default",
  spacing: 2,
  orientation: "horizontal",
});

// A row of toggles; with variant="outline", a segmented control: one track, equal segments (each as
// wide as the widest label, so none spills out of its segment), the chosen one in the accent.
function ToggleGroup({
  className,
  variant,
  size,
  spacing = 2,
  orientation = "horizontal",
  children,
  ...props
}: ToggleGroupPrimitive.Props &
  VariantProps<typeof toggleVariants> & {
    spacing?: number;
    orientation?: "horizontal" | "vertical";
  }) {
  const gap: CSSProperties & Record<"--gap", number> = { "--gap": spacing };
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      style={gap}
      className={cn(
        "group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] rounded-(--radius-control) data-[variant=outline]:grid data-[variant=outline]:auto-cols-fr data-[variant=outline]:grid-flow-col data-[variant=outline]:gap-0 data-[variant=outline]:bg-fill data-vertical:flex-col data-vertical:items-stretch",
        className,
      )}
      {...props}
    >
      {/* The React Compiler keeps this object the same between renders. */}
      {/* oxlint-disable-next-line react/jsx-no-constructed-context-values */}
      <ToggleGroupContext.Provider value={{ variant, size, spacing, orientation }}>
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
      data-variant={context.variant ?? variant}
      data-size={context.size ?? size}
      data-spacing={context.spacing}
      className={cn(
        "shrink-0 focus-visible:z-10",
        toggleVariants({
          variant: context.variant ?? variant,
          size: context.size ?? size,
        }),
        className,
      )}
      {...props}
    >
      {children}
    </TogglePrimitive>
  );
}

export { ToggleGroup, ToggleGroupItem };
