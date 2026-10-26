// What a patch can't show, for the files GitHub sends none for: pictures, compared the ways GitHub
// does (side by side, a swipe between them, one faded over the other), and files too large for
// its diff, offered to load from both versions. A file renamed without changes says so.

import { FileWarning, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fileAt, type Source } from "@/lib/contents";
import { useT } from "@/lib/i18n";
import type { ReviewFile } from "@/lib/review";
import { cn } from "@/lib/utils";

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  // Shown in an <img>, where an SVG's scripts never run.
  svg: "image/svg+xml",
};

const extension = (path: string) => path.slice(path.lastIndexOf(".") + 1).toLowerCase();
export const isImage = (path: string) => extension(path) in IMAGE_TYPES;

/** What a renamed file was called, for "old → new": the old name alone when only the name changed
 *  (or `short`, in the tree, where the folders say where it is), the old path when it moved. */
export function renamed(file: Pick<ReviewFile, "path" | "previousPath">, short = false) {
  if (!file.previousPath || file.previousPath === file.path) return null;
  const dir = (p: string) => p.slice(0, p.lastIndexOf("/") + 1);
  const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
  if (dir(file.previousPath) === dir(file.path)) return base(file.previousPath);
  return short && base(file.previousPath) !== base(file.path) ? base(file.previousPath) : file.previousPath;
}

type Mode = "two-up" | "swipe" | "onion";
const MODE = "image-diff-mode";

function storedMode(): Mode {
  try {
    const mode = localStorage.getItem(MODE);
    return mode === "swipe" || mode === "onion" ? mode : "two-up";
  } catch {
    return "two-up";
  }
}

/** A picture at a commit, as a URL the page can show; let go when it's no longer shown. */
function usePicture(source: Source | null, file: ReviewFile, side: "old" | "new") {
  const [state, setState] = useState<{ url: string; bytes: number } | null | "loading" | Error>("loading");
  useEffect(() => {
    if (!source || (side === "old" && file.status === "added") || (side === "new" && file.status === "removed")) {
      setState(null);
      return;
    }
    let url: string | null = null;
    let live = true;
    void (async () => {
      try {
        const sha = side === "old" ? await source.base() : source.head;
        const bytes = await fileAt(source.repo, sha, side === "old" ? (file.previousPath ?? file.path) : file.path);
        if (!live) return;
        if (!bytes) {
          setState(null);
          return;
        }
        url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: IMAGE_TYPES[extension(file.path)] }));
        setState({ url, bytes: bytes.length });
      } catch (e) {
        if (live) setState(e instanceof Error ? e : new Error(String(e)));
      }
    })();
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, file, side]);
  return state;
}

const bytesText = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

// Transparent parts show over a checkerboard, as in Preview, in either appearance.
const CHECKERS = "bg-[length:16px_16px] bg-[conic-gradient(var(--fill-control)_25%,transparent_0_50%,var(--fill-control)_0_75%,transparent_0)]";

function Figure({ label, picture, tone }: { label: string; picture: { url: string; bytes: number }; tone: "old" | "new" }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  return (
    <figure className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
      <figcaption className={cn("text-callout font-medium", tone === "old" ? "text-destructive" : "text-success")}>{label}</figcaption>
      <div className={cn("grid max-w-full place-items-center rounded-md border p-1", tone === "old" ? "border-destructive/50" : "border-success/50", CHECKERS)}>
        <img src={picture.url} alt={label} className="max-h-[60vh] max-w-full object-contain" onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
      </div>
      <p className="text-subheadline text-muted-foreground tabular-nums">{[size ? `${size.w} × ${size.h}` : null, bytesText(picture.bytes)].filter(Boolean).join(" · ")}</p>
    </figure>
  );
}

