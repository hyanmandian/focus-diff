import { i18n } from '#i18n';
import { normalizePopup, type PopupSettings } from '@/utils/inbox/inbox';
import { $ } from '@/utils/page';
import { repoPickers } from './widgets';

/**
 * Settings' Popup section: the repositories whose pull requests the popup lists, the ones it never does, and whether it
 * lists the reviews asked of the reader's teams.
 */
export const createPopupSettings = ({ onChange }: { onChange: () => void }) => {
  let settings: PopupSettings = normalizePopup({});
  const pickers = repoPickers(onChange);
  const teams = $<HTMLInputElement>('#popup-teams');
  teams.addEventListener('change', () => {
    settings.teams = teams.checked;
    onChange();
  });

  return {
    render: (next: PopupSettings) => {
      settings = structuredClone(next);
      teams.checked = settings.teams;
      pickers.clear();
      $('#popup-repos').replaceChildren(
        pickers.picker('popup-repos-only', i18n.t('popupReposOnly'), settings.repos, (repos) => (settings.repos = repos)),
      );
      $('#popup-repos-never').replaceChildren(
        pickers.picker(
          'popup-repos-never-list',
          i18n.t('popupReposNever'),
          settings.excludeRepos,
          (repos) => (settings.excludeRepos = repos),
        ),
      );
    },
    value: (): PopupSettings => normalizePopup(settings),
    /** Whether every repository typed reads as one; if not, it says so at the field. */
    check: (): boolean => pickers.wrong().length === 0,
  };
};
