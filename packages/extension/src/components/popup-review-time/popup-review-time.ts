import { browser } from "wxt/browser";

import { i18n } from "#i18n";
import { checkIcon, clockIcon, closeIcon } from "@/components/icons/icons";
import { h } from "@/utils/dom/dom";
import { uiLanguage } from "@/utils/i18n/i18n";
import type { HeldEvent } from "@/utils/inbox/inbox";
import type { Message } from "@/utils/messages/messages";
import {
  MINUTE_PRESETS,
  nextOccurrence,
  minutesLeft,
  runEndsAt,
  type ReviewRun,
  type ReviewTimeSettings,
  type RunPull,
} from "@/utils/review-sessions/review-sessions";

const language = uiLanguage();
const clock = (time: number) => new Intl.DateTimeFormat(language, { hour: "numeric", minute: "2-digit" }).format(time);

export interface ReviewState {
  settings: ReviewTimeSettings;
  run: ReviewRun | null;
  waiting: Set<string>;
  held: HeldEvent[];
  skipUntil: number;
}

interface Options {
  avatar: (login: string) => HTMLElement;
  openOptions: (section: string) => void;
  skip: (until: number) => void;
  close: () => void;
}

const send = (message: Message) => browser.runtime.sendMessage(message).catch(() => false);

let minutesNow = 30;
let sessionNow = "";
let starting = false;
let nothingNow = false;

const runRow = (pull: RunPull, reviewed: boolean, avatar: Options["avatar"]) => {
  const link = h(
    "a",
    {
      className: `pull${reviewed ? " reviewed" : ""}`,
      href: `${pull.url}/changes`,
      target: "_blank",
      rel: "noopener",
      "data-repo": pull.repo,
      "data-url": pull.url,
    },
    reviewed ? h("span", { className: "avatar done-mark", "aria-hidden": "true" }, checkIcon()) : avatar(pull.author),
    h(
      "span",
      { className: "pull-body" },
      h("span", { className: "pull-title", textContent: pull.title }),
      h(
        "span",
        { className: "pull-line" },
        h(
          "span",
          { className: "pull-meta" },
          h("span", {
            className: "repo-number",
            textContent: `${pull.repo.slice(pull.repo.lastIndexOf("/") + 1)}#${pull.number}`,
          }),
          pull.author ? h("span", { className: "pull-author", textContent: pull.author }) : null,
        ),
        pull.again ? h("span", { className: "pull-draft pull-again", textContent: i18n.t("popupAgain") }) : null,
      ),
      reviewed ? h("span", { className: "visually-hidden", textContent: i18n.t("popupReviewed") }) : null,
    ),
    h(
      "span",
      { className: "pull-side" },
      h("span", { className: "estimate", textContent: i18n.t("popupAbout", [pull.minutes]) }),
      h("span", {
        className: "pull-time",
        textContent: pull.files === null ? i18n.t("popupSizeUnknown") : i18n.t("popupFiles", pull.files, [pull.files]),
      }),
    ),
  );
  return h("li", { className: "run-row" }, link);
};

const heldSection = (held: HeldEvent[]) => {
  if (held.length === 0) return null;
  return h(
    "section",
    { className: "held", "aria-labelledby": "held-title" },
    h(
      "h2",
      { className: "group-title", id: "held-title" },
      h("span", { textContent: i18n.t("popupHeld") }),
      h("span", { className: "group-count", textContent: String(held.length) }),
    ),
    h(
      "ul",
      { className: "held-list", role: "list" },
      ...held.map((event) =>
        h(
          "li",
          {},
          h(
            "a",
            { className: "held-link", href: event.url, target: "_blank", rel: "noopener" },
            h("span", { className: "pull-title", textContent: event.title }),
            h("span", {
              className: "pull-meta",
              textContent: `${event.repo}#${event.number}${event.actor ? ` · ${event.actor}` : ""}`,
            }),
          ),
        ),
      ),
    ),
  );
};

const elapsedPercent = (minutes: number, startedAt: number) =>
  Math.min(100, Math.round(((Date.now() - startedAt) / (minutes * 60_000)) * 100));

