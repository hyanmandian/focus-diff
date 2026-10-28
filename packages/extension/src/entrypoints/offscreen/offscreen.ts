import { browser } from "wxt/browser";

import type { Message } from "@/utils/messages/messages";
import { playSound } from "@/utils/sound/sound";

let context: AudioContext | null = null;

browser.runtime.onMessage.addListener((message: Message) => {
  if (message?.type !== "play-sound") return;
  context ??= new AudioContext();
  void context.resume().then(() => context && playSound(context, message.sound, message.volume));
});
