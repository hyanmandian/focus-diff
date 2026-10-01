if (typeof FocusDiff === 'undefined') importScripts('shared.js');

const openOptions = (repo) =>
  chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${repo ? `#repo=${encodeURIComponent(repo)}` : ''}`) });

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;
  const config = await FocusDiff.load();
  if (FocusDiff.isEmpty(config)) await FocusDiff.save(FocusDiff.EXAMPLE_CONFIG);
  openOptions();
});

chrome.action.onClicked.addListener(() => openOptions());

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'open-options') openOptions(message.repo);
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  const target = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!target?.id) return;
  chrome.tabs.sendMessage(target.id, { type: 'command', command }).catch(() => {});
});
