import './toast.css';

const TOAST_MS = 2800;
const FADE_MS = 250;

/** A short message at the bottom of the page that fades out on its own. `toast` is the page's `.toast` live region. */
export const toaster = (toast: HTMLElement) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (text: string) => {
    clearTimeout(timer);
    toast.textContent = text;
    toast.classList.add('visible');
    timer = setTimeout(() => {
      toast.classList.remove('visible');
      // Once faded it's gone for screen readers too.
      timer = setTimeout(() => (toast.textContent = ''), FADE_MS);
    }, TOAST_MS);
  };
};
