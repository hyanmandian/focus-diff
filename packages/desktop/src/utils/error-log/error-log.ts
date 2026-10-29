import { invoke } from "@tauri-apps/api/core";

const send = (message: string) => void invoke("log", { message }).catch(() => {});

const describe = (value: unknown) =>
  value instanceof Error
    ? `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`
    : typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : `[${value === null ? "null" : typeof value}]`;

export function forwardErrors() {
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    original(...args);
    send(args.map((arg) => describe(arg)).join(" "));
  };
  window.addEventListener("error", (e) => {
    if (!e.message.startsWith("ResizeObserver loop")) send(`${e.message} at ${e.filename}:${e.lineno}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    send(`Unhandled: ${describe(e.reason)}`);
  });
}
