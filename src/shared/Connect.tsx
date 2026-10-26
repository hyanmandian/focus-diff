// Connecting GitHub: signing in with GitHub (device flow) when this build has it, the GitHub CLI's
// login when gh is installed, or a pasted token. Used by the panel on first run and by settings.

import { Check, Copy, ExternalLink, KeyRound, Loader2, Terminal } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bridge, type AuthStatus, type DeviceCode } from "@/lib/bridge";
import { i18n, useT } from "@/lib/i18n";

type Props = { auth: AuthStatus | null; onConnected: () => void };

export function Connect({ auth, onConnected }: Props) {
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<"device" | "gh" | "token" | null>(null);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(!auth?.device_flow && !auth?.gh_available);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  const run = async (kind: NonNullable<typeof busy>, action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
      onConnected();
    } catch (e) {
      setError(typeof e === "string" ? e : e instanceof Error ? e.message : i18n()("common.somethingWentWrong"));
    } finally {
      setBusy(null);
      setCode(null);
    }
  };

  const signIn = () =>
    run("device", async () => {
      const started = await bridge.authDeviceStart();
      setCode(started);
      await navigator.clipboard.writeText(started.user_code).then(() => setCopied(true), () => {});
      await bridge.openUrl(started.verification_uri);
      await bridge.authDeviceFinish(started);
    });

  if (code) {
    return (
      <div className="flex flex-col items-center gap-4 text-center" role="status" aria-live="polite">
        <p className="text-body text-muted-foreground">{t("shared.connectEnterCode")}</p>
        <div className="flex items-center gap-2">
          <code className="rounded-lg bg-muted px-4 py-2 font-mono text-2xl font-semibold tracking-[0.2em]" aria-label={t("shared.connectCodeLabel", { code: code.user_code.split("").join(" ") })}>
            {code.user_code}
          </code>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("shared.connectCopyCode")}
            onClick={() => navigator.clipboard.writeText(code.user_code).then(() => setCopied(true))}
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
        <Button variant="link" onClick={() => void bridge.openUrl(code.verification_uri)}>
          {t("shared.connectOpenDevice")} <ExternalLink />
        </Button>
        <p className="flex items-center gap-2 text-callout text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> {t("shared.connectWaiting")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {auth?.device_flow ? (
        <Button size="lg" onClick={signIn} disabled={busy !== null}>
          {busy === "device" ? <Loader2 className="animate-spin" /> : null}
          {t("shared.connectSignIn")}
        </Button>
      ) : null}
      {auth?.gh_available ? (
        <Button size="lg" variant={auth.device_flow ? "outline" : "default"} onClick={() => run("gh", bridge.authUseGh)} disabled={busy !== null}>
          {busy === "gh" ? <Loader2 className="animate-spin" /> : <Terminal />}
          {t("shared.connectUseGh")}
        </Button>
      ) : null}
      {showToken ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run("token", () => bridge.authUseToken(token));
          }}
        >
          <Label htmlFor="token">{t("shared.connectToken")}</Label>
          <Input
            id="token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={t("shared.connectTokenPlaceholder")}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <p className="text-callout text-muted-foreground">
            {t("shared.connectTokenNeedsBefore")} <code>repo</code> {t("shared.connectTokenNeedsAnd")} <code>read:org</code>
            {t("shared.connectTokenNeedsAfter")}
          </p>
          <Button type="submit" variant="outline" disabled={!token.trim() || busy !== null}>
            {busy === "token" ? <Loader2 className="animate-spin" /> : <KeyRound />}
            {t("shared.connectUseToken")}
          </Button>
        </form>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setShowToken(true)}>
          {t("shared.connectUseTokenInstead")}
        </Button>
      )}
      {error ? (
        <p className="text-body text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
