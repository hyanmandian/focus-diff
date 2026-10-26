import { i18n } from "#i18n";
import { notifySwitch, repoPickers, soundPicker, switchInput } from "@/components/options-widgets/options-widgets";
import { h } from "@/utils/dom/dom";
import { $ } from "@/utils/extension-page/extension-page";
import {
  EXCEPTIONS,
  INTERVALS,
  normalizeNotify,
  type EventKind,
  type Exception,
  type Interval,
  type NotifySettings,
  type When,
} from "@/utils/inbox/inbox";
import { inboxItem } from "@/utils/storage/storage";

/** The events, grouped by whose pull request they happen on, the way the popup's tabs are. */
const GROUPS: { list: string; events: EventKind[] }[] = [
  { list: "#events-reviewing", events: ["review-requested", "ready-for-review", "comment-reviewing"] },
  { list: "#events-mine", events: ["comment-mine", "approved", "changes-requested"] },
  { list: "#events-other", events: ["mention"] },
];

const EVENT_NAMES: Record<EventKind, string> = {
  "review-requested": i18n.t("eventReviewRequested"),
  "ready-for-review": i18n.t("eventReadyForReview"),
  "comment-reviewing": i18n.t("eventCommentReviewing"),
  "comment-mine": i18n.t("eventCommentMine"),
  approved: i18n.t("eventApproved"),
  "changes-requested": i18n.t("eventChangesRequested"),
  mention: i18n.t("eventMention"),
};

/** The comment events read the same under their groups' headings; out of them, like in a list of controls, they don't. */
const FULL_NAMES: Partial<Record<EventKind, string>> = {
  "comment-reviewing": i18n.t("eventCommentReviewingFull"),
  "comment-mine": i18n.t("eventCommentMineFull"),
};
const fullName = (kind: EventKind) => FULL_NAMES[kind] ?? EVENT_NAMES[kind];

const EXCEPTION_NAMES: Record<Exception, string> = {
  drafts: i18n.t("exceptDrafts"),
  approved: i18n.t("exceptApproved"),
  bots: i18n.t("exceptBots"),
};

/**
 * Settings' Notifications section: one switch to turn them on, which asks the browser for notifications; the
 * repositories they're for and the ones never; the events in two columns, by whose pull request they happen on, each
 * with what to skip and, if it differs, its own repositories; how often to look and when to keep quiet; and how they
 * show.
 */
