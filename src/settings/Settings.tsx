// The settings window, after Raycast's and System Settings': a sidebar under the traffic lights
// (search, the account, the panes) and the open pane beside it. Queues are the heart of it.
// Changes save as you make them; the panel follows along.

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { ArrowDown, ArrowUp, CircleUserRound, Loader2, LogOut, Plus, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getVersion } from "@tauri-apps/api/app";
import { PROVIDERS } from "@/lib/ai";
import { useWebSession } from "@/lib/attachments";
import { avatar } from "@/lib/avatar";
import { bridge, type AuthStatus } from "@/lib/bridge";
import { loadConfig, saveConfig, TEMPLATES, type Config, type Queue, type QueueKind } from "@/lib/config";
import { interval } from "@/lib/copy";
import { LANGUAGES, setLanguage, translator, useT, type Language, type T } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Connect } from "@/shared/Connect";
import { Actions } from "./Actions";
import { Ai } from "./Ai";
import { Filters } from "./Filters";
import { Group, LinkRow, Pane, Row, TONE_FILL, TWO_LINE_ITEM, useDetail } from "./Form";
import { QueueEditor } from "./QueueEditor";
import { PANE_META, type PaneId } from "./panes";
import { ReviewTimePane } from "./ReviewTime";
import { confirmRemove } from "@/lib/confirm";

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
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="xs" disabled={config.queues.length >= 12} />}>
        <Plus /> {t("settings.addQueue")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {(Object.keys(TEMPLATES) as QueueKind[]).map((kind) => (
          <DropdownMenuItem key={kind} className={TWO_LINE_ITEM} onClick={() => onAdd(TEMPLATES[kind].make())}>
            <span>{t(`config.queue.${kind}`)}</span>
            <span className="text-subheadline text-muted-foreground">{t(`config.queue.${kind}.hint`)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Queues({ config, onChange }: { config: Config; onChange: (c: Config) => void }) {
  const detail = useDetail();
  const t = useT();
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
        title={selected.name || t("settings.untitledQueue")}
        back={{ label: t("settings.pane.queues"), onBack: detail.close, ref: detail.backRef }}
        tools={
          <>
            <Button variant="ghost" size="icon" aria-label={t("settings.moveUp")} title={t("settings.moveUp")} disabled={index === 0} onClick={() => move(index, -1)}>
              <ArrowUp />
            </Button>
            <Button variant="ghost" size="icon" aria-label={t("settings.moveDown")} title={t("settings.moveDown")} disabled={index === config.queues.length - 1} onClick={() => move(index, 1)}>
              <ArrowDown />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("settings.deleteNamed", { name: selected.name })}
              title={t("settings.deleteQueue")}
              onClick={async () => {
                if (!(await confirmRemove(t("settings.removeQueueConfirm", { name: selected.name || t("settings.untitledQueue") })))) return;
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
          <Row label={t("settings.showInPanel")} description={selected.enabled ? undefined : t("settings.hiddenQueue")} htmlFor="queue-enabled">
            <Switch id="queue-enabled" size="sm" checked={selected.enabled} onCheckedChange={(enabled) => replace({ ...selected, enabled })} />
          </Row>
        </Group>
        <QueueEditor key={selected.id} queue={selected} onChange={replace} />
      </Pane>
    );
  }

  return (
    <Pane title={t("settings.pane.queues")} hero="queues">
      <Group
        title={t("settings.pane.queues")}
        accessory={
          <AddQueue
            config={config}
            onAdd={(queue) => {
              setQueues([...config.queues, queue]);
              detail.open(queue.id);
            }}
          />
        }
        footer={t("settings.queuesFooter")}
      >
        {config.queues.length ? (
          config.queues.map((queue) => (
            <LinkRow
              key={queue.id}
              ref={detail.rowRef(queue.id)}
              leading={<span className={cn("size-2.5 shrink-0 rounded-full", TONE_FILL[queue.tone], !queue.enabled && "opacity-40")} aria-hidden />}
              label={queue.name || t("settings.untitledQueue")}
              description={t(`config.queue.${queue.kind}`)}
              muted={!queue.enabled}
              onOpen={() => detail.open(queue.id)}
              control={<Switch size="sm" checked={queue.enabled} onCheckedChange={(enabled) => replace({ ...queue, enabled })} aria-label={t("settings.showNamedInPanel", { name: queue.name })} />}
            />
          ))
        ) : (
          <Row description={t("settings.noQueues")} />
        )}
      </Group>
    </Pane>
  );
}

const avatarOf = (login: string) => avatar(`https://avatars.githubusercontent.com/${login}`, 80);

function Account({ auth, onChange }: { auth: AuthStatus | null; onChange: () => void }) {
  const t = useT();
  return (
    <Pane title={t("settings.pane.account")} hero="account">
      {!auth ? (
        <Loader2 className="m-3 animate-spin text-muted-foreground" aria-label={t("settings.loading")} />
      ) : (
        <Group title="GitHub" footer={t("settings.githubFooter")}>
          {auth.signed_in && auth.login ? (
            <div className="flex min-h-14 items-center gap-3 px-3 py-2.5">
              <Avatar className="size-9">
                <AvatarImage src={avatarOf(auth.login)} alt="" />
                <AvatarFallback className="text-body">{auth.login.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-semibold">@{auth.login}</div>
                <div className="mt-0.5 text-subheadline text-muted-foreground">{auth.source === "gh" ? t("settings.usingGh") : t("settings.signedIn")}</div>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  void bridge.authSignOut().then(onChange);
                }}
              >
                <LogOut /> {t("settings.disconnect")}
              </Button>
            </div>
          ) : (
            <div className="p-4">
              <Connect auth={auth} onConnected={onChange} />
            </div>
          )}
        </Group>
      )}
      {auth?.signed_in ? <Attachments /> : null}
    </Pane>
  );
}

/** Signing in on github.com itself, only to attach pictures and videos (src-tauri/src/web.rs). */
function Attachments() {
  const t = useT();
  const login = useWebSession();
  return (
    <Group title={t("settings.attachments")} footer={t("settings.attachmentsFooter")}>
      <div className="flex min-h-14 items-center gap-3 px-3 py-2.5">
        {login === undefined ? (
          <Loader2 className="animate-spin text-muted-foreground" aria-label={t("settings.loading")} />
        ) : login ? (
          <>
            <Avatar className="size-9">
              <AvatarImage src={avatarOf(login)} alt="" />
              <AvatarFallback className="text-body">{login.slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-body font-semibold">@{login}</div>
              <div className="mt-0.5 text-subheadline text-muted-foreground">{t("settings.webSignedIn")}</div>
            </div>
            <Button variant="outline" onClick={() => void bridge.signOutWeb()}>
              <LogOut /> {t("settings.webSignOut")}
            </Button>
          </>
        ) : (
          <>
            <p className="min-w-0 flex-1 text-body text-muted-foreground">{t("settings.webSignedOut")}</p>
            <Button variant="outline" onClick={() => void bridge.signInWeb()}>
              {t("settings.webSignIn")}
            </Button>
          </>
        )}
      </div>
    </Group>
  );
}

const THEMES: Array<Config["theme"]> = ["system", "light", "dark"];

/** A language by its own name, so anyone can find theirs whatever the app is in now; the system's
 *  is said in the language in use. */
const languageName = (language: Language, t: T) => (language === "en" ? "English" : language === "pt-BR" ? "Português (Brasil)" : t("settings.language.system"));

function Updates() {
  const [version, setVersion] = useState("");
  const t = useT();
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
      setState({ phase: "error", message: /release JSON|fetch|network|connect/i.test(detail) ? t("settings.noRelease") : detail });
    }
  };
  return (
    <Row
      label={version ? `Focus Diff ${version}` : "Focus Diff"}
      description={
        state.phase === "found"
          ? t("settings.versionOut", { version: state.version })
          : state.phase === "latest"
            ? t("settings.latest")
            : state.phase === "error"
              ? t("settings.checkFailed", { message: state.message ?? "" })
              : t("settings.checksOnItsOwn")
      }
    >
      {state.phase === "found" || state.phase === "installing" ? (
        <Button
          disabled={state.phase === "installing"}
          onClick={() => {
            setState({ phase: "installing" });
            void bridge.installUpdate().catch((e: unknown) => setState({ phase: "error", message: String(e) }));
          }}
        >
          {state.phase === "installing" ? <Loader2 className="animate-spin" /> : null} {t("settings.updateRestart")}
        </Button>
      ) : (
        <Button variant="outline" disabled={state.phase === "checking"} onClick={() => void check()}>
          {state.phase === "checking" ? <Loader2 className="animate-spin" /> : null} {t("settings.checkUpdates")}
        </Button>
      )}
    </Row>
  );
}

function General({ config, onChange }: { config: Config; onChange: (c: Config) => void }) {
  const t = useT();
  return (
    <Pane title={t("settings.pane.general")} hero="general">
      <Group title={t("settings.softwareUpdate")}>
        <Updates />
      </Group>
      <Group title={t("settings.behavior")}>
        <Row label={t("settings.checkEvery")} description={t("settings.checkEveryHint")}>
          <Select value={String(config.pollSeconds)} onValueChange={(v) => onChange({ ...config, pollSeconds: Number(v) })}>
            <SelectTrigger className="min-w-36" aria-label={t("settings.refreshInterval")}>
              <SelectValue>{(v: string) => interval(Number(v), t)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {[30, 60, 90, 180, 300, 600].map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {interval(s, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label={t("settings.appearance")}>
          <Select value={config.theme} onValueChange={(v) => onChange({ ...config, theme: v as Config["theme"] })}>
            <SelectTrigger className="min-w-44" aria-label={t("settings.appearance")}>
              <SelectValue>{(v: Config["theme"]) => t(`settings.theme.${v}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {THEMES.map((theme) => (
                <SelectItem key={theme} value={theme}>
                  {t(`settings.theme.${theme}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label={t("settings.language")}>
          <Select
            value={config.language}
            onValueChange={(v) => {
              const language = v as Language;
              // This window at once; Rust and the other windows follow the saved settings.
              setLanguage(language);
              onChange({ ...config, language });
            }}
          >
            <SelectTrigger className="min-w-44" aria-label={t("settings.language")}>
              <SelectValue>{(v: Language) => languageName(v, t)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((language) => (
                <SelectItem key={language} value={language} lang={language === "system" ? undefined : language}>
                  {languageName(language, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label={t("settings.sound")} htmlFor="sound">
          <Switch id="sound" size="sm" checked={config.sound} onCheckedChange={(sound) => onChange({ ...config, sound })} />
        </Row>
      </Group>
    </Pane>
  );
}

const PANE_IDS: PaneId[] = ["account", "queues", "review", "filters", "actions", "ai", "general"];

/** The panes in the sidebar under the account, in order. */
const PANES = (["queues", "review", "filters", "actions", "ai", "general"] as const).map((value) => ({ value, ...PANE_META[value] }));

/** A pane's search words in the language in use, and in English too, so a setting is found by
 *  either name. */
function keywords(pane: PaneId, t: T): string[] {
  const own = t(`settings.keywords.${pane}`).split("|");
  const english = t.locale === "en" ? [] : translator("en")(`settings.keywords.${pane}`).split("|");
  return [...own, ...english, ...(pane === "ai" ? Object.values(PROVIDERS).map((p) => p.name) : [])];
}

/** For matching: lower case, accents off, so "notificacoes" finds "Notificações". */
const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** What a search finds in a pane: nothing (null), its name, or the first setting that matches. */
function match(query: string, label: string, words: string[]): { hint?: string } | null {
  const q = fold(query.trim());
  if (!q) return {};
  if (fold(label).includes(q)) return {};
  const hit = words.find((k) => fold(k).includes(q));
  return hit ? { hint: hit } : null;
}

/** The panes a search finds, with the setting (or queue, action, filter, prompt by name) that matched. */
function findPanes(query: string, config: Config, auth: AuthStatus | null, t: T) {
  const names = (list: Array<{ name: string }>) => list.map((x) => x.name).filter(Boolean);
  const own: Partial<Record<PaneId, string[]>> = {
    queues: names(config.queues),
    review: names(config.reviewTime.sessions),
    actions: names(config.actions),
    filters: names(config.filters),
    ai: names(config.ai.prompts),
  };
  const accountMatch = match(query, auth?.login ?? t("settings.pane.account"), keywords("account", t));
  const panes = PANES.map((p) => ({ ...p, label: t(`settings.pane.${p.value}`), found: match(query, t(`settings.pane.${p.value}`), [...(own[p.value] ?? []), ...keywords(p.value, t)]) })).filter(
    (p) => p.found,
  );
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

// A row of the glass sidebar, as Tahoe's (and Raycast's): the open pane on a soft rounded highlight
// that keeps the text's own colour, a touch firmer while the list has the keyboard; the focus ring
// only for the keyboard.
const sidebarItem = cn(
  "group/item flex w-full cursor-default items-center gap-2.5 rounded-[9px] px-2 text-left text-body outline-none focus-ring-inset",
  "data-[active]:bg-(--settings-selected) group-focus-within/list:data-[active]:bg-(--settings-selected-focus)",
);

function Sidebar({ config, auth, query, setQuery }: { config: Config; auth: AuthStatus | null; query: string; setQuery: (q: string) => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const t = useT();
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

  const { accountMatch, panes } = findPanes(query, config, auth, t);
  const nothing = !accountMatch && !panes.length;

  return (
    // A pane of glass floating inset in the window, the traffic lights inside its top (they sit at
    // x 19-79, centred at y 26). What's around it is painted the content's colour by its spread
    // shadow (clipped by the column), so only the pane itself shows the material behind.
    <aside className="h-full w-[240px] shrink-0 overflow-hidden p-2">
      <div className="settings-glass flex h-full flex-col rounded-[18px]">
      <div data-tauri-drag-region className="h-11 shrink-0" />
      <div className="px-2.5 pb-3">
        {/* A search field: a capsule, with a clear button once there's something in it. */}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            ref={searchRef}
            type="search"
            aria-label={t("settings.search")}
            placeholder={t("settings.searchPlaceholder")}
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
            className="h-8 rounded-(--radius-capsule) border-0 bg-(--settings-field) pr-6 pl-7 shadow-none [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
          />
          {query ? (
            <button
              type="button"
              aria-label={t("settings.clear")}
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              className="absolute top-1/2 right-1.5 grid size-3.5 -translate-y-1/2 cursor-default place-items-center rounded-full bg-muted-foreground/60 text-background outline-none focus-ring"
            >
              <X className="size-2.5" strokeWidth={3} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
      <TabsPrimitive.List ref={listRef} activateOnFocus loopFocus={false} aria-label={t("settings.sections")} className="group/list flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
        {accountMatch ? (
          <TabsPrimitive.Tab value="account" className={cn(sidebarItem, "mb-3 h-12")}>
            <Avatar className="size-8">
              {auth?.login ? <AvatarImage src={avatarOf(auth.login)} alt="" /> : null}
              <AvatarFallback>
                <CircleUserRound className="size-5" strokeWidth={1.5} aria-hidden />
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-semibold">{auth?.signed_in && auth.login ? auth.login : t("settings.notSignedIn")}</span>
              <span className="block truncate text-subheadline text-muted-foreground">{accountMatch.hint ?? t("settings.pane.account")}</span>
            </span>
          </TabsPrimitive.Tab>
        ) : null}
        {panes.map(({ value, label, icon: Icon, tile, found }) => (
          <TabsPrimitive.Tab key={value} value={value} className={cn(sidebarItem, found?.hint ? "h-11" : "h-8")}>
            <span className="settings-tile grid size-[22px] shrink-0 place-items-center rounded-[6px] text-white" data-tile={tile} aria-hidden>
              <Icon className="size-3.5" strokeWidth={2.25} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{label}</span>
              {found?.hint ? <span className="block truncate text-subheadline text-muted-foreground">{found.hint}</span> : null}
            </span>
          </TabsPrimitive.Tab>
        ))}
        {nothing ? (
          <p className="px-2 py-6 text-center text-callout text-muted-foreground" role="status">
            {t("settings.noMatch", { query: query.trim() })}
          </p>
        ) : null}
      </TabsPrimitive.List>
      </div>
    </aside>
  );
}

export function Settings() {
  const [config, setConfig] = useConfig();
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [pane, setPane] = useState<PaneId>(rememberedPane);
  const [query, setQuery] = useState("");
  const t = useT();
  const loadAuth = useCallback(() => void bridge.authStatus().then(setAuth), []);
  useEffect(loadAuth, [loadAuth]);
  useTheme(config?.theme);
  // Another window sending the person here for something (the AI's setup, say).
  useEffect(() => {
    const off = bridge.on<PaneId>("settings-pane", (p) => PANE_IDS.includes(p) && setPane(p));
    return () => void off.then((stop) => stop());
  }, []);
  // The window is titled after the pane, as Mac settings windows are (Window menu, Mission Control).
  useEffect(() => {
    document.title = t(`settings.pane.${pane}`);
    try {
      localStorage.setItem(PANE_KEY, pane);
    } catch {
      /* not remembered */
    }
  }, [pane, t]);

  // Searching shows the first pane that matches, as System Settings does, unless the one open still does.
  const search = (q: string) => {
    setQuery(q);
    if (!config || !q.trim()) return;
    const { accountMatch, panes } = findPanes(q, config, auth, t);
    const hits: PaneId[] = [...(accountMatch ? ["account" as const] : []), ...panes.map((p) => p.value)];
    if (hits.length && !hits.includes(pane)) setPane(hits[0]!);
  };

  if (!config)
    return (
      <div className="flex h-full">
        <div className="h-full w-[240px] shrink-0 overflow-hidden p-2">
          <div data-tauri-drag-region className="settings-glass h-full rounded-[18px]" />
        </div>
        <div data-tauri-drag-region className="h-full flex-1 bg-(--settings-content)" />
      </div>
    );
  return (
    <TabsPrimitive.Root value={pane} onValueChange={(v: PaneId) => setPane(v)} orientation="vertical" className="flex h-full text-body">
      <Sidebar config={config} auth={auth} query={query} setQuery={search} />
      <main className="min-w-0 flex-1 bg-(--settings-content)">
        <TabsPrimitive.Panel value="queues" className="h-full outline-none">
          <Queues config={config} onChange={setConfig} />
        </TabsPrimitive.Panel>
        <TabsPrimitive.Panel value="review" className="h-full outline-none">
          <ReviewTimePane config={config} onChange={setConfig} />
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
