// GitHub's HTML for a comment, cleaned (utils/sanitize/sanitize.ts): links open in the browser, pictures in the
// viewer, diagrams drawn, suggested changes as a small diff (suggestion.css).

import { useRef } from "react";
import { bridge } from "@/utils/bridge/bridge";
import { useDiagrams } from "@/utils/diagrams/diagrams";
import { leadsElsewhere, sanitize } from "@/utils/sanitize/sanitize";
import { cn } from "@/utils/cn/cn";
import { openViewer } from "@/components/viewer/viewer";
import "@/components/suggestion/suggestion.css";

/** `base`: the lines a previewed suggestion replaces. */
export function CommentHtml({ html, base, className }: { html: string; base?: string[]; className?: string }) {
  const clean = sanitize(html, base);
  const ref = useRef<HTMLDivElement>(null);
  useDiagrams(ref, clean);
  return (
    <div
      ref={ref}
      className={cn(
        "selectable text-body leading-(--type-reading-leading) break-words [&_img]:max-w-full [&_img]:cursor-zoom-in [&_img]:rounded-md [&_video]:my-2 [&_video]:max-h-[60vh] [&_video]:max-w-full [&_video]:rounded-lg [&_a]:text-link [&_a]:underline [&_a]:decoration-link/40 [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-callout [&_p]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        className,
      )}
      onClick={(e) => {
        // A picture opens in the viewer (even one GitHub wrapped in a link to itself).
        const picture = (e.target as Element).closest("img");
        if (picture && !leadsElsewhere(picture)) {
          e.preventDefault();
          openViewer({ src: picture.src, alt: picture.alt });
          return;
        }
        const link = (e.target as Element).closest("a[href]");
        if (link) {
          e.preventDefault();
          void bridge.openUrl((link as HTMLAnchorElement).href);
        }
      }}
      // Sanitized: an allowlist of tags and attributes, https links and GitHub images only.
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
