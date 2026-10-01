importScripts('shared.js');

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
