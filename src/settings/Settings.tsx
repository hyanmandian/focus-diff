// The settings window: queues (the heart of it), the GitHub account, and general preferences.
// Changes save as you make them; the panel follows along.

import { ArrowDown, ArrowUp, Loader2, LogOut, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { bridge, type AuthStatus } from "@/lib/bridge";
import { loadConfig, saveConfig, TEMPLATES, type Config, type Queue, type QueueKind } from "@/lib/config";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Connect } from "@/shared/Connect";
import { Mark } from "@/shared/Mark";
import { Actions } from "./Actions";
import { Ai } from "./Ai";
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
    <div className="grid h-full grid-cols-[220px_1fr]">
      <aside className="flex flex-col gap-2 border-r p-3">
        <ul className="flex flex-col gap-0.5" aria-label="Queues">
          {config.queues.map((queue) => (
            <li key={queue.id}>
              <div
                className={cn(
                  "group flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px]",
                  selected?.id === queue.id ? "bg-accent text-accent-foreground" : "hover:bg-foreground/5",
                )}
              >
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:underline" onClick={() => setSelectedId(queue.id)} aria-current={selected?.id === queue.id}>
                  <span className={cn("size-2 shrink-0 rounded-full", DOT[queue.tone], !queue.enabled && "opacity-40")} aria-hidden />
                  <span className={cn("truncate", !queue.enabled && "text-muted-foreground")}>{queue.name}</span>
                </button>
                <Switch size="sm" checked={queue.enabled} onCheckedChange={(enabled) => replace({ ...queue, enabled })} aria-label={`Show ${queue.name}`} />
              </div>
            </li>
          ))}
        </ul>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="justify-start" disabled={config.queues.length >= 12} />}>
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
      </aside>
      <ScrollArea className="min-h-0">
        {selected ? (
          <div className="flex flex-col gap-6 p-6">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">{selected.name || "Untitled queue"}</h2>
              <div className="ml-auto flex gap-1">
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
          </div>
        ) : (
          <div className="grid h-full place-items-center p-10 text-center text-sm text-muted-foreground">Add a queue to start.</div>
        )}
      </ScrollArea>
    </div>
  );
}

function Account({ auth, onChange }: { auth: AuthStatus | null; onChange: () => void }) {
  if (!auth) return <Loader2 className="m-6 animate-spin text-muted-foreground" aria-label="Loading" />;
  return (
    <div className="flex max-w-md flex-col gap-6 p-6">
      <div>
        <h2 className="text-base font-semibold">GitHub</h2>
        <p className="text-sm text-muted-foreground">Focus Diff Pro reads and acts on pull requests as you. Your token stays in your system keychain and is only ever sent to GitHub.</p>
      </div>
      {auth.signed_in ? (
        <div className="flex items-center gap-3 rounded-xl border p-4">
          <div className="min-w-0 flex-1">
            <p className="font-medium">@{auth.login}</p>
            <p className="text-xs text-muted-foreground">{auth.source === "gh" ? "Using the GitHub CLI's login" : "Signed in with GitHub"}</p>
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
        <Connect auth={auth} onConnected={onChange} />
      )}
    </div>
  );
}

function General({ config, onChange }: { config: Config; onChange: (c: Config) => void }) {
  return (
    <div className="flex max-w-lg flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label className="text-[13px]">Check GitHub every</Label>
          <p className="text-xs text-muted-foreground">Also whenever you open the panel.</p>
        </div>
        <Select value={String(config.pollSeconds)} onValueChange={(v) => onChange({ ...config, pollSeconds: Number(v) })}>
          <SelectTrigger className="w-36" aria-label="Refresh interval">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[60, 90, 180, 300, 600].map((s) => (
              <SelectItem key={s} value={String(s)}>
                {s < 120 ? `${s} seconds` : `${s / 60} minutes`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-4">
        <Label className="text-[13px]">Appearance</Label>
        <Select value={config.theme} onValueChange={(v) => onChange({ ...config, theme: v as Config["theme"] })}>
          <SelectTrigger className="w-36" aria-label="Appearance">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">Like the system</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <Label htmlFor="sound" className="text-[13px]">
            Play a sound with notifications
          </Label>
        </div>
        <Switch id="sound" checked={config.sound} onCheckedChange={(sound) => onChange({ ...config, sound })} />
      </div>
    </div>
  );
}

export function Settings() {
  const [config, setConfig] = useConfig();
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const loadAuth = useCallback(() => void bridge.authStatus().then(setAuth), []);
  useEffect(loadAuth, [loadAuth]);
  useTheme(config?.theme);

  if (!config) return null;
  return (
    <Tabs defaultValue="queues" className="flex h-full flex-col gap-0">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <Mark className="size-4 text-primary" />
        <h1 className="text-sm font-semibold">Settings</h1>
        <TabsList className="ml-auto">
          <TabsTrigger value="queues">Queues</TabsTrigger>
          <TabsTrigger value="actions">Actions</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="general">General</TabsTrigger>
        </TabsList>
      </header>
      <TabsContent value="queues" className="min-h-0 flex-1">
        <Queues config={config} onChange={setConfig} />
      </TabsContent>
      <TabsContent value="actions" className="min-h-0 flex-1">
        <Actions config={config} onChange={setConfig} />
      </TabsContent>
      <TabsContent value="ai" className="min-h-0 flex-1 overflow-y-auto">
        <Ai config={config} onChange={setConfig} />
      </TabsContent>
      <TabsContent value="account" className="min-h-0 flex-1">
        <Account auth={auth} onChange={loadAuth} />
      </TabsContent>
      <TabsContent value="general" className="min-h-0 flex-1">
        <General config={config} onChange={setConfig} />
      </TabsContent>
    </Tabs>
  );
}
