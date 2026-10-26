import type { ComponentProps } from "react";

import { cn } from "../../utils/cn/cn";

function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // The field look (input.tsx), several lines tall.
        "flex field-sizing-content min-h-16 w-full rounded-(--radius-field) border border-input bg-(--field-bg) px-[7px] py-[5px] text-body text-foreground caret-primary focus-ring outline-none placeholder:text-muted-foreground disabled:text-(--label-tertiary) aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
