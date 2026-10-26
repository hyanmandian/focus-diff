// The box comments are written in, as GitHub's: Markdown, with a preview GitHub renders, @mentions
// and #references completed as you type, ⌘B ⌘I ⌘E ⌘K for bold, italic, code and links, a suggested
// change for the lines picked, and your saved replies. No formatting toolbar: the keys and the
// text are the interface. Pictures and videos pasted, dropped or picked are uploaded as github.com
// does, once you've signed in there (utils/attachments/attachments.ts).

import { CircleDot, FileDiff, GitPullRequest, Loader2, Paperclip, Reply } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/avatar/avatar";
import { Button } from "@/components/button/button";
import { CommentHtml } from "@/components/comment-html/comment-html";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu/dropdown-menu";
import { SlidingPill } from "@/components/sliding-pill/sliding-pill";
import { Textarea } from "@/components/textarea/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/tooltip/tooltip";
import { useConversationApi } from "@/hooks/use-conversation/use-conversation";
import {
  ACCEPT,
  attachable,
  displayWidth,
  markdownFor,
  swap,
  uploadMark,
  useWebSession,
} from "@/utils/attachments/attachments";
import { avatar } from "@/utils/avatar/avatar";
import { bridge, type UploadError } from "@/utils/bridge/bridge";
import { cn } from "@/utils/cn/cn";
import { useT } from "@/utils/i18n/i18n";
import { tabKeys } from "@/utils/keys/keys";
import { isMac } from "@/utils/platform/platform";
import { suggestionBlock } from "@/utils/suggestion/suggestion";
import {
  emoji,
  mentionable,
  preview,
  referable,
  savedReplies,
  type Reference,
  type SavedReply,
} from "@/utils/writer/writer";
import {
  complete,
  link,
  rankEmoji,
  rankPeople,
  tokenAt,
  wrap,
  type Change,
  type Emoji,
  type Person,
  type Token,
} from "@/utils/writing/writing";

type Option =
  | { kind: "person"; person: Person }
  | { kind: "reference"; reference: Reference }
  | { kind: "emoji"; emoji: Emoji };

/** Where the caret is drawn in a text field, measured on a copy of it laid out the same way. */
function caretAt(field: HTMLTextAreaElement, index: number) {
  const style = getComputedStyle(field);
  const copy = document.createElement("div");
  for (const p of [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "letterSpacing",
    "lineHeight",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "borderStyle",
    "boxSizing",
    "width",
    "tabSize",
  ] as const)
    copy.style[p] = style[p];
  copy.style.position = "absolute";
  copy.style.visibility = "hidden";
  copy.style.whiteSpace = "pre-wrap";
  copy.style.overflowWrap = "break-word";
  copy.textContent = field.value.slice(0, index);
  const mark = document.createElement("span");
  mark.textContent = "​";
  copy.append(mark);
  document.body.append(copy);
  const at = { top: mark.offsetTop - field.scrollTop, left: mark.offsetLeft, height: mark.offsetHeight };
  copy.remove();
  return at;
}

