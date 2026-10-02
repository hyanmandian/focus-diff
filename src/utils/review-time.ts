import type { FileStats } from '@/utils/github';

/**
 * SmartBear's study of 2,500 reviews at Cisco found defect detection drops once reviewers go faster than about
 * 500 lines an hour, and recommends staying under it; 400 sits inside that range.
 */
export const LINES_PER_HOUR = 400;
/** Our assumption, not measured: removed code is read, not studied. */
export const REMOVED_LINE_WEIGHT = 0.25;
/** Our assumption, not measured: opening a file and getting oriented in it. */
export const MINUTES_PER_FILE = 0.5;

const GENERATED =
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|composer\.lock|go\.sum|flake\.lock)$|\.min\.(js|css)$|\.map$|\.snap$|(^|\/)(dist|vendor|__generated__|__snapshots__)\//;

export const isGenerated = (path: string): boolean => GENERATED.test(path);

/** Estimated minutes to review one file. Generated and lock files only cost the time to open them. */
export const reviewMinutes = (path: string, stats: FileStats | null): number => {
  if (!stats || isGenerated(path)) return MINUTES_PER_FILE;
  const lines = stats.additions + stats.deletions * REMOVED_LINE_WEIGHT;
  return MINUTES_PER_FILE + (lines / LINES_PER_HOUR) * 60;
};
