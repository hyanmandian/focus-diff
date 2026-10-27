// The floating panel under the tray icon, laid out like Focus Diff's popup: the queues as tabs, the
// chosen one's pull requests on a raised pane, narrowed to a repository with chips and grouped by
// repository, drafts folded at the end. A click opens the pull request's review window, where the
// reviewing happens.

import { AlertCircle, ChevronRight, Loader2, RefreshCw, Settings } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/button/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/collapsible/collapsible";
import { Connect } from "@/components/connect/connect";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu/dropdown-menu";
import { Mark } from "@/components/mark/mark";
import { OpenLink, openLink } from "@/components/open-link/open-link";
import { ReviewTime } from "@/components/panel-review-time/panel-review-time";
import { PullRow } from "@/components/pull-row/pull-row";
import { Skeleton } from "@/components/skeleton/skeleton";
import { SlidingPill } from "@/components/sliding-pill/sliding-pill";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/tooltip/tooltip";
import { arrange } from "@/utils/arrange/arrange";
import { bridge } from "@/utils/bridge/bridge";
import { cn } from "@/utils/cn/cn";
import type { Queue } from "@/utils/config/config";
import type { Item } from "@/utils/engine/engine";
import { useT } from "@/utils/i18n/i18n";
import { tabKeys } from "@/utils/keys/keys";
import { shortcut } from "@/utils/os/os";
import type { Unlisten } from "@/utils/platform/platform";
import { prefetchSome } from "@/utils/prefetch/prefetch";
import { parsePullLink } from "@/utils/pull-link/pull-link";
import {
  clearArrival,
  dismiss,
  isUnread,
  markQueueSeen,
  markSeen,
  refresh,
  restore,
  useStore,
} from "@/utils/store/store";
import { useTheme } from "@/utils/theme/theme";

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

/** Stops listening once the listener is in place. */
async function unlisten(off: Promise<Unlisten>) {
  (await off)();
}

/** Whether a moment was within the last minute (as of now). */
const lastMinute = (at: number) => Date.now() - at < 60_000;

/** Whether the panel is on screen: arrivals play only then, so they're seen. */
function useShown() {
  const [shown, setShown] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const update = () => {
      setShown(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", update);
    const off = bridge.on("panel-shown", () => {
      setShown(true);
    });
    return () => {
      document.removeEventListener("visibilitychange", update);
      void unlisten(off);
    };
  }, []);
  return shown;
}

/** A count on a tab or chip, as Focus Diff's popup has it: a small pill of tabular figures, white on
    the accent when its option is chosen. */
function Count({ n, on }: { n: number; on?: boolean }) {
  return (
    <span
      className={cn(
        "min-w-5 rounded-full px-1.5 text-center text-subheadline leading-[18px] font-semibold tabular-nums",
        on ? "bg-black/16 text-primary-foreground" : "bg-foreground/10 text-muted-foreground",
      )}
    >
      {n}
    </span>
  );
}

/** The panel's raised panes, as the extension's: on a hairline border, rounded, with a small shadow. */
const PANE =
  "rounded-[12px] border border-(--panel-separator) bg-(--panel-raised) shadow-[0_1px_2px_rgb(0_0_0/0.06),0_6px_18px_rgb(0_0_0/0.08)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.3),0_6px_18px_rgb(0_0_0/0.35)]";

/** A repository by its name alone, unless two owners have one by that name. */
const shortName = (repo: string, all: string[]) => {
  const name = repo.slice(repo.indexOf("/") + 1);
  return all.filter((r) => r.endsWith(`/${name}`)).length > 1 ? repo : name;
};

/** The header's buttons: 28pt, a 16pt glyph in the secondary label color; a fill only while pressed
 *  or while its menu is open (controls in a popover don't light up under the pointer). */
const TOOL =
  "rounded-full text-muted-foreground active:bg-foreground/8 aria-expanded:bg-foreground/8 aria-expanded:text-foreground dark:active:bg-foreground/10";

