// Open Pull Request…: a sheet over the panel for a pull request's link on GitHub, opened in its
// review window on Return. It also shows when a link pasted in the panel, or sent from a
// focusdiff:// link, couldn't be opened, with the link and why.

import { parsePullLink } from "@focus-diff/core/pull-link";
import { useState } from "react";

import { Button } from "@/components/button/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/dialog/dialog";
import { Input } from "@/components/input/input";
import { errorText } from "@/utils/error/error";
import { useT, type T } from "@/utils/i18n/i18n";
import { NoSuchPull, openPullLink } from "@/utils/pull-link/pull-link";

/** Opens the review of the pull request a link is to; why not, in words, when it can't. */
export async function openLink(text: string, t: T): Promise<string | null> {
  const link = parsePullLink(text);
  if (!link) return t("panel.notAPullLink");
  try {
    await openPullLink(link);
    return null;
  } catch (e) {
    return e instanceof NoSuchPull ? t("panel.noSuchPull") : errorText(e);
  }
}

export function OpenLink({
  onClose,
  initial,
}: {
  onClose: () => void;
  /** What to show on opening: a link that couldn't be opened, and why. */
  initial?: { text: string; error: string } | null;
}) {
  const t = useT();
  const [text, setText] = useState(initial?.text ?? "");
  const [error, setError] = useState(initial?.error ?? null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const why = await openLink(text, t);
    setBusy(false);
    setError(why);
    if (!why) onClose();
  };
  return (
    // Shown while it's there: it only ever asks to close.
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogTitle>{t("panel.openPullTitle")}</DialogTitle>
        <DialogDescription>{t("panel.openPullHint")}</DialogDescription>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Input
              autoFocus
              value={text}
              aria-label={t("panel.openPullField")}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "open-link-error" : undefined}
              placeholder="https://github.com/owner/repo/pull/123"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
            />
            {error ? (
              <p id="open-link-error" role="alert" className="text-callout text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !text.trim()}>
              {t("panel.openPull")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
