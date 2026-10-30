import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";

import { avatar } from "@/utils/avatar/avatar";
import { cn } from "@/utils/cn/cn";
import type { Actor } from "@/utils/engine/engine";

function Avatar({ className, ...props }: AvatarPrimitive.Root.Props) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "relative flex size-8 shrink-0 rounded-full select-none after:absolute after:inset-0 after:rounded-full after:border after:border-border after:mix-blend-darken dark:after:mix-blend-lighten",
        className,
      )}
      {...props}
    />
  );
}

function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("aspect-square size-full rounded-full object-cover", className)}
      {...props}
    />
  );
}

function AvatarFallback({ className, ...props }: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-full bg-muted text-body text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function Face({ actor, className }: { actor: Actor; className?: string | undefined }) {
  return (
    <Avatar className={cn("size-5", className)}>
      {actor?.avatarUrl ? <AvatarImage src={avatar(actor.avatarUrl)} alt="" /> : null}
      <AvatarFallback className="text-footnote">{(actor?.login ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

export { Avatar, AvatarImage, AvatarFallback, Face };
