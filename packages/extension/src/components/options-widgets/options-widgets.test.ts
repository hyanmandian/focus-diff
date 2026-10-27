// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { playSound, type SoundSetting } from "@/utils/sound/sound";

vi.mock(import("@/utils/sound/sound"), async (original) => ({
  ...(await original()),
  playSound: vi.fn<() => number>(),
}));

// Its names are read in the reader's language as it loads, once the fake browser speaks it.
const load = () => import("./options-widgets");

const type = (input: HTMLInputElement, value: string, inputType = "insertText") => {
  input.value = value;
  input.dispatchEvent(new InputEvent("input", { inputType }));
};
const key = (input: HTMLElement, name: string) => {
  const event = new KeyboardEvent("keydown", { key: name, cancelable: true });
  input.dispatchEvent(event);
  return event.defaultPrevented;
};
const chips = (element: HTMLElement) =>
  [...element.querySelectorAll(".repo-chip span")].map((chip) => chip.textContent);

beforeEach(() => {
  // happy-dom has no Option constructor.
  vi.stubGlobal("Option", function option(text: string, value: string) {
    return Object.assign(document.createElement("option"), { textContent: text, value });
  });
});
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("switchInput", () => {
  it("is a checkbox read out as a switch", async () => {
    const { switchInput } = await load();
    const input = switchInput("on", true);
    expect(input).toMatchObject({ type: "checkbox", id: "on", checked: true });
    expect(input.getAttribute("role")).toBe("switch");
  });
});

