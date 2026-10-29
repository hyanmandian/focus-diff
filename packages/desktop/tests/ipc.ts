import type { Page } from "@playwright/test";

export interface Call {
  cmd: string;
  args: Record<string, unknown>;
}

type Invoke = (cmd: string, args?: Record<string, unknown>, options?: unknown) => Promise<unknown>;

declare global {
  interface Window {
    recordedCalls?: Call[];
    focusDiffPlatform?: { invoke: Invoke };
  }
}

export async function recordCalls(page: Page) {
  await page.waitForFunction(() => window.focusDiffPlatform !== undefined);
  await page.evaluate(() => {
    if (window.recordedCalls) return;
    const calls: Call[] = [];
    window.recordedCalls = calls;
    const platform = window.focusDiffPlatform!;
    const invoke = platform.invoke;
    platform.invoke = (cmd, args, options) => {
      calls.push({ cmd, args: args ?? {} });
      return invoke(cmd, args, options);
    };
  });
}

export function callsOf(page: Page, cmd: string): Promise<Call[]> {
  return page.evaluate((name) => (window.recordedCalls ?? []).filter((c) => c.cmd === name), cmd);
}

export async function savedConfig(page: Page): Promise<unknown> {
  const last = (await callsOf(page, "write_file")).findLast((c) => c.args.name === "config");
  return last ? JSON.parse(String(last.args.contents)) : null;
}
