import { ExternalLink } from "lucide-react";

import { Button } from "@/components/button/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/dialog/dialog";
import { bridge } from "@/utils/bridge/bridge";
import { releasesBetween, releaseUrl } from "@/utils/changes/changes";
import { useT } from "@/utils/i18n/i18n";

const RECENT = 5;

export function WhatsNew({
  open,
  onOpenChange,
  version,
  after = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  version: string;
  after?: string | null;
}) {
  const t = useT();
  const releases = releasesBetween(after, version).slice(0, after ? undefined : RECENT);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,calc(100%-2rem))]">
        <DialogTitle>{t("shared.whatsNewTitle", { version })}</DialogTitle>
        <div className="-mx-1 flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-1">
          {releases.length === 0 ? (
            <p className="text-body text-muted-foreground">{t("shared.whatsNewNothing")}</p>
          ) : (
            releases.map((release) => (
              <section key={release.version} aria-labelledby={`release-${release.version}`}>
                <h3 id={`release-${release.version}`} className="text-headline font-semibold">
                  {release.version}{" "}
                  <span className="text-subheadline font-normal text-muted-foreground">{release.date}</span>
                </h3>
                <ul className="mt-1 flex flex-col gap-1 text-body">
                  {release.changes.map((change) => (
                    <li key={change.text} className="flex items-baseline gap-2">
                      <span
                        className={
                          change.kind === "feature"
                            ? "shrink-0 text-subheadline font-semibold text-success"
                            : "shrink-0 text-subheadline font-semibold text-muted-foreground"
                        }
                      >
                        {change.kind === "feature" ? t("shared.whatsNewNew") : t("shared.whatsNewFixed")}
                      </span>
                      <span>{change.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" className="mr-auto" onClick={() => void bridge.openUrl(releaseUrl(version))}>
            {t("shared.whatsNewOnGitHub")} <ExternalLink />
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t("diff.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
