import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";

import { cn } from "@/utils/cn/cn";

// A contextual menu (Control-click or a two-finger click), drawn as the app's other menus are: the
// same material, rows and selection. Its items are DropdownMenuItem's, which work in either.
function ContextMenu({ ...props }: ContextMenuPrimitive.Root.Props) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

function ContextMenuTrigger({ ...props }: ContextMenuPrimitive.Trigger.Props) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />;
}

function ContextMenuContent({ className, children, ...props }: ContextMenuPrimitive.Popup.Props) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner className="isolate z-50 outline-none">
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            "mac-menu z-50 w-max max-w-80 min-w-40 origin-(--transform-origin) text-popover-foreground outline-none data-closed:animate-out data-closed:overflow-hidden data-closed:duration-150 data-closed:fade-out-0 motion-reduce:data-closed:animate-none",
            className,
          )}
          {...props}
        >
          <div className="max-h-(--available-height) overflow-x-hidden overflow-y-auto p-(--menu-pad)">{children}</div>
        </ContextMenuPrimitive.Popup>
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}

export { ContextMenu, ContextMenuTrigger, ContextMenuContent };
