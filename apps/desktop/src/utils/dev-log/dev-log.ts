// Development only: sends the page's errors to the terminal running `tauri dev` (lib.rs `log`),
// since a web view's console isn't visible there.
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
  // The browser's note that a ResizeObserver callback resized something again (the virtualized
  // diff does, as comments open); harmless, and not an error in the page.
  window.addEventListener("error", (e) => {
    if (!e.message.startsWith("ResizeObserver loop")) send(`${e.message} at ${e.filename}:${e.lineno}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    send(`Unhandled: ${e.reason instanceof Error ? `${e.reason.message}\n${e.reason.stack}` : String(e.reason)}`);
  });
}
