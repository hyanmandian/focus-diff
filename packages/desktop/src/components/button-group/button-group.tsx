import { cn } from "@/utils/cn/cn";

function ButtonGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="group"
      data-slot="button-group"
      className={cn(
        "inline-flex w-fit items-center gap-0.5 rounded-[9px] bg-fill p-0.5",
        "*:data-[slot=button]:rounded-[7px] *:data-[slot=button]:bg-transparent *:data-[slot=button]:hover:bg-foreground/6 *:data-[slot=button]:active:bg-(--fill-control-pressed) *:data-[slot=button]:aria-expanded:bg-(--fill-control-pressed)",
        className,
      )}
      {...props}
    />
  );
}

export { ButtonGroup };
