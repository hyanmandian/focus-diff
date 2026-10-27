import type { ComponentProps } from "react";

import { cn } from "@/utils/cn/cn";

function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // The field look (input.tsx), several lines tall.
        "flex field-sizing-content min-h-16 w-full rounded-(--radius-field) field px-2.5 py-1.5 text-body text-foreground caret-primary outline-none placeholder:text-muted-foreground disabled:text-(--label-tertiary) aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
