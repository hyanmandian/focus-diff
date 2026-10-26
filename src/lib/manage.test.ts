import { describe, expect, it } from "vitest";
import { canTriage, canWrite, reviewerList, type Manage } from "./manage";

const user = (login: string) => ({ __typename: "User" as const, login, avatarUrl: "" });

describe("reviewers", () => {
  it("lists those asked, then those who answered, each once", () => {
    const list = reviewerList(
      [
        { asCodeOwner: false, requestedReviewer: user("ana") },
        { asCodeOwner: true, requestedReviewer: { __typename: "Team", name: "Core", slug: "core", combinedSlug: "acme/core" } },
        { asCodeOwner: false, requestedReviewer: null },
      ],
      [
        { author: user("ana"), state: "CHANGES_REQUESTED" },
        { author: user("bruno"), state: "APPROVED" },
        { author: null, state: "COMMENTED" },
      ],
    );
    expect(list.map((r) => [r.key, r.state, r.requested, r.codeOwner])).toEqual([
      ["ana", "CHANGES_REQUESTED", true, false],
      ["team:core", null, true, true],
      ["bruno", "APPROVED", false, false],
    ]);
  });
});

describe("permissions", () => {
  it("knows write from triage from read", () => {
    const m = (viewerPermission: Manage["viewerPermission"]) => ({ viewerPermission }) as Manage;
    expect([canWrite(m("ADMIN")), canWrite(m("WRITE")), canWrite(m("TRIAGE")), canWrite(null)]).toEqual([true, true, false, false]);
    expect([canTriage(m("TRIAGE")), canTriage(m("READ"))]).toEqual([true, false]);
  });
});
