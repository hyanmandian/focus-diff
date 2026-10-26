// The settings window, after Raycast's and System Settings': a sidebar under the traffic lights
// (search, the account, the panes) and the open pane beside it. Queues are the heart of it.
// Changes save as you make them; the panel follows along.

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { ArrowDown, ArrowUp, CircleUserRound, Inbox, ListFilter, Loader2, LogOut, Plus, Search, Settings as SettingsIcon, Sparkles, Trash2, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getVersion } from "@tauri-apps/api/app";
import { PROVIDERS } from "@/lib/ai";
import { avatar } from "@/lib/avatar";
import { bridge, type AuthStatus } from "@/lib/bridge";
import { loadConfig, saveConfig, TEMPLATES, type Config, type Queue, type QueueKind } from "@/lib/config";
import { interval } from "@/lib/copy";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Connect } from "@/shared/Connect";
import { Actions } from "./Actions";
import { Ai } from "./Ai";
import { Filters } from "./Filters";
import { Group, Intro, LinkRow, Pane, Row, useDetail } from "./Form";
import { QueueEditor } from "./QueueEditor";

const DOT: Record<Queue["tone"], string> = {
  blue: "bg-unread",
  purple: "bg-violet",
  green: "bg-success",
  amber: "bg-warning",
  red: "bg-destructive",
  gray: "bg-muted-foreground",
};

function useConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    void loadConfig().then(setConfig);
  }, []);
  // Saved shortly after the last change, so typing a name doesn't write on every key.
  const update = useCallback((next: Config) => {
    setConfig(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveConfig(next), 350);
  }, []);
  return [config, update] as const;
}

