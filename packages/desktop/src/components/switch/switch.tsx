"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/utils/cn/cn";

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 cursor-default items-center rounded-full p-[2px] focus-ring transition-colors duration-(--duration) outline-none after:absolute after:-inset-x-3 after:-inset-y-2 data-[size=default]:h-(--control-h-sm) data-[size=default]:w-[44px] data-[size=sm]:h-[16px] data-[size=sm]:w-[36px] data-checked:bg-primary data-unchecked:bg-(--switch-off) data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block aspect-[1.6] h-full rounded-full bg-white shadow-(--shadow-knob) transition-transform duration-(--duration) [--switch-travel:14px] group-data-[size=sm]/switch:[--switch-travel:12.8px] data-checked:translate-x-(--switch-travel)"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
