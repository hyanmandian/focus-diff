import { browser } from "wxt/browser";

import type { Message } from "@/utils/messages/messages";
import { isOwnSound, playSound, type SoundSetting } from "@/utils/sound/sound";

const OFFSCREEN = "/offscreen.html";

/** Firefox's background is a page, with audio of its own. */
let context: AudioContext | null = null;
/** Creating the offscreen document twice at once fails; the second waits on the first. */
let creating: Promise<void> | null = null;

/**
 * Chrome's service worker has no audio, so a sound plays in an offscreen document made for it, which Chrome closes
 * again once it's been quiet a while.
 */
const ensureOffscreen = async () => {
  const url = browser.runtime.getURL(OFFSCREEN);
  const existing = await browser.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
  if (existing.length) return;
  creating ??= browser.offscreen
    .createDocument({
      url: OFFSCREEN,
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Plays the notification sound the reader picked.",
    })
    .finally(() => (creating = null));
  await creating;
};

/** Plays the reader's sound, when it's one of ours: the system's own comes with the notification, and none is none. */
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
  } catch {
    // A sound is a nicety; the notification still shows.
  }
};

/** Chrome keeps a notification quiet when asked; it is whenever the sound is ours, or none. */
export const isSilent = ({ id }: SoundSetting): boolean => id !== "system";
