import { cn } from "@/lib/utils"

// A scrolling region with the system's own scroll bars: overlay ones that follow "Show scroll bars"
// in System Settings, the appearance, and grow under the pointer, which a drawn bar can't do.
function ScrollArea({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="scroll-area" className={cn("relative overflow-auto overscroll-contain", className)} {...props}>
      {children}
    </div>
  )
}

export { ScrollArea }
