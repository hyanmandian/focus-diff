import { describe, expect, it } from "vitest";

import { parsePullRequest } from "../github-pulls/github-pulls";
import { panelItem, type EngineItem } from "./queue-panel";

const pr = parsePullRequest({
  id: "PR_1",
  number: 7,
  title: "Fix login",
  url: "u",
  state: "OPEN",
  createdAt: "c",
  updatedAt: "u",
  headRefOid: "h",
  mergeable: "MERGEABLE",
  repository: { nameWithOwner: "acme/web" },
  author: { __typename: "User", login: "ana", name: "Ana" },
  labels: { nodes: [{ name: "bug" }] },
  reviewRequests: {
    nodes: [
      { requestedReviewer: { __typename: "Team", slug: "web", organization: { login: "acme" } } },
      { requestedReviewer: null },
    ],
  },
  latestOpinionatedReviews: {
    nodes: [{ author: null, state: "APPROVED", submittedAt: null, url: "r", body: "secret" }],
  },
  comments: { nodes: [{ body: "not sent", url: "c" }] },
  commentCount: { totalCount: 2 },
  threadCount: { totalCount: 3 },
  files: { nodes: [{ path: "a" }] },
})!;

const item: EngineItem = {
  queueId: "q",
  pr,
  events: [
    { key: "k1", kind: "new", at: 1, who: pr.author, text: null },
    { key: "k2", kind: "comment", at: 2, who: null, text: "hi" },
  ],
  status: null,
  viaTeams: null,
  ci: null,
  passed: false,
  waitingSince: null,
};

describe("panelItem", () => {
  it("sends what the panel shows, as Rust serializes it", () => {
    expect(JSON.stringify(panelItem(item))).toBe(
      JSON.stringify({
        queueId: "q",
        pr: {
          id: "PR_1",
          number: 7,
          title: "Fix login",
          url: "u",
          isDraft: false,
          state: "OPEN",
          createdAt: "c",
          updatedAt: "u",
          mergedAt: null,
          headRefOid: "h",
          additions: 0,
          deletions: 0,
          changedFiles: 0,
          repository: { nameWithOwner: "acme/web" },
          author: { __typename: "User", login: "ana", name: "Ana" },
          mergedBy: null,
          labels: { nodes: [{ name: "bug" }] },
          reviewRequests: {
            nodes: [
              { requestedReviewer: { __typename: "Team", slug: "web", organization: { login: "acme" } } },
              { requestedReviewer: null },
            ],
          },
          latestOpinionatedReviews: { nodes: [{ author: null, state: "APPROVED", submittedAt: null, url: "r" }] },
          comments: 5,
        },
        events: [
          { key: "k1", kind: "new", at: 1, who: { __typename: "User", login: "ana", name: "Ana" } },
          { key: "k2", kind: "comment", at: 2, who: null, text: "hi" },
        ],
        ci: null,
      }),
    );
  });

  it("adds what's set: status, teams, CI passing, waiting", () => {
    const full = panelItem({
      ...item,
      status: "APPROVED",
      viaTeams: ["acme/web"],
      ci: "SUCCESS",
      passed: true,
      waitingSince: 9,
    });
    expect(full).toMatchObject({
      status: "APPROVED",
      viaTeams: ["acme/web"],
      ci: "SUCCESS",
      passed: true,
      waitingSince: 9,
    });
    expect(Object.keys(full)).toStrictEqual([
      "queueId",
      "pr",
      "events",
      "status",
      "viaTeams",
      "ci",
      "passed",
      "waitingSince",
    ]);
  });

  it("passes on all GitHub said of who was asked", () => {
    const asked = parsePullRequest({
      reviewRequests: {
        nodes: [
          {
            requestedReviewer: {
              __typename: "Team",
              slug: "web",
              organization: { login: "acme" },
              members: { nodes: [{ login: "me" }] },
            },
            createdAt: "2026",
          },
        ],
      },
    })!;
    expect(panelItem({ ...item, pr: asked }).pr.reviewRequests.nodes).toStrictEqual([
      {
        requestedReviewer: {
          __typename: "Team",
          slug: "web",
          organization: { login: "acme" },
          members: { nodes: [{ login: "me" }] },
        },
        createdAt: "2026",
      },
    ]);
  });

  it("copies, so the panel can't change the engine's items", () => {
    const sent = panelItem({ ...item, viaTeams: ["a"] });
    sent.viaTeams!.push("b");
    sent.pr.author!.login = "x";
    expect(pr.author?.login).toBe("ana");
  });
});
