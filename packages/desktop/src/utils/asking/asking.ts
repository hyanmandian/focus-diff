import type { SelectedLineRange } from "@pierre/diffs";
import { useSyncExternalStore } from "react";

import { errorText } from "@/utils/error/error";

type Turn = { id: number; question: string; answer?: string; note?: string };
export type Mode = "comment" | "ask";
export type Chat = {
  mode: Mode | null;
  body: string;
  question: string;
  turns: Turn[];
  run: { id: string; at: number } | null;
  error: string | null;
};
export type Open = { path: string; range: SelectedLineRange; file?: boolean };
type Pull = { open: Open | null; chats: Record<string, Chat> };

const EMPTY: Pull = { open: null, chats: {} };
export const BLANK: Chat = { mode: null, body: "", question: "", turns: [], run: null, error: null };
const KEPT = 30;
const pulls = new Map<string, Pull>();
const listeners = new Set<() => void>();

const storageKey = (pull: string) => `asking:${pull}`;

export const chatKey = (open: Open) =>
  open.file
    ? `${open.path}:file`
    : `${open.path}:${Math.min(open.range.start, open.range.end)}-${Math.max(open.range.start, open.range.end)}:${open.range.endSide ?? open.range.side ?? "additions"}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isOpen = (value: unknown): value is Open =>
  isRecord(value) &&
  typeof value.path === "string" &&
  isRecord(value.range) &&
  typeof value.range.start === "number" &&
  typeof value.range.end === "number";

function restore(pull: string): Pull {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(pull)) ?? "null");
    if (!isRecord(value) || !isRecord(value.chats)) return EMPTY;
    const chats: Record<string, Chat> = {};
    for (const [key, chat] of Object.entries(value.chats)) {
      if (!isRecord(chat) || !Array.isArray(chat.turns)) continue;
      const turns = chat.turns.filter(
        (turn): turn is Turn =>
          isRecord(turn) &&
          typeof turn.id === "number" &&
          typeof turn.question === "string" &&
          typeof turn.answer === "string",
      );
      chats[key] = {
        ...BLANK,
        mode: chat.mode === "ask" || chat.mode === "comment" ? chat.mode : null,
        body: typeof chat.body === "string" ? chat.body : "",
        question: typeof chat.question === "string" ? chat.question : "",
        turns,
      };
    }
    return { open: isOpen(value.open) ? value.open : null, chats };
  } catch {
    return EMPTY;
  }
}

function save(pull: string, state: Pull) {
  try {
    const chats = Object.fromEntries(
      Object.entries(state.chats).map(([key, chat]) => [
        key,
        {
          mode: chat.mode,
          body: chat.body,
          question: chat.question,
          turns: chat.turns.filter((turn) => turn.answer !== undefined),
        },
      ]),
    );
    if (!state.open && Object.keys(chats).length === 0) localStorage.removeItem(storageKey(pull));
    else localStorage.setItem(storageKey(pull), JSON.stringify({ open: state.open, chats, at: Date.now() }));
    const kept = Object.keys(localStorage).filter((key) => key.startsWith("asking:"));
    if (kept.length > KEPT) {
      const age = (key: string) => {
        try {
          const value: unknown = JSON.parse(String(localStorage.getItem(key)));
          return isRecord(value) && typeof value.at === "number" ? value.at : 0;
        } catch {
          return 0;
        }
      };
      for (const key of kept.toSorted((a, b) => age(a) - age(b)).slice(0, kept.length - KEPT))
        localStorage.removeItem(key);
    }
  } catch {}
}

function read(pull: string): Pull {
  let state = pulls.get(pull);
  if (!state) {
    state = restore(pull);
    pulls.set(pull, state);
  }
  return state;
}

function write(pull: string, change: (state: Pull) => Pull) {
  const next = change(read(pull));
  pulls.set(pull, next);
  save(pull, next);
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function usePullAsking(pull: string): Pull {
  return useSyncExternalStore(subscribe, () => read(pull));
}

export function setOpen(pull: string, open: Open | null) {
  write(pull, (state) => ({ ...state, open }));
}

export function updateChat(pull: string, key: string, change: Partial<Chat> | ((chat: Chat) => Partial<Chat>)) {
  write(pull, (state) => {
    const chat = state.chats[key] ?? BLANK;
    return {
      ...state,
      chats: { ...state.chats, [key]: { ...chat, ...(typeof change === "function" ? change(chat) : change) } },
    };
  });
}

export function forget(pull: string, key: string) {
  write(pull, (state) => {
    const { [key]: _, ...chats } = state.chats;
    return { open: null, chats };
  });
}

export async function askInto(
  pull: string,
  key: string,
  question: string,
  run: string,
  ask: (earlier: Array<{ question: string; answer: string }>) => Promise<{ text: string; note?: string }>,
): Promise<boolean> {
  const chat = read(pull).chats[key] ?? BLANK;
  if (chat.run) return false;
  const earlier = chat.turns
    .filter((turn): turn is Turn & { answer: string } => turn.answer !== undefined)
    .map((turn) => ({ question: turn.question, answer: turn.answer }));
  const id = (chat.turns.at(-1)?.id ?? 0) + 1;
  updateChat(pull, key, (c) => ({
    question: "",
    error: null,
    turns: [...c.turns, { id, question }],
    run: { id: run, at: Date.now() },
  }));
  try {
    const answer = await ask(earlier);
    updateChat(pull, key, (c) => ({
      run: null,
      turns: c.turns.map((turn) => (turn.id === id ? { ...turn, answer: answer.text, note: answer.note } : turn)),
    }));
    return true;
  } catch (error) {
    updateChat(pull, key, (c) => ({
      run: null,
      question: c.question || question,
      turns: c.turns.filter((turn) => turn.id !== id),
      error: errorText(error),
    }));
    return false;
  }
}

export function resetAsking() {
  pulls.clear();
}