export function Panel() {
  const { ready, signedIn, auth, config, items, status, arrivals, seen, review } = useStore();
  const shown = useShown();
  const t = useT();
  // Open Pull Request…: open, and what it shows on opening (a link that couldn't be opened, and why).
  const [linkSheet, setLinkSheet] = useState<{ at: number; initial: { text: string; error: string } | null } | null>(
    null,
  );
  // A link pasted in the panel or sent from a focusdiff:// link: opened, or the sheet says why not.
  const tRef = useRef(t);
  useLayoutEffect(() => {
    tRef.current = t;
  });
  useEffect(() => {
    const tryLink = async (text: string) => {
      const error = await openLink(text, tRef.current);
      if (!error) return;
      void bridge.openPanel();
      setLinkSheet({ at: Date.now(), initial: { text: text.trim(), error } });
    };
    // Pasted anywhere but a text field: a pull request's link, or what looks like a link to one.
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA)$/u.test(target.tagName)))
        return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!parsePullLink(text) && !/^\s*https?:\/\//u.test(text)) return;
      e.preventDefault();
      void tryLink(text);
    };
    document.addEventListener("paste", onPaste);
    const off = bridge.on<string>("open-link", (text) => void tryLink(text));
    void bridge.takeLink().then(async (text) => {
      if (text) await tryLink(text);
    });
    return () => {
      document.removeEventListener("paste", onPaste);
      void unlisten(off);
    };
  }, []);
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
  const queue =
    queues.find((q) => q.id === tab) ?? queues.find((q) => (items[q.id] ?? []).some((i) => unread(i))) ?? queues[0];
  const [repo, setRepo] = useState("");
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [update, setUpdate] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  // Rows picked to mark done, in the queue on screen, and the ones just marked, which Undo puts back.
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [marked, setMarked] = useState<Item[]>([]);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The rows in the order they show, and the one last picked or unpicked, for shift-click.
  const shownRef = useRef<Item[]>([]);
  const lastPick = useRef<string | null>(null);
  // While Shift is down, the rows a click on the one under the pointer would pick, shown ahead.
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [shift, setShift] = useState(false);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      setShift(e.shiftKey);
    };
    const off = () => {
      setShift(false);
    };
    window.addEventListener("keydown", keys);
    window.addEventListener("keyup", keys);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("keydown", keys);
      window.removeEventListener("keyup", keys);
      window.removeEventListener("blur", off);
    };
  }, []);
  const pick = useCallback((item: Item, on: boolean, range = false) => {
    setMarked([]);
    const rows = shownRef.current;
    const from = range && lastPick.current ? rows.findIndex((i) => i.pr.id === lastPick.current) : -1;
    const to = rows.findIndex((i) => i.pr.id === item.pr.id);
    // From the last one to this, all as this one goes.
    const ids =
      from >= 0 && to >= 0 ? rows.slice(Math.min(from, to), Math.max(from, to) + 1).map((i) => i.pr.id) : [item.pr.id];
    lastPick.current = item.pr.id;
    setAnchor(item.pr.id);
    setPicked((now) => {
      const next = new Set(now);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    void bridge.updateOffered().then(setUpdate);
    const off = bridge.on<string>("update-available", setUpdate);
    return () => {
      void unlisten(off);
    };
  }, []);
  const choose = (id: string) => {
    setTab(id);
    setPicked(new Set());
    setRepo("");
    remember("tab", id);
  };

  // What's picked as of the last render, for the keys (set after it, as refs are).
  const pickedRef = useRef(picked);
  useLayoutEffect(() => {
    pickedRef.current = picked;
  });
  // Esc closes the panel, like a menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The app's own shortcuts, which the menu bar would answer if a tray app had one showing.
      if (e.metaKey && !e.altKey && !e.ctrlKey && (e.key === "," || e.key === "q")) {
        e.preventDefault();
        void (e.key === "," ? bridge.openSettings() : bridge.quit());
      } else if (e.metaKey && !e.altKey && !e.ctrlKey && e.key === "o") {
        e.preventDefault();
        setLinkSheet({ at: Date.now(), initial: null });
      } else if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[data-popup-open]")) {
        // Lets go of what's picked first, then closes.
        if (pickedRef.current.size > 0) setPicked(new Set());
        else void bridge.hidePanel();
      }
      // `x` on a row picks it, or lets it go.
      else if (
        e.key === "x" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        e.target instanceof HTMLElement &&
        e.target.matches("[data-row]")
      ) {
        e.preventDefault();
        e.target.parentElement?.querySelector<HTMLInputElement>("input[type=checkbox]")?.click();
      }
      // Like a menu: ↑↓ walk the pull requests (from anywhere but a field or a tab row), Home/End
      // jump to the ends, Return opens the one focused.
      else if (
        /^(ArrowDown|ArrowUp|Home|End)$/u.test(e.key) &&
        !e.defaultPrevented &&
        !document.querySelector("[data-popup-open]") &&
        e.target instanceof HTMLElement
      ) {
        const target = e.target;
        if (
          /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName) ||
          target.closest("[role=tablist]") ||
          (e.key.startsWith("Arrow") && target.closest("[role=group]"))
        )
          return;
        const rows = [...document.querySelectorAll<HTMLElement>("[data-row]")].filter((r) => r.offsetParent);
        if (rows.length === 0) return;
        const at = rows.indexOf(target);
        const next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? rows.length - 1
              : at < 0
                ? e.key === "ArrowDown"
                  ? 0
                  : rows.length - 1
                : Math.min(rows.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)));
        e.preventDefault();
        const row = rows[next]!;
        row.focus();
        row.scrollIntoView({ block: "nearest" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const open = useCallback((item: Item, from?: DOMRect) => {
    markSeen(item);
    void bridge.openReview(item.pr, item.viaTeams ?? [], from, item.queueId);
  }, []);

  const list = queue ? (items[queue.id] ?? []) : [];
  // The busiest repositories first.
  const repos = [...new Set(list.map((i) => i.pr.repository.nameWithOwner))].toSorted(
    (a, b) =>
      list.filter((i) => i.pr.repository.nameWithOwner === b).length -
        list.filter((i) => i.pr.repository.nameWithOwner === a).length || a.localeCompare(b),
  );
  const narrowed = repo && repos.includes(repo) ? list.filter((i) => i.pr.repository.nameWithOwner === repo) : list;
  const { groups, drafts, stacks } = arrange(narrowed, unread);
  const inOrder = [...groups.flatMap((g) => g.items), ...(draftsOpen ? drafts : [])];
  // For shift-click: picking happens after the render that showed the rows.
  useLayoutEffect(() => {
    shownRef.current = inOrder;
  });
  const pending = new Set<string>();
  if (shift && anchor && hovered && anchor !== hovered) {
    const from = inOrder.findIndex((i) => i.pr.id === anchor);
    const to = inOrder.findIndex((i) => i.pr.id === hovered);
    if (from >= 0 && to >= 0)
      for (const i of inOrder.slice(Math.min(from, to), Math.max(from, to) + 1)) pending.add(i.pr.id);
  }
  const unreadHere = list.filter((i) => unread(i)).length;
  // What's picked and has since gone (done elsewhere, off the list) isn't picked any more.
  const pickedHere = list.filter((i) => picked.has(i.pr.id));
  const markDone = () => {
    for (const item of pickedHere) dismiss(item);
    setMarked(pickedHere);
    setPicked(new Set());
    listRef.current?.focus({ preventScroll: true });
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => {
      setMarked([]);
    }, 6000);
  };
  const undo = () => {
    for (const item of marked) restore(item);
    setMarked([]);
  };

  // The top of the list on screen, fetched ahead a moment after the panel opens (not competing with
  // its first paint), so a click on any of them opens at once. Only ones changed since last kept.
  const top = groups
    .flatMap((g) => g.items)
    .slice(0, 5)
    .map((i) => i.pr);
  const topRef = useRef(top);
  useLayoutEffect(() => {
    topRef.current = top;
  });
  // Again for each list put on screen: another queue, another repository's chips.
  useEffect(() => {
    if (!shown || !ready) return () => {};
    const timer = setTimeout(() => {
      // oxlint-disable-next-line react/exhaustive-effect-dependencies -- the queue and repository aren't read here: a new list on screen is what starts the wait again
      void prefetchSome(topRef.current);
    }, 700);
    return () => {
      clearTimeout(timer);
    };
  }, [shown, ready, queue?.id, repo]);

  const row = (item: Item, of: Queue) => (
    <li key={item.pr.id}>
      <PullRow
        item={item}
        queue={of}
        unread={unread(item)}
        arriving={shown && arrivals.has(item.pr.id)}
        onOpen={open}
        onDismiss={dismiss}
        onArrived={clearArrival}
        picked={picked.has(item.pr.id)}
        pending={pending.has(item.pr.id)}
        selecting={pickedHere.length > 0}
        onPick={pick}
        onHover={setHovered}
        stack={stacks.get(item.pr.id)}
      />
    </li>
  );
  /** A list's rows, each stack's (together, from arrange) in a group of its own. */
  const rows = (these: Item[], of: Queue) => {
    const out: ReactNode[] = [];
    for (let i = 0; i < these.length;) {
      const place = stacks.get(these[i]!.pr.id);
      if (place) {
        out.push(
          <li key={place.stack}>
            <ul aria-label={t("panel.stack", { count: place.size })}>
              {these.slice(i, i + place.size).map((each) => row(each, of))}
            </ul>
          </li>,
        );
        i += place.size;
      } else {
        out.push(row(these[i]!, of));
        i += 1;
      }
    }
    return out;
  };

  return (
    <div className="flex h-full animate-in flex-col overflow-hidden rounded-[18px] bg-(--panel-tint) text-foreground shadow-[inset_0_0_0_0.5px_var(--panel-edge)] duration-(--duration) ease-out fade-in-0 motion-reduce:animate-none">
      {/* No name: the panel was opened from its own icon. The queues straight away, and beside them
          refreshing and the menu, on the same 12px inset as everything under them. */}
      <header className="flex min-h-14 shrink-0 items-center gap-1.5 px-3 pt-3 pb-2.5" data-tauri-drag-region>
        <h1 className="sr-only">Focus Diff</h1>
        {ready ? (
          signedIn && queue ? (
            <>
              {/* The queues as the extension draws them: on a raised pane, the chosen one on an accent pill
                  that slides to the next (concentric: 12px pane, 4px in, 8px pill). */}
              {/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- its tabs take the focus, one at a time (the roving tabindex of WAI-ARIA's tabs pattern), not the list */}
              <div
                role="tablist"
                onKeyDown={tabKeys}
                aria-label={t("panel.queues")}
                className={cn(
                  PANE,
                  "relative isolate flex min-w-0 flex-1 [scrollbar-width:none] gap-0.5 overflow-x-auto p-1",
                )}
              >
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
                      onClick={() => {
                        choose(q.id);
                      }}
                      className={cn(
                        "flex h-7 flex-auto shrink-0 cursor-default items-center justify-center gap-1.5 rounded-[8px] pr-1.5 pl-2.5 text-body font-medium whitespace-nowrap focus-ring-inset transition-colors duration-150 outline-none",
                        selected ? "text-primary-foreground" : "hover:bg-foreground/6",
                      )}
                    >
                      <span className="truncate">{q.name}</span>
                      <Count n={its.length} on={selected} />
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="flex-1" data-tauri-drag-region />
          )
        ) : (
          <Skeleton className="h-9 min-w-0 flex-1 rounded-[12px] bg-(--panel-fill)" />
        )}
        <div className="flex shrink-0 items-center gap-0.5">
          {signedIn ? (
            status.phase === "error" ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className={TOOL}
                      aria-label={t("panel.refreshFailedLabel", { error: status.error ?? "" })}
                      onClick={() => void refresh(true)}
                    />
                  }
                >
                  <AlertCircle className="text-destructive" />
                </TooltipTrigger>
                <TooltipContent>{t("panel.refreshFailedTip", { error: status.error ?? "" })}</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className={TOOL}
                      aria-label={t("panel.refresh")}
                      onClick={() => void refresh(true)}
                      disabled={status.phase === "loading"}
                    />
                  }
                >
                  {status.phase === "loading" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                </TooltipTrigger>
                <TooltipContent>{t("panel.refresh")}</TooltipContent>
              </Tooltip>
            )
          ) : null}
          {/* Open Pull Request…, Settings and Quit. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" className={TOOL} aria-label={t("panel.menu")} />}
            >
              <Settings />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setLinkSheet({ at: Date.now(), initial: null });
                }}
              >
                {t("panel.openPullMenu")} <DropdownMenuShortcut>{shortcut("O", ["cmd"])}</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void bridge.openSettings()}>
                {t("panel.settings")} <DropdownMenuShortcut>{shortcut(",", ["cmd"])}</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void bridge.quit()}>
                {t("panel.quit")} <DropdownMenuShortcut>{shortcut("Q", ["cmd"])}</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {ready && signedIn && review ? <ReviewTime review={review} items={items} /> : null}
      {linkSheet ? (
        <OpenLink
          key={linkSheet.at}
          initial={linkSheet.initial}
          onClose={() => {
            setLinkSheet(null);
          }}
        />
      ) : null}

      {ready ? (
        signedIn ? (
          queue ? (
            <main className="flex min-h-0 flex-1 flex-col">
              <div
                role="tabpanel"
                aria-label={queue.name}
                className={cn(PANE, "mx-3 flex min-h-0 flex-1 flex-col overflow-hidden")}
              >
                {repos.length > 1 ? (
                  <div
                    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a row of toggle chips, not a form's fieldset (with its legend and min-inline-size)
                    role="group"
                    aria-label={t("panel.repositories")}
                    className="relative isolate flex shrink-0 [scrollbar-width:none] gap-0.5 overflow-x-auto border-b border-(--panel-separator) p-1.5"
                  >
                    <SlidingPill
                      selected={(repo && repos.includes(repo) ? repo : "") || "all"}
                      className="rounded-[8px] bg-primary"
                    />
                    {[
                      ["", t("panel.all"), list.length] as const,
                      ...repos.map(
                        (r) =>
                          [
                            r,
                            shortName(r, repos),
                            list.filter((i) => i.pr.repository.nameWithOwner === r).length,
                          ] as const,
                      ),
                    ].map(([value, label, n]) => {
                      const pressed = (repo && repos.includes(repo) ? repo : "") === value;
                      return (
                        <button
                          key={value || "all"}
                          type="button"
                          aria-pressed={pressed}
                          title={value || undefined}
                          data-pill={value || "all"}
                          onClick={() => {
                            setRepo(value);
                          }}
                          className={cn(
                            "flex h-7 max-w-45 shrink-0 cursor-default items-center gap-1.5 rounded-[8px] pr-1.5 pl-2.5 text-callout font-medium focus-ring-inset transition-colors duration-150 outline-none",
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
                  {groups.length > 0 || drafts.length > 0 ? (
                    <>
                      {groups.map((g, i) => (
                        <section
                          key={g.repo}
                          aria-label={g.repo}
                          className={cn(
                            i > 0 && "mt-1 border-t border-(--panel-separator) pt-1",
                            groups.length === 1 && repos.length <= 1 && "pt-1",
                          )}
                        >
                          {groups.length > 1 || repos.length > 1 ? (
                            // A repository's name stays up while its rows scroll by, over their boxes.
                            <h2 className="sticky top-0 z-20 -mx-1 flex items-center gap-2 bg-(--panel-raised) px-3.5 pt-2.5 pb-1.5 text-body leading-[18px] font-semibold">
                              <span className="min-w-0 truncate">
                                <span className="font-normal text-muted-foreground">
                                  {g.repo.slice(0, g.repo.indexOf("/") + 1)}
                                </span>
                                {g.repo.slice(g.repo.indexOf("/") + 1)}
                              </span>
                              <span className="text-callout font-normal text-muted-foreground tabular-nums">
                                {g.items.length}
                              </span>
                            </h2>
                          ) : null}
                          <ul data-join="column">{rows(g.items, queue)}</ul>
                        </section>
                      ))}
                      {drafts.length > 0 ? (
                        <Collapsible
                          open={draftsOpen}
                          onOpenChange={setDraftsOpen}
                          className={cn(groups.length > 0 && "mt-1 border-t border-(--panel-separator) pt-1")}
                        >
                          <CollapsibleTrigger className="flex w-full cursor-default items-center gap-1 rounded-[8px] px-2.5 py-2 text-body font-semibold text-muted-foreground focus-ring-inset outline-none hover:bg-foreground/6">
                            <ChevronRight
                              className={cn(
                                "size-3.5 transition-transform duration-200 motion-reduce:transition-none",
                                draftsOpen && "rotate-90",
                              )}
                              aria-hidden
                            />
                            {t("panel.drafts")}{" "}
                            <span className="text-callout font-normal tabular-nums">{drafts.length}</span>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <ul data-join="column">{rows(drafts, queue)}</ul>
                          </CollapsibleContent>
                        </Collapsible>
                      ) : null}
                    </>
                  ) : (
                    <p className="px-4 py-10 text-center text-body text-muted-foreground">
                      {t(`panel.empty.${queue.kind}`)}
                    </p>
                  )}
                </div>
              </div>

              <footer className="flex h-11 shrink-0 items-center gap-1 pr-2 pl-4 text-callout leading-4 text-muted-foreground">
                {pickedHere.length > 0 || marked.length > 0 ? (
                  // While something is picked, or just marked: how many, and what to do with them.
                  <>
                    <output className="flex-1 font-semibold whitespace-nowrap text-foreground">
                      {pickedHere.length > 0
                        ? t("panel.selected", { count: pickedHere.length })
                        : t("panel.marked", { count: marked.length })}
                    </output>
                    {pickedHere.length > 0 ? (
                      <>
                        <Button
                          variant="ghost"
                          className="text-muted-foreground"
                          onClick={() => {
                            setPicked(new Set());
                          }}
                        >
                          {t("panel.clear")}
                        </Button>
                        <Button onClick={markDone}>{t("panel.markDone")}</Button>
                      </>
                    ) : (
                      <Button variant="outline" onClick={undo}>
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
                        className="flex h-7 cursor-default items-center gap-1.5 rounded-[8px] px-2 font-semibold text-success focus-ring transition-colors duration-(--duration-fast) outline-none hover:bg-foreground/6"
                        onClick={() => {
                          setUpdating(true);
                          void bridge.installUpdate().catch(() => {
                            setUpdating(false);
                          });
                        }}
                      >
                        {updating ? <Loader2 className="size-3 animate-spin" /> : null}
                        {updating ? t("panel.updating") : t("panel.updateTo", { version: update })}
                      </button>
                    ) : null}
                    <output className={cn("whitespace-nowrap", update && "sr-only")}>
                      {status.updatedAt
                        ? lastMinute(status.updatedAt)
                          ? t("panel.updatedNow")
                          : t("panel.updatedAgo", { ago: t.ago(status.updatedAt) })
                        : status.phase === "loading"
                          ? t("panel.checking")
                          : ""}
                    </output>
                    {unreadHere ? (
                      <button
                        type="button"
                        className="ml-auto h-7 cursor-default rounded-[8px] px-2 font-semibold text-(--panel-link) focus-ring outline-none hover:bg-foreground/6"
                        onClick={() => {
                          markQueueSeen(queue.id);
                        }}
                      >
                        {t("panel.markAllRead")}
                      </button>
                    ) : null}
                  </>
                )}
              </footer>
            </main>
          ) : (
            <div className="flex flex-col items-center gap-3 px-8 py-16 text-center">
              <p className="text-body text-muted-foreground">{t("panel.noQueues")}</p>
              <Button variant="outline" onClick={() => void bridge.openSettings()}>
                {t("panel.setUpQueues")}
              </Button>
            </div>
          )
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
            <Mark className="size-10 text-primary" />
            <div className="flex flex-col gap-1.5">
              <h2 className="text-title3 leading-5 font-semibold">{t("panel.signedOutTitle")}</h2>
              <p className="text-body leading-[18px] text-balance text-muted-foreground">{t("panel.signedOutBody")}</p>
            </div>
            <Connect auth={auth} onConnected={() => void refresh(true)} />
          </div>
        )
      ) : (
        // The shape of what's coming, at its size: nothing moves when it arrives.
        <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-label={t("panel.loading")}>
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
      )}
    </div>
  );
}
