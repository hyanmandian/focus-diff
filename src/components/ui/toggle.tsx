import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// A toggle button: borderless, a fill while it's on or pressed, no hover. In a group with
// variant="outline" it's a segment of a segmented control (toggle-group.tsx).
const toggleVariants = cva(
  "group/toggle inline-flex cursor-default items-center justify-center gap-1 rounded-(--radius-control) text-body font-normal whitespace-nowrap outline-none select-none focus-ring active:bg-fill disabled:pointer-events-none disabled:text-(--label-tertiary) aria-pressed:bg-fill data-[state=on]:bg-fill [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        /** A segment: the chosen one in the accent with white text, as Tahoe draws them in content. */
        outline: "flex-1 rounded-(--radius-control-sm) px-3 aria-pressed:bg-selected aria-pressed:text-selected-foreground active:not-aria-pressed:bg-(--fill-control-pressed)",
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
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
