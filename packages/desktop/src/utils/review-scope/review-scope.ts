import { isNoise } from "@/utils/ai-diff/ai-diff";
import type { ReviewFile } from "@/utils/review/review";

const LEFT_OUT = ["tests", "stories", "mocks", "generated", "dependencies", "assets", "docs"] as const;
export type LeftOut = (typeof LEFT_OUT)[number];

const RULES: Array<[LeftOut, RegExp]> = [
  [
    "tests",
    /(?:^|\/)(?:__tests__|__snapshots__|tests?|spec|e2e|cypress|playwright|integration-tests?|test-?utils?)\/|\.(?:test|spec|e2e|cy)\.[^/]+$|(?:^|\/)test_[^/]+\.py$|_(?:test|spec)\.[^/.]+$|(?:Tests?|Spec|IT)\.(?:java|kt|kts|scala|cs|swift|groovy|php|m)$|\.snap$/u,
  ],
  ["stories", /\.(?:stories|story)\.[^/]+$|(?:^|\/)\.storybook\//u],
  [
    "mocks",
    /(?:^|\/)(?:__mocks__|__fixtures__|fixtures?|mocks?|testdata|test-data|stubs?|fakes?)\/|[-_.](?:mocks?|fixtures?|fakes?|stubs?)\.[^/]+$|(?:^|\/)(?:mock|fixture|fake|stub)s?[-_.][^/]*$/u,
  ],
  [
    "generated",
    /\.(?:generated|gen|g|freezed|pb)\.[^/]+$|_pb2(?:_grpc)?\.pyi?$|(?:^|\/)(?:__generated__|generated)\//u,
  ],
  [
    "assets",
    /\.(?:png|jpe?g|gif|webp|avif|ico|bmp|tiff?|svg|mp4|mov|webm|mp3|wav|ogg|woff2?|ttf|otf|eot|pdf|zip|t?gz|jar)$/iu,
  ],
  ["docs", /\.(?:md|mdx|markdown|rst|adoc|txt)$|(?:^|\/)docs?\//iu],
];

const INSTRUCTIONS =
  /(?:^|\/)(?:SKILL|AGENTS|CLAUDE|GEMINI|BUGBOT|copilot-instructions)\.md$|\.(?:mdc|prompt\.md|instructions\.md)$|(?:^|\/)(?:\.cursor|\.claude|\.agents?|\.codex|\.windsurf|\.github\/(?:instructions|prompts)|skills?|prompts?|agents?)\//iu;

export function leftOutAs(path: string): LeftOut | null {
  const reason = RULES.find(([, rule]) => rule.test(path))?.[0] ?? (isNoise(path) ? "dependencies" : null);
  return reason === "docs" && INSTRUCTIONS.test(path) ? null : reason;
}

export type Scope = { kept: ReviewFile[]; leftOut: Array<{ reason: LeftOut; files: ReviewFile[] }> };

export function scope(files: ReviewFile[]): Scope {
  const kept: ReviewFile[] = [];
  const left = new Map<LeftOut, ReviewFile[]>();
  for (const file of files) {
    const reason = leftOutAs(file.path);
    if (reason) left.set(reason, [...(left.get(reason) ?? []), file]);
    else kept.push(file);
  }
  if (kept.length === 0 && left.has("docs")) {
    kept.push(...left.get("docs")!);
    left.delete("docs");
  }
  return {
    kept,
    leftOut: LEFT_OUT.flatMap((reason) => (left.has(reason) ? [{ reason, files: left.get(reason)! }] : [])),
  };
}
