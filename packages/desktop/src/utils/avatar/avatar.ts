import { platform } from "../platform/platform";

/** A person's picture at the size shown (2x for the 20–24px it's drawn at; some come at 420px
 *  otherwise), through the app's own copies of them where it keeps some (the desktop's week-long
 *  cache, src-tauri/src/avatars.rs). */
export function avatar(url: string, size = 48) {
  try {
    const u = new URL(url);
    u.searchParams.delete("size");
    u.searchParams.set("s", String(size));
    if (u.hostname !== "avatars.githubusercontent.com") return u.toString();
    return platform().mediaUrl?.("avatar", u.toString()) ?? u.toString();
  } catch {
    return url;
  }
}
