import { describe, expect, it } from "vite-plus/test";

import { fakePlatform } from "../fake-platform/fake-platform";
import { setPlatform } from "../platform/platform";
import { avatar } from "./avatar";

const github = "https://avatars.githubusercontent.com/u/11?v=4&size=420";

describe("a person's picture", () => {
  it("asks for the size it's drawn at, from GitHub when the app keeps no copies", () => {
    expect(avatar(github)).toBe("https://avatars.githubusercontent.com/u/11?v=4&s=48");
    expect(avatar("https://example.com/me.png", 40)).toBe("https://example.com/me.png?s=40");
  });

  it("comes through the app's copies where it keeps them", () => {
    setPlatform({ ...fakePlatform, mediaUrl: (kind, url) => `${kind}:${url}` });
    try {
      expect(avatar(github)).toBe("avatar:https://avatars.githubusercontent.com/u/11?v=4&s=48");
      // Pictures from elsewhere aren't kept.
      expect(avatar("https://example.com/me.png")).toBe("https://example.com/me.png?s=48");
    } finally {
      setPlatform(fakePlatform);
    }
  });

  it("leaves something that isn't a URL as it is", () => {
    expect(avatar("not a url")).toBe("not a url");
  });
});
