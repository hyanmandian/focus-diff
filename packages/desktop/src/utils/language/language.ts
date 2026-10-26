// Every window follows the language picked in Settings, live: the pick is read from the settings
// file when the page starts and again whenever any window saves it (Rust says so with
// "file-changed"), the way the panel's store follows the rest of the settings.
import { bridge } from "@/utils/bridge/bridge";
import { LANGUAGES, setLanguage } from "@/utils/i18n/i18n";

async function read() {
  try {
    const text = await bridge.readFile("config");
    const saved: unknown = text ? JSON.parse(text) : undefined;
    const picked = saved && typeof saved === "object" && "language" in saved ? saved.language : undefined;
    setLanguage(LANGUAGES.find((language) => language === picked));
  } catch {
    // Keeps the one remembered from last time.
  }
}

export function followLanguage() {
  void read();
  void bridge.on<string>("file-changed", (name) => {
    if (name === "config") void read();
  });
}
