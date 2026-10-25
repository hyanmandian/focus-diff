// The diff's filters: parts of a pull request to review on its own, by file path, offered as chips
// in the review window. Like Focus Diff's, with its recipes as starting points.

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { FILTER_RECIPES, newId, validPattern, type Config, type DiffFilter } from "@/lib/config";

function Pattern({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  const valid = validPattern(value);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} aria-invalid={!valid} className="h-8 font-mono text-xs" />
      {!valid ? <span className="text-xs text-destructive">Not a valid regular expression.</span> : null}
    </label>
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
  const add = (list: Array<Omit<DiffFilter, "id">>) => set([...filters, ...list.map((f) => ({ ...f, id: newId() }))].slice(0, 12));

  return (
    <div className="flex max-w-xl flex-col gap-5 p-6">
      <div>
        <h2 className="text-base font-semibold">Diff filters</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Review one part of a pull request at a time. Each filter keeps the files whose path matches what to include and not what to leave out (regular expressions; empty includes
          everything). They're chips at the bottom of the review window.
        </p>
      </div>
      {filters.map((f, i) => (
        <div key={f.id} className="flex flex-col gap-3 rounded-xl border p-3">
          <div className="flex items-center gap-1">
            <Input aria-label="Filter name" className="h-7 max-w-48 text-[13px] font-medium" maxLength={24} value={f.name} onChange={(e) => update(f.id, { name: e.target.value })} />
            <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label={`Move ${f.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label={`Move ${f.name} down`} disabled={i === filters.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label={`Remove ${f.name}`} onClick={() => set(filters.filter((x) => x.id !== f.id))}>
              <Trash2 />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Pattern label="Include" value={f.include} onChange={(include) => update(f.id, { include })} placeholder="\.(tsx?|css)$" />
            <Pattern label="Leave out" value={f.exclude} onChange={(exclude) => update(f.id, { exclude })} placeholder="\.test\." />
          </div>
        </div>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="self-start" disabled={filters.length >= 12} />}>
          <Plus /> Add a filter
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          {FILTER_RECIPES.map((recipe) => (
            <DropdownMenuItem key={recipe.title} onClick={() => add(recipe.filters)} className="flex-col items-start gap-0.5 whitespace-normal">
              <span className="font-medium">{recipe.title}</span>
              <span className="text-xs text-muted-foreground">{recipe.description}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => add([{ name: "New filter", include: "", exclude: "" }])}>Blank</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
