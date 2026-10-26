import { cn } from "@/lib/utils"

/** Sibling actions joined into one control, as AppKit draws a segmented row of push buttons: one
 *  rounded shape, a hairline between the parts. For buttons that do related things side by side
 *  (Show Log | Re-run | Open on GitHub); a form's Cancel and OK stay apart. */
function ButtonGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="group"
      data-slot="button-group"
      className={cn(
        "inline-flex w-fit items-stretch gap-px",
        "*:data-[slot=button]:rounded-none *:data-[slot=button]:first:rounded-l-(--radius-control) *:data-[slot=button]:last:rounded-r-(--radius-control)",
        className
      )}
      {...props}
    />
  )
}

export { ButtonGroup }