describe("repoPicker", () => {
  const make = async (values: string[] = []) => {
    const { repoPicker } = await load();
    const onChange = vi.fn<(repos: string[]) => void>();
    const picker = repoPicker({ id: "repos", label: "Only in", values, onChange });
    document.body.append(picker.element);
    return { ...picker, onChange };
  };

  it("shows the repositories as chips, labelled", async () => {
    const { element, input } = await make(["a/b"]);
    expect(chips(element)).toEqual(["a/b"]);
    expect(input.getAttribute("aria-label")).toBe("Only in");
    expect(input.getAttribute("aria-describedby")).toBe("repos-error");
    expect(input.placeholder).toBe("owner/name or owner/*");
    expect(element.querySelector(".chip-remove")?.getAttribute("aria-label")).toBe("Remove a/b");
  });

  it("adds what's typed on Enter or a comma, once each", async () => {
    const { element, input, onChange } = await make(["a/b"]);
    input.value = "c/d a/b";
    expect(key(input, "Enter")).toBe(true);
    expect(chips(element)).toEqual(["a/b", "c/d"]);
    expect(input.value).toBe("");
    expect(onChange).toHaveBeenLastCalledWith(["a/b", "c/d"]);
    input.value = "e/*";
    expect(key(input, ",")).toBe(true);
    expect(chips(element)).toEqual(["a/b", "c/d", "e/*"]);
  });

  it("leaves Enter alone on an empty field", async () => {
    const { input, onChange } = await make();
    input.value = "  ";
    expect(key(input, "Enter")).toBe(false);
    expect(key(input, "a")).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps a path that isn't a repository in the field, saying why, until it's fixed", async () => {
    const { element, input, check, onChange } = await make();
    input.value = "nope";
    expect(check()).toBe(false);
    expect(input.value).toBe("nope");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(element.querySelector(".error")?.textContent).toContain("“nope” isn’t a repository path");
    input.value = "";
    expect(check()).toBe(true);
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(element.querySelector(".error")?.textContent).toBe("");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes a chip by its button, or the last one by Backspace on an empty field", async () => {
    const { element, input, onChange } = await make(["a/b", "c/d", "e/f"]);
    element.querySelector<HTMLButtonElement>(".chip-remove")?.click();
    expect(chips(element)).toEqual(["c/d", "e/f"]);
    expect(document.activeElement).toBe(input);
    key(input, "Backspace");
    expect(chips(element)).toEqual(["c/d"]);
    expect(onChange).toHaveBeenLastCalledWith(["c/d"]);
    input.value = "x";
    key(input, "Backspace");
    expect(chips(element)).toEqual(["c/d"]);
  });

  it("does nothing on Backspace with no chips", async () => {
    const { input, onChange } = await make();
    key(input, "Backspace");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("adds a suggestion picked at once, but not what's being typed", async () => {
    const { element, input } = await make();
    type(input, "a/b");
    expect(chips(element)).toEqual([]);
    type(input, "a/b", "insertReplacementText");
    expect(chips(element)).toEqual(["a/b"]);
    input.value = "c/d";
    input.dispatchEvent(new Event("input"));
    expect(chips(element)).toEqual(["a/b", "c/d"]);
  });

  it("adds what's typed on leaving the field", async () => {
    const { element, input } = await make();
    input.value = "a/b";
    input.dispatchEvent(new Event("blur"));
    expect(chips(element)).toEqual(["a/b"]);
  });
});

describe("repoPickers", () => {
  it("tells every change, and checks them all", async () => {
    const { repoPickers } = await load();
    const onChange = vi.fn<() => void>();
    const set = vi.fn<(repos: string[]) => void>();
    const pickers = repoPickers(onChange);
    const element = pickers.picker("one", "One", [], set);
    pickers.picker("two", "Two", [], set);
    const input = element.querySelector("input")!;
    input.value = "a/b";
    input.dispatchEvent(new Event("blur"));
    expect(set).toHaveBeenCalledWith(["a/b"]);
    expect(onChange).toHaveBeenCalledOnce();
    expect(pickers.wrong()).toEqual([]);
    input.value = "wrong";
    expect(pickers.wrong().map((each) => each.input.id)).toEqual(["one"]);
    pickers.clear();
    expect(pickers.wrong()).toEqual([]);
  });
});

describe("soundPicker", () => {
  let resume: () => Promise<void>;

  beforeEach(() => {
    vi.mocked(playSound).mockClear();
    resume = async () => {};
    vi.stubGlobal(
      "AudioContext",
      class {
        resume = () => resume();
      },
    );
  });

  const make = async (value: SoundSetting) => {
    const { soundPicker } = await load();
    const onChange = vi.fn<() => void>();
    const field = soundPicker({ id: "sound", label: "Sound", value, onChange });
    document.body.append(field);
    return {
      field,
      onChange,
      select: field.querySelector("select")!,
      volume: field.querySelector<HTMLInputElement>('input[type="range"]')!,
      play: field.querySelector<HTMLButtonElement>(".sound-play")!,
      hint: field.querySelector<HTMLElement>(".hint")!,
    };
  };
  const settle = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve);
    });

  it("offers every sound, with the picked one selected, labelled", async () => {
    const { field, select, volume, play, hint } = await make({ id: "bowl", volume: 40 });
    expect([...select.options].map((option) => option.value)).toEqual([
      "chime",
      "bowl",
      "marimba",
      "pop",
      "droplet",
      "system",
      "none",
    ]);
    expect(select.options[0]?.textContent).toBe("Chime");
    expect(select.value).toBe("bowl");
    expect(volume.value).toBe("40");
    expect(volume.disabled).toBe(false);
    expect(play.disabled).toBe(false);
    expect(play.getAttribute("aria-label")).toBe("Play the sound");
    expect(hint.hidden).toBe(true);
    expect(field.querySelector("label")?.htmlFor).toBe("sound");
  });

  it("turns the volume off for the system's sound, and says it plays at the system's volume", async () => {
    const { volume, play, hint } = await make({ id: "system", volume: 40 });
    expect(volume.disabled).toBe(true);
    expect(play.disabled).toBe(true);
    expect(hint.hidden).toBe(false);
  });

  it("plays a sound picked, and not the system's or none", async () => {
    const value: SoundSetting = { id: "none", volume: 40 };
    const { select, onChange, hint } = await make(value);
    select.value = "system";
    select.dispatchEvent(new Event("change"));
    expect(value.id).toBe("system");
    expect(hint.hidden).toBe(false);
    expect(onChange).toHaveBeenCalledOnce();
    await settle();
    expect(playSound).not.toHaveBeenCalled();
    select.value = "pop";
    select.dispatchEvent(new Event("change"));
    await settle();
    expect(value.id).toBe("pop");
    expect(playSound).toHaveBeenCalledWith(expect.anything(), "pop", 40);
  });

  it("plays again at the volume picked", async () => {
    const value: SoundSetting = { id: "chime", volume: 40 };
    const { volume, onChange } = await make(value);
    volume.value = "80";
    volume.dispatchEvent(new Event("change"));
    expect(value.volume).toBe(80);
    expect(onChange).toHaveBeenCalledOnce();
    await settle();
    expect(playSound).toHaveBeenCalledWith(expect.anything(), "chime", 80);
  });

  it("plays nothing when the sound changed while the audio woke up", async () => {
    const value: SoundSetting = { id: "marimba", volume: 40 };
    let wake = () => {};
    resume = () =>
      new Promise((resolve) => {
        wake = resolve;
      });
    const { play } = await make(value);
    play.click();
    value.id = "none";
    wake();
    await settle();
    expect(playSound).not.toHaveBeenCalled();
  });

  it("does nothing when the play button is pressed on a sound that isn't ours", async () => {
    const { play } = await make({ id: "none", volume: 40 });
    play.disabled = false;
    play.click();
    await settle();
    expect(playSound).not.toHaveBeenCalled();
  });
});

