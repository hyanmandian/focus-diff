import { invoke } from "@tauri-apps/api/core";

const send = (message: string) => void invoke("log", { message }).catch(() => {});

export function forwardErrors() {
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    original(...args);
    send(
      args
        .map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === "string" ? a : JSON.stringify(a)))
        .join(" "),
    );
  };
  window.addEventListener("error", (e) => {
    if (!e.message.startsWith("ResizeObserver loop")) send(`${e.message} at ${e.filename}:${e.lineno}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    send(`Unhandled: ${e.reason instanceof Error ? `${e.reason.message}\n${e.reason.stack}` : String(e.reason)}`);
  });
}
