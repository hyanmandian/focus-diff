// A Markdown file shown rendered, as GitHub shows a rich diff of prose: the file as it reads at the
// head commit (the base's, for a deleted one), rendered by GitHub itself (the contents API's HTML)
// and cleaned like every other HTML from it (sanitize.ts).

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { openClicked } from "@/components/comment-html/comment-html";
import { github } from "@/utils/bridge/bridge";
import type { Source } from "@/utils/contents/contents";
import { useDiagrams } from "@/utils/diagrams/diagrams";
import { useT } from "@/utils/i18n/i18n";
import type { ReviewFile } from "@/utils/review/review";
import { sanitize } from "@/utils/sanitize/sanitize";

const rendered = new Map<string, Promise<string>>();

/** GitHub's HTML of a file at a commit, asked for once (the commit never changes). */
function renderedAt(repo: string, sha: string, path: string) {
  const key = `${repo}\n${sha}\n${path}`;
  let known = rendered.get(key);
  if (!known) {
    known = github<string>(
      "GET",
      `/repos/${repo}/contents/${path
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/")}?ref=${sha}`,
      undefined,
      "application/vnd.github.html+json",
    );
    known.catch(() => rendered.delete(key));
    rendered.set(key, known);
  }
  return known;
}

export const isMarkdown = (path: string) => /\.(md|markdown|mdx)$/iu.test(path);

export function Rendered({ file, source }: { file: ReviewFile; source: Source }) {
  const t = useT();
  // What was loaded, and for which file: anything else (the first render, or after the file
  // changed) shows as loading.
  const [loaded, setLoaded] = useState<{ file: ReviewFile; source: Source; html: string | Error } | null>(null);
  const html = loaded?.file === file && loaded.source === source ? loaded.html : null;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const removed = file.status === "removed";
        const sha = removed ? await source.base() : source.head;
        const text = await renderedAt(source.repo, sha, removed ? (file.previousPath ?? file.path) : file.path);
        if (live) setLoaded({ file, source, html: sanitize(text) });
      } catch (e) {
        if (live) setLoaded({ file, source, html: e instanceof Error ? e : new Error(String(e)) });
      }
    })();
    return () => {
      live = false;
    };
  }, [file, source]);
  useDiagrams(ref, typeof html === "string" ? html : "");
  if (html === null)
    return (
      <output className="flex items-center gap-2 px-4 py-3 font-sans text-body text-muted-foreground">
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> {t("diff.loading")}
      </output>
    );
  if (html instanceof Error)
    return (
      <p className="px-4 py-3 font-sans text-body text-destructive">{t("diff.loadFailed", { error: html.message })}</p>
    );
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- only catches clicks bubbling from the links inside, which the keyboard reaches and activates itself.
    <div
      ref={ref}
      className={
        // Prose to read, as the Overview shows a description.
        "selectable max-w-3xl px-5 py-4 font-sans text-body leading-(--type-reading-leading) break-words text-foreground " +
        "[&_a]:text-link [&_a]:underline [&_a]:decoration-link/40 [&_a]:underline-offset-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground " +
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-callout [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
        "[&_h1]:my-3 [&_h1]:text-title2 [&_h1]:font-semibold [&_h2]:my-3 [&_h2]:text-title3 [&_h2]:font-semibold [&_h3]:my-2 [&_h3]:font-semibold [&_img]:max-w-full [&_img]:rounded-md [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 " +
        "[&_table]:block [&_table]:overflow-x-auto [&_td]:border [&_td]:px-2 [&_th]:border [&_th]:px-2"
      }
      onClick={openClicked}
      // Sanitized above: an allowlist of tags and attributes, https links and GitHub images only.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
