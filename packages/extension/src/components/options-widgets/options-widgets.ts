import { browser, type Browser } from "wxt/browser";

import { i18n } from "#i18n";
import { closeIcon, playIcon } from "@/components/icons/icons";
import { h } from "@/utils/dom/dom";
import { invalidRepos, splitRepos } from "@/utils/inbox/inbox";
import { oneOf } from "@/utils/record/record";
import { isOwnSound, playSound, SOUND_CHOICES, type SoundChoice, type SoundSetting } from "@/utils/sound/sound";

/** Settings' controls shared by its sections. */

export const switchInput = (id: string, checked: boolean): HTMLInputElement => {
  const input = h("input", { type: "checkbox", className: "switch", id, checked });
  input.setAttribute("role", "switch");
  return input;
};

interface RepoPickerOptions {
  id: string;
  label: string;
  values: string[];
  onChange: (repos: string[]) => void;
}

/**
 * Repositories as chips, each with a way to remove it, and a field to add one: typed, or picked from the ones the
 * reader has pull requests in. A path that doesn't read as one stays in the field, saying why.
 */
export const repoPicker = ({ id, label, values, onChange }: RepoPickerOptions) => {
  let repos = [...values];
  const chips = h("ul", { className: "repo-chips", role: "list" });
  const input = h("input", {
    type: "text",
    id,
    className: "mono",
    spellcheck: false,
    autocomplete: "off",
    placeholder: i18n.t("notifyReposAdd"),
  });
  input.setAttribute("list", "repo-suggestions");
  input.setAttribute("aria-label", label);
  const error = h("p", { className: "error", id: `${id}-error`, "aria-live": "polite" });
  input.setAttribute("aria-describedby", error.id);

  const update = (next: string[]) => {
    repos = next;
    drawChips();
    onChange(repos);
  };
  const drawChips = () => {
    chips.replaceChildren(
      ...repos.map((repo) => {
        const remove = h("button", { type: "button", className: "chip-remove" }, closeIcon());
        remove.setAttribute("aria-label", i18n.t("removeNamed", [repo]));
        remove.addEventListener("click", () => {
          update(repos.filter((each) => each !== repo));
          input.focus();
        });
        return h("li", { className: "repo-chip" }, h("span", { className: "mono", textContent: repo }), remove);
      }),
    );
  };

  /** Adds what's typed; false when some of it isn't a repository path, which stays in the field. */
  const add = (): boolean => {
    const typed = splitRepos(input.value);
    const wrong = invalidRepos(typed)[0];
    error.textContent = wrong ? i18n.t("errorRepos", [wrong]) : "";
    if (wrong) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
    if (wrong || typed.length === 0) return !wrong;
    input.value = "";
    update([...new Set([...repos, ...typed])]);
    return true;
  };

  input.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === ",") && input.value.trim()) {
      event.preventDefault();
      add();
    }
    if (event.key === "Backspace" && !input.value && repos.length > 0) update(repos.slice(0, -1));
  });
  // Picking a suggestion fills the field whole; it's added at once.
  input.addEventListener("input", (event) => {
    if (!(event instanceof InputEvent) || event.inputType === "insertReplacementText") add();
  });
  input.addEventListener("blur", () => {
    add();
  });

  drawChips();
  const element = h("div", { className: "repo-field" }, h("div", { className: "repo-picker" }, chips, input), error);
  return { element, check: add, input };
};

/** Repository pickers that each tell `onChange`, kept together to check them all before saving. */
export const repoPickers = (onChange: () => void) => {
  let made: ReturnType<typeof repoPicker>[] = [];
  return {
    picker: (id: string, label: string, values: string[], set: (repos: string[]) => void): HTMLElement => {
      const one = repoPicker({
        id,
        label,
        values,
        onChange: (repos) => {
          set(repos);
          onChange();
        },
      });
      made.push(one);
      return one.element;
    },
    /** Before drawing them again. */
    clear: () => (made = []),
    /** The ones with something wrong typed in, each saying so at its field. */
    wrong: () => made.filter((each) => !each.check()),
  };
};

const SOUND_NAMES: Record<SoundChoice, string> = {
  chime: i18n.t("soundChime"),
  bowl: i18n.t("soundBowl"),
  marimba: i18n.t("soundMarimba"),
  pop: i18n.t("soundPop"),
  droplet: i18n.t("soundDroplet"),
  system: i18n.t("soundSystem"),
  none: i18n.t("soundNone"),
};

