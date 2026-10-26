// What the comment box asks GitHub for: a preview of the Markdown (rendered by GitHub, so it's what
// the comment will look like), who can be @mentioned, which issues and pull requests a # can point
// to, and your saved replies. Each kept, so the box answers as you type: the people and the replies
// for a day, previews and searches for the window's life.

import { github, graphql } from "./bridge";
import type { Person } from "./writing";

/** In memory, the oldest out first past a few hundred. */
function cache<T>(most = 300) {
  const entries = new Map<string, T>();
  return {
    get: (key: string) => entries.get(key),
    delete: (key: string) => void entries.delete(key),
    set: (key: string, value: T) => {
      entries.delete(key);
      entries.set(key, value);
      if (entries.size > most) entries.delete(entries.keys().next().value!);
    },
  };
}

/** On this machine for a day. */
function stored<T>(key: string): T | null {
  try {
    const kept = JSON.parse(localStorage.getItem(key) ?? "null") as { at: number; value: T } | null;
    return kept && Date.now() - kept.at < 24 * 3_600_000 ? kept.value : null;
  } catch {
    return null;
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
  } catch {
    // Asked again next time.
  }
}

const previews = cache<Promise<string>>(100);

/** The Markdown as GitHub renders it in this repository (so #12 and @ana link as they will). */
export function preview(text: string, repo: string): Promise<string> {
  const key = `${repo}\n${text}`;
  const known = previews.get(key);
  if (known) return known;
  const asked = github<string>("POST", "/markdown", { text, mode: "gfm", context: repo }, "text/html");
  previews.set(key, asked);
  // A failure isn't kept: the next look asks again.
  asked.catch(() => previews.delete(key));
  return asked;
}

type RawPerson = { login: string; name: string | null; avatarUrl: string };
const PERSON = "login name avatarUrl(size: 40)";
const searches = cache<Promise<Person[]>>();

/** Who can be mentioned in the repository: the first hundred kept for a day, and those matching
 *  what's typed asked for when the hundred don't have enough. */
export async function mentionable(repo: string, query: string): Promise<Person[]> {
  const [owner, name] = repo.split("/");
  const key = `mentionable:${repo}`;
  let people = stored<Person[]>(key);
  if (!people) {
    const data = await graphql<{ repository: { mentionableUsers: { nodes: RawPerson[] } } }>(
      `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { mentionableUsers(first: 100) { nodes { ${PERSON} } } } }`,
      { owner, name },
    );
    people = data.repository.mentionableUsers.nodes;
    store(key, people);
  }
  if (!query) return people;
  const q = query.toLowerCase();
  const local = people.filter((p) => p.login.toLowerCase().includes(q) || p.name?.toLowerCase().includes(q));
  if (local.length >= 5 || people.length < 100) return local;
  const asked = `${repo}\n@${q}`;
  let found = searches.get(asked);
  if (!found) {
    found = graphql<{ repository: { mentionableUsers: { nodes: RawPerson[] } } }>(
      `query($owner: String!, $name: String!, $q: String!) { repository(owner: $owner, name: $name) { mentionableUsers(first: 10, query: $q) { nodes { ${PERSON} } } } }`,
      { owner, name, q: query },
    ).then((d) => d.repository.mentionableUsers.nodes);
    searches.set(asked, found);
  }
  return [...local, ...(await found)];
}

export type Reference = { number: number; title: string; kind: "issue" | "pull"; state: string };
const references = cache<Promise<Reference[]>>();

/** Issues and pull requests in the repository for a #: by number or words in the title, the most
 *  recently updated with nothing typed. */
export function referable(repo: string, query: string): Promise<Reference[]> {
  const key = `${repo}\n#${query}`;
  const known = references.get(key);
  if (known) return known;
  type Raw = { search: { nodes: Array<{ __typename: string; number?: number; title?: string; state?: string }> } };
  const words = /^\d+$/.test(query) ? query : query ? `${query} in:title` : "";
  const asked = graphql<Raw>(
    `query($q: String!) { search(query: $q, type: ISSUE, first: 8) { nodes { __typename ... on Issue { number title state } ... on PullRequest { number title state } } } }`,
    { q: `repo:${repo} ${words} sort:updated-desc`.replace(/\s+/g, " ").trim() },
  ).then((d) =>
    d.search.nodes.flatMap((n): Reference[] => (n.number && n.title ? [{ number: n.number, title: n.title, kind: n.__typename === "PullRequest" ? "pull" : "issue", state: n.state ?? "" }] : [])),
  );
  references.set(key, asked);
  asked.catch(() => references.delete(key));
  return asked;
}

export type SavedReply = { id: string; title: string; body: string };

/** Your saved replies on GitHub (Settings → Saved replies), kept for a day. Reading them needs the
 *  read:user permission, which tokens from before the app asked for it don't have: null then. */
export async function savedReplies(): Promise<SavedReply[] | null> {
  const known = stored<SavedReply[]>("saved-replies");
  if (known) return known;
  try {
    const data = await graphql<{ viewer: { savedReplies: { nodes: SavedReply[] } | null } }>("query { viewer { savedReplies(first: 100) { nodes { id title body } } } }");
    const replies = data.viewer.savedReplies?.nodes ?? null;
    if (replies) store("saved-replies", replies);
    return replies;
  } catch {
    return null;
  }
}
