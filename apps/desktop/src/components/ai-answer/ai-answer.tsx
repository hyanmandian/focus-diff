// An answer from the AI, shown as text (never as HTML): paragraphs, "- " points as a list, and
// `code` and **bold** as such.

import { Fragment } from "react";

const POINT = /^[-*•]\s+/u;

/** Each part keyed by where it starts in the line, which is unique and never moves. */
function inline(text: string) {
  let at = 0;
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/gu).map((part) => {
    const key = at;
    at += part.length;
    return part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
      <code key={key} className="rounded bg-muted px-1 font-mono text-[0.92em]">
        {part.slice(1, -1)}
      </code>
    ) : part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={key}>{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={key}>{part}</Fragment>
    );
  });
}

type Line = { at: number; text: string };

export function AiAnswer({ text }: { text: string }) {
  // Blocks and their lines are keyed by the line of the answer they start on.
  const blocks: Array<{ at: number; list: boolean; lines: Line[] }> = [];
  for (const [at, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (!line) {
      blocks.push({ at, list: false, lines: [] });
      continue;
    }
    const point = POINT.test(line);
    const last = blocks.at(-1);
    const next = { at, text: line.replace(POINT, "") };
    if (last && last.list === point && (point || last.lines.length > 0)) last.lines.push(next);
    else blocks.push({ at, list: point, lines: [next] });
  }
  return (
    <div className="selectable flex flex-col gap-2 text-body leading-(--type-reading-leading)">
      {blocks
        .filter((b) => b.lines.length > 0)
        .map((b) =>
          b.list ? (
            <ul key={b.at} className="list-disc pl-5">
              {b.lines.map((l) => (
                <li key={l.at}>{inline(l.text)}</li>
              ))}
            </ul>
          ) : (
            <p key={b.at}>{inline(b.lines.map((l) => l.text).join(" "))}</p>
          ),
        )}
    </div>
  );
}
