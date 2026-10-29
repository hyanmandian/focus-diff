import { File, FileImage, Lock, type LucideIcon } from "lucide-react";

import { cn } from "@/utils/cn/cn";

type Tile = [label: string, color: string];

const BY_EXTENSION: Record<string, Tile> = {
  ts: ["TS", "#3178c6"],
  tsx: ["TSX", "#3178c6"],
  mts: ["TS", "#3178c6"],
  cts: ["TS", "#3178c6"],
  js: ["JS", "#f1e05a"],
  jsx: ["JSX", "#f1e05a"],
  mjs: ["JS", "#f1e05a"],
  cjs: ["JS", "#f1e05a"],
  py: ["PY", "#3572a5"],
  pyi: ["PY", "#3572a5"],
  rs: ["RS", "#dea584"],
  go: ["GO", "#00add8"],
  rb: ["RB", "#a91e50"],
  erb: ["ERB", "#a91e50"],
  java: ["JAV", "#b07219"],
  kt: ["KT", "#a97bff"],
  kts: ["KT", "#a97bff"],
  swift: ["SW", "#f05138"],
  c: ["C", "#555555"],
  h: ["H", "#555555"],
  cc: ["C++", "#f34b7d"],
  cpp: ["C++", "#f34b7d"],
  hpp: ["H++", "#f34b7d"],
  cs: ["C#", "#178600"],
  php: ["PHP", "#4f5d95"],
  ex: ["EX", "#6e4a7e"],
  exs: ["EX", "#6e4a7e"],
  scala: ["SC", "#c22d40"],
  dart: ["DA", "#00b4ab"],
  lua: ["LUA", "#000080"],
  css: ["CSS", "#663399"],
  scss: ["SCS", "#c6538c"],
  sass: ["SAS", "#a53b70"],
  less: ["LES", "#1d365d"],
  html: ["<>", "#e34c26"],
  htm: ["<>", "#e34c26"],
  vue: ["VUE", "#41b883"],
  svelte: ["SV", "#ff3e00"],
  astro: ["AST", "#ff5a03"],
  json: ["{}", "#cbcb41"],
  jsonc: ["{}", "#cbcb41"],
  json5: ["{}", "#cbcb41"],
  yml: ["YML", "#cb171e"],
  yaml: ["YML", "#cb171e"],
  toml: ["TML", "#9c4221"],
  xml: ["XML", "#0060ac"],
  md: ["MD", "#083fa1"],
  mdx: ["MDX", "#fcb32c"],
  sql: ["SQL", "#e38c00"],
  graphql: ["GQL", "#e10098"],
  gql: ["GQL", "#e10098"],
  proto: ["PB", "#4c8bf5"],
  sh: ["SH", "#89e051"],
  bash: ["SH", "#89e051"],
  zsh: ["SH", "#89e051"],
  tf: ["TF", "#7b42bc"],
  prisma: ["PRI", "#0c344b"],
  svg: ["SVG", "#ffb13b"],
  csv: ["CSV", "#237346"],
  txt: ["TXT", "#8e8e93"],
};

const BY_NAME: Record<string, Tile> = {
  dockerfile: ["DOC", "#384d54"],
  makefile: ["MK", "#427819"],
  gemfile: ["RB", "#a91e50"],
  rakefile: ["RB", "#a91e50"],
  ".env": ["ENV", "#ecd53f"],
};

const PICTURE = /\.(png|jpe?g|gif|webp|avif|ico|bmp|heic)$/iu;
const LOCK = /(\.lock|-lock\.json|-lock\.yaml|\.lockb)$/iu;

function tileOf(path: string): Tile | LucideIcon {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (LOCK.test(name)) return Lock;
  if (PICTURE.test(name)) return FileImage;
  const known = BY_NAME[name] ?? (name.startsWith(".env") ? BY_NAME[".env"] : undefined);
  if (known) return known;
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? BY_EXTENSION[name.slice(dot + 1)] : undefined) ?? File;
}

function takesDarkText(hex: string) {
  const channel = (at: number) => {
    const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5) > 0.183;
}

export function FileIcon({ path, className }: { path: string; className?: string }) {
  const tile = tileOf(path);
  if (!Array.isArray(tile)) {
    const Icon = tile;
    // oxlint-disable-next-line react/static-components
    return <Icon aria-hidden className={cn("mx-0.5 size-3.5 shrink-0 text-muted-foreground", className)} />;
  }
  const [label, color] = tile;
  return (
    <span
      aria-hidden
      style={{ backgroundColor: color }}
      className={cn(
        "grid h-3.5 w-[18px] shrink-0 place-items-center rounded-[3px] font-sans text-[7.5px] leading-none font-bold tracking-[-0.02em]",
        takesDarkText(color) ? "text-black/85" : "text-white",
        className,
      )}
    >
      {label}
    </span>
  );
}