export function ImageDiff({ file, source }: { file: ReviewFile; source: Source | null }) {
  const t = useT();
  const before = usePicture(source, file, "old");
  const after = usePicture(source, file, "new");
  const [mode, setMode] = useState<Mode>(storedMode);
  const [amount, setAmount] = useState(50);
  if (before === "loading" || after === "loading")
    return (
      <p className="flex items-center gap-2 text-body text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> {t("diff.loading")}
      </p>
    );
  const failed = [before, after].find((p): p is Error => p instanceof Error);
  if (failed) return <p className="text-body text-destructive">{t("diff.loadFailed", { error: failed.message })}</p>;
  const old = before as { url: string; bytes: number } | null;
  const fresh = after as { url: string; bytes: number } | null;
  if (!old || !fresh) {
    // Only one side: added or deleted.
    const only = old ?? fresh;
    return only ? <Figure label={old ? t("diff.deleted") : t("diff.added")} picture={only} tone={old ? "old" : "new"} /> : null;
  }
  const choose = (next: Mode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE, next);
    } catch {
      // Still works for this window.
    }
  };
  return (
    <div className="flex flex-col items-center gap-3">
      <ToggleGroup value={[mode]} onValueChange={(v: string[]) => v[0] && choose(v[0] as Mode)} variant="outline" size="sm" aria-label={t("diff.compare")}>
        <ToggleGroupItem value="two-up">{t("diff.twoUp")}</ToggleGroupItem>
        <ToggleGroupItem value="swipe">{t("diff.swipe")}</ToggleGroupItem>
        <ToggleGroupItem value="onion">{t("diff.onion")}</ToggleGroupItem>
      </ToggleGroup>
      {mode === "two-up" ? (
        <div className="flex w-full items-start justify-center gap-4">
          <Figure label={t("diff.before")} picture={old} tone="old" />
          <Figure label={t("diff.after")} picture={fresh} tone="new" />
        </div>
      ) : (
        <>
          {/* Both in one box: the new one over the old, cut off at the slider (swipe) or faded by it. */}
          <div className={cn("relative grid max-w-full place-items-center overflow-hidden rounded-md border", CHECKERS)}>
            <img src={old.url} alt={t("diff.before")} className="col-start-1 row-start-1 max-h-[60vh] max-w-full object-contain" />
            <img
              src={fresh.url}
              alt={t("diff.after")}
              className="col-start-1 row-start-1 max-h-[60vh] max-w-full object-contain"
              style={mode === "swipe" ? { clipPath: `inset(0 0 0 ${amount}%)` } : { opacity: amount / 100 }}
            />
            {mode === "swipe" ? <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-primary" style={{ left: `${amount}%` }} /> : null}
          </div>
          <label className="flex w-72 max-w-full items-center gap-2 text-callout text-muted-foreground">
            <span className="text-destructive">{t("diff.before")}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              aria-label={mode === "swipe" ? t("diff.swipePosition") : t("diff.opacity")}
              className="flex-1 accent-(--accent)"
            />
            <span className="text-success">{t("diff.after")}</span>
          </label>
        </>
      )}
    </div>
  );
}

/** A file GitHub sends no diff for, as a card after the others: its name, Viewed, and what can be
 *  shown of it. `onLoad`: shows its diff from both versions, in the list with the rest. */
export function NoPatchFile({
  file,
  source,
  viewed,
  loading,
  error,
  onViewed,
  onLoad,
}: {
  file: ReviewFile;
  source: Source | null;
  viewed: boolean;
  loading: boolean;
  error: string | null;
  onViewed: (viewed: boolean) => void;
  onLoad: () => void;
}) {
  const t = useT();
  const old = renamed(file);
  const pureRename = file.status === "renamed" && !file.additions && !file.deletions;
  return (
    <section id={`file-${file.path}`} aria-label={file.path} className="overflow-hidden rounded-lg border bg-background font-sans">
      <header className="flex h-(--row-h) items-center gap-2 border-b bg-muted/40 px-3 text-body">
        <span className="min-w-0 flex-1 truncate font-mono text-callout" title={old ? `${file.previousPath} → ${file.path}` : file.path}>
          {old ? <span className="text-muted-foreground">{old} → </span> : null}
          {file.path}
        </span>
        <label className="flex shrink-0 items-center gap-1.5 px-1.5 py-1 select-none">
          <Checkbox checked={viewed} onCheckedChange={onViewed} aria-label={t("review.viewedFile", { path: file.path })} className="size-3.5" />
          {t("review.viewed")}
        </label>
      </header>
      <div className="p-4">
        {pureRename ? (
          <p className="text-body text-muted-foreground">{t("diff.renamedOnly")}</p>
        ) : isImage(file.path) ? (
          <ImageDiff file={file} source={source} />
        ) : (
          <div className="flex flex-col items-center gap-2 py-2 text-center">
            <p className="flex items-center gap-2 text-body text-muted-foreground">
              <FileWarning className="size-4" aria-hidden /> {error ?? t("diff.tooLarge")}
            </p>
            {source && !error ? (
              <Button variant="outline" size="sm" onClick={onLoad} disabled={loading}>
                {loading ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}
                {t("diff.loadDiff")}
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
