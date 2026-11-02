import type { Saved } from "@/utils/bridge/bridge";
import { type Args, emitEvent, isRecord, str, wait } from "@/utils/mock-ipc/mock-ipc";

const runs = new Map<string, Saved[]>();
const stopped = new Set<string>();

const ids = (material: string) =>
  new Map([...material.matchAll(/^\[(\d+)\] (\S+)/gmu)].map((m): [string, number] => [m[2]!, Number(m[1])]));

function analysis(material: string) {
  const id = ids(material);
  const at = (path: string) => id.get(path) ?? 0;
  return {
    overview:
      "Keeps a promo code applied when the cart changes: the server re-checks it against the new total, and the cart and the field say why when it stops applying.",
    diagram: "",
    sections: [
      {
        title: "The server decides whether a code still applies",
        kind: "change",
        weight: "high",
        before: "A code stayed valid once applied, even when the cart dropped below its minimum.",
        after: "The server re-checks the code against each new total and says why it stopped applying.",
        summary:
          "`ValidatePromo` now takes the cart total and returns a reason when the code no longer applies. Check the minimum-total rule and the reasons it can give.",
        files: [{ id: at("api/promo.go"), note: "The new total check and the reasons it returns." }],
      },
      {
        title: "The cart keeps the code and re-checks it",
        kind: "change",
        before: "Changing an item dropped the promo code.",
        after: "The code stays, and the cart asks the server again.",
        summary:
          "When items change, the cart recomputes the totals and asks the server again, instead of dropping the code. Check what happens to `promoError` when the code is removed by hand.",
        files: [
          { id: at("src/checkout/totals.ts") },
          { id: at("src/checkout/cart.ts"), note: "`updateCart` re-checks the code after each change.", line: 15 },
        ],
      },
      {
        title: "The field shows why a code stopped applying",
        kind: "change",
        weight: "low",
        after: "The field shows the server's reason under the input.",
        summary: "The renamed field shows the server's reason under the input.",
        files: [{ id: at("src/checkout/ui/PromoField.tsx") }],
      },
      {
        title: "Old helpers moved, one changed on the way",
        kind: "exception",
        before: "`formatDiscount` rounded to the nearest cent.",
        after: "It rounds down.",
        summary:
          "The helpers moved out of `src/legacy`, but `formatDiscount` now rounds down instead of to the nearest cent.",
        files: [{ id: at("src/checkout/old-helpers.ts"), note: "`formatDiscount` rounds differently." }],
      },
    ],
    findings: [
      {
        id: at("src/checkout/cart.ts"),
        line: 15,
        severity: "issue",
        body: "`promoError` stays set after the code is removed by hand: `removePromo` in `src/checkout/promo.ts` only clears `promo`, so the old error keeps showing.",
      },
      {
        id: at("src/checkout/promo.ts"),
        line: 40,
        severity: "suggestion",
        body: "`validatePromo` is also called from `OrderSummary.tsx`, which doesn't pass the new total.",
      },
    ],
  };
}

function part(material: string) {
  const id = ids(material);
  return {
    before: "The field kept the old code after the cart changed.",
    after: "The field shows why the code stopped applying.",
    summary:
      "`PromoField` reads `promoError` and shows it under the input. Check the message clears when the code is removed.",
    files: [{ id: id.get("src/checkout/ui/PromoField.tsx") ?? 1, note: "The reason under the input." }],
    flow: [
      { depth: 0, change: "same", code: "PromoField({ cart })", id: id.get("src/checkout/ui/PromoField.tsx") ?? 1 },
      { depth: 1, change: "added", code: "reason = cart.promoError" },
    ],
  };
}

function reply(args: Args) {
  const task = str(args, "task");
  const material = str(args, "material");
  if (task.includes("one part of this pull request")) return JSON.stringify(part(material));
  if (task.includes("walkthrough")) return JSON.stringify(analysis(material));
  return "Keeps the promo code when the cart changes: `updateCart` now re-checks the code against the new total and keeps it if it still applies, with a reason when it doesn't.\n\nWorth a closer look:\n- `src/checkout/cart.ts`: `promoError` isn't cleared when the code is removed by hand.\n- **No test** for a code that stops applying after an item is removed.";
}

function change(pull: string, id: string, edit: (run: Saved) => Saved) {
  runs.set(
    pull,
    (runs.get(pull) ?? []).map((run) => (run.id === id ? edit(run) : run)),
  );
  emitEvent("ai-saved", pull);
}

export async function askAi(args: Args) {
  const keep = isRecord(args.keep) ? args.keep : null;
  const run = str(args, "run");
  const pull = keep ? str(keep, "pull") : "";
  if (keep && run) {
    runs.set(pull, [
      ...(runs.get(pull) ?? []),
      {
        id: run,
        kind: str(keep, "kind"),
        key: str(keep, "key"),
        head: str(keep, "head"),
        at: Date.now(),
        status: "running",
        project: false,
        meta: str(keep, "meta"),
        archived: false,
        dismissed: [],
      },
    ]);
    emitEvent("ai-saved", pull);
  }
  await wait(task(args) ? 1200 : 400);
  if (stopped.delete(run)) {
    if (keep) change(pull, run, (r) => ({ ...r, status: "stopped" }));
    throw new Error("Stopped");
  }
  const text = reply(args);
  if (keep) change(pull, run, (r) => ({ ...r, status: "done", text, project: true }));
  return { project: true, text };
}

const task = (args: Args) => Boolean(args.schema);

export const savedRuns = (pull: string): Saved[] => runs.get(pull) ?? [];

export function markRun(args: Args) {
  const archived = typeof args.archived === "boolean" ? args.archived : undefined;
  const dismiss = typeof args.dismiss === "string" ? args.dismiss : null;
  change(str(args, "pull"), str(args, "id"), (run) => ({
    ...run,
    archived: archived ?? run.archived,
    dismissed: dismiss && !run.dismissed.includes(dismiss) ? [...run.dismissed, dismiss] : run.dismissed,
  }));
}

export function stopRun(run: string) {
  stopped.add(run);
}
