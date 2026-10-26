// The files the pages read and write, by name, as the desktop keeps them in its config folder (lib.rs read_file and
// write_file): the person's setup (config.json) and the review pace learned from them (pace.json). Here they're kept
// in the browser's local storage, as the same text.

import { storage } from "#imports";
import type { Commands } from "@/utils/command-server/command-server";

export const FILES = ["config", "pace"] as const;
export type AppFile = (typeof FILES)[number];

export const isAppFile = (name: unknown): name is AppFile => FILES.some((file) => file === name);

/** Where a file is kept. */
export const fileKey = (name: AppFile) => `local:file.${name}` as const;

export const UNKNOWN_FILE = "Unknown file";

export const readAppFile = (name: AppFile): Promise<string | null> => storage.getItem<string>(fileKey(name));

export const writeAppFile = (name: AppFile, contents: string): Promise<void> =>
  storage.setItem(fileKey(name), contents);

/** read_file and write_file. A write tells every page ("file-changed") and `changed`, which follows the setup. */
export const appFileCommands = (changed: (name: AppFile, contents: string) => void | Promise<void>): Commands => ({
  read_file: ({ name }) => {
    if (!isAppFile(name)) throw new Error(UNKNOWN_FILE);
    return readAppFile(name);
  },
  write_file: async ({ name, contents }) => {
    if (!isAppFile(name)) throw new Error(UNKNOWN_FILE);
    await writeAppFile(name, String(contents));
    await changed(name, String(contents));
  },
});
