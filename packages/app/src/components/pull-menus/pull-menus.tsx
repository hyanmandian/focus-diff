// The toolbar's menus for what's done to a pull request: the Merge pull-down (merge by each way
// allowed, merge when ready, the merge queue, updating the branch) and the More menu's part (draft
// or ready, close or reopen, delete the branch). The merge box in the Overview has the same, with
// the commit message to edit.

import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@focus-diff/design-system/components/dropdown-menu";

import type { Pull } from "../../hooks/use-pull/use-pull";
import type { Details } from "../../utils/details/details";
import { useT } from "../../utils/i18n/i18n";

export function MergeMenuItems({ details, pull, onDetails }: { details: Details; pull: Pull; onDetails: () => void }) {
  const t = useT();
  const view = pull.view;
  if (!view) return null;
  const methods = details.mergeMethods;
  return (
    <>
      {/* A label names a group: Base UI needs the group around it. */}
      {view.canMerge ? (
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("review.mergeTitle")}</DropdownMenuLabel>
          {methods.map((method) => (
            <DropdownMenuItem key={method} onClick={() => void pull.actions.merge(method)}>
              {t(`review.mergeMethod.${method}`)}…
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      ) : null}
      {view.canAutoMerge ? (
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("manage.mergeWhenReady")}</DropdownMenuLabel>
          {methods.map((method) => (
            <DropdownMenuItem key={method} onClick={() => void pull.actions.autoMerge(method)}>
              {t(`review.mergeMethod.${method}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      ) : null}
      {view.canDisableAutoMerge ? (
        <DropdownMenuItem onClick={() => void pull.actions.disableAutoMerge()}>
          {t("manage.disableAutoMerge")}
        </DropdownMenuItem>
      ) : null}
      {view.canEnqueue ? (
        <DropdownMenuItem onClick={() => void pull.actions.enqueue()}>{t("manage.enqueue")}</DropdownMenuItem>
      ) : null}
      {view.canDequeue ? (
        <DropdownMenuItem onClick={() => void pull.actions.dequeue()}>{t("manage.dequeue")}</DropdownMenuItem>
      ) : null}
      {view.canBypass && !view.canMerge ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("manage.bypassTitle")}</DropdownMenuLabel>
            {methods.map((method) => (
              <DropdownMenuItem
                key={method}
                variant="destructive"
                onClick={() => void pull.actions.merge(method, undefined, { bypass: true })}
              >
                {t(`review.mergeMethod.${method}`)}…
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </>
      ) : null}
      {view.canUpdateBranch ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void pull.actions.updateBranch("MERGE")}>
            {t("manage.updateMerge")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void pull.actions.updateBranch("REBASE")}>
            {t("manage.updateRebase")}
          </DropdownMenuItem>
        </>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onDetails}>{t("manage.mergeOptions")}</DropdownMenuItem>
    </>
  );
}

export function PullMenuItems({ pull, details }: { pull: Pull; details: Details | null }) {
  const t = useT();
  const a = pull.allowed;
  if (!details || !(a.draft || a.ready || a.close || a.reopen || a["delete-branch"])) return null;
  return (
    <>
      <DropdownMenuSeparator />
      {a.ready ? (
        <DropdownMenuItem onClick={() => void pull.actions.ready()}>{t("review.markReady")}</DropdownMenuItem>
      ) : null}
      {a.draft ? (
        <DropdownMenuItem onClick={() => void pull.actions.draft()}>{t("manage.convertToDraft")}</DropdownMenuItem>
      ) : null}
      {a.close ? (
        <DropdownMenuItem onClick={() => void pull.actions.close()}>{t("manage.close")}</DropdownMenuItem>
      ) : null}
      {a.reopen ? (
        <DropdownMenuItem onClick={() => void pull.actions.reopen()}>{t("manage.reopen")}</DropdownMenuItem>
      ) : null}
      {a["delete-branch"] ? (
        <DropdownMenuItem variant="destructive" onClick={() => void pull.actions.deleteBranch()}>
          {t("manage.deleteBranch")}…
        </DropdownMenuItem>
      ) : null}
    </>
  );
}
