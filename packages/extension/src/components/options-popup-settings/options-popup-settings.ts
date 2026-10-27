import { i18n } from "#i18n";
import { repoPickers } from "@/components/options-widgets/options-widgets";
import { $ } from "@/utils/extension-page/extension-page";
import { normalizePopup, type PopupSettings } from "@/utils/inbox/inbox";

/**
 * Settings' Popup section: the repositories whose pull requests the popup lists, the ones it never does, whether it
 * lists the reviews asked of the reader's teams, and the lists it can add, Updates and Merged.
 */
export const createPopupSettings = ({ onChange }: { onChange: () => void }) => {
  let settings: PopupSettings = normalizePopup({});
  const pickers = repoPickers(onChange);
  const switches = (["teams", "updates", "merged"] as const).map((key) => {
    const input = $<HTMLInputElement>(`#popup-${key}`);
    input.addEventListener("change", () => {
      settings[key] = input.checked;
      onChange();
    });
    return { key, input };
  });

  return {
    render: (next: PopupSettings) => {
      settings = structuredClone(next);
      for (const { key, input } of switches) input.checked = settings[key];
      pickers.clear();
      $("#popup-repos").replaceChildren(
        pickers.picker("popup-repos-only", i18n.t("popupReposOnly"), settings.repos, (repos) => {
          settings.repos = repos;
        }),
      );
      $("#popup-repos-never").replaceChildren(
        pickers.picker("popup-repos-never-list", i18n.t("popupReposNever"), settings.excludeRepos, (repos) => {
          settings.excludeRepos = repos;
        }),
      );
    },
    value: (): PopupSettings => normalizePopup(settings),
    /** Whether every repository typed reads as one; if not, it says so at the field. */
    check: (): boolean => pickers.wrong().length === 0,
  };
};
