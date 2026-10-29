import "./toast.css";

const TOAST_MS = 2800;
const FADE_MS = 250;

export const toaster = (toast: HTMLElement) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (text: string) => {
    clearTimeout(timer);
    toast.textContent = text;
    toast.classList.add("visible");
    timer = setTimeout(() => {
      toast.classList.remove("visible");
      timer = setTimeout(() => {
        toast.textContent = "";
      }, FADE_MS);
    }, TOAST_MS);
  };
};
