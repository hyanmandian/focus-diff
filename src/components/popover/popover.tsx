"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { cn } from "@/utils/cn/cn"

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 8,
  children,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "z-50 flex w-72 origin-(--transform-origin) flex-col gap-3 rounded-(--radius-popover) bg-popover p-3.5 text-body text-popover-foreground shadow-(--shadow-menu) outline-hidden data-open:animate-in data-open:fade-in-0 data-open:duration-150 data-closed:animate-out data-closed:fade-out-0 data-closed:duration-150 motion-reduce:animate-none",
            className
          )}
          {...props}
        >
          {/* The arrow points at what opened it (popovers have one; menus never do). */}
          <PopoverPrimitive.Arrow className={"z-50 size-3 rotate-45 rounded-[2px] border-(--separator-strong)/50 bg-popover data-[side=bottom]:-top-[6px] data-[side=bottom]:border-t data-[side=bottom]:border-l data-[side=top]:-bottom-[6px] data-[side=top]:border-r data-[side=top]:border-b data-[side=left]:-right-[6px] data-[side=left]:border-t data-[side=left]:border-r data-[side=right]:-left-[6px] data-[side=right]:border-b data-[side=right]:border-l data-[side=inline-start]:-right-[5px] data-[side=inline-start]:border-t data-[side=inline-start]:border-r data-[side=inline-end]:-left-[5px] data-[side=inline-end]:border-b data-[side=inline-end]:border-l"} />
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("text-headline font-bold", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
