import { defineBackground } from '#imports';
import { browser } from 'wxt/browser';
import type { Command, Message } from '@/utils/messages';

const openOptions = (repo?: string | null) =>
  browser.tabs.create({ url: browser.runtime.getURL(`/options.html${repo ? `#repo=${encodeURIComponent(repo)}` : ''}`) });

const openWelcome = () => browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') });

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') void openWelcome();
  });

  browser.action.onClicked.addListener(() => void openOptions());

  browser.runtime.onMessage.addListener((message: Message) => {
    if (message?.type === 'open-options') void openOptions(message.repo);
    if (message?.type === 'open-welcome') void openWelcome();
  });

  browser.commands.onCommand.addListener(async (command, tab) => {
    const target = tab ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0];
    if (!target?.id) return;
    const message: Message = { type: 'command', command: command as Command };
    await browser.tabs.sendMessage(target.id, message).catch(() => {});
  });
});
