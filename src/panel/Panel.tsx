// The floating panel under the tray icon: connect GitHub on first run, then the person's queues.

import { AlertCircle, Loader2, RefreshCw, Settings } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { bridge } from "@/lib/bridge";
import { ago } from "@/lib/copy";
import type { Item } from "@/lib/engine";
import { clearArrival, dismiss, isUnread, markQueueSeen, markSeen, refresh, reloadAuth, useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { Connect } from "@/shared/Connect";
import { Mark } from "@/shared/Mark";
import { Details } from "./Details";
import { QueueSection } from "./QueueSection";

/** Whether the panel is on screen: arrivals play only then, so they're seen. */
function useShown() {
  const [shown, setShown] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const update = () => setShown(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    const off = bridge.on("panel-shown", () => setShown(true));
    return () => {
      document.removeEventListener("visibilitychange", update);
      void off.then((f) => f());
    };
  }, []);
  return shown;
}

export function Panel() {
  const { ready, auth, config, me, items, status, arrivals, seen } = useStore();
  const shown = useShown();
  useTheme(config?.theme);

  // Esc closes the panel, like a menu (a pull request's details take it first, to go back).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[data-popup-open]")) void bridge.hidePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [selected, setSelected] = useState<Item | null>(null);
  const open = useCallback((item: Item) => {
    markSeen(item);
    setSelected(item);
  }, []);
  const openDiff = useCallback((item: Item) => void bridge.openReview(item.pr), []);
  const unread = useCallback((item: Item) => isUnread(item, seen), [seen]);

  const queues = config?.queues.filter((q) => q.enabled) ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-background/92 text-foreground shadow-2xl">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3" data-tauri-drag-region>
        <Mark className="size-4 text-primary" />
        <h1 className="text-[13px] font-semibold">Focus Diff Pro</h1>
        <div className="ml-auto flex items-center gap-0.5">
          {auth?.signed_in ? (
            <>
              {status.phase === "error" ? (
                <Tooltip>
                  <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Couldn't refresh: ${status.error}. Try again`} onClick={() => void refresh(true)} />}>
                    <AlertCircle className="text-destructive" />
                  </TooltipTrigger>
                  <TooltipContent>{status.error} · click to try again</TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={() => void refresh(true)} disabled={status.phase === "loading"} />}>
                    {status.phase === "loading" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  </TooltipTrigger>
                  <TooltipContent>{status.updatedAt ? `Updated ${ago(status.updatedAt) === "now" ? "just now" : `${ago(status.updatedAt)} ago`}` : "Refresh"}</TooltipContent>
                </Tooltip>
              )}
            </>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Menu" />}>
              <Settings />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void bridge.openSettings()}>Settings…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void bridge.quit()}>Quit Focus Diff Pro</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {!ready ? (
        <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Loading">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" style={{ opacity: 1 - i * 0.3 }} />
          ))}
        </div>
      ) : !auth?.signed_in ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
          <Mark className="size-10 text-primary" />
          <div className="flex flex-col gap-1.5">
            <h2 className="text-base font-semibold">Your reviews, without opening GitHub</h2>
            <p className="text-sm text-balance text-muted-foreground">Connect GitHub to see what's waiting on you, and hear about it as it happens.</p>
          </div>
          <Connect auth={auth} onConnected={() => void reloadAuth()} />
        </div>
      ) : selected ? (
        <Details
          item={selected}
          queue={config?.queues.find((q) => q.id === selected.queueId)}
          me={me ?? ""}
          onBack={() => setSelected(null)}
          onOpenDiff={openDiff}
        />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col py-1">
            {queues.length ? (
              queues.map((queue) => (
                <QueueSection
                  key={queue.id}
                  queue={queue}
                  items={items[queue.id] ?? []}
                  me={me ?? ""}
                  isUnread={unread}
                  arrivals={shown ? arrivals : new Set()}
                  onOpen={open}
                  onDismiss={dismiss}
                  onArrived={clearArrival}
                  onMarkSeen={markQueueSeen}
                />
              ))
            ) : (
              <div className="flex flex-col items-center gap-3 px-8 py-16 text-center">
                <p className="text-sm text-muted-foreground">You have no queues turned on.</p>
                <Button variant="outline" onClick={() => void bridge.openSettings()}>
                  Set up queues
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
