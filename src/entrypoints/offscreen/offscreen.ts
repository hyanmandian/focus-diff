import { browser } from 'wxt/browser';
import type { Message } from '@/utils/messages';
import { playSound } from '@/utils/sound/sound';

/** Chrome's service worker has no audio: it asks this page, made only for that, to play its sounds. */
let context: AudioContext | null = null;

browser.runtime.onMessage.addListener((message: Message) => {
  if (message?.type !== 'play-sound') return;
  context ??= new AudioContext();
  void context.resume().then(() => context && playSound(context, message.sound, message.volume));
});
