import { platform } from "@/utils/platform/platform";

export function media(url: string): string {
  return platform().mediaUrl?.("media", url) ?? url;
}

export const isVideo = (url: string) => /\.(mp4|m4v|mov|webm)(?:$|\?)/iu.test(url);
