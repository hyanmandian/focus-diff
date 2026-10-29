import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "THIRD-PARTY-NOTICES.txt");
const NOTICE_FILE = /^(licen[cs]e|copying|notice|unlicense)([-._].*)?$/iu;

type Entry = { name: string; version: string; license: string; source: string; texts: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const run = (command: string, args: string[], cwd: string): unknown =>
  JSON.parse(execFileSync(command, args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 }));
const npm = (args: string[]) => {
  const cli = process.env.npm_execpath;
  return cli ? run(process.execPath, [cli, ...args], root) : run("npm", args, root);
};

const textsIn = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => NOTICE_FILE.test(file))
        .toSorted()
        .map((file) => readFileSync(path.join(dir, file), "utf8").trim())
        .filter(Boolean)
    : [];

function npmEntries(): Entry[] {
  const tree = npm(["ls", "--omit=dev", "--all", "--long", "--json", "--workspace", "@focus-diff/desktop"]);
  const found = new Map<string, Entry>();
  const walk = (deps: unknown) => {
    if (!isRecord(deps)) return;
    for (const [name, node] of Object.entries(deps)) {
      if (!isRecord(node)) continue;
      if (name.startsWith("@focus-diff/")) {
        walk(node.dependencies);
        continue;
      }
      const version = text(node.version);
      const dir = text(node.path);
      if (!dir || found.has(`${name}@${version}`)) continue;
      const manifest: unknown = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
      found.set(`${name}@${version}`, {
        name,
        version,
        license: (isRecord(manifest) && text(manifest.license)) || "SEE LICENSE FILE",
        source: `https://www.npmjs.com/package/${name}/v/${version}`,
        texts: textsIn(dir),
      });
      walk(node.dependencies);
    }
  };
  walk(isRecord(tree) ? tree.dependencies : undefined);
  return [...found.values()];
}

function cargoEntries(): Entry[] {
  const metadata = run("cargo", ["metadata", "--format-version", "1", "--locked"], path.join(root, "src-tauri"));
  const packages: unknown[] = isRecord(metadata) && Array.isArray(metadata.packages) ? metadata.packages : [];
  const entries: Entry[] = [];
  for (const crate of packages) {
    if (!isRecord(crate) || crate.source === null) continue;
    const name = text(crate.name);
    const version = text(crate.version);
    entries.push({
      name,
      version,
      license: text(crate.license) || "SEE LICENSE FILE",
      source: `https://crates.io/crates/${name}/${version}`,
      texts: textsIn(path.dirname(text(crate.manifest_path))),
    });
  }
  return entries;
}

const spdx = (license: string) =>
  license
    .replaceAll(/[()]/gu, "")
    .split(/ OR | AND |\//u)[0]
    ?.trim();

const entries = [...npmEntries(), ...cargoEntries()].toSorted(
  (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
);
const byText = new Map<string, Entry[]>();
for (const entry of entries) {
  const key =
    entry.texts.join("\n\n---\n\n") ||
    `This package ships no license file. Its license is ${entry.license}: https://spdx.org/licenses/${spdx(entry.license)}.html`;
  byText.set(key, [...(byText.get(key) ?? []), entry]);
}

const rule = "=".repeat(80);
const sections = [...byText].map(
  ([body, group]) =>
    `${group.map((entry) => `${entry.name} ${entry.version} (${entry.license}), source: ${entry.source}`).join("\n")}\n\n${body}`,
);
writeFileSync(
  out,
  `Focus Diff includes the following third-party software, under the licenses that follow each group.\n\n${rule}\n\n${sections.join(`\n\n${rule}\n\n`)}\n`,
);
process.stdout.write(`${entries.length} packages, ${byText.size} license texts → ${path.relative(root, out)}\n`);