const runHead = (run: ReviewRun, reviewed: number) => {
  const total = run.pulls.reduce((sum, pull) => sum + pull.minutes, 0);
  const { startedAt } = run;
  const started = startedAt !== null;
  const left = minutesLeft(run);
  const elapsed = started ? elapsedPercent(run.minutes, startedAt) : 0;
  const head = h(
    "div",
    { className: "run-head" },
    h(
      "div",
      { className: "run-title" },
      h("span", { className: "run-icon", "aria-hidden": "true" }, clockIcon()),
      h("h2", { textContent: run.name, tabIndex: -1 }),
      h("span", {
        className: "run-clock",
        textContent: started ? i18n.t("popupLeft", [left]) : i18n.t("popupSetAside", [run.minutes]),
      }),
    ),
  );
  if (started) {
    const bar = h("div", { className: "run-bar", role: "progressbar" }, h("span", { style: `--done: ${elapsed}%` }));
    bar.setAttribute("aria-label", i18n.t("popupTimeUsed"));
    bar.setAttribute("aria-valuenow", String(elapsed));
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuetext", i18n.t("popupEndsAt", [clock(runEndsAt(run))]));
    head.append(bar);
  }
  head.append(
    h(
      "p",
      { className: "run-summary" },
      run.pulls.length > 0
        ? started
          ? i18n.t("popupReviewedOf", run.pulls.length, [reviewed, run.pulls.length, total])
          : i18n.t("popupPicked", run.pulls.length, [run.pulls.length, total])
        : i18n.t("popupNothingPicked"),
      run.left ? ` ${i18n.t("popupLeftOut", run.left, [run.left])}` : "",
    ),
  );
  if (run.overBy)
    head.append(
      h("p", {
        className: "run-over",
        role: "note",
        textContent: i18n.t("reviewTimeOver", [run.pulls[0]?.minutes ?? 0, run.overBy, run.minutes]),
      }),
    );
  const actions = h("div", { className: "run-actions" });
  if (started) {
    const end = h("button", { type: "button", className: "button quiet", textContent: i18n.t("popupEnd") });
    end.addEventListener("click", () => void send({ type: "review-end" }));
    actions.append(end);
  } else if (run.pulls.length === 0) {
    const dismiss = h("button", { type: "button", className: "button quiet", textContent: i18n.t("popupDismiss") });
    dismiss.addEventListener("click", () => void send({ type: "review-skip" }));
    actions.append(dismiss);
  } else {
    const start = h("button", { type: "button", className: "button", textContent: i18n.t("reviewTimeStart") });
    start.addEventListener("click", () => void send({ type: "review-start" }));
    const later = h("button", { type: "button", className: "button quiet", textContent: i18n.t("popupLater") });
    later.addEventListener("click", () => void send({ type: "review-snooze" }));
    const skip = h("button", { type: "button", className: "text-button quiet", textContent: i18n.t("popupSkip") });
    skip.addEventListener("click", () => void send({ type: "review-skip" }));
    actions.append(start, later, skip);
  }
  head.append(actions);
  return head;
};

