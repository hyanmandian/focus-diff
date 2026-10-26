// Pictures and videos from GitHub, through the app (src-tauri/src/media.rs): private repositories'
// attachments need the signed-in token, which only the app has, and kept copies load at once.

const native = () => "__TAURI_INTERNALS__" in window && !("__mock" in window);

export function media(url: string): string {
  if (!native()) return url;
  // Custom schemes are http://<scheme>.localhost on Windows.
  const base = navigator.userAgent.includes("Windows") ? "http://media.localhost/" : "media://localhost/";
  return `${base}?u=${encodeURIComponent(url)}`;
}

export const isVideo = (url: string) => /\.(mp4|m4v|mov|webm)(?:$|\?)/iu.test(url);
