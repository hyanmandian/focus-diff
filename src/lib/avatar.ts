/** A person's picture at the size shown (2x for the 20–24px it's drawn at; some come at 420px
 *  otherwise), through the app's own week-long cache of them (src-tauri/src/avatars.rs). */
export function avatar(url: string, size = 48) {
  try {
    const u = new URL(url);
    u.searchParams.delete("size");
    u.searchParams.set("s", String(size));
    if (u.hostname !== "avatars.githubusercontent.com" || !("__TAURI_INTERNALS__" in window) || "__mock" in window) return u.toString();
    // Custom schemes are http://<scheme>.localhost on Windows.
    const base = navigator.userAgent.includes("Windows") ? "http://avatar.localhost" : "avatar://localhost";
    return `${base}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}
