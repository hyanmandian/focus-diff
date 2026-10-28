import { platform } from "@/utils/platform/platform";

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
