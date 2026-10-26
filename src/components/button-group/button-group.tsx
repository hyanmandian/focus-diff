import { cn } from "@/utils/cn/cn"

/** Sibling actions in one control, as the review toolbar's capsules and the filter bar draw them:
 *  a filled, rounded tray with the buttons inside it, plain until pressed (concentric: 9px tray,
 *  2px in, 7px buttons). For buttons that do related things side by side (Show Log, Re-run, Open on
 *  GitHub); a form's Cancel and OK stay apart. */
function ButtonGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="group"
      data-slot="button-group"
      className={cn(
        "inline-flex w-fit items-center gap-0.5 rounded-[9px] bg-fill p-0.5",
        "*:data-[slot=button]:rounded-[7px] *:data-[slot=button]:bg-transparent *:data-[slot=button]:hover:bg-foreground/6 *:data-[slot=button]:active:bg-(--fill-control-pressed) *:data-[slot=button]:aria-expanded:bg-(--fill-control-pressed)",
        className
      )}
      {...props}
    />
  )
}

export { ButtonGroup }
