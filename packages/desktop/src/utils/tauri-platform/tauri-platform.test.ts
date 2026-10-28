import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { tauriPlatform } from "@/utils/tauri-platform/tauri-platform";

type Call = { cmd: string; args: unknown };

function rust(answer: (cmd: string) => unknown = () => null, events = false) {
  const calls: Call[] = [];
  mockWindows("review");
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args });
      return answer(cmd);
    },
    { shouldMockEvents: events },
  );
  return calls;
}

afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

describe("the Mac app as the platform", () => {
  it("runs Rust's commands, with their arguments and headers as they are", async () => {
    const calls = rust((cmd) => (cmd === "snapshot" ? { queues: [] } : null));
    await expect(tauriPlatform.invoke("snapshot")).resolves.toEqual({ queues: [] });
    const bytes = new Uint8Array([1, 2]);
    await tauriPlatform.invoke("upload_attachment", bytes, { headers: { "x-repo": "acme/web" } });
    expect(calls[0]).toMatchObject({ cmd: "snapshot" });
    expect(calls[1]?.cmd).toBe("upload_attachment");
    expect(calls[1]?.args).toEqual(bytes);
  });

  it("hears Rust's events with their payload, until told to stop", async () => {
    rust(() => null, true);
    const heard = vi.fn<(payload: string) => void>();
    const stop = await tauriPlatform.listen<string>("snapshot", heard);
    await emit("snapshot", "fresh");
    expect(heard).toHaveBeenCalledWith("fresh");
    stop();
    await emit("snapshot", "again");
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("hears this window's own events", async () => {
    rust(() => null, true);
    const heard = vi.fn<(payload: { id: string }) => void>();
    await tauriPlatform.listenToWindow<{ id: string }>("review-open", heard);
    await emit("review-open", { id: "PR_1" });
    expect(heard).toHaveBeenCalledWith({ id: "PR_1" });
  });

  it("tells another window, asks the version and closes this window", async () => {
    const calls = rust((cmd) => (cmd === "plugin:app|version" ? "1.2.3" : null));
    await tauriPlatform.emitTo("settings", "settings-pane", "ai");
    expect(calls.at(-1)).toMatchObject({
      cmd: "plugin:event|emit_to",
      args: { target: { kind: "AnyLabel", label: "settings" }, event: "settings-pane", payload: "ai" },
    });
    await expect(tauriPlatform.version()).resolves.toBe("1.2.3");
    await tauriPlatform.closeWindow();
    expect(calls.at(-1)?.cmd).toBe("plugin:window|close");
  });

  it("serves GitHub's pictures from the app's cache, through its schemes", () => {
    const url = "https://github.com/user-attachments/assets/a b.png";
    expect(tauriPlatform.mediaUrl?.("avatar", "https://avatars.githubusercontent.com/u/11?v=4&s=48")).toBe(
      "avatar://localhost/u/11?v=4&s=48",
    );
    expect(tauriPlatform.mediaUrl?.("media", url)).toBe(`media://localhost/?u=${encodeURIComponent(url)}`);
  });

  it("uses the http form of the schemes on Windows", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    expect(tauriPlatform.mediaUrl?.("avatar", "https://avatars.githubusercontent.com/u/11?s=64")).toBe(
      "http://avatar.localhost/u/11?s=64",
    );
    expect(tauriPlatform.mediaUrl?.("media", "https://x.test/a")).toBe(
      `http://media.localhost/?u=${encodeURIComponent("https://x.test/a")}`,
    );
  });
});
