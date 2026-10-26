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
import { FILTER_RECIPES, isRepoPattern, newId, validPattern, type Config, type DiffFilter } from "@/lib/config";
import { addImported, exportFilters, importFilters } from "@/lib/filters";

const repoError = (v: string) => (isRepoPattern(v) ? null : "Use owner/name, or owner/* for all of an owner's repositories");
const count = (n: number) => `${n} ${n === 1 ? "filter" : "filters"}`;

function Pattern({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  const valid = validPattern(value);
  const id = useId();
  return (
    <Row label={label} htmlFor={id} description={!valid ? <span className="text-destructive">Not a valid regular expression.</span> : undefined}>
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

  const doImport = () => {
    const imported = importFilters(text);
    if (!imported?.length) return setError(imported ? "That text has no filters in it. Ask for them to be copied again." : "That isn't a copied set of filters. Paste exactly what Copy Filters gave.");
    const { filters: next, added, skipped } = addImported(filters, imported);
    onImport(next);
    setText("");
    setError(null);
    setDone(
      added ? `Added ${count(added)}.${skipped ? ` ${count(skipped)} didn't fit: the app keeps 12.` : ""}` : skipped ? `No room: the app keeps 12 filters.` : "You already have all of them.",
    );
  };

  return (
    <Group title="Share" footer="The same text as Focus Diff in the browser, so filters move between the two either way. Imported filters are added to yours; ones you already have are skipped.">
      <Row label="Copy your filters" description="To send to a teammate, or paste into Focus Diff's settings.">
        <Button
          variant="outline"
          disabled={!filters.length}
          onClick={() =>
            void navigator.clipboard.writeText(exportFilters(filters)).then(
              () => setCopied(true),
              () => setDone("Couldn't reach the clipboard."),
            )
          }
          onBlur={() => setCopied(false)}
        >
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy Filters"}
        </Button>
      </Row>
      <Row stacked label="Import filters" htmlFor={id}>
        <Textarea
          id={id}
          rows={3}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
            setDone(null);
          }}
          placeholder="Paste what a teammate, or Focus Diff, copied"
          spellCheck={false}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className="resize-y font-mono text-callout"
        />
        <div className="flex items-center gap-3">
          <Button variant="outline" disabled={!text.trim()} onClick={doImport}>
            Import
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
  const add = (list: Array<Omit<DiffFilter, "id" | "repos">>) => set([...filters, ...list.map((f) => ({ ...f, id: newId(), repos: [] }))].slice(0, 12));

  return (
    <Pane title="Filters">
      <Intro>
        Review one part of a pull request at a time. Each filter keeps the files whose path matches what to include and not what to leave out (regular expressions; empty includes
        everything). They're chips at the bottom of the review window: turn on several to see them together.
      </Intro>
      {filters.map((f, i) => (
        <Group key={f.id}>
          <Row className="gap-1">
            <Input aria-label="Filter name" className="max-w-52" maxLength={24} value={f.name} onChange={(e) => update(f.id, { name: e.target.value })} />
            <div className="ml-auto flex">
              <Button variant="ghost" size="icon-xs" aria-label={`Move ${f.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp />
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label={`Move ${f.name} down`} disabled={i === filters.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown />
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label={`Remove ${f.name}`} onClick={() => set(filters.filter((x) => x.id !== f.id))}>
                <Trash2 />
              </Button>
            </div>
          </Row>
          <Pattern label="Include" value={f.include} onChange={(include) => update(f.id, { include })} placeholder="\.(tsx?|css)$" />
          <Pattern label="Leave out" value={f.exclude} onChange={(exclude) => update(f.id, { exclude })} placeholder="\.test\." />
          <Row stacked label="Only in" description={f.repos.length ? undefined : "Every repository. Add owner/name, or owner/* for all of an owner's, to offer it only there."}>
            <TagInput label={`Repositories for ${f.name}`} value={f.repos} onChange={(repos) => update(f.id, { repos })} placeholder="acme/web or acme/*" validate={repoError} />
          </Row>
        </Group>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" className="self-start" disabled={filters.length >= 12} />}>
          <Plus /> Add Filter
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          {FILTER_RECIPES.map((recipe) => (
            <DropdownMenuItem key={recipe.title} onClick={() => add(recipe.filters)} className={TWO_LINE_ITEM}>
              <span>{recipe.title}</span>
              <span className="text-subheadline text-muted-foreground">{recipe.description}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => add([{ name: "New filter", include: "", exclude: "" }])}>Blank</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Share filters={filters} onImport={set} />
    </Pane>
  );
}
