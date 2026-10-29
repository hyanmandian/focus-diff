import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

const load = () => {
  vi.resetModules();
  return import("./background-sound");
};

describe("isSilent", () => {
  it("keeps the notification quiet unless the sound is the system's", async () => {
    const { isSilent } = await load();
    expect(isSilent({ id: "bowl", volume: 50 })).toBe(true);
    expect(isSilent({ id: "none", volume: 50 })).toBe(true);
    expect(isSilent({ id: "system", volume: 50 })).toBe(false);
  });
});

describe("play on Chrome", () => {
  const getContexts = vi.fn<() => Promise<unknown[]>>();
  const sent: unknown[] = [];

  beforeEach(() => {
    vi.stubEnv("FIREFOX", "");
    sent.length = 0;
    getContexts.mockResolvedValue([]);
    Object.assign(fakeBrowser.runtime, { getContexts });
    fakeBrowser.runtime.onMessage.addListener((message) => {
      sent.push(message);
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const documentMaker = (make: () => Promise<void>) => {
    const createDocument = vi.fn<(parameters: unknown) => Promise<void>>(make);
    Object.assign(fakeBrowser.offscreen, { createDocument });
    return createDocument;
  };

  it("opens an offscreen document once, and asks it to play", async () => {
    const createDocument = documentMaker(() => {
      getContexts.mockResolvedValue([{}]);
      return Promise.resolve();
    });
    const { play } = await load();
    await play({ id: "chime", volume: 40 });
    await play({ id: "pop", volume: 60 });
    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ url: "/offscreen.html", reasons: ["AUDIO_PLAYBACK"] }),
    );
    expect(sent).toEqual([
      { type: "play-sound", sound: "chime", volume: 40 },
      { type: "play-sound", sound: "pop", volume: 60 },
    ]);
  });

  it("makes the document only once when two sounds start together", async () => {
    let finish = () => {};
    const createDocument = documentMaker(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { play } = await load();
    const both = Promise.all([play({ id: "chime", volume: 40 }), play({ id: "bowl", volume: 40 })]);
    await vi.waitFor(() => {
      expect(createDocument).toHaveBeenCalled();
    });
    finish();
    await both;
    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(2);
  });

  it("plays nothing for the system's sound, none, or no volume", async () => {
    const { play } = await load();
    await play({ id: "system", volume: 50 });
    await play({ id: "none", volume: 50 });
    await play({ id: "bowl", volume: 0 });
    expect(getContexts).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("says nothing when the sound can't play", async () => {
    vi.spyOn(fakeBrowser.offscreen, "createDocument").mockRejectedValue(new Error("nope"));
    const { play } = await load();
    await expect(play({ id: "bowl", volume: 50 })).resolves.toBeUndefined();
    expect(sent).toEqual([]);
  });
});

describe("play on Firefox", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("plays in the background page's own audio, made once", async () => {
    vi.stubEnv("FIREFOX", "true");
    const playSound = vi.fn<(context: unknown, sound: string, volume: number) => number>();
    vi.doMock("@/utils/sound/sound", async (original) => ({ ...(await original<object>()), playSound }));
    const resume = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const made = vi.fn<() => void>();
    vi.stubGlobal(
      "AudioContext",
      class {
        resume = resume;
        constructor() {
          made();
        }
      },
    );
    const { play } = await load();
    await play({ id: "marimba", volume: 30 });
    await play({ id: "pop", volume: 80 });
    expect(made).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(2);
    expect(playSound.mock.calls.map(([, sound, volume]) => [sound, volume])).toEqual([
      ["marimba", 30],
      ["pop", 80],
    ]);
    vi.doUnmock("@/utils/sound/sound");
    vi.unstubAllGlobals();
  });
});
