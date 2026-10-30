import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";

import { Connect, NEW_TOKEN } from "@/components/connect/connect";
import type { AuthStatus, DeviceCode } from "@/utils/bridge/bridge";
import { mockCommands } from "@/utils/fake-platform/fake-platform";
import { deferred } from "@/utils/mock-render/mock-render";

const auth = (over: Partial<AuthStatus> = {}): AuthStatus => ({
  signed_in: false,
  source: null,
  login: null,
  device_flow: false,
  gh_available: false,
  gh_signed_in: false,
  ...over,
});

const CODE: DeviceCode = {
  device_code: "dc",
  user_code: "WDJB-MJHT",
  verification_uri: "https://github.com/login/device",
  interval: 5,
  expires_in: 900,
};

function rust(answers: Record<string, unknown>) {
  const calls: Array<[string, unknown]> = [];
  mockCommands((cmd, args) => {
    calls.push([cmd, args]);
    const answer = answers[cmd];
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return calls;
}

describe("Connect", () => {
  it("asks for a token when there's no other way, and connects with it", async () => {
    const calls = rust({ auth_use_token: null });
    const onConnected = vi.fn<() => void>();
    render(<Connect auth={null} onConnected={onConnected} />);
    expect(screen.queryByRole("button", { name: "Sign in with GitHub" })).toBeNull();
    const submit = screen.getByRole<HTMLButtonElement>("button", { name: "Use this token" });
    expect(submit.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("Personal access token"), "ghp_secret");
    await userEvent.click(submit);
    await waitFor(() => {
      expect(onConnected).toHaveBeenCalledOnce();
    });
    expect(calls).toContainEqual(["auth_use_token", { token: "ghp_secret" }]);
  });

  it("signs in with GitHub: shows the code, copies it, opens the page and waits", async () => {
    const finished = deferred();
    const calls = rust({ auth_device_start: CODE, open_url: null, auth_device_finish: finished.promise });
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const onConnected = vi.fn<() => void>();
    render(
      <Connect auth={auth({ device_flow: true, gh_available: true, gh_signed_in: true })} onConnected={onConnected} />,
    );
    expect(screen.queryByLabelText("Personal access token")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Sign in with GitHub" }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("WDJB-MJHT");
    expect(screen.getByLabelText("Code W D J B - M J H T")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith("WDJB-MJHT");
    await waitFor(() => {
      expect(calls.map(([cmd]) => cmd)).toContain("auth_device_finish");
    });
    expect(calls).toContainEqual(["open_url", { url: CODE.verification_uri }]);
    expect(screen.getByRole("button", { name: "Copy code" }).querySelector(".lucide-check")).not.toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Open github\.com\/login\/device/u }));
    expect(calls.filter(([cmd]) => cmd === "open_url")).toHaveLength(2);

    finished.resolve();
    await waitFor(() => {
      expect(onConnected).toHaveBeenCalledOnce();
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("lets a sign-in waiting on GitHub be cancelled, to choose another way", async () => {
    const finished = deferred();
    const calls = rust({
      auth_device_start: CODE,
      open_url: null,
      auth_device_finish: finished.promise,
      auth_device_cancel: null,
    });
    const onConnected = vi.fn<() => void>();
    render(<Connect auth={auth({ device_flow: true, gh_available: true })} onConnected={onConnected} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in with GitHub" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(calls.map(([cmd]) => cmd)).toContain("auth_device_cancel");
    finished.reject("cancelled");
    expect(await screen.findByRole("button", { name: "Use the GitHub CLI's login" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onConnected).not.toHaveBeenCalled();
  });

  it("shows the code even when it can't be copied, and copies it on request", async () => {
    const finished = deferred();
    rust({ auth_device_start: CODE, open_url: null, auth_device_finish: finished.promise });
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    render(<Connect auth={auth({ device_flow: true })} onConnected={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in with GitHub" }));
    const copy = await screen.findByRole("button", { name: "Copy code" });
    expect(copy.querySelector(".lucide-copy")).not.toBeNull();
    writeText.mockResolvedValue();
    await userEvent.click(copy);
    await waitFor(() => {
      expect(copy.querySelector(".lucide-check")).not.toBeNull();
    });
    finished.reject("The code expired.");
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The code expired.");
  });

  it("uses the GitHub CLI's login, the main way when there's no sign-in", async () => {
    const used = deferred();
    rust({ auth_use_gh: used.promise });
    const onConnected = vi.fn<() => void>();
    render(<Connect auth={auth({ gh_available: true, gh_signed_in: true })} onConnected={onConnected} />);
    const gh = screen.getByRole<HTMLButtonElement>("button", { name: "Use the GitHub CLI's login" });
    await userEvent.click(gh);
    expect(gh.disabled).toBe(true);
    expect(gh.querySelector(".animate-spin")).not.toBeNull();
    used.resolve();
    await waitFor(() => {
      expect(onConnected).toHaveBeenCalledOnce();
    });
    expect(gh.disabled).toBe(false);
  });

  it("says what went wrong", async () => {
    rust({ auth_use_gh: new Error("gh isn't signed in") });
    render(<Connect auth={auth({ gh_available: true, gh_signed_in: true })} onConnected={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Use the GitHub CLI's login" }));
    expect((await screen.findByRole("alert")).textContent).toBe("gh isn't signed in");
  });

  it("falls back to a general message for an error with no words", async () => {
    const token = deferred();
    rust({ auth_use_token: token.promise });
    render(<Connect auth={auth({ gh_available: true, gh_signed_in: true })} onConnected={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Use a personal access token instead" }));
    await userEvent.type(screen.getByLabelText("Personal access token"), "ghp_x");
    await userEvent.click(screen.getByRole("button", { name: "Use this token" }));
    expect(screen.getByRole("button", { name: "Use this token" }).querySelector(".animate-spin")).not.toBeNull();
    token.reject({ code: 1 });
    expect((await screen.findByRole("alert")).textContent).toBe("Something went wrong");
  });

  it("shows a spinner on Sign in while it starts", async () => {
    const started = deferred();
    rust({ auth_device_start: started.promise });
    render(<Connect auth={auth({ device_flow: true })} onConnected={() => {}} />);
    const signIn = screen.getByRole("button", { name: "Sign in with GitHub" });
    await userEvent.click(signIn);
    expect(signIn.querySelector(".animate-spin")).not.toBeNull();
    started.reject(new Error("offline"));
    expect((await screen.findByRole("alert")).textContent).toBe("offline");
  });
  it("says when the GitHub CLI is there but signed out, with the command to copy", async () => {
    rust({});
    const user = userEvent.setup();
    render(<Connect auth={auth({ gh_available: true })} onConnected={() => {}} />);
    expect(screen.getByText(/installed but not signed in/u)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Copy the command" }));
    expect(await navigator.clipboard.readText()).toBe("gh auth login");
    expect(screen.getByRole("button", { name: "Use the GitHub CLI's login" })).toBeTruthy();
  });

  it("opens GitHub's page for a new token with the scopes it needs", async () => {
    const calls = rust({});
    const user = userEvent.setup();
    render(<Connect auth={auth()} onConnected={() => {}} />);
    await user.click(screen.getByRole("button", { name: /Create a token on GitHub/u }));
    expect(calls).toContainEqual(["open_url", { url: NEW_TOKEN }]);
    expect(NEW_TOKEN).toContain("scopes=repo,read:org");
  });
});
