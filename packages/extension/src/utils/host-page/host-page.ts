// GitHub's page as it was before the app's modules loaded: they set <html lang> and data-platform for pages of their
// own, and here the page is GitHub's. The content script imports this first, so what GitHub had is read before they
// change it, and puts it back after.

const root = document.documentElement;
const kept = { lang: root.getAttribute("lang"), "data-platform": root.getAttribute("data-platform") };

/** Puts GitHub's <html lang> and data-platform back as GitHub had them. */
export const restoreHostPage = () => {
  for (const [name, value] of Object.entries(kept)) {
    if (value === null) root.removeAttribute(name);
    else if (root.getAttribute(name) !== value) root.setAttribute(name, value);
  }
};
