import { message, uiLanguage } from "@/utils/i18n/i18n";

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the element it finds, as with querySelector.
export const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

/** A copy of the element in the template with this id. */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the element its template holds.
export const templateElement = <T extends HTMLElement>(id: string): T =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the caller names the element its template holds.
  $<HTMLTemplateElement>(`#${id}`).content.firstElementChild?.cloneNode(true) as T;

const richText = (text: string): Node[] =>
  text
    .split(/(<b>.*?<\/b>|<code>.*?<\/code>)/u)
    .filter(Boolean)
    .map((part) => {
      const [, tag, content] = part.match(/^<(b|code)>(.*)<\/\1>$/u) ?? [];
      if (!tag) return document.createTextNode(part);
      const element = document.createElement(tag);
      element.textContent = content!;
      return element;
    });

/** Fills each element marked with a message key; the selectors only find elements that have one. */
export const translate = <T extends ParentNode>(root: T): T => {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    element.textContent = message(element.dataset.i18n!);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-html]").forEach((element) => {
    element.replaceChildren(...richText(message(element.dataset.i18nHtml!)));
  });
  root.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]").forEach((element) => {
    element.placeholder = message(element.dataset.i18nPlaceholder!);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-label]").forEach((element) => {
    element.setAttribute("aria-label", message(element.dataset.i18nLabel!));
  });
  return root;
};

export const translateDocument = (title: string): void => {
  document.documentElement.lang = uiLanguage();
  document.title = title;
  translate(document.body);
};

/** Shows a page once its first render is complete; see `.pending` in global.css. */
export const reveal = (): void => {
  document.documentElement.classList.remove("pending");
};
