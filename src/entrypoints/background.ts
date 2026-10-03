import { defineBackground } from '#imports';
import { browser } from 'wxt/browser';
import type { Command, Message } from '@/utils/messages';
import { updateItem } from '@/utils/storage/storage';

/** Patch releases only fix things, so only a new minor or major version is worth telling the reader about. */
const isNotable = (previous: string, current: string) =>
  previous.split('.').slice(0, 2).join('.') !== current.split('.').slice(0, 2).join('.');

/**
 * Reuses an open settings tab instead of piling up copies that could overwrite each other. Finding the tab by its URL
 * would need the tabs permission, so the open page is asked to come forward instead.
 */
const openOptions = async (repo?: string | null) => {
  const message: Message = { type: 'show-options', repo };
  const shown = await browser.runtime.sendMessage(message).catch(() => false);
  if (shown === true) return;
  const url = browser.runtime.getURL(`/options.html${repo ? `#repo=${encodeURIComponent(repo)}` : ''}`);
  await browser.tabs.create({ url });
};

const openWelcome = () => browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') });

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
    if (reason === 'install') void openWelcome();
    const { version } = browser.runtime.getManifest();
    if (reason === 'update' && previousVersion && isNotable(previousVersion, version)) void updateItem.setValue(version);
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
