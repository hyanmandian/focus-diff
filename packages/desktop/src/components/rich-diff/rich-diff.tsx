import { FileWarning, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/button/button";
import { Checkbox } from "@/components/checkbox/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/toggle-group/toggle-group";
import { cn } from "@/utils/cn/cn";
import { fileAt, type Source } from "@/utils/contents/contents";
import { useT } from "@/utils/i18n/i18n";
import type { ReviewFile } from "@/utils/review/review";

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

const extension = (path: string) => path.slice(path.lastIndexOf(".") + 1).toLowerCase();
export const isImage = (path: string) => extension(path) in IMAGE_TYPES;

const dir = (p: string) => p.slice(0, p.lastIndexOf("/") + 1);
const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);

export function renamed(file: Pick<ReviewFile, "path" | "previousPath">, short = false) {
  if (!file.previousPath || file.previousPath === file.path) return null;
  if (dir(file.previousPath) === dir(file.path)) return base(file.previousPath);
  return short && base(file.previousPath) !== base(file.path) ? base(file.previousPath) : file.previousPath;
}

const MODES = ["two-up", "swipe", "onion"] as const;
type Mode = (typeof MODES)[number];
const MODE = "image-diff-mode";

function storedMode(): Mode {
  try {
    const mode = localStorage.getItem(MODE);
    return mode === "swipe" || mode === "onion" ? mode : "two-up";
  } catch {
    return "two-up";
  }
}

type Picture = { url: string; bytes: number };

function usePicture(source: Source | null, file: ReviewFile, side: "old" | "new"): Picture | null | "loading" | Error {
  const [loaded, setLoaded] = useState<{ source: Source; file: ReviewFile; picture: Picture | null | Error } | null>(
    null,
  );
  const none = (side === "old" && file.status === "added") || (side === "new" && file.status === "removed");
  useEffect(() => {
    let url: string | null = null;
    let live = true;
    const load = async (from: Source) => {
      try {
        const sha = side === "old" ? await from.base() : from.head;
        const bytes = await fileAt(from.repo, sha, side === "old" ? (file.previousPath ?? file.path) : file.path);
        if (!live) return;
        if (bytes) url = URL.createObjectURL(new Blob([bytes.slice()], { type: IMAGE_TYPES[extension(file.path)] }));
        setLoaded({ source: from, file, picture: bytes && url ? { url, bytes: bytes.length } : null });
      } catch (e) {
        if (live) setLoaded({ source: from, file, picture: e instanceof Error ? e : new Error(String(e)) });
      }
    };
    if (source && !none) void load(source);
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, file, side, none]);
  if (!source || none) return null;
  return loaded?.source === source && loaded.file === file ? loaded.picture : "loading";
}

const bytesText = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

const CHECKERS =
  "bg-[length:16px_16px] bg-[conic-gradient(var(--fill-control)_25%,transparent_0_50%,var(--fill-control)_0_75%,transparent_0)]";

function Figure({
  label,
  picture,
  tone,
}: {
  label: string;
  picture: { url: string; bytes: number };
  tone: "old" | "new";
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  return (
    <figure className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
      <figcaption className={cn("text-callout font-medium", tone === "old" ? "text-destructive" : "text-success")}>
        {label}
      </figcaption>
      <div
        className={cn(
          "grid max-w-full place-items-center rounded-md border p-1",
          tone === "old" ? "border-destructive/50" : "border-success/50",
          CHECKERS,
        )}
      >
        <img
          src={picture.url}
          alt={label}
          className="max-h-[60vh] max-w-full object-contain"
          onLoad={(e) => {
            setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight });
          }}
        />
      </div>
      <p className="text-subheadline text-muted-foreground tabular-nums">
        {[size ? `${size.w} × ${size.h}` : null, bytesText(picture.bytes)].filter(Boolean).join(" · ")}
      </p>
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
      <output className="flex items-center gap-2 text-body text-muted-foreground">
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> {t("diff.loading")}
      </output>
    );
  const failed = (e: Error) => (
    <p className="text-body text-destructive">{t("diff.loadFailed", { error: e.message })}</p>
  );
  if (before instanceof Error) return failed(before);
  if (after instanceof Error) return failed(after);
  const old = before;
  const fresh = after;
  if (!old || !fresh) {
    const only = old ?? fresh;
    return only ? (
      <Figure label={old ? t("diff.deleted") : t("diff.added")} picture={only} tone={old ? "old" : "new"} />
    ) : null;
  }
  const choose = (next: Mode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE, next);
    } catch {}
  };
  return (
    <div className="flex flex-col items-center gap-3">
      <ToggleGroup
        value={[mode]}
        onValueChange={(v: string[]) => {
          const next = MODES.find((m) => m === v[0]);
          if (next) choose(next);
        }}
        variant="outline"
        size="sm"
        aria-label={t("diff.compare")}
      >
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
          <div
            className={cn("relative grid max-w-full place-items-center overflow-hidden rounded-md border", CHECKERS)}
          >
            <img
              src={old.url}
              alt={t("diff.before")}
              className="col-start-1 row-start-1 max-h-[60vh] max-w-full object-contain"
            />
            <img
              src={fresh.url}
              alt={t("diff.after")}
              className="col-start-1 row-start-1 max-h-[60vh] max-w-full object-contain"
              style={mode === "swipe" ? { clipPath: `inset(0 0 0 ${amount}%)` } : { opacity: amount / 100 }}
            />
            {mode === "swipe" ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 w-px bg-primary"
                style={{ left: `${amount}%` }}
              />
            ) : null}
          </div>
          <label className="flex w-72 max-w-full items-center gap-2 text-callout text-muted-foreground">
            <span className="text-destructive">{t("diff.before")}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={amount}
              onChange={(e) => {
                setAmount(Number(e.target.value));
              }}
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
  onLoad?: () => void;
}) {
  const t = useT();
  const old = renamed(file);
  const pureRename = file.status === "renamed" && !file.additions && !file.deletions;
  return (
    <section
      id={`file-${file.path}`}
      aria-label={file.path}
      className="overflow-hidden rounded-lg border bg-background font-sans"
    >
      <header className="flex h-(--row-h) items-center gap-2 border-b bg-muted/40 px-3 text-body">
        <span
          className="min-w-0 flex-1 truncate font-mono text-callout"
          title={old ? `${file.previousPath} → ${file.path}` : file.path}
        >
          {old ? <span className="text-muted-foreground">{old} → </span> : null}
          {file.path}
        </span>
        <label className="flex shrink-0 items-center gap-1.5 px-1.5 py-1 select-none">
          <Checkbox
            checked={viewed}
            onCheckedChange={onViewed}
            aria-label={t("review.viewedFile", { path: file.path })}
            className="size-3.5"
          />
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
            {source && onLoad ? (
              <Button variant="outline" onClick={onLoad} disabled={loading}>
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
