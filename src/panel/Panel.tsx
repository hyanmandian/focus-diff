// The floating panel under the tray icon, laid out like Focus Diff's popup: the queues as tabs, the
// chosen one's pull requests on a raised pane, narrowed to a repository with chips and grouped by
// repository, drafts folded at the end. A click opens the pull request's review window, where the
// reviewing happens.

import { AlertCircle, ChevronRight, Loader2, RefreshCw, Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { bridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import type { Item } from "@/lib/engine";
import { clearArrival, dismiss, isUnread, markQueueSeen, markSeen, refresh, restore, useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { shortcut } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { tabKeys } from "@/lib/keys";
import { Connect } from "@/shared/Connect";
import { Mark } from "@/shared/Mark";
import { SlidingPill } from "@/shared/SlidingPill";
import { prefetchSome } from "@/lib/prefetch";
import { PullRow } from "./PullRow";
import { ReviewTime } from "./ReviewTime";

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

/** A count on a tab or chip, as Focus Diff's popup has it: a small pill of tabular figures, white on
    the accent when its option is chosen. */
function Count({ n, on }: { n: number; on?: boolean }) {
  return (
    <span className={cn("min-w-5 rounded-full px-1.5 text-center text-subheadline leading-[18px] font-semibold tabular-nums", on ? "bg-black/16 text-primary-foreground" : "bg-foreground/10 text-muted-foreground")}>
      {n}
    </span>
  );
}

/** The panel's raised panes, as the extension's: on a hairline border, rounded, with a small shadow. */
const PANE = "rounded-[12px] border border-(--panel-separator) bg-(--panel-raised) shadow-[0_1px_2px_rgb(0_0_0/0.06),0_6px_18px_rgb(0_0_0/0.08)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.3),0_6px_18px_rgb(0_0_0/0.35)]";

/** A repository by its name alone, unless two owners have one by that name. */
const shortName = (repo: string, all: string[]) => {
  const name = repo.slice(repo.indexOf("/") + 1);
  return all.filter((r) => r.endsWith(`/${name}`)).length > 1 ? repo : name;
};

type Group = { repo: string; items: Item[] };

/** The header's buttons: 28pt, a 16pt glyph in the secondary label color; a fill only while pressed
 *  or while its menu is open (controls in a popover don't light up under the pointer). */
const TOOL = "rounded-full text-muted-foreground active:bg-foreground/8 aria-expanded:bg-foreground/8 aria-expanded:text-foreground dark:active:bg-foreground/10";

export function Panel() {
  const { ready, signedIn, auth, config, items, status, arrivals, seen, review } = useStore();
  const shown = useShown();
  const t = useT();
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
  // Rows picked to mark done, in the queue on screen, and the ones just marked, which Undo puts back.
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [marked, setMarked] = useState<Item[]>([]);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pick = useCallback((item: Item, on: boolean) => {
    setMarked([]);
    setPicked((now) => {
      const next = new Set(now);
      if (on) next.add(item.pr.id);
      else next.delete(item.pr.id);
      return next;
    });
  }, []);

  useEffect(() => {
    void bridge.updateOffered().then(setUpdate);
    const off = bridge.on<string>("update-available", setUpdate);
    return () => void off.then((f) => f());
  }, []);
  const choose = (id: string) => {
    setTab(id);
    setPicked(new Set());
    setRepo("");
    remember("tab", id);
  };

  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  // Esc closes the panel, like a menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The app's own shortcuts, which the menu bar would answer if a tray app had one showing.
      if (e.metaKey && !e.altKey && !e.ctrlKey && (e.key === "," || e.key === "q")) {
        e.preventDefault();
        void (e.key === "," ? bridge.openSettings() : bridge.quit());
      } else if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[data-popup-open]")) {
        // Lets go of what's picked first, then closes.
        if (pickedRef.current.size) setPicked(new Set());
        else void bridge.hidePanel();
      }
      // `x` on a row picks it, or lets it go.
      else if (e.key === "x" && !e.metaKey && !e.ctrlKey && !e.altKey && (e.target as HTMLElement).matches("[data-row]")) {
        e.preventDefault();
        (e.target as HTMLElement).parentElement?.querySelector<HTMLInputElement>("input[type=checkbox]")?.click();
      }
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

  const open = useCallback((item: Item, from?: DOMRect) => {
    markSeen(item);
    void bridge.openReview(item.pr, item.viaTeams ?? [], from);
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
  // What's picked and has since gone (done elsewhere, off the list) isn't picked any more.
  const pickedHere = list.filter((i) => picked.has(i.pr.id));
  const markDone = () => {
    for (const item of pickedHere) dismiss(item);
    setMarked(pickedHere);
    setPicked(new Set());
    listRef.current?.focus({ preventScroll: true });
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setMarked([]), 6000);
  };
  const undo = () => {
    for (const item of marked) restore(item);
    setMarked([]);
  };

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


  const row = (item: Item) =>
    queue ? (
      <li key={item.pr.id}>
        <PullRow
          item={item}
          queue={queue}
          unread={unread(item)}
          arriving={shown && arrivals.has(item.pr.id)}
          onOpen={open}
          onDismiss={dismiss}
          onArrived={clearArrival}
          picked={picked.has(item.pr.id)}
          selecting={pickedHere.length > 0}
          onPick={pick}
        />
      </li>
    ) : null;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[18px] bg-(--panel-tint) text-foreground shadow-[inset_0_0_0_0.5px_var(--panel-edge)] animate-in fade-in-0 duration-(--duration) ease-out motion-reduce:animate-none">
      <header className="flex h-12 shrink-0 items-center gap-2 pr-2.5 pl-4" data-tauri-drag-region>
        <Mark className="size-4 text-primary" />
        <h1 className="text-body leading-4 font-semibold">Focus Diff</h1>
        <div className="ml-auto flex items-center gap-0.5">
          {signedIn ? (
            status.phase === "error" ? (
              <Tooltip>
                <TooltipTrigger render={<Button variant="ghost" size="icon" className={TOOL} aria-label={t("panel.refreshFailedLabel", { error: status.error ?? "" })} onClick={() => void refresh(true)} />}>
                  <AlertCircle className="text-destructive" />
                </TooltipTrigger>
                <TooltipContent>{t("panel.refreshFailedTip", { error: status.error ?? "" })}</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger render={<Button variant="ghost" size="icon" className={TOOL} aria-label={t("panel.refresh")} onClick={() => void refresh(true)} disabled={status.phase === "loading"} />}>
                  {status.phase === "loading" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                </TooltipTrigger>
                <TooltipContent>{t("panel.refresh")}</TooltipContent>
              </Tooltip>
            )
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className={TOOL} aria-label={t("panel.menu")} />}>
              <Settings />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void bridge.openSettings()}>
                {t("panel.settings")} <DropdownMenuShortcut>{shortcut(",", ["cmd"])}</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void bridge.openSetup()}>{t("panel.setupAgain")}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void bridge.quit()}>
                {t("panel.quit")} <DropdownMenuShortcut>{shortcut("Q", ["cmd"])}</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {ready && signedIn && review ? <ReviewTime review={review} items={items} /> : null}

      {!ready ? (
        // The shape of what's coming, at its size: nothing moves when it arrives.
        <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-label={t("panel.loading")}>
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
            <h2 className="text-title3 leading-5 font-semibold">{t("panel.signedOutTitle")}</h2>
            <p className="text-body leading-[18px] text-balance text-muted-foreground">{t("panel.signedOutBody")}</p>
          </div>
          <Connect auth={auth} onConnected={() => void refresh(true)} />
        </div>
      ) : !queue ? (
        <div className="flex flex-col items-center gap-3 px-8 py-16 text-center">
          <p className="text-body text-muted-foreground">{t("panel.noQueues")}</p>
          <Button variant="outline" onClick={() => void bridge.openSettings()}>
            {t("panel.setUpQueues")}
          </Button>
        </div>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col">
          {/* The queues as the extension draws them: on a raised pane, the chosen one on an accent pill
              that slides to the next (concentric: 12px pane, 4px in, 8px pill). */}
          <div role="tablist" onKeyDown={tabKeys} aria-label={t("panel.queues")} className={cn(PANE, "relative isolate mx-3 flex shrink-0 gap-0.5 overflow-x-auto p-1 [scrollbar-width:none]")}>
            <SlidingPill selected={queue.id} className="rounded-[8px] bg-primary" />
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
                    "flex h-7 flex-auto shrink-0 cursor-default items-center justify-center gap-1.5 rounded-[8px] pr-2 pl-3 text-body font-medium whitespace-nowrap outline-none transition-colors duration-150 focus-ring-inset",
                    selected ? "text-primary-foreground" : "hover:bg-foreground/6",
                  )}
                >
                  <span className="truncate">{q.name}</span>
                  <Count n={its.length} on={selected} />
                </button>
              );
            })}
          </div>

          <div role="tabpanel" aria-label={queue.name} className={cn(PANE, "mx-3 mt-2.5 flex min-h-0 flex-1 flex-col overflow-hidden")}>
            {repos.length > 1 ? (
              <div role="group" aria-label={t("panel.repositories")} className="relative isolate flex shrink-0 gap-0.5 overflow-x-auto border-b border-(--panel-separator) p-1.5 [scrollbar-width:none]">
                <SlidingPill selected={(repo && repos.includes(repo) ? repo : "") || "all"} className="rounded-[8px] bg-primary" />
                {[["", t("panel.all"), list.length] as const, ...repos.map((r) => [r, shortName(r, repos), list.filter((i) => i.pr.repository.nameWithOwner === r).length] as const)].map(([value, label, n]) => {
                  const pressed = (repo && repos.includes(repo) ? repo : "") === value;
                  return (
                    <button
                      key={value || "all"}
                      type="button"
                      aria-pressed={pressed}
                      title={value || undefined}
                      data-pill={value || "all"}
                      onClick={() => setRepo(value)}
                      className={cn(
                        "flex h-7 max-w-45 shrink-0 cursor-default items-center gap-1.5 rounded-[8px] pr-1.5 pl-2.5 text-callout font-medium outline-none transition-colors duration-150 focus-ring-inset",
                        pressed ? "text-primary-foreground" : "hover:bg-foreground/6",
                      )}
                    >
                      <span className="truncate">{label}</span>
                      <Count n={n} on={pressed} />
                    </button>
                  );
                })}
              </div>
            ) : null}

            {/* Each queue's list, and each repository's, shows at once: switching is frequent, so it
                isn't animated. */}
            <div
              key={`${queue.id}:${repo}`}
              ref={listRef}
              tabIndex={-1}
              aria-label={t("panel.pullRequestsOf", { queue: queue.name })}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-1 outline-none"
            >
              {groups.length || drafts.length ? (
                <>
                  {groups.map((g, i) => (
                    <section key={g.repo} aria-label={g.repo} className={cn(i > 0 && "mt-1 border-t border-(--panel-separator) pt-1", groups.length === 1 && repos.length <= 1 && "pt-1")}>
                      {groups.length > 1 || repos.length > 1 ? (
                        // A repository's name stays up while its rows scroll by, over their boxes.
                        <h2 className="sticky top-0 z-20 -mx-1 flex items-center gap-2 bg-(--panel-raised) px-3.5 pt-2.5 pb-1.5 text-body leading-[18px] font-semibold">
                          <span className="min-w-0 truncate">
                            <span className="font-normal text-muted-foreground">{g.repo.slice(0, g.repo.indexOf("/") + 1)}</span>
                            {g.repo.slice(g.repo.indexOf("/") + 1)}
                          </span>
                          <span className="text-callout font-normal text-muted-foreground tabular-nums">{g.items.length}</span>
                        </h2>
                      ) : null}
                      <ul>{g.items.map(row)}</ul>
                    </section>
                  ))}
                  {drafts.length ? (
                    <Collapsible open={draftsOpen} onOpenChange={setDraftsOpen} className={cn(groups.length && "mt-1 border-t border-(--panel-separator) pt-1")}>
                      <CollapsibleTrigger className="flex w-full cursor-default items-center gap-1 rounded-[8px] px-2.5 py-2 text-body font-semibold text-muted-foreground outline-none hover:bg-foreground/6 focus-ring-inset">
                        <ChevronRight className={cn("size-3.5 transition-transform duration-200 motion-reduce:transition-none", draftsOpen && "rotate-90")} aria-hidden />
                        {t("panel.drafts")} <span className="text-callout font-normal tabular-nums">{drafts.length}</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <ul>{drafts.map(row)}</ul>
                      </CollapsibleContent>
                    </Collapsible>
                  ) : null}
                </>
              ) : (
                <p className="px-4 py-10 text-center text-body text-muted-foreground">{t(`panel.empty.${queue.kind}`)}</p>
              )}
            </div>
          </div>

          <footer className="flex h-11 shrink-0 items-center gap-1 pr-2 pl-4 text-callout leading-4 text-muted-foreground">
            {pickedHere.length || marked.length ? (
              // While something is picked, or just marked: how many, and what to do with them.
              <>
                <p role="status" className="flex-1 font-semibold whitespace-nowrap text-foreground">
                  {pickedHere.length ? t("panel.selected", { count: pickedHere.length }) : t("panel.marked", { count: marked.length })}
                </p>
                {pickedHere.length ? (
                  <>
                    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setPicked(new Set())}>
                      {t("panel.clear")}
                    </Button>
                    <Button size="sm" onClick={markDone}>
                      {t("panel.markDone")}
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" size="sm" onClick={undo}>
                    {t("panel.undo")}
                  </Button>
                )}
              </>
            ) : (
              <>
                {update ? (
                  <button
                    type="button"
                    disabled={updating}
                    className="flex cursor-default items-center gap-1.5 rounded-sm font-semibold text-success outline-none focus-ring"
                    onClick={() => {
                      setUpdating(true);
                      void bridge.installUpdate().catch(() => setUpdating(false));
                    }}
                  >
                    {updating ? <Loader2 className="size-3 animate-spin" /> : null}
                    {updating ? t("panel.updating") : t("panel.updateTo", { version: update })}
                  </button>
                ) : null}
                <p role="status" className={cn("whitespace-nowrap", update && "sr-only")}>
                  {status.updatedAt ? (Date.now() - status.updatedAt < 60_000 ? t("panel.updatedNow") : t("panel.updatedAgo", { ago: t.ago(status.updatedAt) })) : status.phase === "loading" ? t("panel.checking") : ""}
                </p>
                {unreadHere ? (
                  <button type="button" className="ml-auto h-7 cursor-default rounded-[8px] px-2 font-semibold text-(--panel-link) outline-none hover:bg-foreground/6 focus-ring" onClick={() => markQueueSeen(queue.id)}>
                    {t("panel.markAllRead")}
                  </button>
                ) : null}
              </>
            )}
          </footer>
        </main>
      )}
    </div>
  );
}