function AddQueue({ config, onAdd }: { config: Config; onAdd: (queue: Queue) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="xs" className="-mr-1.5 text-[12px] font-normal" disabled={config.queues.length >= 12} />}>
        <Plus /> Add queue
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {(Object.keys(TEMPLATES) as QueueKind[]).map((kind) => (
          <DropdownMenuItem key={kind} className="flex-col items-start gap-0.5 whitespace-normal" onClick={() => onAdd(TEMPLATES[kind].make())}>
            <span className="font-medium">{TEMPLATES[kind].name}</span>
            <span className="text-[11px] text-muted-foreground">{TEMPLATES[kind].description}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Queues({ config, onChange }: { config: Config; onChange: (c: Config) => void }) {
  const detail = useDetail();
  const selected = config.queues.find((q) => q.id === detail.openId) ?? null;
  const setQueues = (queues: Queue[]) => onChange({ ...config, queues });
  const replace = (queue: Queue) => setQueues(config.queues.map((q) => (q.id === queue.id ? queue : q)));
  const move = (index: number, by: number) => {
    const queues = [...config.queues];
    const [queue] = queues.splice(index, 1);
    if (!queue) return;
    queues.splice(index + by, 0, queue);
    setQueues(queues);
  };

  if (selected) {
    const index = config.queues.indexOf(selected);
    return (
      <Pane
        title={selected.name || "Untitled queue"}
        back={{ label: "Queues", onBack: detail.close, ref: detail.backRef }}
        tools={
          <>
            <Button variant="ghost" size="icon-sm" aria-label="Move up" title="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
              <ArrowUp />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Move down" title="Move down" disabled={index === config.queues.length - 1} onClick={() => move(index, 1)}>
              <ArrowDown />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete ${selected.name}`}
              title="Delete queue"
              onClick={() => {
                setQueues(config.queues.filter((q) => q.id !== selected.id));
                detail.close();
              }}
            >
              <Trash2 />
            </Button>
          </>
        }
      >
        <Group>
          <Row label="Show in the panel" description={selected.enabled ? undefined : "Hidden: it isn't checked or shown until you turn it back on."} htmlFor="queue-enabled">
            <Switch id="queue-enabled" checked={selected.enabled} onCheckedChange={(enabled) => replace({ ...selected, enabled })} />
          </Row>
        </Group>
        <QueueEditor key={selected.id} queue={selected} onChange={replace} />
      </Pane>
    );
  }

  return (
    <Pane title="Queues">
      <Intro>The panel's tabs, in this order. Each gathers the pull requests that match it; open one to change what goes in it and what's worth a notification.</Intro>
      <Group
        title="Queues"
        accessory={
          <AddQueue
            config={config}
            onAdd={(queue) => {
              setQueues([...config.queues, queue]);
              detail.open(queue.id);
            }}
          />
        }
        footer="Switched-off queues stay here, unchecked and out of the panel."
      >
        {config.queues.length ? (
          config.queues.map((queue) => (
            <LinkRow
              key={queue.id}
              ref={detail.rowRef(queue.id)}
              leading={<span className={cn("size-2.5 shrink-0 rounded-full", DOT[queue.tone], !queue.enabled && "opacity-40")} aria-hidden />}
              label={queue.name || "Untitled queue"}
              description={TEMPLATES[queue.kind].name}
              muted={!queue.enabled}
              onOpen={() => detail.open(queue.id)}
              control={<Switch checked={queue.enabled} onCheckedChange={(enabled) => replace({ ...queue, enabled })} aria-label={`Show ${queue.name} in the panel`} />}
            />
          ))
        ) : (
          <Row description="No queues yet. Add one to start." />
        )}
      </Group>
    </Pane>
  );
}

const avatarOf = (login: string) => avatar(`https://avatars.githubusercontent.com/${login}`, 80);

function Account({ auth, onChange }: { auth: AuthStatus | null; onChange: () => void }) {
  return (
    <Pane title="Account">
      {!auth ? (
        <Loader2 className="m-3 animate-spin text-muted-foreground" aria-label="Loading" />
      ) : (
        <Group title="GitHub" footer="Focus Diff reads and acts on pull requests as you. Your token stays in your system keychain and is only ever sent to GitHub.">
          {auth.signed_in && auth.login ? (
            <div className="flex min-h-14 items-center gap-3 px-3 py-2.5">
              <Avatar className="size-9">
                <AvatarImage src={avatarOf(auth.login)} alt="" />
                <AvatarFallback className="text-[13px]">{auth.login.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">@{auth.login}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{auth.source === "gh" ? "Using the GitHub CLI's login" : "Signed in with GitHub"}</div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void bridge.authSignOut().then(onChange);
                }}
              >
                <LogOut /> Disconnect
              </Button>
            </div>
          ) : (
            <div className="p-4">
              <Connect auth={auth} onConnected={onChange} />
            </div>
          )}
        </Group>
      )}
    </Pane>
  );
}

const THEMES: Record<Config["theme"], string> = { system: "Like the system", light: "Light", dark: "Dark" };

function Updates() {
  const [version, setVersion] = useState("");
  const [state, setState] = useState<{ phase: "idle" | "checking" | "installing" } | { phase: "found"; version: string } | { phase: "latest" | "error"; message?: string }>({ phase: "idle" });
  useEffect(() => {
    void getVersion().then(setVersion);
    void bridge.updateOffered().then((v) => v && setState({ phase: "found", version: v }));
  }, []);
  const check = async () => {
    setState({ phase: "checking" });
    try {
      const found = await bridge.checkUpdate();
      setState(found ? { phase: "found", version: found } : { phase: "latest" });
    } catch (e) {
      // The updater's own words are technical; the gist is enough.
      const detail = typeof e === "string" ? e : String(e);
      setState({ phase: "error", message: /release JSON|fetch|network|connect/i.test(detail) ? "no published release could be reached" : detail });
    }
  };
  return (
    <Row
      label={version ? `Focus Diff ${version}` : "Focus Diff"}
      description={
        state.phase === "found"
          ? `Version ${state.version} is out.`
          : state.phase === "latest"
            ? "You have the latest version."
            : state.phase === "error"
              ? `Couldn't check: ${state.message}`
              : "Checks for updates on its own; you choose when to install."
      }
    >
      {state.phase === "found" || state.phase === "installing" ? (
        <Button
          size="sm"
          disabled={state.phase === "installing"}
          onClick={() => {
            setState({ phase: "installing" });
            void bridge.installUpdate().catch((e: unknown) => setState({ phase: "error", message: String(e) }));
          }}
        >
          {state.phase === "installing" ? <Loader2 className="animate-spin" /> : null} Update and restart
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={state.phase === "checking"} onClick={() => void check()}>
          {state.phase === "checking" ? <Loader2 className="animate-spin" /> : null} Check for updates
        </Button>
      )}
    </Row>
  );
}

function General({ config, onChange }: { config: Config; onChange: (c: Config) => void }) {
  return (
    <Pane title="General">
      <Group title="Software update">
        <Updates />
      </Group>
      <Group title="Behavior">
        <Row label="Check GitHub every" description="Also whenever you open the panel.">
          <Select value={String(config.pollSeconds)} onValueChange={(v) => onChange({ ...config, pollSeconds: Number(v) })}>
            <SelectTrigger size="sm" className="w-36" aria-label="Refresh interval">
              <SelectValue>{(v: string) => interval(Number(v))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {[30, 60, 90, 180, 300, 600].map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {interval(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Appearance">
          <Select value={config.theme} onValueChange={(v) => onChange({ ...config, theme: v as Config["theme"] })}>
            <SelectTrigger size="sm" className="w-36" aria-label="Appearance">
              <SelectValue>{(v: string) => THEMES[v as Config["theme"]]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(THEMES) as Array<Config["theme"]>).map((t) => (
                <SelectItem key={t} value={t}>
                  {THEMES[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Play a sound with notifications" htmlFor="sound">
          <Switch id="sound" checked={config.sound} onCheckedChange={(sound) => onChange({ ...config, sound })} />
        </Row>
      </Group>
    </Pane>
  );
}

type PaneId = "queues" | "filters" | "actions" | "ai" | "account" | "general";
const PANE_IDS: PaneId[] = ["account", "queues", "filters", "actions", "ai", "general"];

/** The panes in the sidebar, each on a tile in a system color, as System Settings draws them. */
const PANES: Array<{ value: Exclude<PaneId, "account">; label: string; icon: typeof Inbox; tile: string; keywords: string[] }> = [
  {
    value: "queues",
    label: "Queues",
    icon: Inbox,
    tile: "blue",
    keywords: ["Tabs", "Review requests", "Pull requests where", "Repositories", "Changing files", "Drafts", "Bots", "Labels", "Teams", "Notify me when", "Notifications", "Color"],
  },
  { value: "filters", label: "Filters", icon: ListFilter, tile: "indigo", keywords: ["Diff filters", "Include", "Leave out", "Regular expressions", "File paths", "Chips", "Only in", "Repositories", "Share", "Copy filters", "Import filters"] },
  { value: "actions", label: "Actions", icon: Zap, tile: "orange", keywords: ["Buttons", "Steps", "Post a comment", "Request review", "Labels", "Open a link", "Run a command", "Ask me to confirm"] },
  {
    value: "ai",
    label: "AI",
    icon: Sparkles,
    tile: "purple",
    keywords: ["Coding agent", ...Object.values(PROVIDERS).map((p) => p.name), "Model", "Effort", "Read the whole project", "AI review", "Review guidelines", "Prompts"],
  },
  {
    value: "general",
    label: "General",
    icon: SettingsIcon,
    tile: "gray",
    keywords: ["Software update", "Check for updates", "Version", "Check GitHub every", "Refresh interval", "Appearance", "Theme", "Dark", "Light", "Play a sound with notifications"],
  },
];
const ACCOUNT_KEYWORDS = ["Account", "GitHub", "Sign in", "Disconnect", "Sign out", "Token", "Login"];

const TITLES: Record<PaneId, string> = { account: "Account", queues: "Queues", filters: "Filters", actions: "Actions", ai: "AI", general: "General" };

/** What a search finds in a pane: nothing (null), its name, or the first setting that matches. */
function match(query: string, label: string, keywords: string[]): { hint?: string } | null {
  const q = query.trim().toLowerCase();
  if (!q) return {};
  if (label.toLowerCase().includes(q)) return {};
  const hit = keywords.find((k) => k.toLowerCase().includes(q));
  return hit ? { hint: hit } : null;
}

/** The panes a search finds, with the setting (or queue, action, filter, prompt by name) that matched. */
function findPanes(query: string, config: Config, auth: AuthStatus | null) {
  const names = (list: Array<{ name: string }>) => list.map((x) => x.name).filter(Boolean);
  const own: Partial<Record<PaneId, string[]>> = {
    queues: names(config.queues),
    actions: names(config.actions),
    filters: names(config.filters),
    ai: names(config.ai.prompts),
  };
  const accountMatch = match(query, auth?.login ?? "Account", ACCOUNT_KEYWORDS);
  const panes = PANES.map((p) => ({ ...p, found: match(query, p.label, [...(own[p.value] ?? []), ...p.keywords]) })).filter((p) => p.found);
  return { accountMatch, panes };
}

// Like a Mac settings window, it reopens on the pane last used (a convenience: fine to lose).
const PANE_KEY = "settings-pane";
function rememberedPane(): PaneId {
  try {
    const v = localStorage.getItem(PANE_KEY);
    return PANE_IDS.includes(v as PaneId) ? (v as PaneId) : "queues";
  } catch {
    return "queues";
  }
}

const sidebarItem = cn(
  "group/item flex w-full items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none",
  "hover:bg-[var(--settings-hover)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
  "data-[active]:bg-[var(--settings-selection)]",
);

function Sidebar({ config, auth, query, setQuery }: { config: Config; auth: AuthStatus | null; query: string; setQuery: (q: string) => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // ⌘F finds a setting, as in System Settings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { accountMatch, panes } = findPanes(query, config, auth);
  const nothing = !accountMatch && !panes.length;

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-[var(--settings-separator)] bg-[var(--settings-sidebar)]">
      {/* The traffic lights sit here (x 0-78, centred at y 26); the strip drags the window. */}
      <div data-tauri-drag-region className="h-[52px] shrink-0" />
      <div className="px-2.5 pb-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            ref={searchRef}
            type="search"
            aria-label="Search settings"
            placeholder="Search settings…"
            value={query}
            spellCheck={false}
            autoCorrect="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault();
                setQuery("");
              } else if (e.key === "ArrowDown" || e.key === "Enter") {
                // Into the results; the first is already shown.
                e.preventDefault();
                (listRef.current?.querySelector("[role=tab][aria-selected=true]") ?? listRef.current?.querySelector("[role=tab]"))?.closest<HTMLElement>("[role=tab]")?.focus();
              }
            }}
            className="settings-search h-7 w-full rounded-md bg-[var(--settings-field)] pr-2 pl-7 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>
      <TabsPrimitive.List ref={listRef} activateOnFocus loopFocus={false} aria-label="Settings" className="settings-scroll flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2.5 pb-3">
        {accountMatch ? (
          <TabsPrimitive.Tab value="account" className={cn(sidebarItem, "mb-2 h-12 gap-2.5")}>
            <Avatar className="size-8">
              {auth?.login ? <AvatarImage src={avatarOf(auth.login)} alt="" /> : null}
              <AvatarFallback>
                <CircleUserRound className="size-5" strokeWidth={1.5} aria-hidden />
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] leading-4 font-medium">{auth?.signed_in && auth.login ? auth.login : "Not signed in"}</span>
              <span className="block truncate text-[11px] leading-4 text-muted-foreground">{accountMatch.hint ?? "Account"}</span>
            </span>
          </TabsPrimitive.Tab>
        ) : null}
        {panes.map(({ value, label, icon: Icon, tile, found }) => (
          <TabsPrimitive.Tab key={value} value={value} className={cn(sidebarItem, found?.hint ? "h-10" : "h-7")}>
            <span className="settings-tile grid size-5 shrink-0 place-items-center rounded-[5px] text-white" data-tile={tile} aria-hidden>
              <Icon className="size-3" strokeWidth={2.25} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate leading-4">{label}</span>
              {found?.hint ? <span className="block truncate text-[11px] leading-4 text-muted-foreground">{found.hint}</span> : null}
            </span>
          </TabsPrimitive.Tab>
        ))}
        {nothing ? (
          <p className="px-2 py-6 text-center text-[12px] text-muted-foreground" role="status">
            No settings match "{query.trim()}".
          </p>
        ) : null}
      </TabsPrimitive.List>
    </aside>
  );
}

export function Settings() {
  const [config, setConfig] = useConfig();
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [pane, setPane] = useState<PaneId>(rememberedPane);
  const [query, setQuery] = useState("");
  const loadAuth = useCallback(() => void bridge.authStatus().then(setAuth), []);
  useEffect(loadAuth, [loadAuth]);
  useTheme(config?.theme);
  // The window is titled after the pane, as Mac settings windows are (Window menu, Mission Control).
  useEffect(() => {
    document.title = TITLES[pane];
    try {
      localStorage.setItem(PANE_KEY, pane);
    } catch {
      /* not remembered */
    }
  }, [pane]);

  // Searching shows the first pane that matches, as System Settings does, unless the one open still does.
  const search = (q: string) => {
    setQuery(q);
    if (!config || !q.trim()) return;
    const { accountMatch, panes } = findPanes(q, config, auth);
    const hits: PaneId[] = [...(accountMatch ? ["account" as const] : []), ...panes.map((p) => p.value)];
    if (hits.length && !hits.includes(pane)) setPane(hits[0]!);
  };

  if (!config)
    return (
      <div className="flex h-full">
        <div data-tauri-drag-region className="h-full w-[220px] border-r border-[var(--settings-separator)] bg-[var(--settings-sidebar)]" />
        <div data-tauri-drag-region className="h-[52px] flex-1" />
      </div>
    );
  return (
    <TabsPrimitive.Root value={pane} onValueChange={(v: PaneId) => setPane(v)} orientation="vertical" className="flex h-full text-[13px]">
      <Sidebar config={config} auth={auth} query={query} setQuery={search} />
      <main className="min-w-0 flex-1 bg-[var(--settings-window)]">
        <TabsPrimitive.Panel value="queues" className="h-full outline-none">
          <Queues config={config} onChange={setConfig} />
        </TabsPrimitive.Panel>
        <TabsPrimitive.Panel value="filters" className="h-full outline-none">
          <Filters config={config} onChange={setConfig} />
        </TabsPrimitive.Panel>
        <TabsPrimitive.Panel value="actions" className="h-full outline-none">
          <Actions config={config} onChange={setConfig} />
        </TabsPrimitive.Panel>
        <TabsPrimitive.Panel value="ai" className="h-full outline-none">
          <Ai config={config} onChange={setConfig} />
        </TabsPrimitive.Panel>
        <TabsPrimitive.Panel value="account" className="h-full outline-none">
          <Account auth={auth} onChange={loadAuth} />
        </TabsPrimitive.Panel>
        <TabsPrimitive.Panel value="general" className="h-full outline-none">
          <General config={config} onChange={setConfig} />
        </TabsPrimitive.Panel>
      </main>
    </TabsPrimitive.Root>
  );
}
