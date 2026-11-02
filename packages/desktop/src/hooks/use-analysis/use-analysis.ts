import { useMemo, useRef, useState } from "react";

import { useSaved } from "@/hooks/use-saved/use-saved";
import { aiProblem, ensureAi } from "@/utils/ai-ready/ai-ready";
import { newRun, type Finding } from "@/utils/ai/ai";
import { bridge, type Saved } from "@/utils/bridge/bridge";
import type { Config } from "@/utils/config/config";
import type { Details } from "@/utils/details/details";
import { errorText } from "@/utils/error/error";
import { i18n } from "@/utils/i18n/i18n";
import { scope } from "@/utils/review-scope/review-scope";
import type { ReviewFile } from "@/utils/review/review";
import {
  analyze,
  deepen,
  isPlan,
  pathsOf,
  readAnalysis,
  readPart,
  type Analysis,
  type Plan,
} from "@/utils/walkthrough/walkthrough";

export const findingKey = (f: Finding) => `${f.path}:${String(f.line)}:${f.body.slice(0, 80)}`;

function planOf(record: Saved): Plan | null {
  try {
    const value: unknown = JSON.parse(record.meta);
    return isPlan(value) ? value : null;
  } catch {
    return null;
  }
}

function read(record: Saved, parts: Saved[], files: ReviewFile[]): Analysis | null {
  const plan = planOf(record);
  if (!plan || record.text === undefined) return null;
  try {
    const said = { project: record.project, note: record.note, at: record.at };
    const analysis = readAnalysis(record.text, plan, files, said);
    const sections = analysis.walkthrough.sections.map((section, i) => {
      const part = parts.findLast((p) => p.key === `${record.id}#${String(i)}` && p.status === "done");
      const partPlan = part && planOf(part);
      if (!part?.text || !partPlan) return section;
      try {
        return readPart(part.text, partPlan, section, files);
      } catch {
        return section;
      }
    });
    const dismissed = new Set(record.dismissed);
    return {
      walkthrough: { ...analysis.walkthrough, sections },
      review: { ...analysis.review, findings: analysis.review.findings.filter((f) => !dismissed.has(findingKey(f))) },
    };
  } catch {
    return null;
  }
}

export function useAnalysis(pull: string, ai: Config | null, details: Details | null, files: ReviewFile[] | null) {
  const saved = useSaved(pull);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const split = useMemo(() => (files ? scope(files) : null), [files]);
  const runs = useMemo(() => (saved ?? []).filter((r) => r.kind === "analysis"), [saved]);
  const parts = useMemo(() => (saved ?? []).filter((r) => r.kind === "part"), [saved]);
  const running = runs.findLast((r) => r.status === "running") ?? null;
  const readable = useMemo(
    () =>
      files
        ? new Map(runs.filter((r) => r.status === "done").map((r) => [r.id, read(r, parts, files)] as const))
        : new Map<string, Analysis | null>(),
    [runs, parts, files],
  );
  const record =
    runs.find((r) => r.id === chosen && readable.get(r.id)) ??
    runs.findLast((r) => !r.archived && readable.get(r.id)) ??
    null;
  const analysis = record ? readable.get(record.id)! : null;
  const last = runs.findLast((r) => !r.archived && r.status !== "running");
  const unreadable = last?.status === "done" && files && !readable.get(last.id);
  const failed =
    last && (!record || last.at > record.at)
      ? last.status === "failed"
        ? (last.error ?? "")
        : unreadable
          ? i18n()("config.aiUnexpected")
          : null
      : null;
  const building = useRef(false);
  const attempted = useRef(new Set<string>());
  const explaining = useRef(new Set<number>());
  const head = details?.headRefOid;
  const partKey = (index: number) => `${record?.id ?? ""}#${String(index)}`;
  const partRuns = (index: number) => parts.filter((p) => p.key === partKey(index));

  const build = async (asked = true) => {
    if (!ai || !details || !split || split.kept.length === 0 || running || building.current) return;
    const at = details.headRefOid;
    if (!asked) {
      if (attempted.current.has(at)) return;
      attempted.current.add(at);
    }
    building.current = true;
    const run = newRun();
    try {
      if (asked ? !(await ensureAi(ai)) : await aiProblem(ai)) return;
      setError(null);
      setChosen(null);
      await analyze(ai, details, split, { pull, head: at, run });
    } catch (e) {
      const kept = await bridge.aiSaved(pull).catch(() => []);
      if (!kept.some((r) => r.id === run)) setError(errorText(e));
    } finally {
      building.current = false;
    }
  };

  const deepenPart = async (index: number) => {
    const section = analysis?.walkthrough.sections[index];
    if (!ai || !details || !files || !record || !section || explaining.current.has(index)) return;
    explaining.current.add(index);
    const wanted = new Set(pathsOf(section));
    try {
      if (!(await ensureAi(ai))) return;
      await deepen(
        ai,
        details,
        section,
        files.filter((f) => wanted.has(f.path)),
        { pull, head: record.head, run: newRun(), key: partKey(index) },
      );
    } catch {
    } finally {
      explaining.current.delete(index);
    }
  };

  const mark = (id: string, change: { archived?: boolean; dismiss?: string }) => {
    void bridge.aiSavedMark(pull, id, change).catch(() => {});
  };

  return {
    saved,
    analysis,
    record,
    runs,
    split,
    building: Boolean(running),
    error: error ?? failed,
    stale: Boolean(record && head && record.head !== head),
    current: Boolean(record && head && record.head === head),
    build,
    stop: () => {
      if (running) void bridge.aiCancel(running.id);
    },
    show: setChosen,
    archive: (id: string, archived = true) => {
      if (id === chosen) setChosen(null);
      mark(id, { archived });
    },
    dismiss: (finding: Finding) => {
      if (record) mark(record.id, { dismiss: findingKey(finding) });
    },
    deepening: (index: number) => partRuns(index).some((p) => p.status === "running"),
    partError: (index: number) => {
      const lastPart = partRuns(index).findLast((p) => p.status !== "running");
      return lastPart?.status === "failed" ? (lastPart.error ?? "") : null;
    },
    deepen: deepenPart,
    stopPart: (index: number) => {
      for (const p of partRuns(index)) if (p.status === "running") void bridge.aiCancel(p.id);
    },
  };
}

export type AnalysisState = ReturnType<typeof useAnalysis>;
