// The settings window: queues (the heart of it), the GitHub account, and general preferences.
// Changes save as you make them; the panel follows along.

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { ArrowDown, ArrowUp, CircleUserRound, Inbox, ListFilter, Loader2, LogOut, Plus, Settings as SettingsIcon, Sparkles, Trash2, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getVersion } from "@tauri-apps/api/app";
import { bridge, type AuthStatus } from "@/lib/bridge";
import { loadConfig, saveConfig, TEMPLATES, type Config, type Queue, type QueueKind } from "@/lib/config";
import { interval } from "@/lib/copy";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Connect } from "@/shared/Connect";
import { Actions } from "./Actions";
import { Ai } from "./Ai";
import { Filters } from "./Filters";
import { Group, Page, Row, SideList, sideItem } from "./Form";
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

function Queues({ config, onChange }: { config: Config; onChange: (c: Config) => void }) {
  const [selectedId, setSelectedId] = useState(config.queues[0]?.id ?? null);
  const selected = config.queues.find((q) => q.id === selectedId) ?? config.queues[0] ?? null;
  const setQueues = (queues: Queue[]) => onChange({ ...config, queues });
  const replace = (queue: Queue) => setQueues(config.queues.map((q) => (q.id === queue.id ? queue : q)));
  const move = (index: number, by: number) => {
    const queues = [...config.queues];
    const [queue] = queues.splice(index, 1);
    if (!queue) return;
    queues.splice(index + by, 0, queue);
    setQueues(queues);
  };

  return (
    <div className="grid h-full grid-cols-[208px_1fr]">
      <SideList
        label="Queues"
        footer={
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="xs" className="text-[12px] font-normal" disabled={config.queues.length >= 12} />}>
              <Plus /> Add queue
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              {(Object.keys(TEMPLATES) as QueueKind[]).map((kind) => (
                <DropdownMenuItem
                  key={kind}
                  className="flex-col items-start gap-0.5"
                  onClick={() => {
                    const queue = TEMPLATES[kind].make();
                    setQueues([...config.queues, queue]);
                    setSelectedId(queue.id);
                  }}
                >
                  <span className="font-medium">{TEMPLATES[kind].name}</span>
                  <span className="text-xs text-muted-foreground">{TEMPLATES[kind].description}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        {config.queues.map((queue) => (
          <li key={queue.id} className={sideItem(selected?.id === queue.id)}>
            <button
              type="button"
              className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setSelectedId(queue.id)}
              aria-current={selected?.id === queue.id}
            >
              <span className={cn("size-2 shrink-0 rounded-full", DOT[queue.tone], !queue.enabled && "opacity-40")} aria-hidden />
              <span className={cn("truncate", !queue.enabled && "text-muted-foreground")}>{queue.name}</span>
            </button>
            <Switch size="sm" checked={queue.enabled} onCheckedChange={(enabled) => replace({ ...queue, enabled })} aria-label={`Show ${queue.name}`} />
          </li>
        ))}
      </SideList>
      {selected ? (
        <Page>
          <div className="flex items-center gap-2 px-2.5">
            <h2 className="truncate text-[15px] font-semibold">{selected.name || "Untitled queue"}</h2>
            <div className="ml-auto flex gap-0.5">
              <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={config.queues[0]?.id === selected.id} onClick={() => move(config.queues.indexOf(selected), -1)}>
                <ArrowUp />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Move down" disabled={config.queues.at(-1)?.id === selected.id} onClick={() => move(config.queues.indexOf(selected), 1)}>
                <ArrowDown />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${selected.name}`}
                onClick={() => {
                  const rest = config.queues.filter((q) => q.id !== selected.id);
                  setQueues(rest);
                  setSelectedId(rest[0]?.id ?? null);
                }}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
          <QueueEditor key={selected.id} queue={selected} onChange={replace} />
        </Page>
      ) : (
        <div className="grid h-full place-items-center p-10 text-center text-[13px] text-muted-foreground">Add a queue to start.</div>
      )}
    </div>
  );
}

function Account({ auth, onChange }: { auth: AuthStatus | null; onChange: () => void }) {
  if (!auth) return <Loader2 className="m-6 animate-spin text-muted-foreground" aria-label="Loading" />;
  return (
    <Page>
      <Group title="GitHub" footer="Focus Diff reads and acts on pull requests as you. Your token stays in your system keychain and is only ever sent to GitHub.">
        {auth.signed_in ? (
          <Row label={`@${auth.login}`} description={auth.source === "gh" ? "Using the GitHub CLI's login" : "Signed in with GitHub"}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void bridge.authSignOut().then(onChange);
              }}
            >
              <LogOut /> Disconnect
            </Button>
          </Row>
        ) : (
          <div className="p-4">
            <Connect auth={auth} onConnected={onChange} />
          </div>
        )}
      </Group>
    </Page>
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
      label={`Focus Diff ${version}`}
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
    <Page>
      <Group title="Software update">
        <Updates />
      </Group>
      <Group>
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
    </Page>
  );
}

const PANES = [
  { value: "queues", label: "Queues", icon: Inbox },
  { value: "filters", label: "Filters", icon: ListFilter },
  { value: "actions", label: "Actions", icon: Zap },
  { value: "ai", label: "AI", icon: Sparkles },
  { value: "account", label: "Account", icon: CircleUserRound },
  { value: "general", label: "General", icon: SettingsIcon },
] as const;
type Pane = (typeof PANES)[number]["value"];

// Like a Mac settings window, it reopens on the pane last used (a convenience: fine to lose).
const PANE_KEY = "settings-pane";
function rememberedPane(): Pane {
  try {
    const v = localStorage.getItem(PANE_KEY);
    return PANES.some((p) => p.value === v) ? (v as Pane) : "queues";
  } catch {
    return "queues";
  }
}

export function Settings() {
  const [config, setConfig] = useConfig();
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [pane, setPane] = useState<Pane>(rememberedPane);
  const loadAuth = useCallback(() => void bridge.authStatus().then(setAuth), []);
  useEffect(loadAuth, [loadAuth]);
  useTheme(config?.theme);
  // The window is titled after the pane, as Mac settings windows are (Window menu, Mission Control).
  useEffect(() => {
    document.title = PANES.find((p) => p.value === pane)?.label ?? "Settings";
    try {
      localStorage.setItem(PANE_KEY, pane);
    } catch {
      /* not remembered */
    }
  }, [pane]);

  if (!config) return <div className="h-[52px]" data-tauri-drag-region />;
  return (
    <TabsPrimitive.Root value={pane} onValueChange={(v: Pane) => setPane(v)} className="flex h-full flex-col text-[13px]">
      {/* The window's toolbar area: the traffic lights sit at its left (x 0-78, centred at y 26),
          so the panes are centred on the window with room kept clear on both sides. Dragging
          works on the bar itself and on anything in it that isn't a button. */}
      <header data-tauri-drag-region className="flex h-[52px] shrink-0 items-center justify-center border-b border-[var(--settings-separator)] px-20">
        <TabsPrimitive.List data-tauri-drag-region aria-label="Settings" className="flex h-full items-center gap-0.5">
          {PANES.map(({ value, label, icon: Icon }) => (
            <TabsPrimitive.Tab
              key={value}
              value={value}
              className={cn(
                "group flex h-[42px] min-w-[54px] flex-col items-center justify-center gap-[3px] rounded-lg px-2 text-[11px] leading-none text-muted-foreground outline-none",
                "hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-colors",
                "data-[active]:bg-[var(--settings-selection)] data-[active]:text-foreground",
              )}
            >
              <Icon className="size-[18px] group-data-[active]:text-unread" strokeWidth={1.75} aria-hidden />
              {label}
            </TabsPrimitive.Tab>
          ))}
        </TabsPrimitive.List>
      </header>
      <TabsPrimitive.Panel value="queues" className="min-h-0 flex-1 outline-none">
        <Queues config={config} onChange={setConfig} />
      </TabsPrimitive.Panel>
      <TabsPrimitive.Panel value="filters" className="min-h-0 flex-1 outline-none">
        <Filters config={config} onChange={setConfig} />
      </TabsPrimitive.Panel>
      <TabsPrimitive.Panel value="actions" className="min-h-0 flex-1 outline-none">
        <Actions config={config} onChange={setConfig} />
      </TabsPrimitive.Panel>
      <TabsPrimitive.Panel value="ai" className="min-h-0 flex-1 outline-none">
        <Ai config={config} onChange={setConfig} />
      </TabsPrimitive.Panel>
      <TabsPrimitive.Panel value="account" className="min-h-0 flex-1 outline-none">
        <Account auth={auth} onChange={loadAuth} />
      </TabsPrimitive.Panel>
      <TabsPrimitive.Panel value="general" className="min-h-0 flex-1 outline-none">
        <General config={config} onChange={setConfig} />
      </TabsPrimitive.Panel>
    </TabsPrimitive.Root>
  );
}