const when = (time: number) =>
  new Intl.DateTimeFormat(language, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(time);

const nextLine = (settings: ReviewTimeSettings, skipUntil: number, skip: Options["skip"]) => {
  const now = Date.now();
  const skipping = skipUntil > now;
  const next = nextOccurrence(settings, Math.max(now, skipUntil - 1));
  const line = h("div", { className: "run-next" });
  if (skipping) {
    const resume = h("button", { type: "button", className: "text-button", textContent: i18n.t("popupResume") });
    resume.addEventListener("click", () => {
      skip(0);
    });
    line.append(
      h("span", { textContent: next ? i18n.t("popupSkippingTo", [when(next.at)]) : i18n.t("popupSkipping") }),
      resume,
    );
    return line;
  }
  if (!next) return null;
  const skipNext = h("button", { type: "button", className: "text-button", textContent: i18n.t("popupSkipNext") });
  skipNext.addEventListener("click", () => {
    skip(next.at + 1);
  });
  const today = new Date(now);
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
  const rest = h("button", { type: "button", className: "text-button", textContent: i18n.t("popupSkipToday") });
  rest.addEventListener("click", () => {
    skip(tomorrow);
  });
  line.append(
    h("span", {
      textContent: i18n.t("popupNext", [
        when(next.at),
        next.session.name || i18n.t("reviewTimeName"),
        next.session.minutes,
      ]),
    }),
    skipNext,
    nextOccurrence(settings, next.at)!.at < tomorrow ? rest : "",
  );
  return line;
};

const startForm = (state: ReviewState, options: Options, render: () => void) => {
  const { settings } = state;
  const close = h(
    "button",
    { type: "button", className: "icon-button run-close", title: i18n.t("popupClose") },
    closeIcon(),
  );
  close.setAttribute("aria-label", i18n.t("popupClose"));
  close.addEventListener("click", options.close);
  const form = h("div", { className: "run-head" });
  form.append(
    h(
      "div",
      { className: "run-title" },
      h("span", { className: "run-icon", "aria-hidden": "true" }, clockIcon()),
      h("h2", { textContent: i18n.t("popupReviewNow"), tabIndex: -1 }),
      close,
    ),
  );
  const presets = h("div", { className: "filters minutes", role: "group" });
  presets.setAttribute("aria-label", i18n.t("popupHowLong"));
  presets.append(
    ...MINUTE_PRESETS.map((minutes) => {
      const chip = h("button", {
        type: "button",
        className: "chip",
        textContent: i18n.t("reviewMinutesShort", [minutes]),
      });
      chip.setAttribute("aria-pressed", String(minutesNow === minutes));
      chip.addEventListener("click", () => {
        minutesNow = minutes;
        render();
        document.querySelector<HTMLElement>('.minutes [aria-pressed="true"]')?.focus();
      });
      return chip;
    }),
  );
  form.append(h("p", { className: "field-label", textContent: i18n.t("popupHowLong") }), presets);
  if (settings.sessions.length > 0) {
    const like = h(
      "select",
      { id: "review-like" },
      new Option(i18n.t("popupLikeDefaults"), ""),
      ...settings.sessions.map((session) => new Option(session.name || i18n.t("reviewTimeName"), session.id)),
    );
    like.value = sessionNow;
    like.addEventListener("change", () => {
      sessionNow = like.value;
      const minutes = settings.sessions.find((session) => session.id === sessionNow)?.minutes;
      if (minutes) minutesNow = minutes;
      render();
      document.querySelector<HTMLElement>("#review-like")?.focus();
    });
    form.append(
      h(
        "div",
        { className: "inline-field" },
        h("label", { htmlFor: "review-like", textContent: i18n.t("popupLike") }),
        like,
      ),
    );
  }
  const start = h("button", {
    type: "button",
    className: "button",
    textContent: i18n.t(starting ? "popupPicking" : "reviewTimeStart"),
  });
  start.disabled = starting;
  start.setAttribute("aria-busy", String(starting));
  const startNow = async () => {
    starting = true;
    nothingNow = false;
    render();
    nothingNow = (await send({ type: "review-start-now", minutes: minutesNow, session: sessionNow })) === false;
    starting = false;
    render();
    document.querySelector<HTMLElement>(nothingNow ? "#review-card .button" : "#review-card h2")?.focus();
  };
  start.addEventListener("click", () => void startNow());
  const setup = h("button", {
    type: "button",
    className: "text-button quiet",
    textContent: i18n.t(settings.enabled ? "popupReviewSettings" : "popupReviewSetup"),
  });
  setup.addEventListener("click", () => {
    options.openOptions("review-time");
  });
  form.append(h("div", { className: "run-actions" }, start, setup));
  if (nothingNow) form.append(h("p", { className: "run-next", textContent: i18n.t("popupNothingPicked") }));
  if (settings.enabled) form.append(nextLine(settings, state.skipUntil, options.skip) ?? "");
  return form;
};

const tick = (card: HTMLElement, run: ReviewRun) => {
  if (!run.startedAt) return;
  const left = minutesLeft(run);
  const elapsed = elapsedPercent(run.minutes, run.startedAt);
  const clockText = card.querySelector(".run-clock");
  if (clockText) clockText.textContent = i18n.t("popupLeft", [left]);
  card.querySelector<HTMLElement>(".run-bar span")?.style.setProperty("--done", `${elapsed}%`);
  card.querySelector(".run-bar")?.setAttribute("aria-valuenow", String(elapsed));
};

let drawn = "";

export const renderReviewPanel = (
  card: HTMLElement,
  state: ReviewState,
  options: Options,
  render: () => void,
): void => {
  const { run, waiting, held } = state;
  const key = JSON.stringify([
    state.settings,
    run,
    held,
    [...waiting],
    state.skipUntil,
    minutesNow,
    sessionNow,
    starting,
    nothingNow,
  ]);
  if (key === drawn && card.childElementCount) {
    if (run) tick(card, run);
    return;
  }
  drawn = key;
  if (!run) {
    card.replaceChildren(startForm(state, options, render), heldSection(held) ?? "");
    return;
  }
  const reviewed = run.pulls.filter((pull) => !waiting.has(pull.url)).length;
  const list = h(
    "ul",
    { className: "pulls run-pulls", role: "list" },
    ...run.pulls.map((pull) => runRow(pull, !waiting.has(pull.url), options.avatar)),
  );
  card.replaceChildren(runHead(run, reviewed), list, heldSection(held) ?? "");
};