export const createNotifications = ({
  onChange,
  say,
}: {
  onChange: () => void;
  say: (text: string, tone: "error") => void;
}) => {
  let settings: NotifySettings = normalizeNotify({});
  const pickers = repoPickers(onChange);
  const toggle = $<HTMLInputElement>("#notify-on");
  const body = $("#notify-body");
  const permission = $("#notify-permission");
  const interval = $<HTMLSelectElement>("#notify-interval");
  const quietOn = $<HTMLInputElement>("#quiet-on");
  const quietFrom = $<HTMLInputElement>("#quiet-from");
  const quietTo = $<HTMLInputElement>("#quiet-to");
  const quietWeekends = $<HTMLInputElement>("#quiet-weekends");
  const delivery = {
    grouped: $<HTMLInputElement>("#delivery-grouped"),
    sticky: $<HTMLInputElement>("#delivery-sticky"),
  };
  /** Whether the reader has review times, for which an event can wait instead of showing at once. */
  let reviewTime = false;

  interval.append(
    ...INTERVALS.map((minutes) => new Option(i18n.t("notifyMinutes", minutes, [minutes]), String(minutes))),
  );
  // Firefox can't keep a notification on screen.
  if (import.meta.env.FIREFOX)
    document.querySelectorAll<HTMLElement>(".chrome-only").forEach((row) => (row.hidden = true));

  // The repositories the reader has pull requests in, to pick from.
  void inboxItem.getValue().then((snapshot) => {
    const repos = [
      ...new Set([...(snapshot?.reviews ?? []), ...(snapshot?.mine ?? [])].map((pull) => pull.repo)),
    ].toSorted();
    const owners = [...new Set(repos.map((repo) => `${repo.slice(0, repo.indexOf("/"))}/*`))];
    $("#repo-suggestions").replaceChildren(...[...repos, ...owners].map((repo) => new Option(repo)));
  });

  const { picker } = pickers;

  const skipChips = (kind: EventKind) => {
    const setting = settings.events[kind];
    const chips = EXCEPTIONS[kind].map((exception) => {
      const chip = h("button", { type: "button", className: "skip-chip", textContent: EXCEPTION_NAMES[exception] });
      chip.setAttribute("aria-pressed", String(setting.except.includes(exception)));
      chip.addEventListener("click", () => {
        const on = !setting.except.includes(exception);
        setting.except = on ? [...setting.except, exception] : setting.except.filter((each) => each !== exception);
        chip.setAttribute("aria-pressed", String(on));
        onChange();
      });
      return chip;
    });
    const group = h(
      "div",
      { className: "event-skip", role: "group" },
      h("span", { className: "skip-label", textContent: i18n.t("notifySkip") }),
      ...chips,
    );
    group.setAttribute("aria-label", i18n.t("notifyExceptFor", [fullName(kind)]));
    return group;
  };

  /** An event's own repositories, folded behind a button that says which apply. */
  const eventRepos = (kind: EventKind) => {
    const setting = settings.events[kind];
    const id = `event-${kind}-repos`;
    const button = h("button", { type: "button", className: "event-repos-toggle" });
    const panel = h("div", { className: "event-repos", id });
    const label = () =>
      (button.textContent = setting.repos.length
        ? i18n.t("notifyEventReposCount", setting.repos.length, [setting.repos.length])
        : i18n.t("notifyEventReposSame"));
    label();
    panel.hidden = setting.repos.length === 0;
    button.setAttribute("aria-controls", id);
    button.setAttribute("aria-expanded", String(!panel.hidden));
    panel.append(
      picker(`${id}-input`, i18n.t("notifyEventReposLabel", [fullName(kind)]), setting.repos, (repos) => {
        setting.repos = repos;
        label();
      }),
      h("p", { className: "hint", textContent: i18n.t("notifyEventReposHint") }),
    );
    button.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      button.setAttribute("aria-expanded", String(!panel.hidden));
      if (!panel.hidden) $<HTMLInputElement>("input", panel).focus();
    });
    return [button, panel];
  };

  /** Right away, or kept for the reader's next review time: only offered while they have review times. */
  const whenChoice = (kind: EventKind) => {
    const setting = settings.events[kind];
    const choices: [When, string][] = [
      ["now", i18n.t("notifyWhenNow")],
      ["review", i18n.t("notifyWhenReview")],
    ];
    const group = h(
      "div",
      { className: "event-when segmented", role: "radiogroup" },
      ...choices.map(([when, label]) => {
        const id = `event-${kind}-when-${when}`;
        const radio = h("input", {
          type: "radio",
          name: `event-${kind}-when`,
          id,
          value: when,
          checked: setting.when === when,
        });
        radio.addEventListener("change", () => {
          setting.when = when;
          onChange();
        });
        return h("span", { className: "segment" }, radio, h("label", { htmlFor: id, textContent: label }));
      }),
    );
    group.setAttribute("aria-label", i18n.t("notifyWhenFor", [fullName(kind)]));
    group.hidden = !reviewTime;
    return group;
  };

  const eventRow = (kind: EventKind) => {
    const setting = settings.events[kind];
    const id = `event-${kind}`;
    const details = h(
      "div",
      { className: "event-details" },
      whenChoice(kind),
      EXCEPTIONS[kind].length ? skipChips(kind) : null,
      ...eventRepos(kind),
    );
    details.hidden = !setting.on;
    const input = switchInput(id, setting.on);
    if (FULL_NAMES[kind]) input.setAttribute("aria-label", fullName(kind));
    input.addEventListener("change", () => {
      setting.on = input.checked;
      details.hidden = !input.checked;
      onChange();
    });
    return h(
      "li",
      { className: "event" },
      h("div", { className: "event-main" }, input, h("label", { htmlFor: id, textContent: EVENT_NAMES[kind] })),
      details,
    );
  };

  const syncQuiet = () => {
    $("#quiet-fields").hidden = !settings.quiet.on;
  };

  const render = () => {
    pickers.clear();
    toggle.checked = settings.enabled;
    body.hidden = !settings.enabled;
    $("#notify-on-hint").textContent = i18n.t("notifyOnHint", [settings.interval]);
    $("#repos-only").replaceChildren(
      picker("notify-repos", i18n.t("notifyReposOnly"), settings.repos, (repos) => (settings.repos = repos)),
    );
    $("#repos-never").replaceChildren(
      picker(
        "notify-repos-never",
        i18n.t("notifyReposNever"),
        settings.excludeRepos,
        (repos) => (settings.excludeRepos = repos),
      ),
    );
    for (const group of GROUPS) $(group.list).replaceChildren(...group.events.map(eventRow));
    interval.value = String(settings.interval);
    quietOn.checked = settings.quiet.on;
    quietFrom.value = settings.quiet.from;
    quietTo.value = settings.quiet.to;
    quietWeekends.checked = settings.quiet.weekends;
    syncQuiet();
    for (const [key, input] of Object.entries(delivery))
      input.checked = settings.delivery[key as keyof typeof delivery];
    $("#notify-sound").replaceChildren(
      soundPicker({ id: "notify-sound-choice", label: i18n.t("soundLabel"), value: settings.delivery.sound, onChange }),
    );
    void permissionSwitch.sync();
  };

  const permissionSwitch = notifySwitch({
    toggle,
    permission,
    allowButton: $("#notify-allow"),
    isOn: () => settings.enabled,
    onToggle: (on) => {
      settings.enabled = on;
      body.hidden = !on;
      onChange();
    },
    say,
  });

  interval.addEventListener("change", () => {
    settings.interval = Number(interval.value) as Interval;
    $("#notify-on-hint").textContent = i18n.t("notifyOnHint", [settings.interval]);
    onChange();
  });
  quietOn.addEventListener("change", () => {
    settings.quiet.on = quietOn.checked;
    syncQuiet();
    onChange();
  });
  for (const [input, key] of [
    [quietFrom, "from"],
    [quietTo, "to"],
  ] as const) {
    input.addEventListener("change", () => {
      if (input.value) settings.quiet[key] = input.value;
      onChange();
    });
  }
  quietWeekends.addEventListener("change", () => {
    settings.quiet.weekends = quietWeekends.checked;
    onChange();
  });
  for (const [key, input] of Object.entries(delivery)) {
    input.addEventListener("change", () => {
      settings.delivery[key as keyof typeof delivery] = input.checked;
      onChange();
    });
  }

  return {
    render: (next: NotifySettings) => {
      settings = structuredClone(next);
      render();
    },
    value: (): NotifySettings => normalizeNotify(settings),
    /** With review times on, each event can wait for the next one. */
    setReviewTime: (on: boolean) => {
      reviewTime = on;
      document.querySelectorAll<HTMLElement>(".event-when").forEach((group) => (group.hidden = !on));
      $("#notify-when-hint").hidden = !on;
    },
    /** Whether every repository typed reads as one; if not, says so at the field, unfolding an event's if need be. */
    check: (): boolean => {
      const wrong = pickers.wrong();
      const panel = wrong[0]?.input.closest<HTMLElement>(".event-repos");
      if (panel?.hidden) {
        panel.hidden = false;
        panel.previousElementSibling?.setAttribute("aria-expanded", "true");
      }
      return wrong.length === 0;
    },
  };
};
