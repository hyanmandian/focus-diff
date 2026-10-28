import { useEffect, useState } from "react";

import { bridge } from "@/utils/bridge/bridge";

export const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,video/mp4,video/quicktime,video/webm";
const NAMES = /\.(png|jpe?g|gif|webp|svg|mp4|m4v|mov|webm)$/iu;

export const attachable = (file: File) => NAMES.test(file.name) || ACCEPT.split(",").includes(file.type);

export function uploadMark(name: string, uploading: string, text: string): string {
  const clean = name.replaceAll(/[[\]\n]/gu, " ");
  for (let n = 1; ; n++) {
    const mark = `![${uploading.replace("{name}", n === 1 ? clean : `${clean} (${n})`)}]()`;
    if (!text.includes(mark)) return mark;
  }
}

export function swap(text: string, mark: string, by: string): string {
  const at = text.indexOf(mark);
  if (at < 0) return text;
  let end = at + mark.length;
  if (!by && (at === 0 || text[at - 1] === "\n") && text[end] === "\n") end++;
  return text.slice(0, at) + by + text.slice(end);
}

export function markdownFor(kind: "image" | "video", href: string, name: string, width: number | null): string {
  if (kind === "video") return href;
  const alt = name.replace(/\.[^.]+$/u, "").replaceAll('"', "&quot;");
  return width ? `<img width="${width}" alt="${alt}" src="${href}" />` : `![${alt}](${href})`;
}

export function pngDensity(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCodePoint(...bytes.subarray(at + 4, at + 8));
    if (type === "pHYs" && length >= 9 && at + 17 <= bytes.length) {
      const perMeter = view.getUint32(at + 8);
      return bytes[at + 16] === 1 ? Math.round(perMeter * 0.0254) : null;
    }
    if (type === "IDAT" || type === "IEND") return null;
    at += 12 + length;
  }
  return null;
}

export async function displayWidth(file: File): Promise<number | null> {
  if (!file.type.startsWith("image/")) return null;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const width = image.naturalWidth;
    if (!width) return null;
    const density =
      file.type === "image/png" ? pngDensity(new Uint8Array(await file.slice(0, 4096).arrayBuffer())) : null;
    return density && density >= 144 ? Math.round(width / (density / 72)) : width;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function useWebSession(): string | null | undefined {
  const [login, setLogin] = useState<string | null | undefined>();
  useEffect(() => {
    let current = true;
    const update = (l: string | null) => {
      if (current) setLogin(l);
    };
    bridge.webSession().then(update, () => {
      update(null);
    });
    const off = bridge.on<string | null>("web-session", update);
    return () => {
      current = false;
      off();
    };
  }, []);
  return login;
}
