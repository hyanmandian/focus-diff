export interface PullLink {
  owner: string;
  repo: string;
  number: number;
}

const LINK =
  /^(?:https:\/\/)?(?:www\.)?github\.com\/([A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38})\/([\w.-]{1,100})\/pull\/([1-9]\d{0,9})(?:\/[\w.\-/]*)?(?:\?[^\s#]*)?(?:#\S*)?$/u;

export const parsePullLink = (text: string): PullLink | null => {
  const [, owner, repo, number] = LINK.exec(text.trim()) ?? [];
  if (!owner || !repo || !number || repo === "." || repo === "..") return null;
  return { owner, repo, number: Number(number) };
};

export const pullLinkUrl = ({ owner, repo, number }: PullLink): string =>
  `https://github.com/${owner}/${repo}/pull/${number}`;
