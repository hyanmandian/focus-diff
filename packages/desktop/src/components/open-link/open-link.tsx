import { parsePullLink } from "@focus-diff/core/pull-link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/button/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/dialog/dialog";
import { Input } from "@/components/input/input";
import { errorText } from "@/utils/error/error";
import { useT, type T } from "@/utils/i18n/i18n";
import { NoSuchPull, openPullLink } from "@/utils/pull-link/pull-link";

export async function openLink(text: string, t: T, wanted = () => true): Promise<string | null> {
  const link = parsePullLink(text);
  if (!link) return t("panel.notAPullLink");
  try {
    await openPullLink(link, wanted);
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
  initial?: { text: string; error: string } | null;
}) {
  const t = useT();
  const [text, setText] = useState(initial?.text ?? "");
  const [error, setError] = useState(initial?.error ?? null);
  const [busy, setBusy] = useState(false);
  const attempt = useRef(0);
  useEffect(
    () => () => {
      attempt.current++;
    },
    [],
  );
  const close = () => {
    attempt.current++;
    onClose();
  };
  const submit = async () => {
    const mine = ++attempt.current;
    setBusy(true);
    const why = await openLink(text, t, () => attempt.current === mine);
    if (attempt.current !== mine) return;
    setBusy(false);
    setError(why);
    if (!why) onClose();
  };
  return (
    <Dialog open onOpenChange={close}>
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
            <Button type="button" variant="outline" onClick={close}>
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