/** Your saved replies on GitHub, to start from. */
function SavedReplies({ onPick }: { onPick: (body: string) => void }) {
  const t = useT();
  const [replies, setReplies] = useState<SavedReply[] | null | undefined>();
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open && replies === undefined) void savedReplies().then(setReplies);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground"
                  aria-label={t("review.savedReplies")}
                />
              }
            />
          }
        >
          <Reply />
        </TooltipTrigger>
        <TooltipContent>{t("review.savedReplies")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("review.savedReplies")}</DropdownMenuLabel>
          {replies === undefined ? (
            <DropdownMenuItem disabled>
              <Loader2 className="animate-spin" /> {t("review.loading")}
            </DropdownMenuItem>
          ) : replies === null ? (
            <p className="max-w-64 px-2.5 py-1 text-callout whitespace-normal text-muted-foreground">
              {t("review.savedRepliesPermission")}
            </p>
          ) : replies.length > 0 ? (
            replies.map((r) => (
              <DropdownMenuItem
                key={r.id}
                onClick={() => {
                  onPick(r.body);
                }}
              >
                <span className="max-w-64 truncate">{r.title}</span>
              </DropdownMenuItem>
            ))
          ) : (
            <p className="max-w-64 px-2.5 py-1 text-callout whitespace-normal text-muted-foreground">
              {t("review.noSavedReplies")}
            </p>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MarkdownField({
  value,
  onChange,
  label,
  placeholder,
  rows = 3,
  onSubmit,
  onCancel,
  suggestion,
  base,
  autoFocus = true,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  rows?: number;
  /** ⌘/Ctrl+Enter. */
  onSubmit: () => void;
  /** Esc. */
  onCancel: () => void;
  /** The lines a comment is on, offered as a suggested change; null when there can't be one. */
  suggestion?: string[] | null;
  /** The lines a suggestion in it replaces, for the preview. */
  base?: string[];
  autoFocus?: boolean;
}) {
  const t = useT();
  const api = useConversationApi();
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [rendered, setRendered] = useState<{ text: string; html: string | null; error?: string } | null>(null);
  const [token, setToken] = useState<Token | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [active, setActive] = useState(0);
  // Where the caret is, and the field's width, for the list of completions under it.
  const [at, setAt] = useState({ top: 0, left: 0, height: 0, width: 288 });
  // Under the field: why an attachment didn't go, or that github.com needs signing in to first.
  const [message, setMessage] = useState<{ kind: "sign-in" | "ended" } | { kind: "error"; text: string } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const session = useWebSession();
  // The text as it is now, for uploads that finish after it changed.
  const latest = useRef(value);
  useLayoutEffect(() => {
    latest.current = value;
  });
  const asked = useRef(0);
  const number = Number(/\/pull\/(\d+)/u.exec(api?.url ?? "")?.[1]) || null;

  // Signed in on github.com: what asked for it goes.
  const [sessionSeen, setSessionSeen] = useState(session);
  if (session !== sessionSeen) {
    setSessionSeen(session);
    if (session) setMessage((m) => (m?.kind === "error" ? m : null));
  }

  useEffect(() => {
    if (autoFocus) field.current?.focus();
  }, [autoFocus]);

  // The preview, when it's showing: GitHub renders it (kept per text, utils/writer/writer.ts).
  useEffect(() => {
    let current = true;
    const show = async (repo: string) => {
      try {
        const html = await preview(value, repo);
        if (current) setRendered({ text: value, html });
      } catch (e) {
        if (current) setRendered({ text: value, html: null, error: e instanceof Error ? e.message : String(e) });
      }
    };
    if (tab === "preview" && api && value.trim()) void show(api.repo);
    return () => {
      current = false;
    };
  }, [tab, value, api]);

  /** What to offer for the @mention or #reference at the caret. */
  const lookUp = (text: string, caret: number) => {
    const next = api ? tokenAt(text, caret) : null;
    setToken(next);
    if (!next || !api || !field.current) {
      setOptions([]);
      return;
    }
    setAt({ ...caretAt(field.current, next.start), width: field.current.clientWidth });
    const turn = ++asked.current;
    const found: Promise<Option[]> =
      next.kind === "emoji"
        ? emoji()
            .catch(() => [])
            .then((list) => rankEmoji(list, next.query).map((e) => ({ kind: "emoji", emoji: e })))
        : next.kind === "mention"
          ? mentionable(api.repo, next.query)
              .catch(() => [])
              .then((more) =>
                rankPeople([...api.people, ...more], next.query).map((person) => ({ kind: "person", person })),
              )
          : referable(api.repo, next.query)
              .catch(() => [])
              .then((refs) => refs.map((reference) => ({ kind: "reference", reference })));
    // The pull request's own people at once, the rest as they come.
    if (next.kind === "mention")
      setOptions(rankPeople(api.people, next.query).map((person) => ({ kind: "person", person })));
    void (async () => {
      const list = await found;
      if (turn !== asked.current) return;
      setOptions(list);
      setActive(0);
    })();
  };

  /** A change made as if typed, so ⌘Z undoes it. */
  const apply = (change: Change) => {
    const el = field.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(change.from, change.to);
    // execCommand is deprecated, but it's still the only way to change a field's text that the
    // browser's own undo knows about.
    const typed = change.insert
      ? // oxlint-disable-next-line typescript/no-deprecated -- the one way to keep ⌘Z (above)
        document.execCommand("insertText", false, change.insert)
      : // oxlint-disable-next-line typescript/no-deprecated -- the one way to keep ⌘Z (above)
        document.execCommand("delete");
    if (!typed) onChange(value.slice(0, change.from) + change.insert + value.slice(change.to));
    requestAnimationFrame(() => {
      el.setSelectionRange(...change.select);
    });
  };

  /** Text in at the caret (over what's selected), on lines of its own when it's a block. */
  const insert = (text: string, block = false) => {
    const el = field.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    setTab("write");
    const before = block && start > 0 && value[start - 1] !== "\n" ? "\n" : "";
    const after = block && value[end] !== "\n" ? "\n" : "";
    const full = before + text + after;
    requestAnimationFrame(() => {
      apply({ from: start, to: end, insert: full, select: [start + full.length, start + full.length] });
    });
  };

  /** One placeholder swapped for what took its place, keeping the caret where it was. Says whether
   *  it was still there. */
  const replace = (mark: string, by: string) => {
    const before = latest.current;
    const index = before.indexOf(mark);
    const next = swap(before, mark, by);
    if (next === before) return false;
    const el = field.current;
    const caret = el && document.activeElement === el ? [el.selectionStart, el.selectionEnd] : null;
    latest.current = next;
    onChange(next);
    if (caret && el) {
      const shift = (i: number) => (i > index ? Math.max(index, i + next.length - before.length) : i);
      requestAnimationFrame(() => {
        el.setSelectionRange(shift(caret[0]!), shift(caret[1]!));
      });
    }
    return true;
  };

  /** Pictures and videos into the comment: a placeholder for each at the caret, then each as
   *  github.com writes it once it's uploaded. */
  const attach = (files: File[]) => {
    if (!api || !number || files.length === 0) return;
    const list = files.filter((file) => attachable(file));
    if (list.length < files.length) setMessage({ kind: "error", text: t("review.uploadUnsupported") });
    if (list.length === 0) return;
    if (session === null) {
      setMessage({ kind: "sign-in" });
      return;
    }
    if (list.length === files.length) setMessage(null);
    let text = latest.current;
    const marks = list.map((file) => {
      const mark = uploadMark(file.name, t("review.uploading", { name: "{name}" }), text);
      text += mark;
      return mark;
    });
    insert(marks.join("\n"), true);
    const failed = (mark: string, e: UploadError | string) => {
      replace(mark, "");
      if (typeof e === "string") setMessage({ kind: "error", text: e });
      else if (e.kind === "failed") setMessage({ kind: "error", text: e.message });
      else setMessage({ kind: e.kind === "session_expired" ? "ended" : "sign-in" });
    };
    for (const [i, file] of list.entries()) {
      const mark = marks[i]!;
      void Promise.all([bridge.uploadAttachment(api.repo, number, file), displayWidth(file)]).then(
        ([uploaded, width]) => replace(mark, markdownFor(uploaded.kind, uploaded.href, file.name, width)),
        (e: UploadError | string) => {
          failed(mark, e);
        },
      );
    }
  };

  const pick = (option: Option | undefined) => {
    const el = field.current;
    if (!option || !token || !el) return;
    const done = complete(
      value,
      token,
      el.selectionStart,
      option.kind === "person"
        ? option.person.login
        : option.kind === "emoji"
          ? option.emoji.name
          : String(option.reference.number),
    );
    apply({
      from: token.start,
      to: el.selectionStart,
      insert: done.text.slice(token.start, done.caret),
      select: [done.caret, done.caret],
    });
    setToken(null);
    setOptions([]);
  };

  const open = Boolean(token && options.length > 0 && tab === "write");
  const listId = `${id}-options`;
  const shortcut = isMac ? "⌘" : "Ctrl+";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        {/* A small segmented control: write, or see it as GitHub will show it. */}
        {/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- in a tab list the tabs take the focus (WAI-ARIA's tabs pattern), not the list. */}
        <div
          role="tablist"
          onKeyDown={tabKeys}
          aria-label={label}
          className="relative isolate flex rounded-(--radius-control-sm) bg-fill"
        >
          <SlidingPill
            selected={tab}
            className="rounded-(--radius-control-sm) bg-(--toolbar-segment-bg) shadow-[0_1px_2px_rgb(0_0_0/0.12),0_0_0_0.5px_rgb(0_0_0/0.06)]"
          />
          {(
            [
              ["write", t("review.write")],
              ["preview", t("review.preview")],
            ] as const
          ).map(([value_, name]) => (
            <button
              key={value_}
              type="button"
              role="tab"
              data-pill={value_}
              id={`${id}-${value_}`}
              tabIndex={tab === value_ ? 0 : -1}
              aria-selected={tab === value_}
              aria-controls={`${id}-panel`}
              disabled={value_ === "preview" && !api}
              onClick={() => {
                setTab(value_);
              }}
              className="flex h-(--control-h-sm) cursor-default items-center rounded-(--radius-control-sm) px-2 text-subheadline text-foreground focus-ring outline-none disabled:text-(--label-tertiary)"
            >
              {name}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {suggestion ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground"
                  onClick={() => {
                    insert(suggestionBlock(suggestion), true);
                  }}
                />
              }
            >
              <FileDiff /> {t("review.suggestChange")}
            </TooltipTrigger>
            <TooltipContent>{t("review.suggestChangeTip")}</TooltipContent>
          </Tooltip>
        ) : null}
        {api && number ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground"
                  aria-label={t("review.attachFiles")}
                  onClick={() => picker.current?.click()}
                />
              }
            >
              <Paperclip />
            </TooltipTrigger>
            <TooltipContent>{t("review.attachFiles")}</TooltipContent>
          </Tooltip>
        ) : null}
        <input
          ref={picker}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            // A file input always has its list.
            attach([...e.target.files!]);
            e.target.value = "";
          }}
        />
        {api ? (
          <SavedReplies
            onPick={(body) => {
              insert(body);
            }}
          />
        ) : null}
      </div>

      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`}>
        {tab === "preview" ? (
          <div
            className="min-h-16 rounded-(--radius-field) border border-input bg-(--field-bg) px-2 py-1.5"
            aria-busy={rendered?.text !== value}
          >
            {value.trim() ? (
              rendered?.text === value ? (
                rendered.html === null ? (
                  <p className="text-callout text-destructive" role="alert">
                    {rendered.error}
                  </p>
                ) : (
                  <CommentHtml html={rendered.html} base={base} />
                )
              ) : (
                <p className="flex items-center gap-1.5 text-body text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden /> {t("review.loadingPreview")}
                </p>
              )
            ) : (
              <p className="text-body text-muted-foreground">{t("review.nothingToPreview")}</p>
            )}
          </div>
        ) : (
          <div className="relative">
            <label htmlFor={`${id}-field`} className="sr-only">
              {label}
            </label>
            <Textarea
              id={`${id}-field`}
              ref={field}
              rows={rows}
              value={value}
              placeholder={placeholder}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a text field that completes as you type is a combobox (WAI-ARIA's pattern); no HTML element is both.
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              aria-activedescendant={open ? `${listId}-${active}` : undefined}
              aria-describedby={`${id}-hint`}
              onChange={(e) => {
                onChange(e.target.value);
                lookUp(e.target.value, e.target.selectionStart);
              }}
              onSelect={(e) => {
                // The caret moved off what was being completed.
                const caret = e.currentTarget.selectionStart;
                if (token && (caret < token.start || caret > token.start + token.query.length + 1)) setToken(null);
              }}
              onBlur={() => {
                setToken(null);
              }}
              onKeyDown={(e) => {
                const mod = isMac ? e.metaKey : e.ctrlKey;
                if (open) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
                    return;
                  }
                  if ((e.key === "Enter" && !mod) || e.key === "Tab") {
                    e.preventDefault();
                    pick(options[active]);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setToken(null);
                    return;
                  }
                }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onSubmit();
                } else if (e.key === "Escape") {
                  e.stopPropagation();
                  onCancel();
                } else if (mod && !e.shiftKey && !e.altKey && ["b", "i", "e", "k"].includes(e.key.toLowerCase())) {
                  e.preventDefault();
                  const { selectionStart: start, selectionEnd: end } = e.currentTarget;
                  const key = e.key.toLowerCase();
                  apply(
                    key === "k"
                      ? link(value, start, end)
                      : wrap(value, start, end, key === "b" ? "bold" : key === "i" ? "italic" : "code"),
                  );
                }
              }}
              onPaste={(e) => {
                const files = [...e.clipboardData.files];
                if (files.length > 0) {
                  e.preventDefault();
                  attach(files);
                  return;
                }
                // A link pasted over words makes them a link, as on GitHub.
                const pasted = e.clipboardData.getData("text/plain").trim();
                const { selectionStart: start, selectionEnd: end } = e.currentTarget;
                if (
                  start !== end &&
                  /^https?:\/\/\S+$/u.test(pasted) &&
                  !/^https?:\/\//u.test(value.slice(start, end))
                ) {
                  e.preventDefault();
                  apply(link(value, start, end, pasted));
                }
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("Files")) e.preventDefault();
              }}
              onDrop={(e) => {
                if (e.dataTransfer.files.length === 0) return;
                e.preventDefault();
                // Where it's dropped is where it goes.
                const el = e.currentTarget;
                const point = document.caretPositionFromPoint?.(e.clientX, e.clientY);
                if (point?.offsetNode === el) el.setSelectionRange(point.offset, point.offset);
                attach([...e.dataTransfer.files]);
              }}
              className="resize-y"
            />
            {open ? (
              <ul
                id={listId}
                // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role -- the combobox's popup (WAI-ARIA's pattern): a <select> can't sit under a text field.
                role="listbox"
                aria-label={
                  token?.kind === "mention"
                    ? t("review.mentionSomeone")
                    : token?.kind === "emoji"
                      ? t("review.pickEmoji")
                      : t("review.referenceIssue")
                }
                className="mac-menu absolute z-50 w-72 max-w-[calc(100%-8px)] p-(--menu-pad) text-popover-foreground"
                style={{
                  top: at.top + at.height + 4,
                  left: Math.min(at.left, Math.max(0, at.width - 288)),
                }}
                // A click picks without taking the focus from the field.
                onMouseDown={(e) => {
                  e.preventDefault();
                }}
              >
                {options.map((o, i) => (
                  // The keyboard picks from the field (aria-activedescendant): the options only take clicks.
                  // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
                  <li
                    key={o.kind === "person" ? o.person.login : o.kind === "emoji" ? o.emoji.name : o.reference.number}
                    id={`${listId}-${i}`}
                    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role -- the listbox's options, as above.
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => {
                      setActive(i);
                    }}
                    onClick={() => {
                      pick(o);
                    }}
                    className={cn(
                      "flex h-(--menu-item-h) cursor-default items-center gap-2 rounded-(--radius-menu-item) px-2 text-body",
                      i === active && "bg-(--selection-bg) text-(--selection-fg) **:text-(--selection-fg)",
                    )}
                  >
                    {o.kind === "person" ? (
                      <>
                        <Avatar className="size-4">
                          {o.person.avatarUrl ? <AvatarImage src={avatar(o.person.avatarUrl)} alt="" /> : null}
                          <AvatarFallback className="text-footnote">
                            {o.person.login.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{o.person.login}</span>
                        {o.person.name ? <span className="truncate text-muted-foreground">{o.person.name}</span> : null}
                      </>
                    ) : o.kind === "emoji" ? (
                      <>
                        <span aria-hidden className="w-4 shrink-0 text-center text-[15px] leading-none">
                          {o.emoji.char}
                        </span>
                        <span className="truncate">:{o.emoji.name}:</span>
                      </>
                    ) : (
                      <>
                        {o.reference.kind === "pull" ? (
                          <GitPullRequest className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        ) : (
                          <CircleDot className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        )}
                        <span className="shrink-0 text-muted-foreground tabular-nums">#{o.reference.number}</span>
                        <span className="truncate">{o.reference.title}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </div>
      {message ? (
        <p
          id={`${id}-hint`}
          role={message.kind === "error" ? "alert" : "status"}
          className={cn(
            "flex flex-wrap items-center gap-x-1.5 text-callout",
            message.kind === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {message.kind === "error"
            ? message.text
            : t(message.kind === "ended" ? "review.uploadSessionEnded" : "review.uploadSignIn")}
          {message.kind === "error" ? null : (
            <Button variant="link" size="xs" className="h-auto px-0" onClick={() => void bridge.signInWeb()}>
              {t("review.signInGitHubCom")}
            </Button>
          )}
        </p>
      ) : (
        <p id={`${id}-hint`} className="sr-only">
          {t("review.writingShortcuts", { shortcut })}
        </p>
      )}
    </div>
  );
}
