import { Button } from "@/components/button/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/dialog/dialog";
import { Kbd } from "@/components/kbd/kbd";
import { useT, type Key } from "@/utils/i18n/i18n";
import { written } from "@/utils/os/os";

type Words = Extract<Key, `diff.key${string}`>;

const GROUPS: Array<[title: Words, shortcuts: Array<[keys: string, does: Words]>]> = [
  [
    "diff.keysFiles",
    [
      ["j", "diff.keyNextFile"],
      ["k", "diff.keyPreviousFile"],
      ["v", "diff.keyViewed"],
      ["⌥⇧J", "diff.keyNextToReview"],
      ["⌘F", "diff.keyFind"],
      ["⌘G", "diff.keyFindNext"],
      ["⇧⌘G", "diff.keyFindPrevious"],
      ["⇧⌘F", "diff.keyFindFiles"],
    ],
  ],
  [
    "diff.keysComments",
    [
      ["n", "diff.keyNextComment"],
      ["p", "diff.keyPreviousComment"],
      ["⌘↩", "diff.keySend"],
      ["Esc", "diff.keyCancel"],
    ],
  ],
  [
    "diff.keysFilters",
    [
      ["⌥⇧.", "diff.keyNextFilter"],
      ["⌥⇧,", "diff.keyPreviousFilter"],
      ["⌥⇧0", "diff.keyAllFiles"],
    ],
  ],
  [
    "diff.keysView",
    [
      ["⌘1", "diff.keyOverview"],
      ["⌘2", "diff.keyDiff"],
      ["⌘[", "diff.keyPreviousPull"],
      ["⌘]", "diff.keyNextPull"],
      ["E", "diff.keyMarkDone"],
      ["?", "diff.keyHelp"],
    ],
  ],
];

export function Shortcuts({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(560px,calc(100%-2rem))]">
        <DialogTitle>{t("diff.shortcuts")}</DialogTitle>
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          {GROUPS.map(([title, shortcuts]) => (
            <section key={title} aria-label={t(title)}>
              <h3 className="mb-1 text-subheadline font-semibold text-muted-foreground">{t(title)}</h3>
              <dl className="flex flex-col">
                {shortcuts.map(([keys, does]) => (
                  <div key={keys} className="flex h-(--row-h-sm) items-center justify-between gap-4 text-body">
                    <dt>{t(does)}</dt>
                    <dd>
                      <Kbd className="text-body">{written(keys)}</Kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <DialogFooter>
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
