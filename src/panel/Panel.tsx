// The floating panel under the tray icon, laid out like Focus Diff's popup: the queues as tabs, the
// chosen one's pull requests on a raised pane, narrowed to a repository with chips and grouped by
// repository, drafts folded at the end. A click opens the pull request's review window, where the
// reviewing happens.

import { AlertCircle, ChevronRight, Loader2, RefreshCw, Settings } from "lucide-react";
import { type UIEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { bridge } from "@/lib/bridge";
import type { Queue } from "@/lib/config";
import { ago } from "@/lib/copy";
import type { Item } from "@/lib/engine";
import { clearArrival, dismiss, isUnread, markQueueSeen, markSeen, refresh, useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { tabKeys } from "@/lib/keys";
import { Connect } from "@/shared/Connect";
import { Mark } from "@/shared/Mark";
import { SlidingPill } from "@/shared/SlidingPill";
import { prefetchSome } from "@/lib/prefetch";
import { PullRow } from "./PullRow";
import { ReviewTime } from "./ReviewTime";

const EMPTY: Record<Queue["kind"], string> = {
  review: "Nothing waiting on your review.",
  involved: "Nothing new where you took part.",
  authored: "You have no open pull requests.",
  merged: "Nothing merged without you lately.",
  custom: "Nothing matches this search.",
};

function remembered(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Kept for this session only.
  }
}

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

/** A count beside a label, as Mail's sidebar has it: plain secondary text, no badge. Unread puts it in
    the accent (deepened to stay AA on the material). */
function Count({ n, unread }: { n: number; unread?: number }) {
  return <span className={cn("tabular-nums", unread ? "font-semibold text-(--panel-link)" : "font-normal text-muted-foreground")}>{n}</span>;
}

/** A repository by its name alone, unless two owners have one by that name. */
const shortName = (repo: string, all: string[]) => {
  const name = repo.slice(repo.indexOf("/") + 1);
  return all.filter((r) => r.endsWith(`/${name}`)).length > 1 ? repo : name;
};

type Group = { repo: string; items: Item[] };

/** The header's toolbar buttons: 28pt, a 16pt glyph in the secondary label color, a quiet hover. */
const TOOL = "rounded-[8px] text-muted-foreground hover:bg-foreground/8 hover:text-foreground aria-expanded:bg-foreground/8 aria-expanded:text-foreground dark:hover:bg-foreground/10";

export function Panel() {
  const { ready, signedIn, auth, config, items, status, arrivals, seen, review } = useStore();
  const shown = useShown();
  // Opening the panel moves the keyboard into it, on the list, as a popover does: ↑↓ walk it
  // right away and VoiceOver reads where you are.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (shown && ready) requestAnimationFrame(() => listRef.current?.focus({ preventScroll: true }));
  }, [shown, ready]);
  useTheme(config?.theme);
  const queues = useMemo(() => config?.queues.filter((q) => q.enabled) ?? [], [config]);
  const unread = useCallback((item: Item) => isUnread(item, seen), [seen]);

  const [tab, setTab] = useState(() => remembered("tab"));
  const queue = queues.find((q) => q.id === tab) ?? queues.find((q) => (items[q.id] ?? []).some(unread)) ?? queues[0];
  const [repo, setRepo] = useState("");
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [update, setUpdate] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    void bridge.updateOffered().then(setUpdate);
    const off = bridge.on<string>("update-available", setUpdate);
    return () => void off.then((f) => f());
  }, []);
  // Which way a new list comes in: from the right when the pick moved right.
  const [direction, setDirection] = useState(0);
  const choose = (id: string) => {
    setDirection(Math.sign(queues.findIndex((q) => q.id === id) - queues.findIndex((q) => q.id === queue?.id)));
    setTab(id);
    setRepo("");
    remember("tab", id);
  };

  // Esc closes the panel, like a menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[data-popup-open]")) void bridge.hidePanel();
      // Like a menu: ↑↓ walk the pull requests (from anywhere but a field or a tab row), Home/End
      // jump to the ends, Return opens the one focused.
      else if (/^(ArrowDown|ArrowUp|Home|End)$/.test(e.key) && !e.defaultPrevented && !document.querySelector("[data-popup-open]")) {
        const target = e.target as HTMLElement;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.closest("[role=tablist]") || (e.key.startsWith("Arrow") && target.closest("[role=group]"))) return;
        const rows = [...document.querySelectorAll<HTMLElement>("[data-row]")].filter((r) => r.offsetParent);
        if (!rows.length) return;
        const at = rows.indexOf(target);
        const next = e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : at < 0 ? (e.key === "ArrowDown" ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)));
        e.preventDefault();
        rows[next]?.focus();
        rows[next]?.scrollIntoView({ block: "nearest" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const open = useCallback((item: Item) => {
    markSeen(item);
    void bridge.openReview(item.pr, item.viaTeams ?? []);
  }, []);

  const list = queue ? (items[queue.id] ?? []) : [];
  // The busiest repositories first.
  const repos = [...new Set(list.map((i) => i.pr.repository.nameWithOwner))].sort(
    (a, b) => list.filter((i) => i.pr.repository.nameWithOwner === b).length - list.filter((i) => i.pr.repository.nameWithOwner === a).length || a.localeCompare(b),
  );
  const narrowed = repo && repos.includes(repo) ? list.filter((i) => i.pr.repository.nameWithOwner === repo) : list;
  // Within a repository: asked again first, then news, then the most recently active; drafts apart.
  const at = (i: Item) => Math.max(...i.events.map((e) => e.at), Date.parse(i.pr.updatedAt));
  const order = (a: Item, b: Item) =>
    Number(b.events.some((e) => e.kind === "rerequest")) - Number(a.events.some((e) => e.kind === "rerequest")) || Number(unread(b)) - Number(unread(a)) || at(b) - at(a);
  const groups: Group[] = [];
  for (const item of narrowed.filter((i) => !i.pr.isDraft)) {
    const name = item.pr.repository.nameWithOwner;
    const group = groups.find((g) => g.repo === name) ?? groups[groups.push({ repo: name, items: [] }) - 1]!;
    group.items.push(item);
  }
  for (const g of groups) g.items.sort(order);
  groups.sort((a, b) => b.items.filter(unread).length - a.items.filter(unread).length || Math.max(...b.items.map(at)) - Math.max(...a.items.map(at)));
  const drafts = narrowed.filter((i) => i.pr.isDraft).sort(order);
  const unreadHere = list.filter(unread).length;

  // The top of the list on screen, fetched ahead a moment after the panel opens (not competing with
  // its first paint), so a click on any of them opens at once. Only ones changed since last kept.
  const top = groups.flatMap((g) => g.items).slice(0, 5).map((i) => i.pr);
  const topRef = useRef(top);
  topRef.current = top;
  useEffect(() => {
    if (!shown || !ready) return;
    const timer = setTimeout(() => void prefetchSome(topRef.current), 700);
    return () => clearTimeout(timer);
  }, [shown, ready, queue?.id, repo]);

  // A repository's heading takes a backing only while it floats over rows; at rest it's plain text on
  // the material, so no band shows.
  const stick = (e: UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.getBoundingClientRect().top;
    for (const h of e.currentTarget.querySelectorAll("section > h2")) h.toggleAttribute("data-stuck", h.parentElement!.getBoundingClientRect().top < top - 0.5);
  };

  const row = (item: Item) =>
    queue ? (
      <li key={item.pr.id}>
        <PullRow item={item} queue={queue} unread={unread(item)} arriving={shown && arrivals.has(item.pr.id)} onOpen={open} onDismiss={dismiss} onArrived={clearArrival} />
      </li>
    ) : null;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[18px] bg-(--panel-tint) text-foreground shadow-[inset_0_0_0_0.5px_var(--panel-edge)] animate-in fade-in-0 zoom-in-[0.98] duration-150 ease-out motion-reduce:animate-none">
      <header className="flex h-12 shrink-0 items-center gap-2 pr-2.5 pl-4" data-tauri-drag-region>
        <Mark className="size-4 text-primary" />
        <h1 className="text-[13px] leading-4 font-semibold">Focus Diff</h1>
        <div className="ml-auto flex items-center gap-0.5">
          {signedIn ? (
            status.phase === "error" ? (
              <Tooltip>
                <TooltipTrigger render={<Button variant="ghost" size="icon-sm" className={TOOL} aria-label={`Couldn't refresh: ${status.error}. Try again`} onClick={() => void refresh(true)} />}>
                  <AlertCircle className="text-destructive" />
                </TooltipTrigger>
                <TooltipContent>{status.error} · click to try again</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger render={<Button variant="ghost" size="icon-sm" className={TOOL} aria-label="Refresh" onClick={() => void refresh(true)} disabled={status.phase === "loading"} />}>
                  {status.phase === "loading" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                </TooltipTrigger>
                <TooltipContent>Refresh</TooltipContent>
              </Tooltip>
            )
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className={TOOL} aria-label="Menu" />}>
              <Settings />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void bridge.openSettings()}>Settings…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void bridge.openSetup()}>Run setup again…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void bridge.quit()}>Quit Focus Diff</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {ready && signedIn && review ? <ReviewTime review={review} items={items} /> : null}

      {!ready ? (
        // The shape of what's coming, at its size: nothing moves when it arrives.
        <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-label="Loading">
          <Skeleton className="mx-4 h-7 shrink-0 rounded-[8px] bg-(--panel-fill)" />
          <div className="mx-4 mt-3 h-px shrink-0 bg-(--panel-separator)" />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-1 pt-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-start gap-2.5 py-2 pr-3 pl-3" style={{ opacity: 1 - i * 0.18 }}>
                <Skeleton className="size-5 shrink-0 rounded-full bg-(--panel-fill)" />
                <div className="flex flex-1 flex-col gap-1.5 pt-0.5">
                  <Skeleton className="h-3.5 w-4/5 bg-(--panel-fill)" />
                  <Skeleton className="h-3 w-2/5 bg-(--panel-fill)" />
                </div>
              </div>
            ))}
          </div>
          <div className="mx-4 h-px shrink-0 bg-(--panel-separator)" />
          <div className="h-9 shrink-0" />
        </div>
      ) : !signedIn ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
          <Mark className="size-10 text-primary" />
          <div className="flex flex-col gap-1.5">
            <h2 className="text-[15px] leading-5 font-semibold">Your reviews, without opening GitHub</h2>
            <p className="text-[13px] leading-[18px] text-balance text-muted-foreground">Connect GitHub to see what's waiting on you, and hear about it as it happens.</p>
          </div>
          <Connect auth={auth} onConnected={() => void refresh(true)} />
        </div>
      ) : !queue ? (
        <div className="flex flex-col items-center gap-3 px-8 py-16 text-center">
          <p className="text-[13px] text-muted-foreground">You have no queues turned on.</p>
          <Button variant="outline" onClick={() => void bridge.openSettings()}>
            Set up queues
          </Button>
        </div>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col">
          {/* The queues as a segmented control on the 16pt inset: the chosen one on a raised knob
              (concentric: 8px track, 2px in, 6px knob). */}
          <div role="tablist" onKeyDown={tabKeys} aria-label="Queues" className="relative isolate mx-4 flex shrink-0 gap-0.5 overflow-x-auto rounded-[8px] bg-(--panel-fill) p-0.5 [scrollbar-width:none]">
            <SlidingPill selected={queue.id} className="rounded-[6px] bg-white shadow-[0_1px_2px_rgb(0_0_0/0.14),0_0_0_0.5px_rgb(0_0_0/0.06)] dark:bg-white/18 dark:shadow-[0_1px_2px_rgb(0_0_0/0.3)]" />
            {queues.map((q) => {
              const its = items[q.id] ?? [];
              const selected = q.id === queue.id;
              return (
                <button
                  key={q.id}
                  type="button"
                  role="tab"
                  tabIndex={selected ? 0 : -1}
                  aria-selected={selected}
                  data-pill={q.id}
                  onClick={() => choose(q.id)}
                  className={cn(
                    "flex h-6 flex-auto shrink-0 items-center justify-center gap-1.5 rounded-[6px] px-2.5 text-[13px] leading-4 font-medium whitespace-nowrap outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    !selected && "hover:bg-foreground/6",
                  )}
                >
                  <span className="truncate">{q.name}</span>
                  <Count n={its.length} unread={its.filter(unread).length} />
                </button>
              );
            })}
          </div>

          <div role="tabpanel" aria-label={queue.name} className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden">
            {repos.length > 1 ? (
              <div role="group" aria-label="Repositories" className="relative isolate flex shrink-0 gap-0.5 overflow-x-auto px-2 pb-2 [scrollbar-width:none]">
                <SlidingPill selected={(repo && repos.includes(repo) ? repo : "") || "all"} className="rounded-[6px] bg-(--panel-fill)" />
                {[["", "All", list.length] as const, ...repos.map((r) => [r, shortName(r, repos), list.filter((i) => i.pr.repository.nameWithOwner === r).length] as const)].map(([value, label, n]) => {
                  const pressed = (repo && repos.includes(repo) ? repo : "") === value;
                  return (
                    <button
                      key={value || "all"}
                      type="button"
                      aria-pressed={pressed}
                      title={value || undefined}
                      data-pill={value || "all"}
                      onClick={() => {
                        const order = ["", ...repos];
                        setDirection(Math.sign(order.indexOf(value) - order.indexOf(repo && repos.includes(repo) ? repo : "")));
                        setRepo(value);
                      }}
                      className={cn(
                        "flex h-6 max-w-44 shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-[12px] leading-4 font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                        pressed ? "text-foreground" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                      )}
                    >
                      <span className="truncate">{label}</span>
                      <Count n={n} />
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="mx-4 h-px shrink-0 bg-(--panel-separator)" />
            {/* Each queue's list, and each repository's, slides in from the side it was picked on. */}
            <div
              key={`${queue.id}:${repo}`}
              ref={listRef}
              tabIndex={-1}
              aria-label={`${queue.name} pull requests`}
              onScroll={stick}
              className={cn(
                "outline-none",
                "min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-2 animate-in fade-in-0 duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:animate-none",
                direction > 0 ? "slide-in-from-right-3" : direction < 0 ? "slide-in-from-left-3" : "",
              )}
            >
              {groups.length || drafts.length ? (
                <>
                  {groups.map((g, i) => (
                    <section key={g.repo} aria-label={g.repo} className={cn(i > 0 && "mt-2", groups.length === 1 && repos.length <= 1 && "pt-1")}>
                      {groups.length > 1 || repos.length > 1 ? (
                        <h2 className="sticky top-0 z-10 -mx-1 flex items-center gap-1.5 px-4 pt-2 pb-1 text-[11px] leading-4 font-semibold text-muted-foreground data-stuck:bg-(--panel-sticky) data-stuck:backdrop-blur-xl">
                          <span className="min-w-0 truncate">
                            <span className="font-normal">{g.repo.slice(0, g.repo.indexOf("/") + 1)}</span>
                            <span className="text-foreground/85">{g.repo.slice(g.repo.indexOf("/") + 1)}</span>
                          </span>
                          <span className="font-normal tabular-nums">{g.items.length}</span>
                        </h2>
                      ) : null}
                      <ul>{g.items.map(row)}</ul>
                    </section>
                  ))}
                  {drafts.length ? (
                    <Collapsible open={draftsOpen} onOpenChange={setDraftsOpen} className={cn(groups.length && "mt-2")}>
                      <CollapsibleTrigger className="flex w-full items-center gap-1 rounded-[6px] py-2 pr-3 pl-3 text-[11px] leading-4 font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                        <ChevronRight className={cn("size-3 transition-transform duration-200 motion-reduce:transition-none", draftsOpen && "rotate-90")} aria-hidden />
                        Drafts <span className="font-normal tabular-nums">{drafts.length}</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <ul>{drafts.map(row)}</ul>
                      </CollapsibleContent>
                    </Collapsible>
                  ) : null}
                </>
              ) : (
                <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">{EMPTY[queue.kind]}</p>
              )}
            </div>
          </div>

          <div className="mx-4 h-px shrink-0 bg-(--panel-separator)" />
          <footer className="flex h-9 shrink-0 items-center gap-2 px-4 text-[11px] leading-4 text-muted-foreground">
            {update ? (
              <button
                type="button"
                disabled={updating}
                className="flex items-center gap-1.5 rounded-sm font-medium text-success outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  setUpdating(true);
                  void bridge.installUpdate().catch(() => setUpdating(false));
                }}
              >
                {updating ? <Loader2 className="size-3 animate-spin" /> : null}
                {updating ? "Updating…" : `Update to ${update} and restart`}
              </button>
            ) : null}
            <p role="status" className={cn(update && "sr-only")}>{status.updatedAt ? `Updated ${ago(status.updatedAt) === "now" ? "just now" : `${ago(status.updatedAt)} ago`}` : status.phase === "loading" ? "Checking GitHub…" : ""}</p>
            {unreadHere ? (
              <button type="button" className="ml-auto rounded-sm font-medium text-(--panel-link) outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" onClick={() => markQueueSeen(queue.id)}>
                Mark all as read
              </button>
            ) : null}
          </footer>
        </main>
      )}
    </div>
  );
}
