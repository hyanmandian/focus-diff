import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon } from "lucide-react";

import { cn } from "@/utils/cn/cn";

// A checkbox as AppKit draws it: the field's white with a 1px edge, the accent with a white check
// when on, the focus ring for the keyboard. No hover.
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-4 shrink-0 cursor-default items-center justify-center rounded-(--radius-checkbox) border border-input bg-(--field-bg) focus-ring transition-colors duration-(--duration-fast) outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 hover:not-data-checked:border-(--field-border-hover) active:brightness-95 disabled:opacity-50 aria-invalid:border-destructive data-checked:border-transparent data-checked:bg-primary data-checked:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3 [&>svg]:stroke-[3]"
      >
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
