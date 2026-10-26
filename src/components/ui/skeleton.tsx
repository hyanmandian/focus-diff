import { cn } from "@/lib/utils"

// The shape of what's loading, still: no pulsing (motion that repeats while waiting is noise).
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
