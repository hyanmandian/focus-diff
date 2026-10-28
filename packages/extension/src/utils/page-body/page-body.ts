export const pageBody = (html: string): string => {
  const page = new DOMParser().parseFromString(html, "text/html");
  for (const script of page.querySelectorAll("script")) script.remove();
  return page.body.innerHTML;
};
