import { asRecord } from "@/utils/record/record";

/**
 * Focus Diff's own sounds, made on the spot with the Web Audio API: no audio files, no libraries. Each is a few
 * oscillators shaped by envelopes, short and soft, so a notification is heard without startling anyone.
 */

const SOUNDS = ["chime", "bowl", "marimba", "pop", "droplet"] as const;
export type SoundId = (typeof SOUNDS)[number];

/** One of ours, the system's own notification sound, or none at all. */
export type SoundChoice = SoundId | "system" | "none";
export const SOUND_CHOICES: SoundChoice[] = [...SOUNDS, "system", "none"];

export interface SoundSetting {
  id: SoundChoice;
  /** 0 to 100. */
  volume: number;
}

export const isOwnSound = (choice: SoundChoice): choice is SoundId => (SOUNDS as readonly string[]).includes(choice);

export const normalizeSound = (value: unknown, fallback: SoundSetting): SoundSetting => {
  const raw = asRecord(value);
  const id = SOUND_CHOICES.find((choice) => choice === raw.id) ?? fallback.id;
  const volume = Number(raw.volume);
  return { id, volume: Number.isFinite(volume) ? Math.min(100, Math.max(0, Math.round(volume))) : fallback.volume };
};

interface Partial {
  /** A multiple of the note's frequency. */
  ratio: number;
  gain: number;
  /** Seconds to fade to silence. */
  decay: number;
  type?: OscillatorType;
  /** Hz off the exact ratio, for a slow shimmer against a twin. */
  detune?: number;
}

/** One struck note: its partials start together with a quick attack and fade each at their own pace. */
const strike = (
  context: BaseAudioContext,
  out: AudioNode,
  frequency: number,
  at: number,
  partials: Partial[],
  attack = 0.004,
) => {
  let end = at;
  for (const { ratio, gain, decay, type = "sine", detune = 0 } of partials) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency * ratio + detune;
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(gain, at + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    oscillator.connect(envelope).connect(out);
    oscillator.start(at);
    oscillator.stop(at + attack + decay + 0.05);
    end = Math.max(end, at + attack + decay + 0.05);
  }
  return end;
};

/** A note whose pitch glides, like a bubble's or a drop's. */
const glide = (
  context: BaseAudioContext,
  out: AudioNode,
  from: number,
  to: number,
  at: number,
  length: number,
  gain: number,
) => {
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.frequency.setValueAtTime(from, at);
  oscillator.frequency.exponentialRampToValueAtTime(to, at + length * 0.6);
  envelope.gain.setValueAtTime(0, at);
  envelope.gain.linearRampToValueAtTime(gain, at + 0.006);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + length);
  oscillator.connect(envelope).connect(out);
  oscillator.start(at);
  oscillator.stop(at + length + 0.02);
  return at + length + 0.02;
};

/** A soft echo after the sound, filtered darker each time round, so it rings in a room instead of in a box. */
const room = (context: BaseAudioContext, out: AudioNode) => {
  const input = context.createGain();
  const delay = context.createDelay(1);
  const feedback = context.createGain();
  const tone = context.createBiquadFilter();
  const wet = context.createGain();
  delay.delayTime.value = 0.16;
  feedback.gain.value = 0.28;
  tone.type = "lowpass";
  tone.frequency.value = 2400;
  wet.gain.value = 0.3;
  input.connect(out);
  input.connect(delay).connect(tone).connect(feedback).connect(delay);
  tone.connect(wet).connect(out);
  return input;
};

const SYNTHS: Record<SoundId, (context: BaseAudioContext, out: AudioNode, at: number) => number> = {
  /** Two bell-like notes a fifth apart, rising: something new. */
  chime: (context, out, at) => {
    const bell: Partial[] = [
      { ratio: 1, gain: 0.5, decay: 1.1 },
      { ratio: 2, gain: 0.12, decay: 0.6 },
      { ratio: 3.01, gain: 0.05, decay: 0.3 },
    ];
    const wet = room(context, out);
    strike(context, wet, 1046.5, at, bell);
    return strike(context, wet, 1568, at + 0.13, bell) + 0.5;
  },
  /** A singing bowl: inharmonic partials, each beating slowly against a twin. Time to focus. */
  bowl: (context, out, at) => {
    const partials: Partial[] = [
      { ratio: 1, gain: 0.32, decay: 3.2 },
      { ratio: 1, gain: 0.2, decay: 3, detune: 1.3 },
      { ratio: 2.76, gain: 0.14, decay: 2 },
      { ratio: 2.76, gain: 0.08, decay: 1.8, detune: 2.1 },
      { ratio: 5.4, gain: 0.05, decay: 1 },
      { ratio: 8.93, gain: 0.02, decay: 0.5 },
    ];
    return strike(context, out, 392, at, partials, 0.012);
  },
  /** Three wooden notes up a major chord. */
  marimba: (context, out, at) => {
    const bar: Partial[] = [
      { ratio: 1, gain: 0.42, decay: 0.55 },
      { ratio: 3.93, gain: 0.07, decay: 0.12 },
      { ratio: 9.2, gain: 0.02, decay: 0.05 },
    ];
    const wet = room(context, out);
    let end = at;
    [783.99, 987.77, 1174.66].forEach((frequency, index) => {
      end = strike(context, wet, frequency, at + index * 0.085, bar, 0.003);
    });
    return end + 0.4;
  },
  /** Two quick bubbles, the second higher. */
  pop: (context, out, at) => {
    glide(context, out, 380, 1100, at, 0.09, 0.8);
    return glide(context, out, 520, 1500, at + 0.1, 0.09, 0.65);
  },
  /** A drop into still water, and its smaller echo. */
  droplet: (context, out, at) => {
    const wet = room(context, out);
    glide(context, wet, 1100, 2300, at, 0.16, 1);
    return glide(context, wet, 1500, 2900, at + 0.12, 0.12, 0.45) + 0.5;
  },
};

/** Plays a sound at `volume`, 0 to 100, and says when it's over, in the context's time. */
export const playSound = (context: BaseAudioContext, sound: SoundId, volume: number): number => {
  const master = context.createGain();
  // Loudness isn't linear in gain: a curve makes the slider's middle sound like the middle.
  master.gain.value = (Math.min(100, Math.max(0, volume)) / 100) ** 1.6;
  // A gentle limiter, so no sound clips at full volume however its notes add up.
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.ratio.value = 12;
  master.connect(limiter).connect(context.destination);
  return SYNTHS[sound](context, master, context.currentTime + 0.02);
};
