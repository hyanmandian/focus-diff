// Every window follows the language picked in Settings, live: the pick is read from the settings
// file when the page starts and again whenever any window saves it (Rust says so with
// "file-changed"), the way the panel's store follows the rest of the settings.
import { bridge } from "./bridge";
import { setLanguage, type Language } from "./i18n";

async function read() {
  try {
    const text = await bridge.readFile("config");
    setLanguage(text ? (JSON.parse(text) as { language?: Language }).language : undefined);
  } catch {
    // Keeps the one remembered from last time.
  }
}

export function followLanguage() {
  void read();
  void bridge.on<string>("file-changed", (name) => name === "config" && void read());
}
