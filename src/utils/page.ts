import { message, uiLanguage } from '@/utils/i18n';

export const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

const richText = (text: string): Node[] =>
  text
    .split(/(<b>.*?<\/b>|<code>.*?<\/code>)/)
    .filter(Boolean)
    .map((part) => {
      const [, tag, content] = part.match(/^<(b|code)>(.*)<\/\1>$/) ?? [];
      if (!tag) return document.createTextNode(part);
      const element = document.createElement(tag);
      element.textContent = content ?? '';
      return element;
    });

export const translate = <T extends ParentNode>(root: T): T => {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => (element.textContent = message(element.dataset.i18n ?? '')));
  root
    .querySelectorAll<HTMLElement>('[data-i18n-html]')
    .forEach((element) => element.replaceChildren(...richText(message(element.dataset.i18nHtml ?? ''))));
  root
    .querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')
    .forEach((element) => (element.placeholder = message(element.dataset.i18nPlaceholder ?? '')));
  root
    .querySelectorAll<HTMLElement>('[data-i18n-label]')
    .forEach((element) => element.setAttribute('aria-label', message(element.dataset.i18nLabel ?? '')));
  return root;
};

export const translateDocument = (title: string): void => {
  document.documentElement.lang = uiLanguage();
  document.title = title;
  translate(document.body);
};

const TOAST_MS = 2800;

export const toaster = (toast: HTMLElement) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (text: string) => {
    clearTimeout(timer);
    toast.textContent = text;
    toast.classList.add('visible');
    timer = setTimeout(() => toast.classList.remove('visible'), TOAST_MS);
  };
};
