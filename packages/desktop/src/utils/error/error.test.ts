import { describe, expect, it } from "vite-plus/test";

import { errorText } from "@/utils/error/error";

describe("errorText", () => {
  it("says an error's message, or what was thrown", () => {
    expect(errorText(new Error("Not Found"))).toBe("Not Found");
    expect(errorText("offline")).toBe("offline");
  });
});
