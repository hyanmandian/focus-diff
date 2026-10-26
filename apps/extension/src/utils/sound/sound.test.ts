import { describe, expect, it } from "vitest";

import { isOwnSound, normalizeSound, playSound, SOUND_CHOICES, type SoundId } from "./sound";

/** A param that remembers what it was set to and every ramp scheduled on it. */
const param = () => ({
  value: 0,
  events: [] as [string, number, number][],
  setValueAtTime(value: number, at: number) {
    this.events.push(["set", value, at]);
  },
  linearRampToValueAtTime(value: number, at: number) {
    this.events.push(["linear", value, at]);
  },
  exponentialRampToValueAtTime(value: number, at: number) {
    this.events.push(["exponential", value, at]);
  },
});

/** Just enough of an audio context to tell what a sound plays: its oscillators, and what the master gain is set to. */
const fakeContext = () => {
  const oscillators: { type: string; frequency: ReturnType<typeof param>; start: number; stop: number }[] = [];
  const gains: ReturnType<typeof param>[] = [];
  const node = () => ({ connect: (next: unknown) => next });
  const context = {
    currentTime: 10,
    destination: node(),
    createGain: () => {
      const gain = param();
      gains.push(gain);
      return { ...node(), gain };
    },
    createOscillator: () => {
      const oscillator = { type: "sine", frequency: param(), start: 0, stop: 0 };
      oscillators.push(oscillator);
      return {
        ...node(),
        get type() {
          return oscillator.type;
        },
        set type(value: string) {
          oscillator.type = value;
        },
        frequency: oscillator.frequency,
        start: (at: number) => {
          oscillator.start = at;
        },
        stop: (at: number) => {
          oscillator.stop = at;
        },
      };
    },
    createDelay: () => ({ ...node(), delayTime: param() }),
    createBiquadFilter: () => ({ ...node(), type: "", frequency: param() }),
    createDynamicsCompressor: () => ({ ...node(), threshold: param(), ratio: param() }),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in with only what the synths use.
  return { context: context as unknown as BaseAudioContext, oscillators, gains };
};

describe("normalizeSound", () => {
  const fallback = { id: "bowl", volume: 70 } as const;

  it("keeps a known sound and a volume within 0 to 100, rounded", () => {
    expect(normalizeSound({ id: "pop", volume: 33.6 }, fallback)).toEqual({ id: "pop", volume: 34 });
    expect(normalizeSound({ id: "none", volume: 150 }, fallback)).toEqual({ id: "none", volume: 100 });
    expect(normalizeSound({ id: "system", volume: -5 }, fallback)).toEqual({ id: "system", volume: 0 });
  });

  it("falls back for what isn't a sound or a number", () => {
    expect(normalizeSound({ id: "trumpet", volume: "loud" }, fallback)).toEqual(fallback);
    expect(normalizeSound(null, fallback)).toEqual(fallback);
  });
});

describe("isOwnSound", () => {
  it("tells our sounds from the system's and none", () => {
    expect(SOUND_CHOICES.filter((choice) => isOwnSound(choice))).toEqual([
      "chime",
      "bowl",
      "marimba",
      "pop",
      "droplet",
    ]);
  });
});

describe("playSound", () => {
  const sounds: SoundId[] = ["chime", "bowl", "marimba", "pop", "droplet"];

  it.each(sounds)("plays %s just after now and says when it's over, after its last note", (sound) => {
    const { context, oscillators } = fakeContext();
    const end = playSound(context, sound, 50);
    expect(oscillators.length).toBeGreaterThan(0);
    expect(Math.min(...oscillators.map((each) => each.start))).toBeCloseTo(10.02);
    expect(end).toBeGreaterThanOrEqual(Math.max(...oscillators.map((each) => each.stop)));
  });

  it("makes the bowl's partials beat against their twins", () => {
    const { context, oscillators } = fakeContext();
    playSound(context, "bowl", 50);
    expect(oscillators.map((each) => each.frequency.value)).toEqual([
      392,
      393.3,
      392 * 2.76,
      392 * 2.76 + 2.1,
      392 * 5.4,
      392 * 8.93,
    ]);
  });

  it("glides the pop's bubbles upwards", () => {
    const { context, oscillators } = fakeContext();
    playSound(context, "pop", 50);
    expect(oscillators.map((each) => each.frequency.events.map(([, value]) => value))).toEqual([
      [380, 1100],
      [520, 1500],
    ]);
  });

  it("sets the master volume on a curve, clamped to 0 to 100", () => {
    const at = (volume: number) => {
      const { context, gains } = fakeContext();
      playSound(context, "pop", volume);
      return gains[0]!.value;
    };
    expect(at(100)).toBe(1);
    expect(at(150)).toBe(1);
    expect(at(-10)).toBe(0);
    expect(at(50)).toBeCloseTo(0.5 ** 1.6);
  });
});
