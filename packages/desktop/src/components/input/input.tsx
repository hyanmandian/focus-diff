import { Input as InputPrimitive } from "@base-ui/react/input";
import type { ComponentProps } from "react";

import { cn } from "@/utils/cn/cn";

function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        // A text field as AppKit draws one: 24pt, a 1px edge, the field's own white (darker than the
        // window in dark mode), 13pt text and the focus ring around it while it has focus.
        "h-(--field-h) w-full min-w-0 rounded-(--radius-field) border border-input bg-(--field-bg) px-[7px] text-body text-foreground caret-primary focus-ring outline-none file:inline-flex file:h-5 file:border-0 file:bg-transparent file:text-body placeholder:text-muted-foreground disabled:pointer-events-none disabled:text-(--label-tertiary) aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
