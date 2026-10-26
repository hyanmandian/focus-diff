/**
 * Whether a repository pattern covers a repository: `owner/name` exactly, or `owner/*` for all of an owner's (and,
 * where a site nests groups, like GitLab, everything under a group). Case doesn't matter, as on GitHub.
 */
export const repoMatches = (pattern: string, repo: string): boolean => {
  const key = pattern.trim().toLowerCase();
  const target = repo.toLowerCase();
  return key === target || (key.endsWith("/*") && target.startsWith(key.slice(0, -1)));
};
