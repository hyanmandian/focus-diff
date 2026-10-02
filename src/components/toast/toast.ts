import './toast.css';

const TOAST_MS = 2800;

/** A short message at the bottom of the page that fades out on its own. `toast` is the page's `.toast` live region. */
export const toaster = (toast: HTMLElement) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (text: string) => {
    clearTimeout(timer);
    toast.textContent = text;
    toast.classList.add('visible');
    timer = setTimeout(() => toast.classList.remove('visible'), TOAST_MS);
  };
};
