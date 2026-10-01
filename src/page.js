var FocusDiffPage = (() => {
  const { t } = FocusDiff;

  const richText = (message) =>
    message
      .split(/(<b>.*?<\/b>|<code>.*?<\/code>)/)
      .filter(Boolean)
      .map((part) => {
        const [, tag, text] = part.match(/^<(b|code)>(.*)<\/\1>$/) ?? [];
        if (!tag) return document.createTextNode(part);
        const element = document.createElement(tag);
        element.textContent = text;
        return element;
      });

  const translate = (root) => {
    root.querySelectorAll('[data-i18n]').forEach((element) => (element.textContent = t(element.dataset.i18n)));
    root.querySelectorAll('[data-i18n-html]').forEach((element) => element.replaceChildren(...richText(t(element.dataset.i18nHtml))));
    root.querySelectorAll('[data-i18n-placeholder]').forEach((element) => (element.placeholder = t(element.dataset.i18nPlaceholder)));
    root.querySelectorAll('[data-i18n-label]').forEach((element) => element.setAttribute('aria-label', t(element.dataset.i18nLabel)));
    return root;
  };

  const translateDocument = (titleKey) => {
    document.documentElement.lang = chrome.i18n.getUILanguage();
    document.title = t(titleKey);
    translate(document.body);
  };

  const toaster = (toast) => {
    let timer;
    return (message) => {
      clearTimeout(timer);
      toast.textContent = message;
      toast.classList.add('visible');
      timer = setTimeout(() => toast.classList.remove('visible'), 2800);
    };
  };

  return { translate, translateDocument, toaster };
})();