let preview: AudioContext | null = null;

/**
 * A sound to pick, how loud, and a button to hear it. The volume is only for our own sounds: the system's plays at the
 * system's volume, and none at none.
 */
export const soundPicker = ({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: SoundSetting;
  onChange: () => void;
}) => {
  const select = h("select", { id }, ...SOUND_CHOICES.map((choice) => new Option(SOUND_NAMES[choice], choice)));
  select.value = value.id;
  const volume = h("input", {
    type: "range",
    id: `${id}-volume`,
    min: 0,
    max: 100,
    step: 5,
    value: String(value.volume),
  });
  volume.setAttribute("aria-label", i18n.t("soundVolume"));
  const play = h("button", { type: "button", className: "icon-btn sound-play" }, playIcon());
  play.setAttribute("aria-label", i18n.t("soundPlay"));
  play.title = i18n.t("soundPlay");
  const hint = h("p", { className: "hint", id: `${id}-hint`, textContent: i18n.t("soundSystemHint") });
  const sync = () => {
    const own = isOwnSound(value.id);
    volume.disabled = !own;
    play.disabled = !own;
    hint.hidden = value.id !== "system";
  };
  select.addEventListener("change", () => {
    value.id = oneOf(SOUND_CHOICES, select.value, value.id);
    sync();
    onChange();
    if (isOwnSound(value.id)) play.click();
  });
  volume.addEventListener("change", () => {
    value.volume = Number(volume.value);
    onChange();
    play.click();
  });
  play.addEventListener("click", () => {
    if (!isOwnSound(value.id)) return;
    const context = (preview ??= new AudioContext());
    void context.resume().then(() => isOwnSound(value.id) && playSound(context, value.id, value.volume));
  });
  sync();
  return h(
    "div",
    { className: "sound-field" },
    h("label", { htmlFor: id, textContent: label }),
    h("div", { className: "sound-controls" }, select, play, volume),
    hint,
  );
};

/** Buttons that are pressed or not, in a labelled group; for choices that are many, like days, or one of a few. */
export const toggleChip = (label: string, pressed: boolean, onToggle: (pressed: boolean) => void, name?: string) => {
  const chip = h("button", { type: "button", className: "skip-chip", textContent: label });
  if (name) chip.setAttribute("aria-label", name);
  chip.setAttribute("aria-pressed", String(pressed));
  chip.addEventListener("click", () => {
    const next = chip.getAttribute("aria-pressed") !== "true";
    chip.setAttribute("aria-pressed", String(next));
    onToggle(next);
  });
  return chip;
};

/** Safari has no notifications for extensions; there, nothing is asked. */
const canNotify = () => Boolean(browser.runtime.getManifest().optional_permissions?.includes("notifications"));
const PERMISSION: Browser.permissions.Permissions = { permissions: ["notifications"] };

/**
 * A switch that turns on something that notifies: turning it on asks the browser for notifications first, and stays
 * off if it says no. On but not allowed in this browser, like after syncing from another one, a note says so, with a
 * button to allow them.
 */
// Asked from the click itself: browsers only show the prompt for something the reader just did.
const allow = (): Promise<boolean> =>
  canNotify() ? browser.permissions.request(PERMISSION).catch(() => false) : Promise.resolve(true);

export const notifySwitch = ({
  toggle,
  permission,
  allowButton,
  isOn,
  onToggle,
  say,
}: {
  toggle: HTMLInputElement;
  permission: HTMLElement;
  allowButton: HTMLElement;
  isOn: () => boolean;
  onToggle: (on: boolean) => void;
  say: (text: string, tone: "error") => void;
}) => {
  const sync = async () => {
    const allowed = !canNotify() || (await browser.permissions.contains(PERMISSION));
    permission.hidden = !isOn() || allowed;
  };
  const toggleOn = async () => {
    if (toggle.checked && !(await allow())) {
      toggle.checked = false;
      say(i18n.t("notifyDenied"), "error");
      return;
    }
    onToggle(toggle.checked);
    void sync();
  };
  toggle.addEventListener("change", () => void toggleOn());
  const askAgain = async () => {
    if (await allow()) void sync();
    else say(i18n.t("notifyDenied"), "error");
  };
  allowButton.addEventListener("click", () => void askAgain());
  return { sync };
};
