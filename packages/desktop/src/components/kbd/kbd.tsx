import { cn } from "@/utils/cn/cn";

// A shortcut written as macOS writes one in menus and tooltips (⌥⇧J): plain secondary glyphs,
// no keycap.
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex w-fit items-center justify-center gap-0.5 font-sans text-[length:inherit] text-muted-foreground select-none [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
