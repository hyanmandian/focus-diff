import { bridge } from "@/utils/bridge/bridge";
import { LANGUAGES, setLanguage } from "@/utils/i18n/i18n";

async function read() {
  try {
    const text = await bridge.readFile("config");
    const saved: unknown = text ? JSON.parse(text) : undefined;
    const picked = saved && typeof saved === "object" && "language" in saved ? saved.language : undefined;
    setLanguage(LANGUAGES.find((language) => language === picked));
  } catch {}
}

export function followLanguage() {
  void read();
  bridge.on<string>("file-changed", (name) => {
    if (name === "config") void read();
  });
}
