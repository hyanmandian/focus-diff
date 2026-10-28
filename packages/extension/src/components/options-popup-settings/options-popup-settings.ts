import { i18n } from "#i18n";
import { repoPickers } from "@/components/options-widgets/options-widgets";
import { $ } from "@/utils/extension-page/extension-page";
import { normalizePopup, type PopupSettings } from "@/utils/inbox/inbox";

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
    check: (): boolean => pickers.wrong().length === 0,
  };
};
