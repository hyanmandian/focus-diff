import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/utils/cn/cn";

// Buttons as AppKit draws them on macOS 27: a flat fill with no border or shadow, regular weight,
// no hover (Mac buttons don't light up under the pointer), a darker fill while pressed and the
// accent focus ring for the keyboard. Disabled keeps the shape and dims the label.
//
// One way everywhere, so the same kind of button looks the same wherever it is:
// - Regular (the default size) for every button that does something: a form's, a card's or a
//   section's actions, Settings. Cancel and Close are push buttons ("outline"), as in a Mac dialog,
//   beside the one prominent ("default") button.
// - Small ("xs") only within a line of small text: beside a file path, a chip, an editor's own
//   bar. Glyphs alone: "icon-xs" in rows and headers, "icon" in toolbars.
// - "ghost" for a quiet action that leads somewhere (Reply, Go to Line, Show Older), "link" only
//   inside a sentence.
// - Related actions side by side join in a ButtonGroup; the window toolbar has its own capsules.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-default items-center justify-center font-normal whitespace-nowrap focus-ring outline-none select-none disabled:pointer-events-none disabled:text-(--label-tertiary) aria-disabled:text-(--label-tertiary) aria-invalid:outline-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /** The prominent (default) button: the accent with white text. One per view at most. */
        default: "bg-primary text-primary-foreground active:brightness-90 disabled:bg-fill",
        /** A push button. ("outline" and "secondary" are shadcn's names for it.) */
        outline: "bg-fill text-foreground active:bg-(--fill-control-pressed) aria-expanded:bg-(--fill-control-pressed)",
        secondary:
          "bg-fill text-foreground active:bg-(--fill-control-pressed) aria-expanded:bg-(--fill-control-pressed)",
        /** Borderless: just the label or glyph, a fill only while pressed or its menu is open. */
        ghost: "text-foreground active:bg-fill aria-expanded:bg-fill aria-pressed:bg-fill",
        /** A push button that does something that can't be taken back: red label, never the default. */
        destructive: "bg-fill text-destructive active:bg-(--fill-control-pressed)",
        link: "text-link active:opacity-70",
      },
      size: {
        /** Regular: 24pt, 13pt label. */
        default: "h-(--control-h) gap-1.5 rounded-(--radius-control) px-2.5 text-body",
        /** The same as regular (shadcn's name kept so nothing drifts). */
        sm: "h-(--control-h) gap-1.5 rounded-(--radius-control) px-2.5 text-body",
        /** Small: 20pt, 11pt label. */
        xs: "h-(--control-h-sm) gap-1 rounded-(--radius-control-sm) px-2 text-subheadline [&_svg:not([class*='size-'])]:size-3.5",
        /** Large: 28pt and a capsule, as AppKit draws large controls. */
        lg: "h-(--control-h-lg) gap-1.5 rounded-(--radius-capsule) px-3.5 text-body",
        /** A glyph alone: 28pt (a toolbar's), 24pt (regular), 20pt (small). */
        icon: "size-(--control-h-lg) rounded-(--radius-control)",
        "icon-sm": "size-(--control-h) rounded-(--radius-control)",
        "icon-xs": "size-(--control-h-sm) rounded-(--radius-control-sm) [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-(--control-h-lg) rounded-(--radius-capsule)",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
