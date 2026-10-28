import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/utils/cn/cn";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-default items-center justify-center font-normal whitespace-nowrap focus-ring transition-[background-color,color,filter] duration-(--duration-fast) outline-none select-none disabled:pointer-events-none disabled:text-(--label-tertiary) aria-disabled:text-(--label-tertiary) aria-invalid:outline-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:brightness-110 active:brightness-90 disabled:bg-fill",
        outline:
          "bg-fill text-foreground hover:bg-(--fill-control-hover) active:bg-(--fill-control-pressed) aria-expanded:bg-(--fill-control-pressed)",
        secondary:
          "bg-fill text-foreground hover:bg-(--fill-control-hover) active:bg-(--fill-control-pressed) aria-expanded:bg-(--fill-control-pressed)",
        ghost:
          "text-foreground hover:bg-fill active:bg-(--fill-control-pressed) aria-expanded:bg-fill aria-pressed:bg-fill",
        destructive: "bg-fill text-destructive hover:bg-(--fill-control-hover) active:bg-(--fill-control-pressed)",
        link: "text-link underline-offset-2 hover:underline active:opacity-70",
      },
      size: {
        default: "h-(--control-h) gap-1.5 rounded-(--radius-control) px-2.5 text-body",
        sm: "h-(--control-h) gap-1.5 rounded-(--radius-control) px-2.5 text-body",
        xs: "h-(--control-h-sm) gap-1 rounded-(--radius-control-sm) px-2 text-subheadline [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-(--control-h-lg) gap-1.5 rounded-(--radius-capsule) px-3.5 text-body",
        icon: "size-(--toolbar-item-h) rounded-(--radius-control)",
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

export { Button };
