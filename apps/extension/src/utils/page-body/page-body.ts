/** An extension page's body without its scripts, read as the browser would, for tests to draw the page's markup
 *  without running it. */
export const pageBody = (html: string): string => {
  const page = new DOMParser().parseFromString(html, "text/html");
  for (const script of page.querySelectorAll("script")) script.remove();
  return page.body.innerHTML;
};
