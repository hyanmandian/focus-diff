import { github, graphql } from "@/utils/bridge/bridge";
import { emojiList, type Emoji, type Person } from "@/utils/writing/writing";

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

function daily<T>(key: string) {
  return {
    get: (): T | null => {
      try {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only put() writes here, with a T
        const kept = JSON.parse(localStorage.getItem(key) ?? "null") as { at: number; value: T } | null;
        return kept && Date.now() - kept.at < 24 * 3_600_000 ? kept.value : null;
      } catch {
        return null;
      }
    },
    put: (value: T) => {
      try {
        localStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
      } catch {}
    },
  };
}

const emojiKept = daily<Emoji[]>("emoji");
const repliesKept = daily<SavedReply[]>("saved-replies");

const previews = cache<Promise<string>>(100);

let emojiAsked: Promise<Emoji[]> | null = null;
export function emoji(): Promise<Emoji[]> {
  const kept = emojiKept.get();
  if (kept) return Promise.resolve(kept);
  emojiAsked ??= github<Record<string, string>>("GET", "/emojis").then((pictures) => {
    const list = emojiList(pictures);
    emojiKept.put(list);
    return list;
  });
  emojiAsked.catch(() => (emojiAsked = null));
  return emojiAsked;
}

export function preview(text: string, repo: string): Promise<string> {
  const key = `${repo}\n${text}`;
  const known = previews.get(key);
  if (known) return known;
  const asked = github<string>("POST", "/markdown", { text, mode: "gfm", context: repo }, "text/html");
  previews.set(key, asked);
  asked.catch(() => {
    previews.delete(key);
  });
  return asked;
}

type RawPerson = { login: string; name: string | null; avatarUrl: string };
const PERSON = "login name avatarUrl(size: 40)";
const searches = cache<Promise<Person[]>>();

export async function mentionable(repo: string, query: string): Promise<Person[]> {
  const [owner, name] = repo.split("/");
  const kept = daily<Person[]>(`mentionable:${repo}`);
  let people = kept.get();
  if (!people) {
    const data = await graphql<{ repository: { mentionableUsers: { nodes: RawPerson[] } } }>(
      `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { mentionableUsers(first: 100) { nodes { ${PERSON} } } } }`,
      { owner, name },
    );
    people = data.repository.mentionableUsers.nodes;
    kept.put(people);
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
    found.catch(() => {
      searches.delete(asked);
    });
  }
  return [...local, ...(await found)];
}

export type Reference = { number: number; title: string; kind: "issue" | "pull"; state: string };
const references = cache<Promise<Reference[]>>();

export function referable(repo: string, query: string): Promise<Reference[]> {
  const key = `${repo}\n#${query}`;
  const known = references.get(key);
  if (known) return known;
  type Raw = { search: { nodes: Array<{ __typename: string; number?: number; title?: string; state?: string }> } };
  const words = /^\d+$/u.test(query) ? query : query ? `${query} in:title` : "";
  const asked = graphql<Raw>(
    `
      query ($q: String!) {
        search(query: $q, type: ISSUE, first: 8) {
          nodes {
            __typename
            ... on Issue {
              number
              title
              state
            }
            ... on PullRequest {
              number
              title
              state
            }
          }
        }
      }
    `,
    { q: `repo:${repo} ${words} sort:updated-desc`.replaceAll(/\s+/gu, " ").trim() },
  ).then((d) =>
    d.search.nodes.flatMap((n): Reference[] =>
      n.number && n.title
        ? [
            {
              number: n.number,
              title: n.title,
              kind: n.__typename === "PullRequest" ? "pull" : "issue",
              state: n.state ?? "",
            },
          ]
        : [],
    ),
  );
  references.set(key, asked);
  asked.catch(() => {
    references.delete(key);
  });
  return asked;
}

export type SavedReply = { id: string; title: string; body: string };

export async function savedReplies(): Promise<SavedReply[] | null> {
  const known = repliesKept.get();
  if (known) return known;
  try {
    const data = await graphql<{ viewer: { savedReplies: { nodes: SavedReply[] } | null } }>(
      "query { viewer { savedReplies(first: 100) { nodes { id title body } } } }",
    );
    const replies = data.viewer.savedReplies?.nodes ?? null;
    if (replies) repliesKept.put(replies);
    return replies;
  } catch {
    return null;
  }
}
