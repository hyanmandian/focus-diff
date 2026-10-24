// Development only: sends the page's errors to the terminal running `tauri dev` (lib.rs `log`),
// since a web view's console isn't visible there.
import { invoke } from "@tauri-apps/api/core";

export function forwardErrors() {
  const send = (message: string) => void invoke("log", { message }).catch(() => {});
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    original(...args);
    send(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  window.addEventListener("error", (e) => send(`${e.message} at ${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => send(`Unhandled: ${e.reason instanceof Error ? `${e.reason.message}\n${e.reason.stack}` : String(e.reason)}`));
}
