import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it, vi } from "vite-plus/test";

import { i18n, setLanguage } from "@/utils/i18n/i18n";
import { followLanguage } from "@/utils/language/language";

/** Rust with this settings file (null: none yet); `reads` counts how often it's read. */
function settings(file: { text: string | null }) {
  const reads = { count: 0 };
  mockIPC(
    (cmd) => {
      if (cmd !== "read_file") return null;
      reads.count++;
      return file.text;
    },
    { shouldMockEvents: true },
  );
  return reads;
}

const picked = () => localStorage.getItem("language");

describe("following the language picked in Settings", () => {
  it("uses the one in the settings file, and follows it when any window saves it", async () => {
    const file = { text: JSON.stringify({ language: "pt-BR" }) };
    const reads = settings(file);
    followLanguage();
    await vi.waitFor(() => {
      expect(i18n().locale).toBe("pt-BR");
    });
    file.text = JSON.stringify({ language: "en" });
    await emit("file-changed", "pace");
    expect(reads.count).toBe(1);
    await emit("file-changed", "config");
    await vi.waitFor(() => {
      expect(i18n().locale).toBe("en");
    });
    expect(reads.count).toBe(2);
  });

  it.each([null, "3", "{}", JSON.stringify({ language: "fr" })])(
    "follows the system with no settings, or none picked (%s)",
    async (text) => {
      settings({ text });
      followLanguage();
      await vi.waitFor(() => {
        expect(picked()).toBe("system");
      });
    },
  );

  it("keeps the language it has when the file can't be read", async () => {
    setLanguage("pt-BR");
    localStorage.clear();
    const reads = settings({ text: "{ broken" });
    followLanguage();
    await vi.waitFor(() => {
      expect(reads.count).toBe(1);
    });
    expect(picked()).toBeNull();
    expect(i18n().locale).toBe("pt-BR");
    setLanguage("en");
  });
});
