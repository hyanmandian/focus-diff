import { browser } from "wxt/browser";

import type { Message } from "@/utils/messages/messages";
import { isOwnSound, playSound, type SoundSetting } from "@/utils/sound/sound";

const OFFSCREEN = "/offscreen.html";

let context: AudioContext | null = null;
let creating: Promise<void> | null = null;

const ensureOffscreen = async () => {
  const url = browser.runtime.getURL(OFFSCREEN);
  const existing = await browser.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
  if (existing.length > 0) return;
  creating ??= browser.offscreen
    .createDocument({
      url: OFFSCREEN,
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Plays the notification sound the reader picked.",
    })
    .finally(() => {
      creating = null;
    });
  await creating;
};

export const play = async ({ id, volume }: SoundSetting): Promise<void> => {
  if (!isOwnSound(id) || volume <= 0) return;
  try {
    if (import.meta.env.FIREFOX) {
      context ??= new AudioContext();
      await context.resume();
      playSound(context, id, volume);
      return;
    }
    await ensureOffscreen();
    const message: Message = { type: "play-sound", sound: id, volume };
    await browser.runtime.sendMessage(message);
  } catch {}
};

export const isSilent = ({ id }: SoundSetting): boolean => id !== "system";
