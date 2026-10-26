// The diff's filters: parts of a pull request to review on its own, by file path, offered as chips
// in the review window, for every repository or only some. Like Focus Diff's, with its recipes as
// starting points, and shared with it (and teammates) as the same text.

import { ArrowDown, ArrowUp, Check, Copy, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Group, Intro, Pane, Row, TWO_LINE_ITEM } from "./Form";
import { TagInput } from "./TagInput";
import { filterRecipes, isRepoPattern, newId, validPattern, type Config, type DiffFilter } from "@/lib/config";
import { addImported, exportFilters, importFilters } from "@/lib/filters";
import { i18n, useT } from "@/lib/i18n";
import { confirmRemove } from "@/lib/confirm";

// Called as a repository is added, so it reads the words then.
const repoError = (v: string) => (isRepoPattern(v) ? null : i18n()("settings.repoError"));

function Pattern({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  const valid = validPattern(value);
  const id = useId();
  const t = useT();
  return (
    <Row label={label} htmlFor={id} description={!valid ? <span className="text-destructive">{t("settings.notValidRegex")}</span> : undefined}>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} aria-invalid={!valid} className="w-80 font-mono text-callout" />
    </Row>
  );
}

/** Copy the filters for a teammate (or Focus Diff in the browser), and import theirs in one step. */
function Share({ filters, onImport }: { filters: DiffFilter[]; onImport: (next: DiffFilter[]) => void }) {
  const [copied, setCopied] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const id = useId();
  const errorId = useId();
  const t = useT();

  const doImport = () => {
    const imported = importFilters(text);
    if (!imported?.length) return setError(imported ? t("settings.importEmpty") : t("settings.importInvalid"));
    const { filters: next, added, skipped } = addImported(filters, imported);
    onImport(next);
    setText("");
    setError(null);
    setDone(
      added
        ? [t("settings.added", { count: added }), skipped ? t("settings.skipped", { count: skipped }) : ""].filter(Boolean).join(" ")
        : skipped
          ? t("settings.noRoom")
          : t("settings.haveAll"),
    );
  };

  return (
    <Group title={t("settings.share")} footer={t("settings.shareFooter")}>
      <Row label={t("settings.copyYours")} description={t("settings.copyYoursHint")}>
        <Button
          variant="outline"
          disabled={!filters.length}
          onClick={() =>
            void navigator.clipboard.writeText(exportFilters(filters)).then(
              () => setCopied(true),
              () => setDone(t("settings.noClipboard")),
            )
          }
          onBlur={() => setCopied(false)}
        >
          {copied ? <Check /> : <Copy />} {copied ? t("settings.copied") : t("settings.copyFilters")}
        </Button>
      </Row>
      <Row stacked label={t("settings.importFilters")} htmlFor={id}>
        <Textarea
          id={id}
          rows={3}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
            setDone(null);
          }}
          placeholder={t("settings.importPlaceholder")}
          spellCheck={false}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className="resize-y font-mono text-callout"
        />
        <div className="flex items-center gap-3">
          <Button variant="outline" disabled={!text.trim()} onClick={doImport}>
            {t("settings.import")}
          </Button>
          {error ? (
            <p id={errorId} className="text-subheadline text-destructive" role="alert">
              {error}
            </p>
          ) : done ? (
            <p className="text-subheadline text-muted-foreground" role="status">
              {done}
            </p>
          ) : null}
        </div>
      </Row>
    </Group>
  );
}

export function Filters({ config, onChange }: { config: Config; onChange: (c: Config) => void }) {
  const filters = config.filters;
  const set = (next: DiffFilter[]) => onChange({ ...config, filters: next });
  const update = (id: string, patch: Partial<DiffFilter>) => set(filters.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const move = (index: number, by: number) => {
    const next = [...filters];
    const [f] = next.splice(index, 1);
    if (!f) return;
    next.splice(index + by, 0, f);
    set(next);
  };
  const t = useT();
  const add = (list: Array<Omit<DiffFilter, "id" | "repos">>) => set([...filters, ...list.map((f) => ({ ...f, id: newId(), repos: [] }))].slice(0, 12));

  return (
    <Pane title={t("settings.pane.filters")} hero="filters">
      <Intro>{t("settings.filtersIntro")}</Intro>
      {filters.map((f, i) => (
        <Group key={f.id}>
          <Row className="gap-1">
            <Input aria-label={t("settings.filterName")} className="max-w-52" maxLength={24} value={f.name} onChange={(e) => update(f.id, { name: e.target.value })} />
            <div className="ml-auto flex">
              <Button variant="ghost" size="icon-xs" aria-label={t("settings.moveNamedUp", { name: f.name })} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp />
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label={t("settings.moveNamedDown", { name: f.name })} disabled={i === filters.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown />
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label={t("settings.removeNamed", { name: f.name })} onClick={async () => (await confirmRemove(t("settings.removeFilterConfirm", { name: f.name }))) && set(filters.filter((x) => x.id !== f.id))}>
                <Trash2 />
              </Button>
            </div>
          </Row>
          <Pattern label={t("settings.include")} value={f.include} onChange={(include) => update(f.id, { include })} placeholder="\.(tsx?|css)$" />
          <Pattern label={t("settings.leaveOut")} value={f.exclude} onChange={(exclude) => update(f.id, { exclude })} placeholder="\.test\." />
          <Row stacked label={t("settings.onlyIn")} description={f.repos.length ? undefined : t("settings.onlyInHint")}>
            <TagInput label={t("settings.reposFor", { name: f.name })} value={f.repos} onChange={(repos) => update(f.id, { repos })} placeholder={t("settings.repoPlaceholder")} validate={repoError} />
          </Row>
        </Group>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" className="self-start" disabled={filters.length >= 12} />}>
          <Plus /> {t("settings.addFilter")}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          {filterRecipes(t).map((recipe) => (
            <DropdownMenuItem key={recipe.title} onClick={() => add(recipe.filters)} className={TWO_LINE_ITEM}>
              <span>{recipe.title}</span>
              <span className="text-subheadline text-muted-foreground">{recipe.description}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => add([{ name: t("settings.newFilter"), include: "", exclude: "" }])}>{t("settings.blank")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Share filters={filters} onImport={set} />
    </Pane>
  );
}