describe("toggleChip", () => {
  it("is a pressed button that toggles, with a name of its own when given", async () => {
    const { toggleChip } = await load();
    const onToggle = vi.fn<(pressed: boolean) => void>();
    const chip = toggleChip("Mon", false, onToggle, "Monday");
    expect(chip.textContent).toBe("Mon");
    expect(chip.getAttribute("aria-label")).toBe("Monday");
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    chip.click();
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(onToggle).toHaveBeenLastCalledWith(true);
    chip.click();
    expect(onToggle).toHaveBeenLastCalledWith(false);
    expect(toggleChip("All", true, onToggle).hasAttribute("aria-label")).toBe(false);
  });
});

describe("notifySwitch", () => {
  const manifest = (optional?: string[]) => {
    Object.assign(fakeBrowser.runtime, { getManifest: () => ({ optional_permissions: optional }) });
  };

  const make = async ({ on = false, allowed = false, granted = true } = {}) => {
    const { notifySwitch } = await load();
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    const permission = document.createElement("p");
    const allowButton = document.createElement("button");
    // The callback overloads hide the promise ones from vi.spyOn.
    const contains = vi.fn<(permissions: unknown) => Promise<boolean>>().mockResolvedValue(allowed);
    const request = vi.fn<(permissions: unknown) => Promise<boolean>>().mockResolvedValue(granted);
    Object.assign(fakeBrowser.permissions, { contains, request });
    const onToggle = vi.fn<(on: boolean) => void>();
    const say = vi.fn<(text: string, tone: "error") => void>();
    let isOn = on;
    onToggle.mockImplementation((next) => {
      isOn = next;
    });
    const made = notifySwitch({ toggle, permission, allowButton, isOn: () => isOn, onToggle, say });
    return { ...made, toggle, permission, allowButton, contains, request, onToggle, say };
  };
  const settle = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve);
    });
  const flip = (toggle: HTMLInputElement, checked: boolean) => {
    toggle.checked = checked;
    toggle.dispatchEvent(new Event("change"));
  };

  it("asks the browser when turned on, and turns on once allowed", async () => {
    manifest(["notifications"]);
    const { toggle, permission, request, onToggle } = await make({ allowed: true });
    flip(toggle, true);
    await settle();
    expect(request).toHaveBeenCalledWith({ permissions: ["notifications"] });
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(permission.hidden).toBe(true);
  });

  it("stays off, saying so, when the browser says no or fails to ask", async () => {
    manifest(["notifications"]);
    const { toggle, request, onToggle, say } = await make({ granted: false });
    flip(toggle, true);
    await settle();
    expect(toggle.checked).toBe(false);
    expect(onToggle).not.toHaveBeenCalled();
    expect(say).toHaveBeenCalledWith("The browser didn’t allow notifications, so they stay off.", "error");
    request.mockRejectedValue(new Error("no"));
    flip(toggle, true);
    await settle();
    expect(say).toHaveBeenCalledTimes(2);
  });

  it("turns off without asking", async () => {
    manifest(["notifications"]);
    const { toggle, request, onToggle } = await make({ on: true });
    flip(toggle, false);
    await settle();
    expect(request).not.toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("shows a note, on but not allowed here, with a button that asks again", async () => {
    manifest(["notifications"]);
    const { sync, permission, allowButton, contains, request, say } = await make({ on: true });
    await sync();
    expect(permission.hidden).toBe(false);
    request.mockResolvedValue(false);
    allowButton.click();
    await settle();
    expect(say).toHaveBeenCalledOnce();
    request.mockResolvedValue(true);
    contains.mockResolvedValue(true);
    allowButton.click();
    await settle();
    expect(permission.hidden).toBe(true);
  });

  it("hides the note while off", async () => {
    manifest(["notifications"]);
    const { sync, permission } = await make({ on: false });
    await sync();
    expect(permission.hidden).toBe(true);
  });

  it("asks nothing where there are no notifications to ask for, like Safari", async () => {
    manifest();
    const { sync, toggle, permission, contains, request, onToggle } = await make({ on: true });
    await sync();
    expect(permission.hidden).toBe(true);
    flip(toggle, true);
    await settle();
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(request).not.toHaveBeenCalled();
    expect(contains).not.toHaveBeenCalled();
  });
});
