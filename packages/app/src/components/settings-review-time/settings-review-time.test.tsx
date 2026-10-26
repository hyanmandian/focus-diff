import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  defaultConfig,
  TEMPLATES,
  type Config,
  type Queue,
  type ReviewSession,
  type ReviewTime,
} from "../../utils/config/config";
import { fakePlatform, mockCommands } from "../../utils/fake-platform/fake-platform";
import { setLanguage } from "../../utils/i18n/i18n";
import { setPlatform } from "../../utils/platform/platform";
import { ReviewTimePane } from "./settings-review-time";

beforeEach(() => {
  // A Wednesday morning.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 0, 7, 10, 0));
});

afterEach(() => {
  vi.useRealTimers();
  setLanguage("en");
});

const session = (patch: Partial<ReviewSession> = {}): ReviewSession => ({
  id: "s1",
  name: "Afternoon",
  on: true,
  days: [1, 2, 3, 4, 5],
  times: ["15:00"],
  minutes: 30,
  order: "oldest",
  queues: [],
  drafts: false,
  ...patch,
});

const queue = (id: string, name: string, patch: Partial<Queue> = {}): Queue => ({
  ...TEMPLATES.review.make(),
  id,
  name,
  ...patch,
});

/** The question a "confirm" call asks. */
function titleOf(args: unknown): string {
  if (typeof args === "object" && args !== null && "title" in args && typeof args.title === "string") return args.title;
  return "";
}

/** The pane as Settings holds it: each change kept, the latest readable, "Remove …?" answered with `confirm`. */
function setup(review: Partial<ReviewTime> = {}, queues: Queue[] = [], confirm = true) {
  const asked: string[] = [];
  mockCommands((cmd, args) => {
    if (cmd === "confirm") {
      asked.push(titleOf(args));
      return confirm;
    }
    return null;
  });
  const changes = vi.fn<(c: Config) => void>();
  const initial = defaultConfig();
  function Harness() {
    const [config, setConfig] = useState<Config>({
      ...initial,
      queues,
      reviewTime: { ...initial.reviewTime, ...review },
    });
    return (
      <ReviewTimePane
        config={config}
        onChange={(c) => {
          changes(c);
          setConfig(c);
        }}
      />
    );
  }
  render(<Harness />, { wrapper: StrictMode });
  const last = () => changes.mock.lastCall![0].reviewTime;
  const current = () => last().sessions[0]!;
  return { user: userEvent.setup(), changes, last, current, asked };
}

