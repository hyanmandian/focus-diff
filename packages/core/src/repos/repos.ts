export const repoMatches = (pattern: string, repo: string): boolean => {
  const key = pattern.trim().toLowerCase();
  const target = repo.toLowerCase();
  return key === target || (key.endsWith("/*") && target.startsWith(key.slice(0, -1)));
};
