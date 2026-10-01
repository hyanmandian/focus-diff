const openOptions = (repo) =>
  chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${repo ? `#repo=${encodeURIComponent(repo)}` : ''}`) });

const openWelcome = () => chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') openWelcome();
});

chrome.action.onClicked.addListener(() => openOptions());

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'open-options') openOptions(message.repo);
  if (message?.type === 'open-welcome') openWelcome();
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  const target = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!target?.id) return;
  chrome.tabs.sendMessage(target.id, { type: 'command', command }).catch(() => {});
});