const rowOf = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`, "u") });

const choose = async (user: ReturnType<typeof userEvent.setup>, label: string, option: string) => {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
};

describe("ReviewTimePane", () => {
  it("says when the next review time is, once reminders are on", async () => {
    const { user, last } = setup({ sessions: [session()] });
    expect(screen.queryByText(/^Next:/u)).toBeNull();
    await user.click(screen.getByRole("switch", { name: "Remind me when it's review time" }));
    expect(last().enabled).toBe(true);
    expect(screen.getByText(/^Next: Wednesday at 3:00\sPM, “Afternoon” for 30 min\.$/u)).toBeTruthy();
  });

  it("names an untitled review time by default in the next one", () => {
    setup({ enabled: true, sessions: [session({ name: "" })] });
    expect(screen.getByText(/“Review time”/u)).toBeTruthy();
  });

  it("counts down on the toolbar button in the browser extension", () => {
    setPlatform({ ...fakePlatform, features: { tray: false } });
    setup();
    expect(screen.getByText(/counts the time down on its toolbar button/u)).toBeTruthy();
  });

  it("says when no review time is coming", () => {
    setup({ enabled: true, sessions: [session({ on: false })] });
    expect(screen.getByText(/^No review time is on\./u)).toBeTruthy();
  });

  it("sums up each review time in its row", () => {
    setup({
      sessions: [
        session({ id: "1", name: "Weekdays", days: [1, 2, 3, 4, 5], times: ["15:00", "09:30"] }),
        session({ id: "2", name: "Daily", days: [0, 1, 2, 3, 4, 5, 6], minutes: 15 }),
        session({ id: "3", name: "Weekend", days: [0, 6], times: [] }),
        session({ id: "4", name: "Some", days: [3, 1] }),
        session({ id: "5", name: "None", days: [] }),
        session({ id: "6", name: "", on: false }),
      ],
    });
    expect(rowOf("Weekdays").textContent).toMatch(/Weekdays at 3:00\sPM and 9:30\sAM · 30 min/u);
    expect(rowOf("Daily").textContent).toMatch(/Every day at 3:00\sPM · 15 min/u);
    expect(rowOf("Weekend").textContent).toContain("Weekends with no time yet · 30 min");
    expect(rowOf("Some").textContent).toMatch(/Mon and Wed at/u);
    expect(rowOf("None").textContent).toContain("No days picked");
    expect(rowOf("Review time").textContent).toContain("Weekdays");
    expect(screen.getByRole("switch", { name: "Review time on" }).getAttribute("aria-checked")).toBe("false");
  });

  it("turns a review time on and off from its row", async () => {
    const { user, last } = setup({ sessions: [session(), session({ id: "s2", name: "Other" })] });
    await user.click(screen.getByRole("switch", { name: "Afternoon on" }));
    expect(last().sessions.map((s) => s.on)).toEqual([false, true]);
  });

  it("says there are none yet, and adding one opens it", async () => {
    const { user, current } = setup();
    expect(screen.getByText(/^None yet\./u)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add Review Time" }));
    expect(current()).toMatchObject({ name: "", days: [1, 2, 3, 4, 5], times: ["15:00"] });
    expect(screen.getByRole("textbox", { name: "Name" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back to Review time" }));
    expect(rowOf("Review time")).toBeTruthy();
  });

  it("can't have more than ten review times", () => {
    setup({ sessions: Array.from({ length: 10 }, (_, i) => session({ id: `s${i}` })) });
    expect(screen.getByRole("button", { name: "Add Review Time" })).toHaveProperty("disabled", true);
  });

  it("names the queues whose notifications wait for review time", () => {
    setup({}, [
      queue("q1", "Mine", { notify: ["new"], notifyAt: "review" }),
      queue("q2", "Now", { notify: ["new"], notifyAt: "now" }),
      queue("q3", "Quiet", { notify: [], notifyAt: "review" }),
      queue("q4", "Off", { enabled: false, notify: ["new"], notifyAt: "review" }),
    ]);
    expect(screen.getByText(/^Notifications from Mine wait for review time/u)).toBeTruthy();
  });

  it("says each queue's notifications can wait, when none do", () => {
    setup({}, [queue("q1", "Now", { notify: ["new"], notifyAt: "now" })]);
    expect(screen.getByText(/^Each queue's notifications can wait/u)).toBeTruthy();
  });

  it("changes what happens when it's time", async () => {
    const { user, last } = setup();
    await user.click(screen.getByRole("switch", { name: /Re-reviews first/u }));
    expect(last().againFirst).toBe(false);
    await user.click(screen.getByRole("switch", { name: "Tell me when the time's up" }));
    expect(last().remindEnd).toBe(false);
    await user.click(screen.getByRole("switch", { name: "Say nothing when there's nothing to review" }));
    expect(last().skipEmpty).toBe(false);
    await user.click(screen.getByRole("switch", { name: /Hold every notification/u }));
    expect(last().holdWhileReviewing).toBe(true);
  });

  it("edits a review time's name, days, times and length", async () => {
    const { user, current, last } = setup({ sessions: [session(), session({ id: "s2", name: "Other" })] });
    await user.click(rowOf("Afternoon"));

    const name = screen.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Review time");
    await user.type(name, "Late");
    expect(current().name).toBe("Late");
    expect(last().sessions[1]!.name).toBe("Other");

    await user.click(screen.getByRole("switch", { name: "On" }));
    expect(current().on).toBe(false);

    await user.click(screen.getByRole("button", { name: "Sunday" }));
    expect(current().days).toEqual([0, 1, 2, 3, 4, 5]);
    expect(screen.getByRole("button", { name: "Monday" }).textContent).toBe("Mo");

    const times = screen.getByRole("textbox", { name: "Times" });
    await user.type(times, "25:00{Enter}");
    expect(screen.getByText("A time like 15:00, on a 24-hour clock")).toBeTruthy();
    await user.clear(times);
    await user.type(times, "09:00{Enter}");
    expect(current().times).toEqual(["09:00", "15:00"]);

    await choose(user, "How long", "45 min");
    expect(current().minutes).toBe(45);
    expect(screen.getByRole("combobox", { name: "How long" }).textContent).toContain("45 min");
  });

  it("asks for a time when there's none, and offers its own length among the usual ones", async () => {
    const { user } = setup({ sessions: [session({ times: [], minutes: 25 })] });
    await user.click(rowOf("Afternoon"));
    expect(screen.getByText("Add at least one time.")).toBeTruthy();
    await user.click(screen.getByRole("combobox", { name: "How long" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "15 min",
      "25 min",
      "30 min",
      "45 min",
      "60 min",
      "90 min",
      "120 min",
    ]);
  });

  it("chooses what to review and from which queues", async () => {
    const { user, current } = setup({ sessions: [session()] }, [
      queue("q1", "Mine"),
      queue("q2", "Team"),
      queue("q3", "Off", { enabled: false }),
    ]);
    await user.click(rowOf("Afternoon"));

    await choose(user, "What goes first", "Quickest");
    expect(current().order).toBe("quickest");
    expect(screen.getByText("As many as fit, the shortest first.")).toBeTruthy();

    await user.click(screen.getByRole("switch", { name: "Include drafts" }));
    expect(current().drafts).toBe(true);

    expect(screen.queryByRole("button", { name: "Off" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Team" }));
    expect(current().queues).toEqual(["q2"]);
    expect(screen.getByRole("button", { name: "Team" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Team" }));
    expect(current().queues).toEqual([]);
  });

  it("goes back to the list as it was", async () => {
    const { user, changes } = setup({ enabled: true, sessions: [session()] }, [
      queue("q1", "Mine", { notify: ["new"], notifyAt: "review" }),
    ]);
    await user.click(rowOf("Afternoon"));
    await user.click(screen.getByRole("button", { name: "Back to Review time" }));
    expect(document.activeElement).toBe(rowOf("Afternoon"));
    expect(rowOf("Afternoon").textContent).toMatch(/Weekdays at 3:00\sPM · 30 min/u);
    expect(changes).not.toHaveBeenCalled();
  });

  it("deletes a review time once confirmed", async () => {
    const { user, last, asked } = setup({ sessions: [session({ name: "" })] });
    await user.click(rowOf("Review time"));
    await user.click(screen.getByRole("button", { name: "Delete Review time" }));
    await waitFor(() => {
      expect(last().sessions).toEqual([]);
    });
    expect(asked).toEqual(["Remove “Review time”?"]);
    expect(screen.getByText(/^None yet\./u)).toBeTruthy();
  });

  it("keeps a review time when its deletion isn't confirmed", async () => {
    const { user, changes, asked } = setup({ sessions: [session()] }, [], false);
    await user.click(rowOf("Afternoon"));
    await user.click(screen.getByRole("button", { name: "Delete Afternoon" }));
    await waitFor(() => {
      expect(asked).toEqual(["Remove “Afternoon”?"]);
    });
    expect(changes).not.toHaveBeenCalled();
  });

  it("shortens days in Portuguese without the period, and rewords itself", async () => {
    const { user } = setup({ enabled: true, sessions: [session()] }, [queue("q1", "Mine")]);
    act(() => {
      setLanguage("pt-BR");
    });
    expect(screen.getByRole("button", { name: "Adicionar review time" })).toBeTruthy();
    act(() => {
      setLanguage("en");
    });
    await user.click(rowOf("Afternoon"));
    act(() => {
      setLanguage("pt-BR");
    });
    expect(screen.getByRole("button", { name: "segunda-feira" }).textContent).toBe("seg");
  });
});
