// Pictures and videos from GitHub, through the app where it can (the desktop's src-tauri/src/media.rs):
// private repositories' attachments need the signed-in token, which only the app has, and kept copies
// load at once.
import { platform } from "../platform/platform";

export function media(url: string): string {
  return platform().mediaUrl?.("media", url) ?? url;
}

export const isVideo = (url: string) => /\.(mp4|m4v|mov|webm)(?:$|\?)/iu.test(url);
