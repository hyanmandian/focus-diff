// An answer from the AI, shown as text (never as HTML): paragraphs, "- " points as a list, and
// `code` and **bold** as such.

import { Fragment } from "react";

function inline(text: string) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
      <code key={i} className="rounded bg-muted px-1 font-mono text-[0.92em]">
        {part.slice(1, -1)}
      </code>
    ) : part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

export function AiAnswer({ text }: { text: string }) {
  const blocks: Array<{ list: boolean; lines: string[] }> = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      blocks.push({ list: false, lines: [] });
      continue;
    }
    const point = /^[-*•]\s+/.test(line);
    const last = blocks.at(-1);
    if (last && last.list === point && (point || last.lines.length)) last.lines.push(line.replace(/^[-*•]\s+/, ""));
    else blocks.push({ list: point, lines: [line.replace(/^[-*•]\s+/, "")] });
  }
  return (
    <div className="selectable flex flex-col gap-2 text-body leading-(--type-reading-leading)">
      {blocks
        .filter((b) => b.lines.length)
        .map((b, i) =>
          b.list ? (
            <ul key={i} className="list-disc pl-5">
              {b.lines.map((l, j) => (
                <li key={j}>{inline(l)}</li>
              ))}
            </ul>
          ) : (
            <p key={i}>{inline(b.lines.join(" "))}</p>
          ),
        )}
    </div>
  );
}
